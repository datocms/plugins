import { act, cleanup, render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import type { RenderPageCtx } from 'datocms-plugin-sdk';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type {
  FindReplaceAppProps,
  FindReplaceController,
} from '../findReplace/contract';
import { createFindReplaceController } from '../findReplace/createFindReplaceController';
import { devHooks } from '../findReplace/devHooks';
import { fetchRecordTotal } from '../selection/query';
import { loadSchemaIndex } from '../selection/schemaIndex';
import type { SchemaIndex } from '../selection/types';
import type { ModelSummary } from '../types';
import { loadModels, loadSiteLocales } from '../utils/schema';
import FindReplacePage from './FindReplacePage';

vi.mock('../utils/cma', () => ({
  buildCmaClient: vi.fn(() => ({ fake: 'client' })),
}));
vi.mock('../utils/schema', () => ({
  loadModels: vi.fn(),
  loadSiteLocales: vi.fn(),
}));
vi.mock('../selection/schemaIndex', () => ({
  loadSchemaIndex: vi.fn(),
}));
vi.mock('../selection/query', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../selection/query')>()),
  fetchRecordTotal: vi.fn(),
}));
vi.mock('../findReplace/createFindReplaceController', () => ({
  createFindReplaceController: vi.fn(),
}));
vi.mock('../findReplace/ui/FindReplaceApp', () => ({
  FindReplaceApp: ({ boot }: FindReplaceAppProps) => (
    <div>
      <p data-testid="boot">
        {boot.status === 'unavailable' || boot.status === 'failed'
          ? `${boot.status}/${boot.cause}`
          : boot.status}
      </p>
      {boot.status === 'failed' && (
        <button type="button" onClick={boot.retry}>
          Try again
        </button>
      )}
    </div>
  ),
}));

const MODELS: ModelSummary[] = [
  { id: 'article', name: 'Article', apiKey: 'article', workflowId: null },
  { id: 'page', name: 'Page', apiKey: 'page', workflowId: null },
];
const SCHEMA = { rootModelIds: ['article', 'page'] } as unknown as SchemaIndex;

type CtxPatch = {
  environment?: string;
  token?: string | null;
  roleId?: string;
  positiveRules?: unknown[];
  parameters?: Record<string, unknown>;
  internalDomain?: string | null;
  isEnvironmentPrimary?: boolean;
  colorScheme?: string;
  cssDesignTokens?: Record<string, string>;
};

function makeCtx(patch: CtxPatch = {}): RenderPageCtx {
  const environment = patch.environment ?? 'main';
  return {
    mode: 'renderPage',
    environment,
    isEnvironmentPrimary: patch.isEnvironmentPrimary ?? true,
    cmaBaseUrl: 'https://site-api.datocms.com',
    currentUserAccessToken:
      patch.token === null ? undefined : (patch.token ?? 'token-1'),
    currentRole: {
      id: patch.roleId ?? 'role-1',
      type: 'role',
      meta: {
        final_permissions: {
          positive_item_type_permissions: patch.positiveRules ?? [
            { environment, action: 'all', item_type: null, workflow: null },
          ],
          negative_item_type_permissions: [],
          can_edit_schema: false,
        },
      },
    },
    plugin: {
      id: 'plugin-1',
      attributes: { parameters: patch.parameters ?? {} },
    },
    site: {
      id: 'site-1',
      attributes: {
        internal_domain:
          patch.internalDomain === undefined
            ? 'acme.admin.datocms.com'
            : patch.internalDomain,
      },
    },
    theme: {},
    cssDesignTokens: patch.cssDesignTokens ?? {},
    colorScheme: patch.colorScheme ?? 'light',
    ui: { locale: 'en' },
  } as unknown as RenderPageCtx;
}

type FakeController = FindReplaceController & {
  dispose: ReturnType<typeof vi.fn>;
};

const controllers: FakeController[] = [];

beforeEach(() => {
  controllers.length = 0;
  vi.mocked(loadModels).mockResolvedValue(MODELS);
  vi.mocked(loadSiteLocales).mockResolvedValue(['en', 'it']);
  vi.mocked(loadSchemaIndex).mockResolvedValue(SCHEMA);
  vi.mocked(fetchRecordTotal).mockResolvedValue(12_345);
  vi.mocked(createFindReplaceController).mockImplementation(() => {
    const controller = { dispose: vi.fn() } as unknown as FakeController;
    controllers.push(controller);
    return controller;
  });
});

afterEach(() => {
  cleanup();
  vi.clearAllMocks();
  devHooks.onController = undefined;
});

async function bootStatus(expected: string): Promise<void> {
  expect(await screen.findByText(expected)).toBeInTheDocument();
}

describe('FindReplacePage', () => {
  it('boots once and survives host updates with equal primitives', async () => {
    const { rerender } = render(<FindReplacePage ctx={makeCtx()} />);
    expect(screen.getByTestId('boot')).toHaveTextContent('booting');
    await bootStatus('ready');

    rerender(<FindReplacePage ctx={makeCtx()} />);
    rerender(
      <FindReplacePage
        ctx={makeCtx({
          colorScheme: 'dark',
          cssDesignTokens: { '--color--surface': '#000' },
        })}
      />,
    );
    await act(async () => {});

    expect(loadModels).toHaveBeenCalledTimes(1);
    expect(createFindReplaceController).toHaveBeenCalledTimes(1);
    expect(controllers[0]?.dispose).not.toHaveBeenCalled();
    expect(screen.getByTestId('boot')).toHaveTextContent('ready');
  });

  it.each<[string, CtxPatch]>([
    ['role', { roleId: 'role-2' }],
    [
      'permissions',
      {
        positiveRules: [
          {
            environment: 'main',
            action: 'all',
            item_type: 'article',
            workflow: null,
          },
        ],
      },
    ],
    ['parameters', { parameters: { restrictToModels: false } }],
    ['environment', { environment: 'sandbox', isEnvironmentPrimary: false }],
    ['token', { token: 'token-2' }],
  ])('boots again when the %s changes', async (_, patch) => {
    const { rerender } = render(<FindReplacePage ctx={makeCtx()} />);
    await bootStatus('ready');

    rerender(<FindReplacePage ctx={makeCtx(patch)} />);
    await act(async () => {});
    await bootStatus('ready');

    expect(controllers[0]?.dispose).toHaveBeenCalledTimes(1);
    expect(loadModels).toHaveBeenCalledTimes(2);
    expect(createFindReplaceController).toHaveBeenCalledTimes(2);
  });

  it('asks for the token before any request', async () => {
    render(<FindReplacePage ctx={makeCtx({ token: null })} />);
    await bootStatus('unavailable/token');
    expect(loadModels).not.toHaveBeenCalled();
  });

  it('refuses roles outside the allowlist before any request', async () => {
    render(
      <FindReplacePage
        ctx={makeCtx({
          parameters: { restrictToRoles: true, allowedRoleIds: ['editor'] },
        })}
      />,
    );
    await bootStatus('unavailable/role');
    expect(loadModels).not.toHaveBeenCalled();
  });

  it('is unavailable without a model the role can read and update', async () => {
    render(<FindReplacePage ctx={makeCtx({ positiveRules: [] })} />);
    await bootStatus('unavailable/no_models');
    expect(loadSchemaIndex).not.toHaveBeenCalled();
    expect(createFindReplaceController).not.toHaveBeenCalled();
  });

  it('maps network errors to `network` and retries', async () => {
    vi.mocked(loadModels).mockRejectedValueOnce(
      new TypeError('Failed to fetch'),
    );
    render(<FindReplacePage ctx={makeCtx()} />);
    await bootStatus('failed/network');

    await userEvent.click(screen.getByRole('button', { name: 'Try again' }));
    await bootStatus('ready');
    expect(loadModels).toHaveBeenCalledTimes(2);
  });

  it('never shows the error text', async () => {
    vi.mocked(loadSchemaIndex).mockRejectedValueOnce(new Error('secret'));
    render(<FindReplacePage ctx={makeCtx()} />);
    await bootStatus('failed/unknown');
    expect(document.body.textContent).not.toContain('secret');
  });

  it('creates the controller from ctx and the permitted models, and disposes it on unmount', async () => {
    const onController = vi.fn();
    devHooks.onController = onController;
    const { unmount } = render(
      <FindReplacePage
        ctx={makeCtx({
          parameters: { restrictToModels: true, allowedModelIds: ['page'] },
          internalDomain: null,
          isEnvironmentPrimary: false,
          environment: 'sandbox',
        })}
      />,
    );
    await bootStatus('ready');

    expect(loadSchemaIndex).toHaveBeenCalledWith(
      { fake: 'client' },
      { rootModelIds: ['page'] },
    );
    expect(createFindReplaceController).toHaveBeenCalledWith({
      client: { fake: 'client' },
      schema: SCHEMA,
      siteId: 'site-1',
      environment: 'sandbox',
      locales: ['en', 'it'],
      links: { internalDomain: null, isEnvironmentPrimary: false },
      canPublishModel: expect.any(Function),
      recordCount: 12_345,
    });
    expect(fetchRecordTotal).toHaveBeenCalledWith({ fake: 'client' }, ['page']);
    expect(onController).toHaveBeenCalledWith(controllers[0]);

    unmount();
    expect(controllers[0]?.dispose).toHaveBeenCalledTimes(1);
  });

  it('boots with an unknown record count when counting fails', async () => {
    vi.mocked(fetchRecordTotal).mockRejectedValueOnce(new TypeError('offline'));
    render(<FindReplacePage ctx={makeCtx()} />);
    await bootStatus('ready');

    expect(createFindReplaceController).toHaveBeenCalledWith(
      expect.objectContaining({ recordCount: null }),
    );
  });

  it('disposes a controller that arrives after the page moved on', async () => {
    let resolveSchema: (schema: SchemaIndex) => void = () => undefined;
    vi.mocked(loadSchemaIndex).mockImplementationOnce(
      () =>
        new Promise<SchemaIndex>((resolve) => {
          resolveSchema = resolve;
        }),
    );
    const { unmount } = render(<FindReplacePage ctx={makeCtx()} />);
    await act(async () => {});
    unmount();
    await act(async () => {
      resolveSchema(SCHEMA);
    });
    expect(createFindReplaceController).not.toHaveBeenCalled();
  });
});
