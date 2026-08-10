import { beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';

type TestContext = {
  currentRole: { id: string };
  plugin: {
    attributes: {
      parameters: {
        enableRecordSidebar: boolean;
        allowedRoleIds: string[] | null;
      };
    };
  };
  site: { id: string };
};

type CapturedHooks = {
  mainNavigationTabs(ctx: TestContext): unknown[];
  itemFormSidebars(itemType: unknown, ctx: TestContext): unknown[];
  renderInspector(inspectorId: string, ctx: TestContext): void;
  renderItemFormSidebar(sidebarId: string, ctx: TestContext): void;
};

const mocks = vi.hoisted(() => ({
  hooks: undefined as CapturedHooks | undefined,
  render: vi.fn(),
}));

vi.mock('datocms-plugin-sdk', () => ({
  connect: (hooks: unknown) => {
    mocks.hooks = hooks as CapturedHooks;
  },
}));

vi.mock('./utils/render', () => ({ render: mocks.render }));

vi.mock('./lib/oauth', async (importOriginal) => {
  const original = await importOriginal<typeof import('./lib/oauth')>();
  return { ...original, handleOAuthCallbackIfPresent: () => false };
});

function context(roleId: string, allowedRoleIds: string[] | null): TestContext {
  return {
    currentRole: { id: roleId },
    plugin: {
      attributes: {
        parameters: {
          enableRecordSidebar: true,
          allowedRoleIds,
        },
      },
    },
    site: { id: 'site' },
  };
}

function renderedComponentName(): string | undefined {
  const element = mocks.render.mock.calls[0]?.[0] as
    | { type?: { name?: string } }
    | undefined;
  return element?.type?.name;
}

beforeAll(async () => {
  await import('./main');
});

beforeEach(() => {
  mocks.render.mockClear();
});

describe('Dato Agent role-gated plugin surfaces', () => {
  it('exposes tabs and sidebars only to owners or explicitly allowed roles', () => {
    const hooks = mocks.hooks;
    expect(hooks).toBeDefined();

    expect(
      hooks?.mainNavigationTabs(context('account_role', null)),
    ).toHaveLength(1);
    expect(hooks?.mainNavigationTabs(context('editor-role', null))).toEqual([]);
    expect(
      hooks?.mainNavigationTabs(context('editor-role', ['editor-role'])),
    ).toHaveLength(1);

    expect(
      hooks?.itemFormSidebars({}, context('account_role', null)),
    ).toHaveLength(1);
    expect(hooks?.itemFormSidebars({}, context('editor-role', []))).toEqual([]);
    expect(
      hooks?.itemFormSidebars({}, context('editor-role', ['editor-role'])),
    ).toHaveLength(1);
  });

  it('fails closed when stale inspector or sidebar routes render directly', () => {
    const hooks = mocks.hooks;
    const denied = context('editor-role', []);

    hooks?.renderInspector('dato-agent', denied);
    expect(mocks.render).toHaveBeenCalledOnce();
    expect(renderedComponentName()).toBe('AgentUnavailableFrame');

    mocks.render.mockClear();
    hooks?.renderItemFormSidebar('dato-agent', denied);
    expect(mocks.render).toHaveBeenCalledOnce();
    expect(renderedComponentName()).toBe('AgentUnavailableFrame');
  });
});
