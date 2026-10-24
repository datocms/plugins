// @vitest-environment jsdom

import { buildPluginParams } from '@utils/pluginParams';
import { act, StrictMode } from 'react';
import { describe, expect, it, vi } from 'vitest';
import ConfigScreen from '@/entrypoints/ConfigScreen';
import { createApiClient } from '@/utils/cmaClient';
import { createCanvasCtx, renderInCanvas } from '../testUtils/canvas';
import { flushPromises } from '../testUtils/react';

vi.mock('@/utils/cmaClient', () => ({ createApiClient: vi.fn() }));

function createCtx(overrides: Record<string, unknown> = {}) {
  return createCanvasCtx<Record<string, unknown>>({
    currentRole: {
      meta: {
        final_permissions: {
          can_edit_schema: true,
        },
      },
    },
    currentUserAccessToken: 'token',
    itemTypes: {},
    loadItemTypeFields: vi.fn().mockResolvedValue([]),
    updatePluginParameters: vi.fn().mockResolvedValue(undefined),
    ...overrides,
  });
}

// The migration chains many awaits: let all of them settle
async function settle() {
  for (let i = 0; i < 5; i++) {
    // biome-ignore lint/performance/noAwaitInLoops: Each round settles the next step.
    await flushPromises();
  }
}

// The input that a visible label points to (label for -> input)
function inputByLabel(container: HTMLElement, text: string) {
  const label = Array.from(container.querySelectorAll('label')).find(
    (candidate) => candidate.textContent?.trim().startsWith(text),
  );
  const input = label?.htmlFor
    ? container.ownerDocument.getElementById(label.htmlFor)
    : null;
  if (!(input instanceof HTMLInputElement))
    throw new Error(`Input missing: ${text}`);
  return input;
}

function findButton(container: HTMLElement, text: string) {
  return Array.from(container.querySelectorAll('button')).find(
    (candidate) => candidate.textContent === text,
  );
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

function click(element: HTMLElement) {
  act(() => {
    element.dispatchEvent(
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
  // The host's confirm dialog: the user picks "Delete fields"
  const openConfirm = vi.fn().mockResolvedValue(true);
  const ctx = createCtx({
    alert,
    notice,
    openConfirm,
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
  const view = renderInCanvas(<ConfigScreen ctx={ctx as never} />, ctx);
  const button = (text: string) => {
    const result = findButton(view.container, text);
    if (!result) throw new Error(`Button missing: ${text}`);
    return result;
  };
  return {
    view,
    ctx,
    alert,
    notice,
    openConfirm,
    button,
    hasButton: (text: string) => findButton(view.container, text) !== undefined,
    destroy,
    create,
    changeEnvironment: (environment: string) => {
      const nextCtx = { ...ctx, environment };
      view.rerender(<ConfigScreen ctx={nextCtx as never} />, nextCtx);
    },
    setCommentLog: (value: unknown) => {
      commentLog = value;
    },
  };
}

const oldComment = {
  dateISO: '2024-01-01T00:00:00.000Z',
  author: { name: 'Jane', email: 'jane@example.com' },
  usersWhoUpvoted: [],
  content: 'Legacy comment',
};

async function scanAndMigrate(state: ReturnType<typeof setupMigration>) {
  // The group starts closed: its title opens it
  click(state.button('Legacy comments'));
  click(state.button('Scan for legacy comments'));
  await settle();
  click(state.button('Migrate comments'));
  await settle();
}

describe('ConfigScreen', () => {
  it('never exposes cleanup after a malformed legacy record', async () => {
    const state = setupMigration([oldComment, {}]);
    await scanAndMigrate(state);
    expect(state.create).not.toHaveBeenCalled();
    expect(state.view.container.textContent).toContain(
      'complete record was preserved',
    );
    expect(state.view.container.textContent).toContain('1 record failed');
    expect(state.hasButton('Delete fields')).toBe(false);
    // Records that failed are an error, not a success
    expect(state.alert).toHaveBeenCalledWith(
      'The migration ended with 1 error. Check the details in the settings.',
    );
    expect(state.notice).not.toHaveBeenCalledWith(
      expect.stringContaining('The migration ended'),
    );
    state.view.unmount();
  });

  it('warns when the scan could not inspect a model', async () => {
    const notice = vi.fn().mockResolvedValue(undefined);
    const customToast = vi.fn().mockResolvedValue(null);
    const ctx = createCtx({
      notice,
      customToast,
      itemTypes: {
        source: {
          id: 'source-model',
          attributes: { name: 'Article', api_key: 'article' },
        },
      },
      loadItemTypeFields: vi.fn().mockRejectedValue(new Error('Forbidden')),
    });
    const view = renderInCanvas(<ConfigScreen ctx={ctx as never} />, ctx);

    click(findButton(view.container, 'Legacy comments') as HTMLElement);
    click(
      findButton(view.container, 'Scan for legacy comments') as HTMLElement,
    );
    await settle();

    expect(customToast).toHaveBeenCalledWith({
      type: 'warning',
      message:
        "The scan couldn't inspect 1 model. Check the list before migrating.",
      dismissOnPageChange: true,
    });
    expect(notice).not.toHaveBeenCalled();
    expect(view.container.textContent).toContain("1 model wasn't inspected");
    // The model that failed shows with its API key, as the found models do
    const failedModel = Array.from(view.container.querySelectorAll('li')).find(
      (item) => item.textContent?.startsWith('Article'),
    );
    expect(failedModel?.textContent).toBe('Article article');
    expect(
      Array.from(failedModel?.querySelectorAll('*') ?? []).some(
        (element) => element.textContent === 'article',
      ),
    ).toBe(true);

    view.unmount();
  });

  it('revalidates changed legacy comments and keeps the field', async () => {
    const state = setupMigration([oldComment]);
    await scanAndMigrate(state);
    state.setCommentLog([
      { ...oldComment, content: 'Changed after migration' },
    ]);
    click(state.button('Delete fields'));
    await settle();
    expect(state.openConfirm).toHaveBeenCalledWith(
      expect.objectContaining({ title: 'Delete 1 legacy field?' }),
    );
    expect(state.destroy).not.toHaveBeenCalled();
    expect(state.alert).toHaveBeenCalledWith(
      expect.stringContaining('failed verification'),
    );
    state.view.unmount();
  });

  it('opens the legacy group to show the progress of the cleanup', async () => {
    const state = setupMigration([oldComment]);
    await scanAndMigrate(state);
    const legacyTitle = () => state.button('Legacy comments');
    // The user closes the group after the migration
    click(legacyTitle());
    expect(legacyTitle().getAttribute('aria-expanded')).toBe('false');

    // The cleanup starts in the Danger zone
    click(state.button('Delete fields'));
    await settle();
    expect(legacyTitle().getAttribute('aria-expanded')).toBe('true');
    expect(state.destroy).toHaveBeenCalledTimes(1);
    state.view.unmount();
  });

  it('keeps the fields when the confirm is cancelled', async () => {
    const state = setupMigration([oldComment]);
    await scanAndMigrate(state);
    state.openConfirm.mockResolvedValueOnce(false);
    click(state.button('Delete fields'));
    await settle();
    expect(state.destroy).not.toHaveBeenCalled();
    expect(state.notice).not.toHaveBeenCalledWith('Legacy fields deleted');
    state.view.unmount();
  });

  it('requires a new migration verification after switching environments', async () => {
    const state = setupMigration([oldComment]);
    await scanAndMigrate(state);
    expect(state.hasButton('Delete fields')).toBe(true);
    expect(state.view.container.textContent).toContain(
      '1 model with a comment_log field',
    );
    state.changeEnvironment('sandbox');
    await settle();
    expect(state.hasButton('Delete fields')).toBe(false);
    expect(state.view.container.textContent).not.toContain(
      '1 model with a comment_log field',
    );
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
    await scanAndMigrate(state);
    expect(state.create).toHaveBeenCalledTimes(1);
    state.changeEnvironment('sandbox');
    pending.resolve?.();
    await settle();
    expect(state.hasButton('Delete fields')).toBe(false);
    expect(state.notice).not.toHaveBeenCalledWith('Comments migrated');
    expect(state.destroy).not.toHaveBeenCalled();
    state.view.unmount();
  });

  it('shows the token field only while real-time updates are on', () => {
    const ctx = createCtx();
    const view = renderInCanvas(<ConfigScreen ctx={ctx as never} />, ctx);

    expect(
      inputByLabel(view.container, 'Content Delivery API token'),
    ).toBeDefined();
    click(inputByLabel(view.container, 'Real-time updates'));
    expect(() =>
      inputByLabel(view.container, 'Content Delivery API token'),
    ).toThrow();

    view.unmount();
  });

  it('gives the missing token as the error of its field once it blocks the save', () => {
    const ctx = createCtx();
    const view = renderInCanvas(<ConfigScreen ctx={ctx as never} />, ctx);
    const token = () =>
      inputByLabel(view.container, 'Content Delivery API token');

    // Nothing changed yet: no error on load
    expect(token().getAttribute('aria-invalid')).toBeNull();

    click(inputByLabel(view.container, 'Debug logging'));

    expect(token().getAttribute('aria-invalid')).toBe('true');
    expect(view.container.textContent).toContain(
      'Enter a Content Delivery API token',
    );

    setTextInputValue(token(), 'demo-token');
    expect(token().getAttribute('aria-invalid')).toBeNull();

    view.unmount();
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

    const view = renderInCanvas(
      <StrictMode>
        <ConfigScreen ctx={ctx as never} />
      </StrictMode>,
      ctx,
    );

    const save = () => findButton(view.container, 'Save');

    // Nothing to save yet: the button says why
    expect(save()?.getAttribute('aria-disabled')).toBe('true');

    setTextInputValue(
      inputByLabel(view.container, 'Content Delivery API token'),
      '  demo-token  ',
    );

    const saveButton = save();
    expect(saveButton).toBeDefined();
    expect(saveButton?.getAttribute('aria-disabled')).toBeNull();
    expect(saveButton?.disabled).toBe(false);

    click(saveButton as HTMLButtonElement);

    expect(updatePluginParameters).toHaveBeenCalledWith(
      buildPluginParams({
        cdaToken: 'demo-token',
        debugLoggingEnabled: false,
        migrationCompleted: false,
        realTimeUpdatesEnabled: true,
      }),
    );
    expect(save()?.getAttribute('aria-busy')).toBe('true');
    expect(save()?.disabled).toBe(true);

    resolveSave?.();
    await flushPromises();

    expect(save()?.getAttribute('aria-busy')).toBeNull();
    expect(notice).toHaveBeenCalledWith('Settings saved');
    expect(
      inputByLabel(view.container, 'Content Delivery API token').value,
    ).toBe('demo-token');

    view.unmount();
  });
});
