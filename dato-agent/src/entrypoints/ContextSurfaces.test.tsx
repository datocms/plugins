import { cleanup, render, waitFor } from '@testing-library/react';
import type {
  Field,
  ItemType,
  RenderInspectorCtx,
  RenderItemFormSidebarCtx,
} from 'datocms-plugin-sdk';
import { type ReactNode, useEffect } from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { resolveFieldsWithinDeadline } from '../lib/hostContextDeadline';
import type { AgentFrameProps, AgentHostContextSnapshot } from './AgentFrame';
import AgentInspector from './AgentInspector';
import AgentSidebar from './AgentSidebar';

const frameMocks = vi.hoisted(() => ({
  latestProps: undefined as unknown,
  mountCount: 0,
  unmountCount: 0,
}));

vi.mock('datocms-react-ui', () => ({
  Canvas: ({ children }: { children: ReactNode }) => <>{children}</>,
}));

vi.mock('../lib/persistedWidth', () => ({
  usePersistedSidebarWidth: vi.fn(),
}));

vi.mock('./AgentFrame', () => ({
  default: (props: AgentFrameProps) => {
    frameMocks.latestProps = props;

    useEffect(() => {
      frameMocks.mountCount += 1;

      return () => {
        frameMocks.unmountCount += 1;
      };
    }, []);

    return <div data-testid="agent-frame" />;
  },
}));

type ModelInput = {
  id: string;
  apiKey: string;
  name?: string;
  fieldIds?: string[];
  titleFieldId?: string;
};

function model({
  id,
  apiKey,
  name = apiKey,
  fieldIds = [],
  titleFieldId,
}: ModelInput): ItemType {
  const optionalField = (fieldId?: string) => ({
    data: fieldId ? { type: 'field' as const, id: fieldId } : null,
  });

  return {
    type: 'item_type',
    id,
    attributes: {
      name,
      api_key: apiKey,
      collection_appearance: 'compact',
      singleton: false,
      all_locales_required: false,
      sortable: false,
      modular_block: false,
      draft_mode_active: true,
      draft_saving_active: false,
      tree: false,
      ordering_direction: null,
      ordering_meta: null,
      has_singleton_item: false,
      hint: null,
      inverse_relationships_enabled: false,
    },
    relationships: {
      singleton_item: { data: null },
      fields: {
        data: fieldIds.map((fieldId) => ({
          type: 'field' as const,
          id: fieldId,
        })),
      },
      fieldsets: { data: [] },
      presentation_title_field: optionalField(titleFieldId),
      presentation_image_field: optionalField(),
      title_field: optionalField(titleFieldId),
      image_preview_field: optionalField(),
      excerpt_field: optionalField(),
      ordering_field: optionalField(),
      workflow: { data: null },
    },
    meta: { has_singleton_item: false },
  };
}

type FieldInput = {
  id: string;
  modelId: string;
  apiKey: string;
  label?: string;
  fieldType?: Field['attributes']['field_type'];
  localized?: boolean;
  position?: number;
};

function field({
  id,
  modelId,
  apiKey,
  label = apiKey,
  fieldType = 'string',
  localized = false,
  position = 0,
}: FieldInput): Field {
  return {
    type: 'field',
    id,
    attributes: {
      label,
      field_type: fieldType,
      localized,
      default_value: null,
      api_key: apiKey,
      hint: null,
      validators: {},
      appearance: {
        editor: 'single_line',
        parameters: {},
        addons: [],
      },
      position,
      deep_filtering_enabled: false,
      content_link_enabled: true,
    },
    relationships: {
      item_type: { data: { type: 'item_type', id: modelId } },
      fieldset: { data: null },
    },
  } as Field;
}

function repository<T extends { id: string }>(
  entities: readonly T[],
): Record<string, T> {
  return Object.fromEntries(entities.map((entity) => [entity.id, entity]));
}

type CommonContextInput = {
  itemTypes: readonly ItemType[];
  fields: readonly Field[];
  loadItemTypeFields: (itemTypeId: string) => Promise<Field[]>;
};

function commonContext({
  itemTypes,
  fields,
  loadItemTypeFields,
}: CommonContextInput) {
  return {
    plugin: {
      id: 'plugin-id',
      attributes: {
        parameters: {
          openAiApiKey: 'sk-test',
          model: 'gpt-test',
        },
      },
    },
    site: {
      id: 'site-id',
      attributes: {
        name: 'Marketing site',
        locales: ['en', 'it'],
        timezone: 'Europe/Rome',
      },
    },
    environment: 'primary',
    isEnvironmentPrimary: true,
    currentUser: { id: 'editor-id' },
    ui: { locale: 'en' },
    itemTypes: repository(itemTypes),
    fields: repository(fields),
    loadItemTypeFields,
  };
}

type SidebarContextInput = CommonContextInput & {
  itemType: ItemType;
  formValues?: Record<string, unknown>;
  locale?: string;
  itemStatus?: 'new' | 'draft' | 'updated' | 'published';
  itemId?: string;
};

function sidebarContext({
  itemType,
  formValues = {},
  locale = 'en',
  itemStatus = 'draft',
  itemId = 'record-id',
  ...common
}: SidebarContextInput): RenderItemFormSidebarCtx {
  return {
    ...commonContext(common),
    itemType,
    item: { id: itemId },
    formValues,
    locale,
    itemStatus,
    isFormDirty: true,
    isSubmitting: false,
    blocksAnalysis: {
      usage: {
        total: 0,
        nonLocalized: 0,
        perLocale: { en: 0, it: 0 },
      },
      maximumPerItem: 100,
    },
  } as unknown as RenderItemFormSidebarCtx;
}

type InspectorContextInput = CommonContextInput & {
  highlightedItemId?: string;
  pathname?: string;
};

function inspectorContext({
  highlightedItemId,
  pathname = '/editor',
  ...common
}: InspectorContextInput): RenderInspectorCtx {
  return {
    ...commonContext(common),
    highlightedItemId,
    location: {
      pathname,
      search: '',
      hash: '',
    },
  } as unknown as RenderInspectorCtx;
}

function latestFrameProps(): AgentFrameProps {
  expect(frameMocks.latestProps).toBeDefined();
  return frameMocks.latestProps as AgentFrameProps;
}

async function loadSnapshot(
  props: AgentFrameProps = latestFrameProps(),
): Promise<AgentHostContextSnapshot> {
  expect(props.loadHostContext).toBeDefined();
  const result = await props.loadHostContext?.();
  expect(result).toBeDefined();
  return result as AgentHostContextSnapshot;
}

beforeEach(() => {
  frameMocks.latestProps = undefined;
  frameMocks.mountCount = 0;
  frameMocks.unmountCount = 0;
});

afterEach(() => {
  cleanup();
  vi.useRealTimers();
  vi.clearAllMocks();
});

describe('AgentSidebar host context', () => {
  it('loads missing current-model fields and captures typed localized live state', async () => {
    const article = model({
      id: 'article-id',
      apiKey: 'article',
      name: 'Article',
      fieldIds: ['title-id'],
      titleFieldId: 'title-id',
    });
    const title = field({
      id: 'title-id',
      modelId: article.id,
      apiKey: 'title',
      label: 'Title',
      localized: true,
    });
    const loadItemTypeFields = vi.fn(async () => [title]);

    render(
      <AgentSidebar
        ctx={sidebarContext({
          itemType: article,
          itemTypes: [article],
          fields: [],
          loadItemTypeFields,
          locale: 'it',
          itemStatus: 'updated',
          formValues: {
            title: {
              en: 'Hello',
              it: 'Ciao',
            },
          },
        })}
      />,
    );

    const snapshot = await loadSnapshot();

    expect(loadItemTypeFields).toHaveBeenCalledOnce();
    expect(loadItemTypeFields).toHaveBeenCalledWith(article.id);
    expect(snapshot.text).toContain('surface=record');
    expect(snapshot.text).toContain('active_locale="it"|status=updated');
    expect(snapshot.text).toContain('field title|"Title"|string|localized');
    expect(snapshot.text).toContain(
      'live_value|field="title"|type=string|locale="it"|"Ciao"',
    );
    expect(snapshot.fingerprint).toMatch(/^hostctx-v1-/);
  });

  it('does not load fields when the current model is already complete', async () => {
    const article = model({
      id: 'article-id',
      apiKey: 'article',
      fieldIds: ['title-id'],
    });
    const title = field({
      id: 'title-id',
      modelId: article.id,
      apiKey: 'title',
    });
    const loadItemTypeFields = vi.fn(async () => [title]);

    render(
      <AgentSidebar
        ctx={sidebarContext({
          itemType: article,
          itemTypes: [article],
          fields: [title],
          loadItemTypeFields,
          formValues: { title: 'Already loaded' },
        })}
      />,
    );

    const snapshot = await loadSnapshot();

    expect(loadItemTypeFields).not.toHaveBeenCalled();
    expect(snapshot.text).toContain('fields_complete=true');
    expect(snapshot.text).toContain(
      'live_value|field="title"|type=string|"Already loaded"',
    );
  });

  it('falls back to loaded fields when current-model enrichment misses its deadline', async () => {
    vi.useFakeTimers();
    const article = model({
      id: 'article-id',
      apiKey: 'article',
      fieldIds: ['title-id', 'body-id'],
    });
    const title = field({
      id: 'title-id',
      modelId: article.id,
      apiKey: 'title',
    });
    const loadItemTypeFields = vi.fn(
      () => new Promise<Field[]>(() => undefined),
    );

    render(
      <AgentSidebar
        ctx={sidebarContext({
          itemType: article,
          itemTypes: [article],
          fields: [title],
          loadItemTypeFields,
          formValues: { title: 'Available immediately' },
        })}
      />,
    );

    const resultPromise = loadSnapshot();
    await vi.advanceTimersByTimeAsync(750);
    const snapshot = await resultPromise;

    expect(snapshot.text).toContain('fields_complete=false');
    expect(snapshot.text).toContain(
      'live_value|field="title"|type=string|"Available immediately"',
    );
  });

  it('cancels pending current-model enrichment immediately', async () => {
    const article = model({
      id: 'article-id',
      apiKey: 'article',
      fieldIds: ['title-id'],
    });

    render(
      <AgentSidebar
        ctx={sidebarContext({
          itemType: article,
          itemTypes: [article],
          fields: [],
          loadItemTypeFields: () => new Promise<Field[]>(() => undefined),
        })}
      />,
    );

    const controller = new AbortController();
    const resultPromise = latestFrameProps().loadHostContext?.(
      controller.signal,
    );
    controller.abort();

    await expect(resultPromise).rejects.toMatchObject({
      name: 'AbortError',
    });
  });

  it('loads exactly the model requested by the on-demand resolver', async () => {
    const article = model({
      id: 'article-id',
      apiKey: 'article',
      fieldIds: ['title-id'],
    });
    const author = model({
      id: 'author-id',
      apiKey: 'author',
      name: 'Author',
      fieldIds: ['name-id'],
    });
    const title = field({
      id: 'title-id',
      modelId: article.id,
      apiKey: 'title',
    });
    const name = field({
      id: 'name-id',
      modelId: author.id,
      apiKey: 'name',
      label: 'Name',
    });
    const loadItemTypeFields = vi.fn(async (itemTypeId: string) =>
      itemTypeId === author.id ? [name] : [],
    );

    render(
      <AgentSidebar
        ctx={sidebarContext({
          itemType: article,
          itemTypes: [article, author],
          fields: [title],
          loadItemTypeFields,
        })}
      />,
    );

    const getModelSchema = latestFrameProps().getModelSchema;
    expect(getModelSchema).toBeDefined();
    const result = await getModelSchema?.({ identifier: 'author' });

    expect(loadItemTypeFields).toHaveBeenCalledOnce();
    expect(loadItemTypeFields).toHaveBeenCalledWith(author.id);
    expect(result).toEqual({
      schema: expect.stringContaining('field name|"Name"|string'),
    });
  });
});

describe('AgentInspector host context', () => {
  it('uses already-loaded fields when project enrichment misses its deadline', async () => {
    vi.useFakeTimers();
    const article = model({
      id: 'article-id',
      apiKey: 'article',
      fieldIds: ['title-id'],
    });
    const title = field({
      id: 'title-id',
      modelId: article.id,
      apiKey: 'title',
    });
    const unresolvedFields = new Promise<Field[]>(() => {});

    const resultPromise = resolveFieldsWithinDeadline({
      fieldsPromise: unresolvedFields,
      fallbackFields: [title],
      waitMs: 50,
    });
    await vi.advanceTimersByTimeAsync(50);

    await expect(resultPromise).resolves.toEqual([title]);
  });

  it('cancels a pending project enrichment immediately', async () => {
    const controller = new AbortController();
    const resultPromise = resolveFieldsWithinDeadline({
      fieldsPromise: new Promise<Field[]>(() => {}),
      fallbackFields: [],
      signal: controller.signal,
      waitMs: 10_000,
    });

    controller.abort();

    await expect(resultPromise).rejects.toMatchObject({
      name: 'AbortError',
    });
  });

  it('loads missing fields for a small project and emits a complete detailed map', async () => {
    const article = model({
      id: 'article-id',
      apiKey: 'article',
      fieldIds: ['title-id'],
    });
    const author = model({
      id: 'author-id',
      apiKey: 'author',
      fieldIds: ['name-id'],
    });
    const title = field({
      id: 'title-id',
      modelId: article.id,
      apiKey: 'title',
    });
    const name = field({
      id: 'name-id',
      modelId: author.id,
      apiKey: 'name',
    });
    const loadItemTypeFields = vi.fn(async (itemTypeId: string) =>
      itemTypeId === author.id ? [name] : [],
    );

    render(
      <AgentInspector
        ctx={inspectorContext({
          itemTypes: [article, author],
          fields: [title],
          loadItemTypeFields,
        })}
      />,
    );

    await waitFor(() => {
      expect(loadItemTypeFields).toHaveBeenCalledWith(author.id);
    });
    const snapshot = await loadSnapshot();

    expect(loadItemTypeFields).toHaveBeenCalledOnce();
    expect(snapshot.text).toContain('schema_mode=detailed_complete');
    expect(snapshot.text).toContain(
      'project_map|complete=true|models=2/2|omitted_models=0',
    );
    expect(snapshot.text).toContain('field title|"title"|string');
    expect(snapshot.text).toContain('field name|"name"|string');
  });

  it.each([
    {
      label: 'more than 40 models',
      itemTypes: Array.from({ length: 41 }, (_, index) =>
        model({
          id: `model-${index}`,
          apiKey: `model_${index}`,
          fieldIds: [`field-${index}`],
        }),
      ),
    },
    {
      label: 'more than 400 fields',
      itemTypes: [
        model({
          id: 'large-model',
          apiKey: 'large_model',
          fieldIds: Array.from(
            { length: 401 },
            (_, index) => `large-field-${index}`,
          ),
        }),
      ],
    },
  ])(
    'uses directory/on-demand mode without eager loads for $label',
    async ({ itemTypes }) => {
      const loadItemTypeFields = vi.fn(async () => []);

      render(
        <AgentInspector
          ctx={inspectorContext({
            itemTypes,
            fields: [],
            loadItemTypeFields,
          })}
        />,
      );

      const snapshot = await loadSnapshot();

      expect(loadItemTypeFields).not.toHaveBeenCalled();
      expect(snapshot.text).toContain('schema_mode=directory_complete');
      expect(snapshot.text).toContain(
        `model_directory|complete=true|models=${itemTypes.length}`,
      );
      expect(snapshot.text).toContain('schema_on_demand=Use get_model_schema');
    },
  );

  it('keeps the project frame mounted while highlight and location change', async () => {
    const article = model({
      id: 'article-id',
      apiKey: 'article',
      fieldIds: ['title-id'],
    });
    const title = field({
      id: 'title-id',
      modelId: article.id,
      apiKey: 'title',
    });
    const loadItemTypeFields = vi.fn(async () => [title]);
    const initialCtx = inspectorContext({
      itemTypes: [article],
      fields: [title],
      loadItemTypeFields,
      highlightedItemId: 'first-record',
      pathname: '/editor/first',
    });
    const { rerender } = render(<AgentInspector ctx={initialCtx} />);

    expect(frameMocks.mountCount).toBe(1);
    expect(latestFrameProps().scope).toEqual({ type: 'project' });

    rerender(
      <AgentInspector
        ctx={inspectorContext({
          itemTypes: [article],
          fields: [title],
          loadItemTypeFields,
          highlightedItemId: 'second-record',
          pathname: '/editor/second',
        })}
      />,
    );

    const snapshot = await loadSnapshot();

    expect(frameMocks.mountCount).toBe(1);
    expect(frameMocks.unmountCount).toBe(0);
    expect(latestFrameProps().scope).toEqual({ type: 'project' });
    expect(snapshot.text).toContain('highlighted_item_id="second-record"');
    expect(snapshot.text).toContain('"pathname":"/editor/second"');
    expect(loadItemTypeFields).not.toHaveBeenCalled();
  });
});

describe('Agent host-dialog callbacks', () => {
  it.each(['record sidebar', 'agent inspector'] as const)(
    'returns the pending native approval-details modal from the %s',
    async (surface) => {
      const article = model({
        id: 'article-id',
        apiKey: 'article',
      });
      let closeModal: ((value: unknown) => void) | undefined;
      const modal = new Promise<unknown>((resolve) => {
        closeModal = resolve;
      });
      const openModal = vi.fn(() => modal);
      const common = {
        itemTypes: [article],
        fields: [],
        loadItemTypeFields: vi.fn(async () => []),
      };

      if (surface === 'record sidebar') {
        render(
          <AgentSidebar
            ctx={
              {
                ...sidebarContext({
                  ...common,
                  itemType: article,
                }),
                openModal,
              } as unknown as RenderItemFormSidebarCtx
            }
          />,
        );
      } else {
        render(
          <AgentInspector
            ctx={
              {
                ...inspectorContext(common),
                openModal,
              } as unknown as RenderInspectorCtx
            }
          />,
        );
      }

      const pending = latestFrameProps().onReviewApprovalDetails({
        id: 'approval',
        title: 'Review this change',
        description: 'Review generated details.',
        actionLabel: 'Approve',
        details: [{ label: 'Target', value: 'Homepage' }],
        status: 'pending',
      });
      expect(openModal).toHaveBeenCalledOnce();
      expect(openModal).toHaveBeenCalledWith(
        expect.objectContaining({
          parameters: expect.objectContaining({ canDecide: true }),
        }),
      );

      let settled = false;
      void Promise.resolve(pending).then(() => {
        settled = true;
      });
      await Promise.resolve();
      expect(settled).toBe(false);

      closeModal?.(null);
      await expect(pending).resolves.toBeNull();
      expect(settled).toBe(true);
    },
  );
});
