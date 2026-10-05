import type { RawApiTypes } from '@datocms/cma-client-browser';
import type { RenderConfigScreenCtx, RenderPageCtx } from 'datocms-plugin-sdk';
import { vi } from 'vitest';

type Field = RawApiTypes.Field;
type Item = RawApiTypes.Item;
type ItemType = RawApiTypes.ItemType;

export function buildItemType(
  id: string,
  name: string,
  options: {
    workflowId?: string | null;
    draftMode?: boolean;
    titleFieldId?: string | null;
    imageFieldId?: string | null;
    block?: boolean;
  } = {},
): ItemType {
  const ref = (fieldId: string | null | undefined) => ({
    data: fieldId ? { id: fieldId, type: 'field' as const } : null,
  });
  return {
    id,
    type: 'item_type',
    attributes: {
      name,
      api_key: name.toLowerCase().replace(/\s+/g, '_'),
      modular_block: options.block ?? false,
      draft_mode_active: options.draftMode ?? true,
    },
    relationships: {
      workflow: {
        data: options.workflowId
          ? { id: options.workflowId, type: 'workflow' }
          : null,
      },
      presentation_title_field: ref(options.titleFieldId),
      title_field: ref(null),
      presentation_image_field: ref(options.imageFieldId),
      image_preview_field: ref(null),
    },
  } as unknown as ItemType;
}

export function buildField(
  id: string,
  apiKey: string,
  options: {
    type?: string;
    localized?: boolean;
    position?: number;
    editor?: string;
    heading?: boolean;
  } = {},
): Field {
  return {
    id,
    type: 'field',
    attributes: {
      api_key: apiKey,
      label: apiKey,
      field_type: options.type ?? 'string',
      localized: options.localized ?? false,
      position: options.position ?? 1,
      appearance: {
        editor: options.editor ?? 'single_line',
        parameters: options.heading ? { heading: true } : {},
        addons: [],
      },
    },
  } as unknown as Field;
}

export function buildItem(
  id: string,
  attributes: Record<string, unknown>,
  meta: Partial<Item['meta']> = {},
): Item {
  return {
    id,
    type: 'item',
    attributes,
    relationships: {
      item_type: { data: { id: 'unknown', type: 'item_type' } },
      creator: { data: { id: 'user-1', type: 'user' } },
    },
    meta: {
      created_at: '2026-01-01T10:00:00Z',
      updated_at: '2026-01-01T10:00:00Z',
      status: 'draft',
      is_current_version_valid: true,
      is_published_version_valid: null,
      stage: 'review',
      ...meta,
    },
  } as unknown as Item;
}

export type PermissionRule = {
  action: string;
  environment?: string;
  item_type?: string | null;
  workflow?: string | null;
  on_stage?: string | null;
  to_stage?: string | null;
  on_creator?: string | null;
};

/** By default the role can do anything to any record in the main environment. */
const ALL_RECORDS: PermissionRule[] = [{ action: 'all', on_creator: 'anyone' }];

const role = (
  canEditSchema: boolean,
  positive: PermissionRule[] = ALL_RECORDS,
  negative: PermissionRule[] = [],
) => ({
  id: 'role',
  type: 'role',
  attributes: { can_edit_schema: canEditSchema },
  meta: {
    final_permissions: {
      can_edit_schema: canEditSchema,
      positive_item_type_permissions: positive.map((rule) => ({
        environment: 'main',
        ...rule,
      })),
      negative_item_type_permissions: negative.map((rule) => ({
        environment: 'main',
        ...rule,
      })),
    },
  },
});

function baseCtx(
  parameters: Record<string, unknown>,
  canEditSchema = true,
  permissions: {
    positive?: PermissionRule[];
    negative?: PermissionRule[];
  } = {},
) {
  return {
    cssDesignTokens: {},
    theme: {},
    colorScheme: 'light',
    environment: 'main',
    isEnvironmentPrimary: true,
    cmaBaseUrl: 'https://site-api.datocms.com',
    currentUserAccessToken: 'token',
    currentRole: role(
      canEditSchema,
      permissions.positive,
      permissions.negative,
    ),
    currentUser: { id: 'user-1', type: 'user' },
    users: {},
    ssoUsers: {},
    owner: { id: 'owner-1', type: 'account' },
    plugin: {
      id: 'plugin-1',
      type: 'plugin',
      attributes: { name: 'Workflow Stage View', parameters },
    },
    site: {
      id: 'site',
      attributes: { locales: ['en', 'it'], timezone: 'Europe/Rome' },
    },
    ui: { locale: 'en' },
    notice: vi.fn(async () => {}),
    alert: vi.fn(async () => {}),
    navigateTo: vi.fn(async () => {}),
    // Confirms say yes; the stage picker takes the first stage it offers.
    openConfirm: vi.fn(
      async (options: { choices: { value: unknown }[] }) =>
        options.choices[0]?.value,
    ),
    openModal: vi.fn(
      async (modal: { parameters: { stages: { id: string }[] } }) =>
        modal.parameters.stages[0]?.id ?? null,
    ),
  };
}

export function buildPageCtx(
  options: {
    parameters?: Record<string, unknown>;
    itemTypes?: ItemType[];
    fields?: Record<string, Field[]>;
    canEditSchema?: boolean;
    environment?: string;
    permissions?: { positive?: PermissionRule[]; negative?: PermissionRule[] };
  } = {},
): RenderPageCtx {
  const itemTypes = Object.fromEntries(
    (options.itemTypes ?? []).map((itemType) => [itemType.id, itemType]),
  );
  const base = baseCtx(
    options.parameters ?? {},
    options.canEditSchema,
    options.permissions,
  );
  return {
    ...base,
    mode: 'renderPage',
    bodyPadding: [0, 0, 0, 0],
    environment: options.environment ?? 'main',
    isEnvironmentPrimary: (options.environment ?? 'main') === 'main',
    itemTypes,
    loadItemTypeFields: vi.fn(
      async (itemTypeId: string) => options.fields?.[itemTypeId] ?? [],
    ),
    location: { pathname: '/', search: '', hash: '' },
  } as unknown as RenderPageCtx;
}

export function buildConfigCtx(
  options: {
    parameters?: Record<string, unknown>;
    canEditSchema?: boolean;
    updatePluginParameters?: (params: Record<string, unknown>) => Promise<void>;
  } = {},
): RenderConfigScreenCtx {
  return {
    ...baseCtx(options.parameters ?? {}, options.canEditSchema),
    mode: 'renderConfigScreen',
    bodyPadding: [30, 30, 30, 30],
    startAutoResizer: vi.fn(),
    stopAutoResizer: vi.fn(),
    isAutoResizerActive: () => false,
    updateHeight: vi.fn(),
    updatePluginParameters: vi.fn(
      options.updatePluginParameters ?? (async () => {}),
    ),
  } as unknown as RenderConfigScreenCtx;
}

/** An async generator over items, like the CMA client's paged iterator. */
export async function* iterate<T>(values: T[]): AsyncGenerator<T> {
  for (const value of values) yield value;
}
