import type { RenderConfigScreenCtx } from 'datocms-plugin-sdk';
import {
  useCallback,
  useEffect,
  useMemo,
  useReducer,
  useRef,
  useState,
} from 'react';
import { isRecord } from '../../lib/guards';
import {
  ADMIN_TOKEN_ERROR,
  isCurrentPluginParameters,
  isStoreUsable,
  normalizePluginParameters,
} from '../../lib/parameters';
import type {
  PluginParametersV3,
  StoreCapabilities,
  StoreConnection,
} from '../../types';
import {
  connectionSignature,
  type DraftErrors,
  type DraftState,
  draftFromParameters,
  emptyStoreDraft,
  hasDraftErrors,
  isDraftDirty,
  isStoreDraftUsable,
  makeDefaultConsequences,
  parametersFromDraft,
  rebaseDraftState,
  removeStoreConsequences,
  type SettingsDraft,
  type StoreDraft,
  type StoreErrors,
  type StoreFieldName,
  signatureOf,
  storeConnectionFromDraft,
  storesToSave,
  validateDraft,
} from './draft';
import { scrollBehavior } from './scroll';
import {
  type ConnectionChecks,
  useConnectionChecks,
} from './useConnectionChecks';

/** Shown in one line right above Save after a failed attempt. */
export type FormMessage = 'invalid' | 'connection';

/**
 * A store whose domain input should take focus: a new object per request, so
 * asking for the same store twice still moves focus.
 */
export type FocusRequest = { storeKey: string };

export type SettingsForm = {
  draft: SettingsDraft;
  /** Only the errors that should be visible right now. */
  errors: DraftErrors;
  dirty: boolean;
  /**
   * True from the moment Save is pressed until the save ends. Buttons that
   * check, save or restructure the stores are disabled right away.
   */
  saving: boolean;
  /** Inputs lock only when a save takes longer than a second (or read-only). */
  fieldsLocked: boolean;
  readOnly: boolean;
  formMessage: FormMessage | null;
  checks: ConnectionChecks;
  /** Signatures whose check failed during the last save: they offer "Save anyway". */
  saveAnywaySignatures: ReadonlySet<string>;
  /** Set by "Add another store" and "Remove store" (which focuses a neighbour). */
  focusRequest: FocusRequest | null;
  /** True when no saved store is usable yet (the setup guide starts open). */
  noStoreConnected: boolean;
  /** Store key → signature of the saved connection, for saved capabilities. */
  savedSignatures: ReadonlyMap<string, string>;
  updateStore: (key: string, patch: Partial<StoreDraft>) => void;
  touchStore: (key: string, field: StoreFieldName) => void;
  addStore: () => void;
  removeStore: (key: string) => Promise<void>;
  makeDefault: (key: string) => Promise<void>;
  setUseDemoStore: (value: boolean) => void;
  setAutoApply: (value: string) => void;
  touchAutoApply: () => void;
  testStore: (key: string) => Promise<void>;
  save: () => Promise<void>;
  saveAnyway: () => Promise<void>;
};

const FIELD_LOCK_DELAY_MS = 1000;
const AUTO_APPLY_KEY = 'autoApply';

function touchedKey(storeKey: string, field: StoreFieldName): string {
  return `${storeKey}:${field}`;
}

/** Every error key of the draft as it is now (a submit shows them all). */
function allErrorKeys(draft: SettingsDraft): string[] {
  const keys = [AUTO_APPLY_KEY];
  for (const store of draft.stores) {
    keys.push(touchedKey(store.key, 'domain'), touchedKey(store.key, 'token'));
  }
  return keys;
}

function parametersKey(params: unknown): string {
  return JSON.stringify(normalizePluginParameters(params));
}

// ---------------------------------------------------------------------------
// Saved parameters
// ---------------------------------------------------------------------------

/**
 * The saved parameters, normalized (v1/v2/v3 → v3). The SDK hands a new ctx
 * on every render, so the result is keyed by value, not by identity.
 */
function useSavedParameters(raw: unknown): {
  saved: PluginParametersV3;
  needsMigration: boolean;
} {
  const key = parametersKey(raw);
  const saved = useMemo(() => JSON.parse(key) as PluginParametersV3, [key]);
  // A fresh install (`{}`) has nothing to migrate; older shapes do.
  const hasSettings = isRecord(raw) && Object.keys(raw).length > 0;
  return {
    saved,
    needsMigration: hasSettings && !isCurrentPluginParameters(raw),
  };
}

/** A flag that turns on after `delay` ms of `active`, and off right away. */
function useDelayedFlag(active: boolean, delay: number): boolean {
  const [flag, setFlag] = useState(false);
  useEffect(() => {
    if (!active) {
      setFlag(false);
      return undefined;
    }
    const timeout = window.setTimeout(() => setFlag(true), delay);
    return () => window.clearTimeout(timeout);
  }, [active, delay]);
  return flag;
}

/**
 * Checks every saved, usable store once. Stores saved without capabilities
 * (a detection that failed at boot, or "Save anyway") detect them too, so the
 * screen shows what the token can do and Save offers to keep it.
 */
function useSavedStoreVerification(
  saved: PluginParametersV3,
  checks: ConnectionChecks,
  onDetected: (signature: string, capabilities: StoreCapabilities) => void,
): void {
  const settled = useRef(new Set<string>());
  const { statuses, verify, check } = checks;

  useEffect(() => {
    for (const [signature, status] of Object.entries(statuses)) {
      if (status.kind !== 'checking') settled.current.add(signature);
    }
  }, [statuses]);

  useEffect(() => {
    const controller = new AbortController();
    const detect = async (store: StoreConnection, signature: string) => {
      const outcome = await check(store, signature, controller.signal);
      if (outcome.ok) onDetected(signature, outcome.capabilities);
    };
    for (const store of saved.stores) {
      const signature = signatureOf(store);
      if (!isStoreUsable(store) || settled.current.has(signature)) continue;
      if (store.capabilities) {
        void verify(store, signature, controller.signal);
      } else {
        void detect(store, signature);
      }
    }
    return () => controller.abort();
  }, [saved, verify, check, onDetected]);
}

// ---------------------------------------------------------------------------
// Draft state
// ---------------------------------------------------------------------------

type DraftAction =
  | { type: 'edit'; update: (draft: SettingsDraft) => SettingsDraft }
  | { type: 'touch'; keys: readonly string[] }
  | { type: 'rebase'; params: PluginParametersV3 };

function withTouched(
  touched: ReadonlySet<string>,
  keys: readonly string[],
): ReadonlySet<string> {
  const missing = keys.filter((key) => !touched.has(key));
  if (missing.length === 0) return touched;
  const next = new Set(touched);
  for (const key of missing) next.add(key);
  return next;
}

function draftReducer(state: DraftState, action: DraftAction): DraftState {
  if (action.type === 'edit') {
    const draft = action.update(state.draft);
    return draft === state.draft ? state : { ...state, draft };
  }
  if (action.type === 'touch') {
    const touched = withTouched(state.touched, action.keys);
    return touched === state.touched ? state : { ...state, touched };
  }
  return rebaseDraftState(state, action.params);
}

function initialDraftState(saved: PluginParametersV3): DraftState {
  const initial = draftFromParameters(saved);
  return { initial, draft: initial, touched: new Set() };
}

function useDraftState(saved: PluginParametersV3) {
  const [state, dispatch] = useReducer(draftReducer, saved, initialDraftState);
  const savedKey = useRef(parametersKey(saved));

  // Another tab (or a save the host reports first) changed the parameters.
  useEffect(() => {
    const key = parametersKey(saved);
    if (key === savedKey.current) return;
    savedKey.current = key;
    dispatch({ type: 'rebase', params: saved });
  }, [saved]);

  const edit = useCallback(
    (update: (draft: SettingsDraft) => SettingsDraft) =>
      dispatch({ type: 'edit', update }),
    [],
  );
  const touch = useCallback(
    (...keys: string[]) => dispatch({ type: 'touch', keys }),
    [],
  );
  /**
   * Our own save: rebases right away (a no-op save may never re-render) and
   * makes the host's re-render with the same parameters no news. Returns an
   * undo for a failed write.
   */
  const expectSaved = useCallback((params: PluginParametersV3) => {
    const previous = savedKey.current;
    savedKey.current = parametersKey(params);
    return {
      commit: () => dispatch({ type: 'rebase', params }),
      undo: () => {
        savedKey.current = previous;
      },
    };
  }, []);

  return { state, edit, touch, expectSaved };
}

function visibleStoreErrors(
  store: StoreDraft,
  errors: StoreErrors,
  touched: ReadonlySet<string>,
): StoreErrors {
  const visible: StoreErrors = {};
  if (errors.domain && touched.has(touchedKey(store.key, 'domain'))) {
    visible.domain = errors.domain;
  }
  // Pasting an Admin API token is a security problem: say so right away.
  const tokenTouched = touched.has(touchedKey(store.key, 'token'));
  if (errors.token && (tokenTouched || errors.token === ADMIN_TOKEN_ERROR)) {
    visible.token = errors.token;
  }
  return visible;
}

function visibleErrors(
  draft: SettingsDraft,
  errors: DraftErrors,
  touched: ReadonlySet<string>,
): DraftErrors {
  return {
    stores: draft.stores.map((store, index) =>
      visibleStoreErrors(store, errors.stores[index] ?? {}, touched),
    ),
    autoApply: touched.has(AUTO_APPLY_KEY) ? errors.autoApply : undefined,
  };
}

type Detected = Map<
  string,
  { signature: string; capabilities: StoreCapabilities }
>;

function withCapabilities(
  draft: SettingsDraft,
  detected: Detected,
): SettingsDraft {
  return {
    ...draft,
    stores: draft.stores.map((store) => {
      const match = detected.get(store.key);
      return match && connectionSignature(store) === match.signature
        ? { ...store, capabilities: match.capabilities }
        : store;
    }),
  };
}

/**
 * Capabilities describe one connection: a store whose shop or token changed
 * since they were detected (and wasn't re-checked) saves none.
 */
function withoutStaleCapabilities(
  draft: SettingsDraft,
  isTrusted: (store: StoreDraft) => boolean,
): SettingsDraft {
  return {
    ...draft,
    stores: draft.stores.map((store) =>
      store.capabilities && !isTrusted(store)
        ? { ...store, capabilities: null }
        : store,
    ),
  };
}

/** Moves keyboard focus to the first visible problem after a failed save. */
function focusFirstProblem(selector: string): void {
  window.requestAnimationFrame(() => {
    const target = document.querySelector<HTMLElement>(selector);
    if (!target) return;
    target.scrollIntoView({ behavior: scrollBehavior(), block: 'center' });
    target.focus({ preventScroll: true });
  });
}

/** The store next to `key` (the previous one, else the next one). */
function neighbourKey(stores: StoreDraft[], key: string): string | null {
  const index = stores.findIndex((store) => store.key === key);
  if (index === -1) return null;
  return (stores[index - 1] ?? stores[index + 1])?.key ?? null;
}

/** Puts the store first: the default for fields without a store setting. */
function moveToTop(draft: SettingsDraft, key: string): SettingsDraft {
  const store = draft.stores.find((item) => item.key === key);
  if (!store) return draft;
  return {
    ...draft,
    stores: [store, ...draft.stores.filter((item) => item !== store)],
  };
}

/** A save message stays only while its problem does. */
function currentFormMessage(
  message: FormMessage | null,
  problems: Record<FormMessage, boolean>,
): FormMessage | null {
  return message && problems[message] ? message : null;
}

function hasFailedSave(
  draft: SettingsDraft,
  checks: ConnectionChecks,
  failed: ReadonlySet<string>,
): boolean {
  return draft.stores.some((store) => {
    const signature = connectionSignature(store);
    return (
      signature !== null &&
      failed.has(signature) &&
      checks.statuses[signature]?.kind === 'failed'
    );
  });
}

// ---------------------------------------------------------------------------
// Saving
// ---------------------------------------------------------------------------

type CheckedStores = {
  detected: Detected;
  failed: string[];
};

const NOT_CHECKED: CheckedStores = { detected: new Map(), failed: [] };

async function checkStores(
  stores: StoreDraft[],
  checks: ConnectionChecks,
): Promise<CheckedStores> {
  const detected: Detected = new Map();
  const failed: string[] = [];
  await Promise.all(
    stores.map(async (store) => {
      const connection = storeConnectionFromDraft(store);
      const signature = connectionSignature(store);
      if (!connection || !signature) return;
      const outcome = await checks.check(connection, signature);
      if (outcome.ok) {
        detected.set(store.key, {
          signature,
          capabilities: outcome.capabilities,
        });
      } else {
        failed.push(signature);
      }
    }),
  );
  return { detected, failed };
}

function useSavedSignatures(initial: SettingsDraft) {
  return useMemo(() => {
    const signatures = new Map<string, string>();
    for (const store of initial.stores) {
      const signature = connectionSignature(store);
      if (signature) signatures.set(store.key, signature);
    }
    return signatures;
  }, [initial]);
}

export function useSettingsForm(ctx: RenderConfigScreenCtx): SettingsForm {
  const { saved, needsMigration } = useSavedParameters(
    ctx.plugin.attributes.parameters,
  );
  const { state, edit, touch, expectSaved } = useDraftState(saved);
  const { draft } = state;
  const checks = useConnectionChecks();
  const applyDetectedOnMount = useCallback(
    (signature: string, capabilities: StoreCapabilities) => {
      edit((current) => ({
        ...current,
        stores: current.stores.map((store) =>
          !store.capabilities && connectionSignature(store) === signature
            ? { ...store, capabilities }
            : store,
        ),
      }));
    },
    [edit],
  );
  useSavedStoreVerification(saved, checks, applyDetectedOnMount);

  const [saving, setSaving] = useState(false);
  const [migrationSaved, setMigrationSaved] = useState(false);
  const [formMessage, setFormMessage] = useState<FormMessage | null>(null);
  const [saveAnywaySignatures, setSaveAnywaySignatures] = useState<
    ReadonlySet<string>
  >(new Set());
  const [focusRequest, setFocusRequest] = useState<FocusRequest | null>(null);
  const fieldsLocked = useDelayedFlag(saving, FIELD_LOCK_DELAY_MS);
  const savingRef = useRef(false);
  const stateRef = useRef(state);
  stateRef.current = state;

  const readOnly = !ctx.currentRole.meta.final_permissions.can_edit_schema;
  const allErrors = validateDraft(draft);
  const dirty =
    (needsMigration && !migrationSaved) || isDraftDirty(draft, state.initial);
  const savedSignatures = useSavedSignatures(state.initial);

  const updateStore = useCallback(
    (key: string, patch: Partial<StoreDraft>) => {
      edit((current) => ({
        ...current,
        stores: current.stores.map((store) =>
          store.key === key ? { ...store, ...patch } : store,
        ),
      }));
    },
    [edit],
  );

  const applyDetected = useCallback(
    (detected: Detected) => {
      if (detected.size === 0) return;
      edit((current) => withCapabilities(current, detected));
    },
    [edit],
  );

  /** Capabilities the store's current connection can vouch for. */
  const isTrusted = useCallback(
    (store: StoreDraft) => {
      const signature = connectionSignature(store);
      if (!signature) return false;
      const status = checks.statuses[signature];
      return (
        savedSignatures.get(store.key) === signature ||
        (status?.kind === 'connected' && status.detected)
      );
    },
    [checks.statuses, savedSignatures],
  );

  const persist = useCallback(
    async (params: PluginParametersV3) => {
      const expected = expectSaved(params);
      try {
        await ctx.updatePluginParameters(params);
      } catch {
        expected.undo();
        void ctx.alert("Couldn't save the settings!");
        return;
      }
      expected.commit();
      setMigrationSaved(true);
      setSaveAnywaySignatures(new Set());
      void ctx.notice('Settings successfully saved!');
    },
    [ctx, expectSaved],
  );

  const checkAndPersist = useCallback(
    async (snapshot: SettingsDraft, force: boolean) => {
      const { detected, failed } = force
        ? NOT_CHECKED
        : await checkStores(storesToSave(snapshot), checks);
      if (failed.length > 0) {
        applyDetected(detected);
        setSaveAnywaySignatures(new Set(failed));
        setFormMessage('connection');
        focusFirstProblem('[data-connection-failed="true"]');
        return;
      }
      const trusted = (store: StoreDraft) =>
        detected.get(store.key)?.signature === connectionSignature(store) ||
        isTrusted(store);
      const settle = (current: SettingsDraft) =>
        withoutStaleCapabilities(withCapabilities(current, detected), trusted);
      // The draft gets what is saved, so the save leaves nothing dirty.
      edit(settle);
      await persist(parametersFromDraft(settle(snapshot)));
    },
    [applyDetected, checks, edit, isTrusted, persist],
  );

  const runSave = useCallback(
    async (force: boolean) => {
      // One save at a time: a double click on Save anyway saves once.
      if (savingRef.current) return;
      const snapshot = stateRef.current.draft;
      // Blocks added after this attempt follow the usual touch rule.
      touch(...allErrorKeys(snapshot));
      if (hasDraftErrors(validateDraft(snapshot))) {
        setFormMessage('invalid');
        focusFirstProblem('[aria-invalid="true"]');
        return;
      }
      savingRef.current = true;
      setFormMessage(null);
      setSaving(true);
      try {
        await checkAndPersist(snapshot, force);
      } finally {
        savingRef.current = false;
        setSaving(false);
      }
    },
    [checkAndPersist, touch],
  );

  const testStore = useCallback(
    async (key: string) => {
      const store = stateRef.current.draft.stores.find(
        (item) => item.key === key,
      );
      if (!store) return;
      touch(touchedKey(key, 'domain'), touchedKey(key, 'token'));
      const connection = storeConnectionFromDraft(store);
      const signature = connectionSignature(store);
      if (!isStoreDraftUsable(store) || !connection || !signature) return;
      const outcome = await checks.check(connection, signature);
      if (outcome.ok) {
        applyDetected(
          new Map([[key, { signature, capabilities: outcome.capabilities }]]),
        );
      }
    },
    [applyDetected, checks, touch],
  );

  const removeStore = useCallback(
    async (key: string) => {
      const content = removeStoreConsequences(stateRef.current, key);
      // A blank block has nothing to lose: no confirm.
      if (content) {
        const confirmed = await ctx.openConfirm({
          title: 'Remove this store?',
          content,
          choices: [
            {
              label: 'Yes, remove this store',
              value: true,
              intent: 'negative',
            },
          ],
          cancel: { label: 'Cancel', value: false },
        });
        if (confirmed !== true) return;
      }
      // Its block (and the focused ⋮ menu) is about to go: focus stays nearby.
      const neighbour = neighbourKey(stateRef.current.draft.stores, key);
      edit((current) => ({
        ...current,
        stores: current.stores.filter((store) => store.key !== key),
      }));
      if (neighbour) setFocusRequest({ storeKey: neighbour });
    },
    [ctx, edit],
  );

  const makeDefault = useCallback(
    async (key: string) => {
      const content = makeDefaultConsequences(stateRef.current, key);
      if (content) {
        const confirmed = await ctx.openConfirm({
          title: 'Make this the default store?',
          content,
          choices: [
            {
              label: 'Yes, make it the default',
              value: true,
              intent: 'positive',
            },
          ],
          cancel: { label: 'Cancel', value: false },
        });
        if (confirmed !== true) return;
      }
      edit((current) => moveToTop(current, key));
    },
    [ctx, edit],
  );

  const addStore = useCallback(() => {
    const store = emptyStoreDraft();
    edit((current) => ({ ...current, stores: [...current.stores, store] }));
    setFocusRequest({ storeKey: store.key });
  }, [edit]);

  return {
    draft,
    errors: visibleErrors(draft, allErrors, state.touched),
    dirty,
    saving,
    fieldsLocked: fieldsLocked || readOnly,
    readOnly,
    formMessage: currentFormMessage(formMessage, {
      invalid: hasDraftErrors(allErrors),
      connection: hasFailedSave(draft, checks, saveAnywaySignatures),
    }),
    checks,
    saveAnywaySignatures,
    focusRequest,
    noStoreConnected: !saved.stores.some(isStoreUsable),
    savedSignatures,
    updateStore,
    touchStore: (key, field) => touch(touchedKey(key, field)),
    addStore,
    removeStore,
    makeDefault,
    setUseDemoStore: (useDemoStore) =>
      edit((current) => ({ ...current, useDemoStore })),
    setAutoApply: (autoApplyToFieldsWithApiKey) =>
      edit((current) => ({ ...current, autoApplyToFieldsWithApiKey })),
    touchAutoApply: () => touch(AUTO_APPLY_KEY),
    testStore,
    save: () => runSave(false),
    saveAnyway: () => runSave(true),
  };
}
