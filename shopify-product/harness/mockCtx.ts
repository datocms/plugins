import type {
  ConfirmOptions,
  FieldAppearanceChange,
  Modal,
  RenderConfigScreenCtx,
  RenderFieldExtensionCtx,
  RenderManualFieldExtensionConfigScreenCtx,
  RenderModalCtx,
  Toast,
} from 'datocms-plugin-sdk';
import { FIELD_EXTENSION_ID } from '../src/constants';
import { isRecord } from '../src/lib/guards';
import type { FieldType, PluginParametersV3 } from '../src/types';
import {
  cloneIntoThisRealm,
  type HarnessHostApi,
  type HostToast,
  toastTimeout,
} from './bridge';
import type { FrameSizing } from './sizing';
import type { ResolvedState } from './surface';

/**
 * Mock ctx builders, one per surface kind. Each call returns a fresh ctx
 * object built from the in-memory mock state (`MockStore`), as the SDK hands a
 * new ctx to every render. Methods that change dashboard state
 * (`setFieldValue`, `updatePluginParameters`, `setParameters`) update the
 * store and re-render on the next task, like a host round trip. Every ctx is
 * wrapped in a Proxy that warns once about each property it doesn't mock.
 */

export const DEFAULT_PLUGIN_PARAMETERS: PluginParametersV3 = {
  paramsVersion: '3',
  stores: [],
  useDemoStore: true,
  autoApplyToFieldsWithApiKey: '',
};

const PLUGIN_ID = 'harness-plugin';
const ITEM_TYPE_ID = 'harness-model';
const FIELD_ID = 'harness-field';
const ITEM_ID = 'harness-record';
const CONTENT_LOCALE = 'en';
const DEFAULT_API_KEY = 'shopify_product';
const DEFAULT_FIELD_LABEL = 'Shopify product';
const LOG_SUMMARY_LENGTH = 120;

/** How `ctx.openConfirm` answers: the first choice (default) or cancel. */
export type ConfirmMode = 'first' | 'cancel';

/** What the frame knows that doesn't change between renders. */
export type MockEnv = {
  scheme: 'light' | 'dark';
  cssDesignTokens: Record<string, string>;
  bodyPadding: number;
  sizing: FrameSizing;
  host: HarnessHostApi | null;
  confirm: ConfirmMode;
  /** Re-renders the surface with a fresh ctx (the host's re-render). */
  rerender: () => void;
};

/** The in-memory dashboard state that ctx methods change. */
export type MockStore = {
  pluginParameters: Record<string, unknown>;
  fieldParameters: Record<string, unknown>;
  formValues: Record<string, unknown>;
  /** The record as last saved: `ctx.item.attributes`. */
  savedFormValues: Record<string, unknown>;
  isFormDirty: boolean;
};

/** How a modal ctx talks back: the opener's session, or a standalone log. */
export type ModalBinding = {
  modalId: string;
  parameters: Record<string, unknown>;
  resolve: (value: unknown) => Promise<void>;
};

// ---------------------------------------------------------------------------
// State helpers
// ---------------------------------------------------------------------------

export function getPath(source: unknown, path: string): unknown {
  let current = source;
  for (const key of path.split('.')) {
    if (!isRecord(current)) {
      return undefined;
    }
    current = current[key];
  }
  return current;
}

export function setPath(
  source: Record<string, unknown>,
  path: string,
  value: unknown,
): Record<string, unknown> {
  const [head, ...rest] = path.split('.');
  if (rest.length === 0) {
    return { ...source, [head]: value };
  }
  const existing = source[head];
  const child = isRecord(existing) ? existing : {};
  return { ...source, [head]: setPath(child, rest.join('.'), value) };
}

export function fieldPathFor(state: ResolvedState): string {
  const apiKey = state.apiKey ?? DEFAULT_API_KEY;
  return state.localized ? `${apiKey}.${CONTENT_LOCALE}` : apiKey;
}

export function createStore(state: ResolvedState): MockStore {
  const formValues = setPath(
    {},
    fieldPathFor(state),
    cloneIntoThisRealm(state.value ?? null),
  );
  return {
    pluginParameters: cloneIntoThisRealm(
      state.pluginParameters ?? DEFAULT_PLUGIN_PARAMETERS,
    ),
    fieldParameters: cloneIntoThisRealm(state.fieldParameters ?? {}),
    formValues,
    savedFormValues: formValues,
    isFormDirty: false,
  };
}

/** `ctx.errors` for a field config: `validate` output plus the state's fixed errors. */
export function fieldConfigErrors(
  store: MockStore,
  state: ResolvedState,
  validate:
    | ((parameters: Record<string, unknown>) => Record<string, unknown>)
    | undefined,
): Record<string, unknown> {
  return { ...(validate?.(store.fieldParameters) ?? {}), ...state.errors };
}

// ---------------------------------------------------------------------------
// Logging, toasts and host round trips
// ---------------------------------------------------------------------------

function summarize(details: unknown[]): string {
  const text = details
    .map((detail) => {
      if (typeof detail === 'string') {
        return detail;
      }
      try {
        return JSON.stringify(detail) ?? String(detail);
      } catch {
        return String(detail);
      }
    })
    .join(' ');
  return text.length > LOG_SUMMARY_LENGTH
    ? `${text.slice(0, LOG_SUMMARY_LENGTH - 1)}…`
    : text;
}

/**
 * Shows a toast in the host page and settles when it closes. Without a host
 * page (frame.html opened on its own) it settles when the toast would have
 * closed on its own, and never for one that stays until closed.
 */
function showToast(env: MockEnv, toast: HostToast): Promise<unknown> {
  if (env.host) {
    return env.host.toast(toast).then(cloneIntoThisRealm);
  }
  const timeout = toastTimeout(toast);
  return new Promise((resolve) => {
    if (timeout !== null) {
      setTimeout(() => resolve(null), timeout);
    }
  });
}

/** `notice`, `alert` and `customToast`: logged, then shown as a host toast. */
function announce(env: MockEnv, toast: HostToast): Promise<unknown> {
  console.info(`[ctx] ${toast.type}`, toast.message);
  return showToast(env, toast);
}

/** `ctx.notice`: green, closes after 6s. */
export function noticeToast(message: string): HostToast {
  return { type: 'notice', message, dismissAfterTimeout: true };
}

/** `ctx.alert`: red, stays until closed. */
export function alertToast(message: string): HostToast {
  return { type: 'alert', message, dismissAfterTimeout: false };
}

/** Logs a no-op ctx call to the console and as a small host toast. */
function logCall(env: MockEnv, method: string, ...details: unknown[]): void {
  console.info(`[ctx] ${method}`, ...details);
  const summary = summarize(details);
  void showToast(env, {
    type: 'log',
    message: summary ? `ctx.${method}: ${summary}` : `ctx.${method}()`,
  });
}

/** Applies a change on the next task, then re-renders, like a host round trip. */
function commit(env: MockEnv, change: () => void): Promise<void> {
  return new Promise((resolve) => {
    setTimeout(() => {
      change();
      env.rerender();
      resolve();
    }, 0);
  });
}

function answerConfirm(env: MockEnv, options: ConfirmOptions): unknown {
  const choice =
    env.confirm === 'cancel'
      ? options.cancel
      : (options.choices[0] ?? options.cancel);
  logCall(env, 'openConfirm', `${options.title} → ${choice.label}`);
  return choice.value;
}

function openModal(
  env: MockEnv,
  store: MockStore,
  state: ResolvedState,
  modal: Modal,
): Promise<unknown> {
  console.info('[ctx] openModal', modal);
  const host = env.host;
  if (!host) {
    console.warn(
      '[harness] ctx.openModal needs the harness host page (index.html); resolving null.',
    );
    return Promise.resolve(null);
  }
  return new Promise((resolve) => {
    host.openModal({
      modal,
      pluginParameters: store.pluginParameters,
      uiLocale: state.uiLocale ?? 'en',
      onResolve: (value) => resolve(cloneIntoThisRealm(value)),
    });
  });
}

// ---------------------------------------------------------------------------
// Entities
// ---------------------------------------------------------------------------

const ACCOUNT = {
  id: 'harness-account',
  type: 'account',
  attributes: {
    email: 'editor@example.com',
    first_name: 'Harness',
    last_name: 'Editor',
    company: 'Acme',
  },
};

const SITE = {
  id: 'harness-site',
  type: 'site',
  attributes: {
    name: 'Harness project',
    internal_domain: 'harness-project.admin.datocms.com',
    domain: null,
    locales: [CONTENT_LOCALE, 'it'],
    timezone: 'Europe/Rome',
  },
};

const ITEM_TYPE = {
  id: ITEM_TYPE_ID,
  type: 'item_type',
  attributes: {
    name: 'Landing page',
    api_key: 'landing_page',
    singleton: false,
    modular_block: false,
    sortable: false,
    tree: false,
    draft_mode_active: false,
    all_locales_required: false,
  },
  relationships: {
    fields: { data: [{ id: FIELD_ID, type: 'field' }] },
    fieldsets: { data: [] },
  },
};

function roleEntity(canEditSchema: boolean) {
  return {
    id: 'harness-role',
    type: 'role',
    attributes: {
      name: canEditSchema ? 'Admin' : 'Editor',
      can_edit_schema: canEditSchema,
    },
    meta: { final_permissions: { can_edit_schema: canEditSchema } },
  };
}

function pluginEntity(parameters: Record<string, unknown>) {
  return {
    id: PLUGIN_ID,
    type: 'plugin',
    attributes: {
      name: 'Shopify product',
      description: 'Pick Shopify products, variants and collections in DatoCMS',
      url: 'https://www.npmjs.com/package/datocms-plugin-shopify-product',
      package_name: 'datocms-plugin-shopify-product',
      package_version: '2.0.0',
      permissions: [],
      parameters,
    },
    meta: { version: '2' },
  };
}

function fieldAttributes(
  state: ResolvedState,
  parameters: Record<string, unknown>,
) {
  const fieldType: FieldType = state.fieldType ?? 'json';
  return {
    label: state.fieldLabel ?? DEFAULT_FIELD_LABEL,
    api_key: state.apiKey ?? DEFAULT_API_KEY,
    field_type: fieldType,
    localized: state.localized ?? false,
    hint: null,
    default_value: null,
    validators: {},
    appearance: {
      editor: PLUGIN_ID,
      field_extension: FIELD_EXTENSION_ID,
      parameters,
      addons: [],
    },
  };
}

function fieldEntity(
  state: ResolvedState,
  parameters: Record<string, unknown>,
) {
  return {
    id: FIELD_ID,
    type: 'field',
    attributes: { ...fieldAttributes(state, parameters), position: 1 },
    relationships: {
      item_type: { data: { id: ITEM_TYPE_ID, type: 'item_type' } },
      fieldset: { data: null },
    },
  };
}

function itemEntity(store: MockStore) {
  return {
    id: ITEM_ID,
    type: 'item',
    attributes: store.savedFormValues,
    relationships: {
      item_type: { data: { id: ITEM_TYPE_ID, type: 'item_type' } },
    },
    meta: {
      created_at: '2026-10-01T09:00:00.000Z',
      updated_at: '2026-10-02T09:00:00.000Z',
      published_at: null,
      first_published_at: null,
      status: 'draft',
      is_valid: true,
      current_version: 'harness-version',
      stage: null,
    },
  };
}

// ---------------------------------------------------------------------------
// ctx assembly
// ---------------------------------------------------------------------------

/** Property names that libraries probe on any object; never worth a warning. */
const IGNORED_PROPERTIES = new Set([
  'then',
  'toJSON',
  '$$typeof',
  'nodeType',
  'asymmetricMatch',
  '@@__IMMUTABLE_ITERABLE__@@',
  '@@__IMMUTABLE_RECORD__@@',
]);
const warnedProperties = new Set<string>();

function warnOnce(mode: string, property: string): void {
  const key = `${mode}.${property}`;
  if (warnedProperties.has(key)) {
    return;
  }
  warnedProperties.add(key);
  console.warn(
    `[harness] ctx.${property} is not mocked for ${mode}; add it to harness/mockCtx.ts.`,
  );
}

/** Warns once per missing property, so code that reads an unmocked field shows up. */
export function warnOnMissingProperties<T extends object>(
  ctx: T,
  mode: string,
): T {
  return new Proxy(ctx, {
    get(target, property, receiver) {
      if (
        typeof property === 'string' &&
        !IGNORED_PROPERTIES.has(property) &&
        !Reflect.has(target, property)
      ) {
        warnOnce(mode, property);
      }
      return Reflect.get(target, property, receiver);
    },
  });
}

function baseProperties(env: MockEnv, store: MockStore, state: ResolvedState) {
  const padding = env.bodyPadding;
  return {
    bodyPadding: [padding, padding, padding, padding],
    cssDesignTokens: env.cssDesignTokens,
    colorScheme: env.scheme,
    // <Canvas> iterates it for the legacy variables; plugin code never reads it.
    theme: {},
    plugin: pluginEntity(store.pluginParameters),
    currentUser: ACCOUNT,
    currentRole: roleEntity(state.canEditSchema ?? true),
    currentUserAccessToken: undefined,
    owner: ACCOUNT,
    account: ACCOUNT,
    site: SITE,
    environment: 'main',
    isEnvironmentPrimary: true,
    cdaEndpointUrl: 'https://graphql.datocms.com/',
    cmaBaseUrl: 'https://site-api.datocms.com',
    ui: { locale: state.uiLocale ?? 'en' },
    itemTypes: { [ITEM_TYPE_ID]: ITEM_TYPE },
    fields: { [FIELD_ID]: fieldEntity(state, store.fieldParameters) },
    fieldsets: {},
    users: {},
    ssoUsers: {},
  };
}

function loadMethods(store: MockStore, state: ResolvedState) {
  const field = fieldEntity(state, store.fieldParameters);
  return {
    loadItemTypeFields: async () => [field],
    loadItemTypeFieldsets: async () => [],
    loadFieldsUsingPlugin: async () => [field],
    loadUsers: async () => [],
    loadSsoUsers: async () => [],
  };
}

function dialogMethods(env: MockEnv, store: MockStore, state: ResolvedState) {
  const nullDialog =
    (method: string) =>
    async (...args: unknown[]) => {
      logCall(env, method, ...args);
      return null;
    };
  return {
    createNewItem: nullDialog('createNewItem'),
    selectItem: nullDialog('selectItem'),
    editItem: nullDialog('editItem'),
    selectUpload: nullDialog('selectUpload'),
    editUpload: nullDialog('editUpload'),
    editUploadMetadata: nullDialog('editUploadMetadata'),
    openModal: (modal: Modal) => openModal(env, store, state, modal),
    openConfirm: async (options: ConfirmOptions) => answerConfirm(env, options),
  };
}

function baseMethods(env: MockEnv, store: MockStore, state: ResolvedState) {
  return {
    ...loadMethods(store, state),
    ...dialogMethods(env, store, state),
    updatePluginParameters: (parameters: Record<string, unknown>) => {
      logCall(env, 'updatePluginParameters');
      return commit(env, () => {
        store.pluginParameters = cloneIntoThisRealm(parameters);
      });
    },
    updateFieldAppearance: async (
      fieldId: string,
      changes: FieldAppearanceChange[],
    ) => logCall(env, 'updateFieldAppearance', fieldId, changes),
    // As in the dashboard, each promise settles only when its toast closes:
    // notice after 6s, alert when closed, customToast per dismissAfterTimeout.
    notice: async (message: string) => {
      await announce(env, noticeToast(message));
    },
    alert: async (message: string) => {
      await announce(env, alertToast(message));
    },
    customToast: (toast: Toast) => announce(env, toast),
    navigateTo: async (path: string) => logCall(env, 'navigateTo', path),
  };
}

function common(env: MockEnv, store: MockStore, state: ResolvedState) {
  return {
    ...baseProperties(env, store, state),
    ...baseMethods(env, store, state),
    ...env.sizing,
  };
}

/** Spreads `overrides`, adds `getSettings` and wraps the ctx in the warning Proxy. */
function finalize<T>(
  base: Record<string, unknown>,
  overrides: object | undefined,
  mode: string,
): T {
  let proxy: Record<string, unknown> | null = null;
  const ctx: Record<string, unknown> = {
    ...base,
    getSettings: async () => proxy,
    ...overrides,
  };
  proxy = warnOnMissingProperties(ctx, mode);
  return proxy as unknown as T;
}

export function buildConfigCtx(
  env: MockEnv,
  store: MockStore,
  state: ResolvedState,
  overrides?: Partial<RenderConfigScreenCtx>,
): RenderConfigScreenCtx {
  return finalize(
    { ...common(env, store, state), mode: 'renderConfigScreen' },
    overrides,
    'renderConfigScreen',
  );
}

function itemFormMethods(env: MockEnv, store: MockStore) {
  return {
    setFieldValue: (path: string, value: unknown) => {
      console.info('[ctx] setFieldValue', path, value);
      return commit(env, () => {
        store.formValues = setPath(
          store.formValues,
          path,
          cloneIntoThisRealm(value),
        );
        store.isFormDirty = true;
      });
    },
    toggleField: async (path: string, show: boolean) =>
      logCall(env, 'toggleField', path, show),
    disableField: async (path: string, disable: boolean) =>
      logCall(env, 'disableField', path, disable),
    scrollToField: async (path: string, locale?: string) =>
      logCall(env, 'scrollToField', path, locale),
    formValuesToItem: async () => {
      logCall(env, 'formValuesToItem');
      return undefined;
    },
    itemToFormValues: async () => {
      logCall(env, 'itemToFormValues');
      return {};
    },
    saveCurrentItem: async () => logCall(env, 'saveCurrentItem'),
  };
}

export function buildFieldCtx(
  env: MockEnv,
  store: MockStore,
  state: ResolvedState,
  overrides?: Partial<RenderFieldExtensionCtx>,
): RenderFieldExtensionCtx {
  return finalize(
    {
      ...common(env, store, state),
      ...itemFormMethods(env, store),
      mode: 'renderFieldExtension',
      fieldExtensionId: FIELD_EXTENSION_ID,
      parameters: store.fieldParameters,
      field: fieldEntity(state, store.fieldParameters),
      fieldPath: fieldPathFor(state),
      parentField: undefined,
      block: undefined,
      disabled: state.disabled ?? false,
      locale: CONTENT_LOCALE,
      item: itemEntity(store),
      itemType: ITEM_TYPE,
      formValues: store.formValues,
      itemStatus: 'draft',
      isSubmitting: false,
      isFormDirty: store.isFormDirty,
      blocksAnalysis: {
        usage: { total: 0, nonLocalized: 0, perLocale: {} },
        maximumPerItem: 3000,
      },
    },
    overrides,
    'renderFieldExtension',
  );
}

export function buildFieldConfigCtx(
  env: MockEnv,
  store: MockStore,
  state: ResolvedState,
  errors: Record<string, unknown>,
  overrides?: Partial<RenderManualFieldExtensionConfigScreenCtx>,
): RenderManualFieldExtensionConfigScreenCtx {
  return finalize(
    {
      ...common(env, store, state),
      mode: 'renderManualFieldExtensionConfigScreen',
      fieldExtensionId: FIELD_EXTENSION_ID,
      parameters: store.fieldParameters,
      errors,
      pendingField: {
        id: FIELD_ID,
        type: 'field',
        attributes: fieldAttributes(state, store.fieldParameters),
      },
      itemType: ITEM_TYPE,
      setParameters: (parameters: Record<string, unknown>) => {
        console.info('[ctx] setParameters', parameters);
        return commit(env, () => {
          store.fieldParameters = cloneIntoThisRealm(parameters);
        });
      },
    },
    overrides,
    'renderManualFieldExtensionConfigScreen',
  );
}

export function buildModalCtx(
  env: MockEnv,
  store: MockStore,
  state: ResolvedState,
  binding: ModalBinding,
  overrides?: Partial<RenderModalCtx>,
): RenderModalCtx {
  return finalize(
    {
      ...common(env, store, state),
      mode: 'renderModal',
      modalId: binding.modalId,
      parameters: binding.parameters,
      resolve: binding.resolve,
    },
    overrides,
    'renderModal',
  );
}

/** A modal shown on its own (`?surface=<modal id>`): resolve just logs. */
export function standaloneModalBinding(
  env: MockEnv,
  modalId: string,
  parameters: Record<string, unknown>,
  onResolve: (value: unknown) => void,
): ModalBinding {
  return {
    modalId,
    parameters,
    resolve: async (value) => {
      logCall(env, 'resolve', value);
      onResolve(cloneIntoThisRealm(value));
    },
  };
}
