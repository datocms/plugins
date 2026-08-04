import { act, cleanup, render, waitFor } from '@testing-library/react';
import type {
  Field,
  ItemType,
  RenderItemFormSidebarCtx,
} from 'datocms-plugin-sdk';
import { type ReactNode, useRef } from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  type Conversation,
  createConversationStore,
} from '../lib/conversations';
import type { AgentFrameProps } from './AgentFrame';
import AgentSidebar from './AgentSidebar';

const mocks = vi.hoisted(() => ({
  frameProps: undefined as AgentFrameProps | undefined,
  nextFrameMountId: 0,
}));

vi.mock('datocms-react-ui', () => ({
  Canvas: ({ children }: { children?: ReactNode }) => children,
}));

vi.mock('./AgentFrame', () => ({
  default: (props: AgentFrameProps) => {
    const mountId = useRef(++mocks.nextFrameMountId).current;
    mocks.frameProps = props;
    return (
      <div
        data-frame-mount-id={mountId}
        data-scope={JSON.stringify(props.scope)}
        data-testid="agent-frame"
      />
    );
  },
}));

beforeEach(() => {
  localStorage.clear();
});

afterEach(() => {
  cleanup();
  mocks.frameProps = undefined;
  mocks.nextFrameMountId = 0;
});

function field(
  id: string,
  apiKey: string,
  localized = false,
  fieldType: Field['attributes']['field_type'] = 'string',
): Field {
  return {
    id,
    type: 'field',
    attributes: {
      api_key: apiKey,
      label: apiKey === 'title' ? 'Title' : 'Body',
      field_type: fieldType,
      localized,
      hint: null,
      validators: {},
      appearance: {
        editor: 'single_line',
        parameters: {},
        addons: [],
      },
      position: 1,
    },
    relationships: {
      item_type: { data: { id: 'model', type: 'item_type' } },
    },
  } as unknown as Field;
}

function itemType(fields: readonly Field[]): ItemType {
  return {
    id: 'model',
    type: 'item_type',
    attributes: {
      api_key: 'page',
      name: 'Page',
      modular_block: false,
      singleton: false,
      all_locales_required: false,
      draft_mode_active: true,
      draft_saving_active: false,
      sortable: false,
      tree: false,
      hint: null,
    },
    relationships: {
      fields: {
        data: fields.map((currentField) => ({
          id: currentField.id,
          type: 'field',
        })),
      },
      title_field: { data: null },
      presentation_title_field: { data: null },
      presentation_image_field: { data: null },
      image_preview_field: { data: null },
      excerpt_field: { data: null },
      ordering_field: { data: null },
      workflow: { data: null },
    },
  } as ItemType;
}

function context({
  fields,
  formValues,
  itemId = 'record-1',
  loadItemTypeFields,
}: {
  fields: readonly Field[];
  formValues: Readonly<Record<string, unknown>>;
  itemId?: string | null;
  loadItemTypeFields?: (itemTypeId: string) => Promise<Field[]>;
}): RenderItemFormSidebarCtx {
  const model = itemType(
    fields.length > 0 ? fields : [field('title', 'title')],
  );

  return {
    plugin: { id: 'plugin', attributes: { parameters: {} } },
    site: {
      id: 'site',
      attributes: {
        name: 'Site',
        locales: ['en', 'it'],
        timezone: 'Europe/Rome',
      },
    },
    environment: 'primary',
    isEnvironmentPrimary: true,
    currentUser: { id: 'user' },
    ui: { locale: 'en' },
    item: itemId ? { id: itemId } : null,
    itemType: model,
    itemTypes: { [model.id]: model },
    fields: Object.fromEntries(
      fields.map((currentField) => [currentField.id, currentField]),
    ),
    formValues,
    locale: 'en',
    itemStatus: itemId ? 'draft' : 'new',
    isFormDirty: true,
    isSubmitting: false,
    blocksAnalysis: {
      usage: { total: 0, nonLocalized: 0, perLocale: {} },
      maximumPerItem: 100,
    },
    loadItemTypeFields:
      loadItemTypeFields ?? vi.fn().mockResolvedValue([...fields]),
    scrollToField: vi.fn().mockResolvedValue(undefined),
    editItem: vi.fn().mockResolvedValue(null),
    editUpload: vi.fn().mockResolvedValue(null),
    setHeight: vi.fn(),
  } as unknown as RenderItemFormSidebarCtx;
}

describe('AgentSidebar local current-form capabilities', () => {
  it('isolates scope and frame identity for concurrent unsaved records of the same model', () => {
    const title = field('title', 'title');
    const first = context({
      fields: [title],
      formValues: { title: 'First unsaved record' },
      itemId: null,
    });
    const second = context({
      fields: [title],
      formValues: { title: 'Second unsaved record' },
      itemId: null,
    });
    const rendered = render(
      <>
        <AgentSidebar ctx={first} />
        <AgentSidebar ctx={second} />
      </>,
    );
    const initialFrames = rendered.getAllByTestId('agent-frame');
    const initialScopes = initialFrames.map((frame) =>
      JSON.parse(frame.dataset.scope ?? 'null'),
    );
    const initialMountIds = initialFrames.map(
      (frame) => frame.dataset.frameMountId,
    );

    expect(initialScopes[0]).toMatchObject({
      type: 'custom',
      id: expect.stringMatching(/^new:model:/),
    });
    expect(initialScopes[1]).toMatchObject({
      type: 'custom',
      id: expect.stringMatching(/^new:model:/),
    });
    expect(initialScopes[0].id).not.toBe(initialScopes[1].id);
    expect(initialMountIds[0]).not.toBe(initialMountIds[1]);

    rendered.rerender(
      <>
        <AgentSidebar
          ctx={context({
            fields: [title],
            formValues: { title: 'First changed value' },
            itemId: null,
          })}
        />
        <AgentSidebar
          ctx={context({
            fields: [title],
            formValues: { title: 'Second changed value' },
            itemId: null,
          })}
        />
      </>,
    );
    const rerenderedFrames = rendered.getAllByTestId('agent-frame');

    expect(
      rerenderedFrames.map((frame) =>
        JSON.parse(frame.dataset.scope ?? 'null'),
      ),
    ).toEqual(initialScopes);
    expect(rerenderedFrames.map((frame) => frame.dataset.frameMountId)).toEqual(
      initialMountIds,
    );
  });

  it('migrates only the saved unsaved-record history into its record scope', async () => {
    const title = field('title', 'title');
    const firstUnsaved = context({
      fields: [title],
      formValues: { title: 'First unsaved' },
      itemId: null,
    });
    const secondUnsaved = context({
      fields: [title],
      formValues: { title: 'Second unsaved' },
      itemId: null,
    });
    const rendered = render(
      <>
        <AgentSidebar ctx={firstUnsaved} />
        <AgentSidebar ctx={secondUnsaved} />
      </>,
    );
    const [firstFrame, secondFrame] = rendered.getAllByTestId('agent-frame');
    const firstScope = JSON.parse(firstFrame?.dataset.scope ?? 'null');
    const secondScope = JSON.parse(secondFrame?.dataset.scope ?? 'null');
    const storageIdentity = {
      pluginId: firstUnsaved.plugin.id,
      siteId: firstUnsaved.site.id,
      environment: firstUnsaved.environment,
      currentUserId: firstUnsaved.currentUser.id,
    };
    const firstSourceStore = createConversationStore({
      ...storageIdentity,
      scope: firstScope,
    });
    const secondSourceStore = createConversationStore({
      ...storageIdentity,
      scope: secondScope,
    });
    const firstChat: Conversation = {
      id: 'first-new-record-chat',
      title: 'First new record chat',
      createdAt: '2026-07-30T10:00:00.000Z',
      updatedAt: '2026-07-30T10:00:00.000Z',
      messages: [
        {
          id: 'message-1',
          role: 'user',
          text: 'Help me finish the first record',
          createdAt: '2026-07-30T10:00:00.000Z',
        },
      ],
    };
    const secondChat: Conversation = {
      ...firstChat,
      id: 'second-new-record-chat',
      title: 'Second new record chat',
      messages: [
        {
          ...firstChat.messages[0],
          id: 'message-2',
          text: 'Help me finish the second record',
        },
      ],
    };
    firstSourceStore.save(firstChat);
    secondSourceStore.save(secondChat);

    const saved = context({
      fields: [title],
      formValues: { title: 'First unsaved' },
      itemId: 'record-after-save',
    });
    rendered.rerender(
      <>
        <AgentSidebar ctx={saved} />
        <AgentSidebar ctx={secondUnsaved} />
      </>,
    );

    await waitFor(() => {
      const [savedFrame, stillUnsavedFrame] =
        rendered.getAllByTestId('agent-frame');
      expect(JSON.parse(savedFrame?.dataset.scope ?? 'null')).toEqual({
        type: 'record',
        recordId: 'record-after-save',
      });
      expect(JSON.parse(stillUnsavedFrame?.dataset.scope ?? 'null')).toEqual(
        secondScope,
      );
    });
    const targetStore = createConversationStore({
      ...storageIdentity,
      scope: { type: 'record', recordId: 'record-after-save' },
    });
    expect(targetStore.list().map((item) => item.id)).toEqual([
      'first-new-record-chat',
    ]);
    expect(secondSourceStore.list().map((item) => item.id)).toEqual([
      'second-new-record-chat',
    ]);
    expect(localStorage.getItem(firstSourceStore.key)).toBeNull();
  });

  it('verifies field references, reads bounded live values, and only scrolls on click', async () => {
    const title = field('title', 'title', true);
    const body = field('body', 'body', false, 'structured_text');
    const ctx = context({
      fields: [title, body],
      formValues: {
        title: { en: 'Unsaved title', it: 'Titolo' },
        body: [{ type: 'paragraph', children: [{ text: 'Draft body' }] }],
      },
    });
    const navigateTo = vi.fn();
    Object.assign(ctx, { navigateTo });

    render(<AgentSidebar ctx={ctx} />);

    await expect(
      mocks.frameProps?.prepareCurrentFieldReferences?.({
        title: 'Fields',
        fields: [{ fieldPath: 'title' }, { fieldPath: 'body' }],
      }),
    ).resolves.toEqual({
      title: 'Fields',
      fields: [
        {
          fieldPath: 'title',
          label: 'Title',
          apiKey: 'title',
          localized: true,
          locale: 'en',
          fieldType: 'single_line',
        },
        {
          fieldPath: 'body',
          label: 'Body',
          apiKey: 'body',
          localized: false,
          fieldType: 'single_line',
        },
      ],
    });

    await expect(
      mocks.frameProps?.readCurrentRecordLiveFormState?.({
        fields: [{ fieldApiKey: 'title' }, { fieldApiKey: 'body' }],
      }),
    ).resolves.toMatchObject({
      source: 'current_record_browser_form_state',
      persistence: 'may_be_unsaved',
      savedOrPublishedStateVerified: false,
      record: { id: 'record-1', modelApiKey: 'page' },
      form: { dirty: true },
      fields: [
        {
          fieldPath: 'title',
          locale: 'en',
          state: 'value',
          summary: '"Unsaved title"',
        },
        {
          fieldPath: 'body',
          locale: null,
          state: 'value',
        },
      ],
    });

    await mocks.frameProps?.openCurrentField?.({
      fieldPath: 'title',
      locale: 'it',
    });
    expect(ctx.scrollToField).toHaveBeenCalledWith('title.it', 'it');
    expect(navigateTo).not.toHaveBeenCalled();
  });

  it('reads the latest form values after a host rerender', async () => {
    const title = field('title', 'title');
    const first = context({
      fields: [title],
      formValues: { title: 'First value' },
    });
    const rendered = render(<AgentSidebar ctx={first} />);
    const read = mocks.frameProps?.readCurrentRecordLiveFormState;

    const latest = context({
      fields: [title],
      formValues: { title: 'Latest unsaved value' },
    });
    rendered.rerender(<AgentSidebar ctx={latest} />);

    await expect(
      read?.({ fields: [{ fieldApiKey: 'title' }] }),
    ).resolves.toMatchObject({
      fields: [{ summary: '"Latest unsaved value"' }],
    });
  });

  it('rejects an async form read if the current record changes while fields load', async () => {
    const title = field('title', 'title');
    let finishLoad: ((fields: Field[]) => void) | undefined;
    const loading = new Promise<Field[]>((resolve) => {
      finishLoad = resolve;
    });
    const first = context({
      fields: [],
      formValues: { title: 'First' },
      itemId: 'record-1',
      loadItemTypeFields: () => loading,
    });
    const rendered = render(<AgentSidebar ctx={first} />);
    const read = mocks.frameProps?.readCurrentRecordLiveFormState;
    const pending = read?.({ fields: [{ fieldApiKey: 'title' }] });
    const rejection = expect(pending).rejects.toThrow(
      'The current record changed while its fields were loading.',
    );

    const second = context({
      fields: [title],
      formValues: { title: 'Second' },
      itemId: 'record-2',
    });
    rendered.rerender(<AgentSidebar ctx={second} />);
    await act(async () => {
      finishLoad?.([title]);
    });

    await rejection;
  });
});
