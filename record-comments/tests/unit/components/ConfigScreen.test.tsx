// @vitest-environment jsdom

import { buildPluginParams } from '@utils/pluginParams';
import { act, type ReactNode, StrictMode } from 'react';
import { describe, expect, it, vi } from 'vitest';
import ConfigScreen from '@/entrypoints/ConfigScreen';
import { createApiClient } from '@/utils/cmaClient';
import { flushPromises, render } from '../testUtils/react';

vi.mock('@/utils/cmaClient', () => ({ createApiClient: vi.fn() }));

vi.mock('datocms-react-ui', () => ({
  Button: ({
    children,
    disabled,
    onClick,
  }: {
    children?: ReactNode;
    disabled?: boolean;
    onClick?: () => void | Promise<void>;
  }) => (
    <button
      disabled={disabled}
      onClick={() => {
        void onClick?.();
      }}
      type="button"
    >
      {children}
    </button>
  ),
  Canvas: ({ children }: { children?: ReactNode }) => <div>{children}</div>,
  Section: ({ children }: { children?: ReactNode }) => (
    <section>{children}</section>
  ),
  Spinner: () => <span>Loading</span>,
  SwitchField: ({
    disabled,
    label,
    onChange,
    value,
  }: {
    disabled?: boolean;
    label: string;
    onChange: (value: boolean) => void;
    value: boolean;
  }) => (
    <label>
      <span>{label}</span>
      <input
        aria-label={label}
        checked={value}
        disabled={disabled}
        onChange={(event) => onChange(event.currentTarget.checked)}
        type="checkbox"
      />
    </label>
  ),
  TextField: ({
    disabled,
    label,
    onChange,
    value,
  }: {
    disabled?: boolean;
    label: string;
    onChange: (value: string) => void;
    value: string;
  }) => (
    <label>
      <span>{label}</span>
      <input
        aria-label={label}
        disabled={disabled}
        onChange={(event) => onChange(event.currentTarget.value)}
        type="text"
        value={value}
      />
    </label>
  ),
}));

function createCtx(overrides: Record<string, unknown> = {}) {
  return {
    alert: vi.fn().mockResolvedValue(undefined),
    currentRole: {
      meta: {
        final_permissions: {
          can_edit_schema: true,
        },
      },
    },
    environment: 'main',
    currentUserAccessToken: 'token',
    itemTypes: {},
    loadItemTypeFields: vi.fn().mockResolvedValue([]),
    notice: vi.fn().mockResolvedValue(undefined),
    plugin: {
      attributes: {
        parameters: {},
      },
    },
    updatePluginParameters: vi.fn().mockResolvedValue(undefined),
    ...overrides,
  };
}

function setTextInputValue(input: HTMLInputElement, value: string) {
  act(() => {
    const descriptor = Object.getOwnPropertyDescriptor(
      HTMLInputElement.prototype,
      'value',
    );
    descriptor?.set?.call(input, value);
    input.dispatchEvent(new Event('input', { bubbles: true }));
  });
}

function click(button: HTMLButtonElement) {
  act(() => {
    button.dispatchEvent(
      new MouseEvent('click', { bubbles: true, cancelable: true }),
    );
  });
}

function setupMigration(commentLog: unknown) {
  let destination: Record<string, unknown> | undefined;
  let fieldExists = true;
  const source = () => ({
    id: 'record-1',
    attributes: { comment_log: commentLog },
    meta: { updated_at: '2026-01-01T00:00:00Z' },
  });
  const field = {
    id: 'legacy-field',
    api_key: 'comment_log',
    localized: false,
  };
  const destroy = vi.fn(async () => {
    fieldExists = false;
  });
  const create = vi.fn(async (body: Record<string, unknown>) => {
    destination = body;
    return body;
  });
  const client = {
    fields: {
      list: vi.fn(async (modelId: string) =>
        modelId === 'comments-model'
          ? [
              {
                api_key: 'record_id',
                field_type: 'string',
                localized: false,
                validators: { unique: {} },
              },
              {
                api_key: 'model_id',
                field_type: 'string',
                localized: false,
                validators: {},
              },
              {
                api_key: 'content',
                field_type: 'json',
                localized: false,
                validators: {},
              },
            ]
          : fieldExists
            ? [field]
            : [],
      ),
      destroy,
    },
    items: {
      create,
      list: vi.fn(async () => (destination ? [destination] : [])),
      rawList: vi.fn(async (query: { filter: { type: string } }) => ({
        data:
          query.filter.type === 'source-model'
            ? [source()]
            : destination
              ? [{ id: destination.id, attributes: destination }]
              : [],
        meta: {
          total_count:
            query.filter.type === 'source-model' || destination ? 1 : 0,
        },
      })),
    },
  };
  vi.mocked(createApiClient).mockReturnValue(client as never);
  const alert = vi.fn().mockResolvedValue(undefined);
  const notice = vi.fn().mockResolvedValue(undefined);
  const ctx = createCtx({
    alert,
    notice,
    currentRole: {
      attributes: {
        positive_item_type_permissions: [
          {
            environment: 'main',
            item_type: null,
            action: 'read',
            on_creator: 'anyone',
          },
        ],
        negative_item_type_permissions: [],
      },
      meta: { final_permissions: { can_edit_schema: true } },
    },
    itemTypes: {
      source: {
        id: 'source-model',
        attributes: { name: 'Article', api_key: 'article' },
      },
      comments: {
        id: 'comments-model',
        attributes: { name: 'Comments', api_key: 'project_comment' },
      },
    },
    currentUser: { id: 'user-1', attributes: { email: 'jane@example.com' } },
    owner: {
      id: 'owner-1',
      type: 'account',
      attributes: { email: 'owner@example.com' },
    },
    loadUsers: vi.fn().mockResolvedValue([]),
    loadSsoUsers: vi.fn().mockResolvedValue([]),
    loadItemTypeFields: vi.fn().mockResolvedValue([
      {
        id: field.id,
        attributes: { api_key: field.api_key, localized: false },
      },
    ]),
  });
  const view = render(<ConfigScreen ctx={ctx as never} />);
  const button = (text: string) => {
    const result = Array.from(view.container.querySelectorAll('button')).find(
      (candidate) => candidate.textContent === text,
    );
    if (!result) throw new Error(`Button missing: ${text}`);
    return result;
  };
  return {
    view,
    ctx,
    alert,
    notice,
    button,
    destroy,
    create,
    changeEnvironment: (environment: string) => {
      view.rerender(<ConfigScreen ctx={{ ...ctx, environment } as never} />);
    },
    setCommentLog: (value: unknown) => {
      commentLog = value;
    },
    loseDeleteResponse: () => {
      destroy.mockImplementationOnce(async () => {
        fieldExists = false;
        throw new TypeError('Failed to fetch');
      });
    },
  };
}

const oldComment = {
  dateISO: '2024-01-01T00:00:00.000Z',
  author: { name: 'Jane', email: 'jane@example.com' },
  usersWhoUpvoted: [],
  content: 'Legacy comment',
};

describe('ConfigScreen', () => {
  it('never exposes cleanup after a malformed legacy record', async () => {
    const state = setupMigration([oldComment, {}]);
    click(state.button('Scan for Legacy Comments'));
    await flushPromises();
    click(state.button('Start Migration'));
    await flushPromises();
    expect(state.create).not.toHaveBeenCalled();
    expect(state.view.container.textContent).toContain(
      'complete record was preserved',
    );
    expect(state.view.container.textContent).not.toContain(
      'Delete Old comment_log Fields',
    );
    state.view.unmount();
  });

  it('revalidates changed legacy comments and keeps the field', async () => {
    const state = setupMigration([oldComment]);
    click(state.button('Scan for Legacy Comments'));
    await flushPromises();
    click(state.button('Start Migration'));
    await flushPromises();
    state.setCommentLog([
      { ...oldComment, content: 'Changed after migration' },
    ]);
    click(state.button('Delete Old comment_log Fields'));
    click(state.button('Yes, Delete Fields'));
    await flushPromises();
    expect(state.destroy).not.toHaveBeenCalled();
    expect(state.alert).toHaveBeenCalledWith(
      expect.stringContaining('failed verification'),
    );
    state.view.unmount();
  });

  it('reconciles a deleted field after a lost response', async () => {
    const state = setupMigration([oldComment]);
    click(state.button('Scan for Legacy Comments'));
    await flushPromises();
    click(state.button('Start Migration'));
    await flushPromises();
    state.loseDeleteResponse();
    click(state.button('Delete Old comment_log Fields'));
    click(state.button('Yes, Delete Fields'));
    await flushPromises();
    expect(state.destroy).toHaveBeenCalledTimes(1);
    expect(state.notice).toHaveBeenCalledWith(
      'Old comment_log fields have been deleted successfully!',
    );
    expect(state.view.container.textContent).not.toContain(
      'Delete Old comment_log Fields',
    );
    state.view.unmount();
  });

  it('requires a new migration verification after switching environments', async () => {
    const state = setupMigration([oldComment]);
    click(state.button('Scan for Legacy Comments'));
    await flushPromises();
    click(state.button('Start Migration'));
    await flushPromises();
    expect(state.view.container.textContent).toContain(
      'Delete Old comment_log Fields',
    );
    state.changeEnvironment('sandbox');
    await flushPromises();
    expect(state.view.container.textContent).not.toContain(
      'Delete Old comment_log Fields',
    );
    expect(state.view.container.textContent).not.toContain('Found 1 model(s)');
    expect(state.destroy).not.toHaveBeenCalled();
    state.view.unmount();
  });

  it('ignores completion of an in-flight migration after switching environments', async () => {
    const state = setupMigration([oldComment]);
    const pending: { resolve?: () => void } = {};
    state.create.mockImplementationOnce(
      (body) =>
        new Promise((resolve) => {
          pending.resolve = () => resolve(body);
        }),
    );
    click(state.button('Scan for Legacy Comments'));
    await flushPromises();
    click(state.button('Start Migration'));
    await flushPromises();
    expect(state.create).toHaveBeenCalledTimes(1);
    state.changeEnvironment('sandbox');
    pending.resolve?.();
    await flushPromises();
    expect(state.view.container.textContent).not.toContain(
      'Delete Old comment_log Fields',
    );
    expect(state.notice).not.toHaveBeenCalledWith(
      'Migration completed successfully!',
    );
    expect(state.destroy).not.toHaveBeenCalled();
    state.view.unmount();
  });

  it('clears the saving state after save completes in StrictMode', async () => {
    let resolveSave: (() => void) | undefined;
    const updatePluginParameters = vi.fn(
      () =>
        new Promise<void>((resolve) => {
          resolveSave = resolve;
        }),
    );
    const notice = vi.fn().mockResolvedValue(undefined);
    const ctx = createCtx({ notice, updatePluginParameters });

    const view = render(
      <StrictMode>
        <ConfigScreen ctx={ctx as never} />
      </StrictMode>,
    );

    const tokenInput = view.container.querySelector(
      'input[aria-label="Content Delivery API Token"]',
    ) as HTMLInputElement | null;

    expect(tokenInput).not.toBeNull();
    setTextInputValue(tokenInput as HTMLInputElement, '  demo-token  ');

    const saveButton = Array.from(
      view.container.querySelectorAll('button'),
    ).find((button) => button.textContent === 'Save Settings') as
      | HTMLButtonElement
      | undefined;

    expect(saveButton).toBeDefined();
    expect((saveButton as HTMLButtonElement).disabled).toBe(false);

    click(saveButton as HTMLButtonElement);

    expect(updatePluginParameters).toHaveBeenCalledWith(
      buildPluginParams({
        cdaToken: 'demo-token',
        debugLoggingEnabled: false,
        migrationCompleted: false,
        realTimeUpdatesEnabled: true,
      }),
    );
    expect((saveButton as HTMLButtonElement).textContent).toBe('Saving...');

    resolveSave?.();
    await flushPromises();

    expect((saveButton as HTMLButtonElement).textContent).toBe('Save Settings');
    expect(notice).toHaveBeenCalledWith('Settings saved successfully!');

    view.unmount();
  });
});
