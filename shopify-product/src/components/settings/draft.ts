/**
 * The config screen's form model: plugin parameters v3 as editable drafts,
 * plus validation, dirty tracking and the conversion back to parameters.
 *
 * Drafts keep what the merchant typed (`domainInput` can be `acme`, an admin
 * URL, …); `normalizeShopDomain` turns it into the store identity on save.
 */

import {
  normalizePluginParameters,
  normalizeShopDomain,
  validateStorefrontToken,
} from '../../lib/parameters';
import type {
  PluginParametersV3,
  StoreCapabilities,
  StoreConnection,
} from '../../types';
import { hasNestedQuantifier } from '../../utils/autoApply';

export type StoreDraft = {
  /** Local React key; never saved. */
  key: string;
  domainInput: string;
  token: string;
  tokenless: boolean;
  label: string;
  /** `''` means Shopify's default market. */
  defaultCountry: string;
  defaultLanguage: string;
  capabilities: StoreCapabilities | null;
};

export type SettingsDraft = {
  stores: StoreDraft[];
  useDemoStore: boolean;
  autoApplyToFieldsWithApiKey: string;
};

export type StoreFieldName = 'domain' | 'token';

export type StoreErrors = Partial<Record<StoreFieldName, string>>;

export type DraftErrors = {
  /** Same order as `draft.stores`. */
  stores: StoreErrors[];
  autoApply?: string;
};

export const DUPLICATE_STORE_ERROR = 'This store is already in the list';
export const INVALID_PATTERN_ERROR = 'Field must be a valid regular expression';
export const NESTED_REPEAT_ERROR =
  'Field cannot contain nested repeats like (a+)+, which can freeze record forms';

let lastStoreKey = 0;

function nextStoreKey(): string {
  lastStoreKey += 1;
  return `store-${lastStoreKey}`;
}

export function emptyStoreDraft(): StoreDraft {
  return {
    key: nextStoreKey(),
    domainInput: '',
    token: '',
    tokenless: false,
    label: '',
    defaultCountry: '',
    defaultLanguage: '',
    capabilities: null,
  };
}

function storeDraftFromConnection(store: StoreConnection): StoreDraft {
  return {
    key: nextStoreKey(),
    domainInput: store.shopDomain,
    token: store.storefrontAccessToken,
    tokenless: store.tokenless,
    label: store.label ?? '',
    defaultCountry: store.defaultCountry ?? '',
    defaultLanguage: store.defaultLanguage ?? '',
    capabilities: store.capabilities ?? null,
  };
}

/** The form always shows at least one store block. */
export function draftFromParameters(params: PluginParametersV3): SettingsDraft {
  const stores = params.stores.map(storeDraftFromConnection);
  return {
    stores: stores.length > 0 ? stores : [emptyStoreDraft()],
    useDemoStore: params.useDemoStore,
    autoApplyToFieldsWithApiKey: params.autoApplyToFieldsWithApiKey,
  };
}

/** A store block nobody filled in: dropped on save when the demo store is on. */
export function isBlankStore(store: StoreDraft): boolean {
  return (
    store.domainInput.trim() === '' &&
    store.token.trim() === '' &&
    !store.tokenless &&
    store.label.trim() === ''
  );
}

/** The normalized domain, or null while the input isn't a valid shop. */
export function storeDomain(store: StoreDraft): string | null {
  const result = normalizeShopDomain(store.domainInput);
  return result.ok ? result.domain : null;
}

/** The connection as it would be saved, or null without a valid domain. */
export function storeConnectionFromDraft(
  store: StoreDraft,
): StoreConnection | null {
  const shopDomain = storeDomain(store);
  if (!shopDomain) return null;
  const connection: StoreConnection = {
    shopDomain,
    storefrontAccessToken: store.tokenless ? '' : store.token.trim(),
    tokenless: store.tokenless,
  };
  if (store.label.trim()) connection.label = store.label.trim();
  if (store.defaultCountry) connection.defaultCountry = store.defaultCountry;
  if (store.defaultLanguage) connection.defaultLanguage = store.defaultLanguage;
  if (store.capabilities) connection.capabilities = store.capabilities;
  return connection;
}

/**
 * Identifies what a connection check depends on (shop, token, tokenless),
 * so a status stays attached to its store when stores are reordered and
 * disappears as soon as the merchant edits the connection.
 */
export function connectionSignature(store: StoreDraft): string | null {
  const shopDomain = storeDomain(store);
  if (!shopDomain) return null;
  return signatureOf({
    shopDomain,
    storefrontAccessToken: store.token.trim(),
    tokenless: store.tokenless,
  });
}

/** The signature of a saved connection (same shape as `connectionSignature`). */
export function signatureOf(
  store: Pick<
    StoreConnection,
    'shopDomain' | 'storefrontAccessToken' | 'tokenless'
  >,
): string {
  return store.tokenless
    ? `${store.shopDomain}|tokenless`
    : `${store.shopDomain}|token:${store.storefrontAccessToken}`;
}

/** True when the store can be tested: valid domain and token (or tokenless). */
export function isStoreDraftUsable(store: StoreDraft): boolean {
  return (
    storeDomain(store) !== null &&
    validateStorefrontToken(store.token, store.tokenless) === null
  );
}

/** The stores that get saved: every block, minus blank ones. */
export function storesToSave(draft: SettingsDraft): StoreDraft[] {
  return draft.stores.filter((store) => !isBlankStore(store));
}

export function parametersFromDraft(draft: SettingsDraft): PluginParametersV3 {
  const stores: StoreConnection[] = [];
  for (const store of storesToSave(draft)) {
    const connection = storeConnectionFromDraft(store);
    if (connection) stores.push(connection);
  }
  return normalizePluginParameters({
    paramsVersion: '3',
    stores,
    useDemoStore: draft.useDemoStore,
    // Saved exactly as typed: `onBoot` matches it untrimmed.
    autoApplyToFieldsWithApiKey: draft.autoApplyToFieldsWithApiKey,
  });
}

// ---------------------------------------------------------------------------
// Validation
// ---------------------------------------------------------------------------

function validateStore(
  store: StoreDraft,
  seenDomains: Set<string>,
): StoreErrors {
  const errors: StoreErrors = {};
  const domain = normalizeShopDomain(store.domainInput);
  if (!domain.ok) {
    errors.domain = domain.error;
  } else if (seenDomains.has(domain.domain)) {
    errors.domain = DUPLICATE_STORE_ERROR;
  } else {
    seenDomains.add(domain.domain);
  }
  const tokenError = validateStorefrontToken(store.token, store.tokenless);
  if (tokenError) errors.token = tokenError;
  return errors;
}

/**
 * Validated as `onBoot` uses it: untrimmed, empty means off. The pattern runs
 * on every field of every record form, so patterns that can backtrack
 * exponentially are refused (saved ones keep working at runtime).
 */
export function validatePattern(pattern: string): string | undefined {
  if (pattern === '') return undefined;
  try {
    new RegExp(pattern);
  } catch {
    return INVALID_PATTERN_ERROR;
  }
  return hasNestedQuantifier(pattern) ? NESTED_REPEAT_ERROR : undefined;
}

/**
 * Blank store blocks are fine while the demo store is on (they're dropped on
 * save); otherwise every block must be a complete, unique connection.
 */
export function validateDraft(draft: SettingsDraft): DraftErrors {
  const seenDomains = new Set<string>();
  const stores = draft.stores.map((store) =>
    draft.useDemoStore && isBlankStore(store)
      ? {}
      : validateStore(store, seenDomains),
  );
  return {
    stores,
    autoApply: validatePattern(draft.autoApplyToFieldsWithApiKey),
  };
}

export function hasDraftErrors(errors: DraftErrors): boolean {
  return (
    errors.autoApply !== undefined ||
    errors.stores.some((store) => Object.keys(store).length > 0)
  );
}

// ---------------------------------------------------------------------------
// Dirty state
// ---------------------------------------------------------------------------

/**
 * What would be saved, without local keys or detection timestamps. Blank
 * store blocks are never saved, so they don't count. Neither does the
 * metafields capability: nothing shows or uses it, so it can't be a reason
 * to save.
 */
function comparableDraft(draft: SettingsDraft): string {
  return JSON.stringify({
    stores: draft.stores
      .filter((store) => !isBlankStore(store))
      .map((store) => ({
        domain: storeDomain(store) ?? store.domainInput.trim(),
        token: store.tokenless ? '' : store.token.trim(),
        tokenless: store.tokenless,
        label: store.label.trim(),
        country: store.defaultCountry,
        language: store.defaultLanguage,
        capabilities: store.capabilities
          ? [store.capabilities.tags, store.capabilities.inventory]
          : null,
      })),
    useDemoStore: draft.useDemoStore,
    autoApply: draft.autoApplyToFieldsWithApiKey,
  });
}

export function isDraftDirty(
  draft: SettingsDraft,
  initial: SettingsDraft,
): boolean {
  return comparableDraft(draft) !== comparableDraft(initial);
}

// ---------------------------------------------------------------------------
// Rebasing on new saved parameters
// ---------------------------------------------------------------------------

function matchKey(store: StoreDraft): string {
  return storeDomain(store) ?? store.domainInput.trim().toLowerCase();
}

/**
 * Gives `next`'s stores the keys of the matching `current` stores (same
 * shop), so React keeps their blocks (and focus) instead of remounting them.
 */
export function adoptStoreKeys(
  next: SettingsDraft,
  current: SettingsDraft,
): SettingsDraft {
  const available = [...current.stores];
  return {
    ...next,
    stores: next.stores.map((store) => {
      const index = available.findIndex(
        (candidate) => matchKey(candidate) === matchKey(store),
      );
      if (index === -1) return store;
      const [match] = available.splice(index, 1);
      return { ...store, key: match.key };
    }),
  };
}

export type DraftState = {
  /** The saved parameters as a draft: the baseline for dirty tracking. */
  initial: SettingsDraft;
  draft: SettingsDraft;
  /** `${storeKey}:${field}` and `autoApply` keys whose errors are visible. */
  touched: ReadonlySet<string>;
};

/**
 * New saved parameters arrived (our own save, or another tab). The draft
 * starts over from them, unless it holds edits they don't include (typed
 * while the save was running): those stay, and stay dirty.
 */
export function rebaseDraftState(
  state: DraftState,
  params: PluginParametersV3,
): DraftState {
  const initial = adoptStoreKeys(draftFromParameters(params), state.draft);
  const keepEdits =
    isDraftDirty(state.draft, state.initial) &&
    isDraftDirty(state.draft, initial);
  return keepEdits
    ? { ...state, initial }
    : { initial, draft: initial, touched: new Set() };
}

/** How confirms name a store: its label, else its domain. */
export function storeDisplayName(store: StoreDraft): string {
  return store.label.trim() || storeDomain(store) || store.domainInput.trim();
}

/** A store name inside confirm copy (user-provided names take quotes). */
function quotedName(store: StoreDraft): string {
  return `"${storeDisplayName(store)}"`;
}

function firstFilledStore(
  stores: StoreDraft[],
  skipKey?: string,
): StoreDraft | undefined {
  return stores.find((store) => store.key !== skipKey && !isBlankStore(store));
}

/** What removing the default store does to fields without a store setting. */
function defaultStoreConsequence(
  state: Pick<DraftState, 'draft' | 'initial'>,
  store: StoreDraft,
  saved: boolean,
): string | null {
  if (firstFilledStore(state.draft.stores) !== store) return null;
  const nextDefault = firstFilledStore(state.draft.stores, store.key);
  if (!nextDefault) {
    return saved
      ? 'Fields without a store setting stop loading products too.'
      : null;
  }
  return nextDefault.key === firstFilledStore(state.initial.stores)?.key
    ? null
    : `Fields without a store setting switch to ${quotedName(nextDefault)}, the new default store.`;
}

/**
 * The body of the "Remove this store?" confirm, from what removing the store
 * changes once saved; `null` when there's nothing to lose (a blank block).
 */
export function removeStoreConsequences(
  state: Pick<DraftState, 'draft' | 'initial'>,
  key: string,
): string | null {
  const store = state.draft.stores.find((item) => item.key === key);
  if (!store || isBlankStore(store)) return null;
  // The fresh-install block is in `initial` too, but blank: never saved.
  const saved = state.initial.stores.some(
    (item) => item.key === key && !isBlankStore(item),
  );
  const sentences = [
    'Are you sure you want to remove this store?',
    saved
      ? 'Fields set to use it stop loading products until you add it again.'
      : "It isn't saved yet, so what you entered here is discarded.",
  ];
  const defaultChange = defaultStoreConsequence(state, store, saved);
  if (defaultChange) sentences.push(defaultChange);
  return sentences.join(' ');
}

/**
 * The body of the "Make this the default store?" confirm: fields without a
 * store setting follow the first store, so their saved values would resolve
 * against another catalog. `null` when that doesn't change: nothing is saved
 * yet, the store already is the default, or it is the saved default again.
 */
export function makeDefaultConsequences(
  state: Pick<DraftState, 'draft' | 'initial'>,
  key: string,
): string | null {
  const store = state.draft.stores.find((item) => item.key === key);
  const savedDefault = firstFilledStore(state.initial.stores);
  if (!store || !savedDefault || isBlankStore(store)) return null;
  if (store.key === savedDefault.key) return null;
  if (firstFilledStore(state.draft.stores) === store) return null;
  // Name the saved default as the form shows it now, if it's still there.
  const current = state.draft.stores.find(
    (item) => item.key === savedDefault.key && !isBlankStore(item),
  );
  return [
    `Fields without a store setting switch from ${quotedName(current ?? savedDefault)} to ${quotedName(store)}.`,
    'Products already saved in those fields can stop loading or match a different product.',
    'Are you sure you want to proceed?',
  ].join(' ');
}
