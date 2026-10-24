import type {
  Field,
  ItemType,
  RenderConfigScreenCtx,
  RenderItemFormSidebarPanelCtx,
  RenderModalCtx,
  RenderPageCtx,
} from 'datocms-plugin-sdk';
import { vi } from 'vitest';

export function sdkModel(id = 'page', name = 'Page'): ItemType {
  return {
    id,
    type: 'item_type',
    attributes: { name, modular_block: false },
    relationships: {
      presentation_title_field: { data: { id: 'title', type: 'field' } },
      workflow: { data: null },
    },
  } as unknown as ItemType;
}

export function sdkField(apiKey: string, localized = false): Field {
  return {
    id: apiKey,
    type: 'field',
    attributes: {
      api_key: apiKey,
      label: apiKey === 'url' ? 'Website' : 'Title',
      field_type: 'string',
      localized,
      validators: {},
      appearance: { editor: 'single_line', parameters: {} },
    },
  } as unknown as Field;
}

export function rawRecord(
  id = 'record-1',
  url: unknown = {
    en: 'https://broken.example/page',
    it: 'https://italian.example/page',
  },
) {
  return {
    id,
    type: 'item',
    attributes: { title: 'Example page', url },
    relationships: { item_type: { data: { type: 'item_type', id: 'page' } } },
  };
}

/**
 * What every hook's ctx has: the project, the user, the plugin, and what the
 * kit's `Canvas` reads from the host (tokens, color scheme, padding, the
 * user's locale and date settings, the internal domain, the toasts, the
 * confirm and the router).
 */
function hostContext() {
  return {
    site: {
      id: 'site-1',
      attributes: { locales: ['en', 'it'], internal_domain: null },
    },
    environment: 'main',
    isEnvironmentPrimary: true,
    currentUser: { id: 'user-1' },
    currentRole: {
      id: 'reader',
      attributes: {
        positive_item_type_permissions: [
          { action: 'read', environment: 'main', item_type: null },
        ],
        negative_item_type_permissions: [],
      },
      meta: { final_permissions: { can_edit_schema: false } },
    },
    currentUserAccessToken: 'test-user-token',
    cmaBaseUrl: 'https://cma.example',
    ui: {
      locale: 'en',
      dateFormat: 'dd/MM/yyyy',
      timezone: 'UTC',
      twentyFourHour: true,
    },
    cssDesignTokens: {},
    colorScheme: 'light',
    bodyPadding: [0, 0, 0, 0],
    theme: {},
    plugin: {
      id: 'plugin-1',
      type: 'plugin',
      attributes: {
        permissions: ['currentUserAccessToken'],
        parameters: {},
      },
    },
    itemTypes: { page: sdkModel(), news: sdkModel('news', 'News') },
    loadItemTypeFields: vi
      .fn()
      .mockResolvedValue([sdkField('title'), sdkField('url', true)]),
    editItem: vi.fn().mockResolvedValue(null),
    navigateTo: vi.fn().mockResolvedValue(undefined),
    openModal: vi.fn().mockResolvedValue(undefined),
    openConfirm: vi.fn().mockResolvedValue(null),
    alert: vi.fn().mockResolvedValue(undefined),
    notice: vi.fn().mockResolvedValue(undefined),
    customToast: vi.fn().mockResolvedValue(null),
  };
}

/** The frames that size themselves (panel, modal, config screen). */
function sizingMethods() {
  return {
    startAutoResizer: vi.fn(),
    stopAutoResizer: vi.fn(),
    updateHeight: vi.fn(),
  };
}

export function pageContext(
  overrides: Partial<RenderPageCtx> = {},
): RenderPageCtx {
  return {
    ...hostContext(),
    mode: 'renderPage',
    pageId: 'link-checker',
    location: {
      pathname: '/editor/p/plugin-1/pages/link-checker',
      search: '',
      hash: '',
    },
    ...overrides,
  } as unknown as RenderPageCtx;
}

export function panelContext(
  overrides: Partial<RenderItemFormSidebarPanelCtx> = {},
): RenderItemFormSidebarPanelCtx {
  return {
    ...hostContext(),
    ...sizingMethods(),
    mode: 'renderItemFormSidebarPanel',
    sidebarPaneId: 'broken-links',
    itemType: sdkModel(),
    item: null,
    locale: 'en',
    itemStatus: 'new',
    isSubmitting: false,
    isFormDirty: true,
    formValues: {
      title: 'New page',
      url: {
        en: 'https://broken.example/page',
        it: 'https://italian.example/page',
      },
      internalLocales: ['en', 'it'],
    },
    formValuesToItem: vi.fn().mockResolvedValue(rawRecord()),
    scrollToField: vi.fn().mockResolvedValue(undefined),
    saveCurrentItem: vi.fn().mockResolvedValue(undefined),
    setFieldValue: vi.fn().mockResolvedValue(undefined),
    ...overrides,
  } as unknown as RenderItemFormSidebarPanelCtx;
}

export function modalContext(
  parameters: Record<string, unknown> = {},
  overrides: Partial<Record<keyof RenderModalCtx, unknown>> = {},
): RenderModalCtx {
  return {
    ...hostContext(),
    ...sizingMethods(),
    mode: 'renderModal',
    modalId: 'scan-scope',
    parameters,
    resolve: vi.fn().mockResolvedValue(undefined),
    ...overrides,
  } as unknown as RenderModalCtx;
}

export function configContext(
  overrides: Partial<Record<keyof RenderConfigScreenCtx, unknown>> = {},
): RenderConfigScreenCtx {
  return {
    ...hostContext(),
    ...sizingMethods(),
    mode: 'renderConfigScreen',
    ...overrides,
  } as unknown as RenderConfigScreenCtx;
}

export function deferred<T>() {
  let resolve: (value: T) => void = () => undefined;
  let reject: (reason: unknown) => void = () => undefined;
  const promise = new Promise<T>((resolvePromise, rejectPromise) => {
    resolve = resolvePromise;
    reject = rejectPromise;
  });
  return { promise, resolve, reject };
}
