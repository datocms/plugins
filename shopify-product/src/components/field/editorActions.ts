import type { RenderFieldExtensionCtx } from 'datocms-plugin-sdk';
import { PICKER_MODAL_HEIGHT, PICKER_MODAL_ID } from '../../constants';
import {
  countKept,
  entriesFromNodes,
  entriesFromSelection,
  escapeHtml,
  FORMAT_LABELS,
  kindNoun,
  newlyPickedNodes,
  nodesFromSelection,
  PERSIST_FAILED_MESSAGE,
  PICKER_FAILED_MESSAGE,
  pickerTitle,
  type RowModel,
  readPickerResult,
  replaceEntryAt,
  selectionChangeMessage,
  selectionWithPrimaryHandles,
  serializeEntries,
  toPickerSelected,
  type WriteTarget,
  withEntryHandle,
  withPrimaryHandle,
} from '../../lib/fieldValue';
import { nodeTitle } from '../../lib/format';
import { moveEntry, StoredValueBuildError } from '../../lib/references';
import {
  describeError,
  isAbortError,
  ShopifyClientError,
  type ShopifyClient,
} from '../../lib/shopifyClient';
import type {
  Cardinality,
  FieldParametersV1,
  FieldType,
  PickerModalParameters,
  PickerModalResult,
  PickerSelectedEntry,
  PickerUnavailableEntry,
  ShopifyNode,
  StorageFormat,
  StoredEntry,
  StoreConnection,
} from '../../types';
import type { FieldFeedback } from './useFieldFeedback';

/** Everything an editor action needs. Every write goes through `ctx.setFieldValue`. */
export type ActionEnv = {
  ctx: RenderFieldExtensionCtx;
  fieldType: FieldType;
  params: FieldParametersV1;
  store: StoreConnection;
  client: ShopifyClient;
  /**
   * The context-free client (no market: the shop's primary language and
   * currency). Every 1.x JSON value is rebuilt from it, and every handle the
   * field saves comes from it: Shopify translates handles in a language
   * context, and translated handles only resolve in that language.
   */
  primaryClient: Pick<ShopifyClient, 'legacyProduct' | 'loadNodes'>;
  /** The format and shop of the value as saved (for same-format updates). */
  storedFormat: StorageFormat | null;
  storedShop: string | null;
  /** The rows as shown, in order. */
  rows: readonly RowModel[];
  seed: (nodes: ReadonlyMap<string, ShopifyNode | null>) => void;
  setOrder: (keys: string[] | null) => void;
  feedback: FieldFeedback;
};

function entriesOf(env: ActionEnv): StoredEntry[] {
  return env.rows.map((row) => row.entry);
}

function rowLabel(row: RowModel): string {
  return row.node ? nodeTitle(row.node) : row.fallback.label;
}

/** Writes in the field's configured format (picks, replace, convert). */
function configuredTarget(env: ActionEnv): WriteTarget {
  return {
    fieldType: env.fieldType,
    format: env.params.format,
    kind: env.params.kind,
    shop: env.store.shopDomain,
    cardinality: env.params.cardinality,
    snapshot: env.params.format === 'reference' && env.params.snapshot,
  };
}

/**
 * Writes in the format the value is saved in, keeping any snapshots it
 * carries (reorder, remove, handle updates, legacy refresh).
 */
function storedTarget(env: ActionEnv): WriteTarget {
  return {
    ...configuredTarget(env),
    format: env.storedFormat ?? env.params.format,
    shop: env.storedShop ?? env.store.shopDomain,
    snapshot: true,
  };
}

/** The toast after a failed write. Toasts render HTML, so details are escaped. */
export function failureMessage(error: unknown): string {
  if (error instanceof StoredValueBuildError) {
    return `Couldn't save the Shopify selection: ${escapeHtml(error.message)}`;
  }
  if (error instanceof ShopifyClientError) {
    return `Couldn't save the Shopify selection: ${escapeHtml(describeError(error))}`;
  }
  return PERSIST_FAILED_MESSAGE;
}

function reportFailure(env: ActionEnv, error: unknown) {
  if (!isAbortError(error)) void env.ctx.alert(failureMessage(error));
}

async function writeValue(
  env: ActionEnv,
  value: string | null,
): Promise<boolean> {
  try {
    await env.ctx.setFieldValue(env.ctx.fieldPath, value);
    return true;
  } catch {
    void env.ctx.alert(PERSIST_FAILED_MESSAGE);
    return false;
  }
}

async function writeEntries(
  env: ActionEnv,
  target: WriteTarget,
  entries: readonly StoredEntry[],
): Promise<boolean> {
  let value: string | null;
  try {
    value = await serializeEntries(target, entries, (ref) =>
      env.primaryClient.legacyProduct(ref),
    );
  } catch (error) {
    reportFailure(env, error);
    return false;
  }
  return writeValue(env, value);
}

/** Reference documents and 1.x string fields save handles; Shopify IDs and 1.x JSON don't need these. */
function savesHandles(env: ActionEnv): boolean {
  return env.params.format === 'reference' || env.params.format === 'handle';
}

/**
 * The same items loaded with no market, keyed by GID: the source of every
 * handle the field saves. One batched `nodes(ids:)` call.
 */
async function loadPrimaryNodes(
  env: ActionEnv,
  nodes: readonly ShopifyNode[],
): Promise<Map<string, ShopifyNode | null>> {
  const ids = [...new Set(nodes.map((node) => node.id))];
  if (ids.length === 0) return new Map();
  const found = await env.primaryClient.loadNodes(ids);
  return new Map(ids.map((id, index) => [id, found[index] ?? null]));
}

/**
 * The picker's selection with primary-language handles on the items that
 * aren't in `current` (those keep their saved handle). The picker may have
 * loaded them in the field's language, a store default language, or a
 * language chosen in its market switcher. Null when Shopify couldn't be
 * reached (the editor has been told).
 */
async function primarySelection(
  env: ActionEnv,
  selected: PickerSelectedEntry[],
  current: readonly StoredEntry[],
): Promise<PickerSelectedEntry[] | null> {
  if (!savesHandles(env)) return selected;
  const picked = newlyPickedNodes(selected, current);
  try {
    const primary = await loadPrimaryNodes(env, picked);
    return selectionWithPrimaryHandles(selected, primary);
  } catch (error) {
    reportFailure(env, error);
    return null;
  }
}

function selectionOptions(env: ActionEnv) {
  return {
    kind: env.params.kind,
    snapshot: env.params.format === 'reference' && env.params.snapshot,
    capturedAt: new Date().toISOString(),
  };
}

async function openPicker(
  env: ActionEnv,
  selected: PickerSelectedEntry[],
  cardinality: Cardinality,
  unavailable?: PickerUnavailableEntry[],
): Promise<PickerModalResult | null> {
  const parameters: PickerModalParameters = {
    fieldParameters: { ...env.params, cardinality },
    fieldType: env.fieldType,
    shopDomain: env.store.shopDomain,
    selected,
    context: env.client.context,
    ...(unavailable && unavailable.length > 0 ? { unavailable } : {}),
  };
  let result: unknown;
  try {
    result = await env.ctx.openModal({
      id: PICKER_MODAL_ID,
      title: pickerTitle(env.params.kind, cardinality),
      width: 'xl',
      initialHeight: PICKER_MODAL_HEIGHT,
      parameters,
    });
  } catch {
    void env.ctx.alert(PICKER_FAILED_MESSAGE);
    return null;
  }
  return readPickerResult(result);
}

/** "Browse Shopify" and "Add …": the picker with the current selection. */
export async function browse(env: ActionEnv): Promise<void> {
  const result = await openPicker(
    env,
    toPickerSelected(env.rows),
    env.params.cardinality,
  );
  if (!result) return;
  const current = entriesOf(env);
  const selected = await primarySelection(env, result.selected, current);
  if (!selected) return;
  const entries = entriesFromSelection(
    selected,
    current,
    selectionOptions(env),
  );
  env.seed(nodesFromSelection(selected));
  const limited =
    env.params.cardinality === 'single' ? entries.slice(0, 1) : entries;
  // Untouched items keep their snapshots, whatever the setting is now: new
  // items only get one when the field asks for it (`entriesFromSelection`).
  const saved = await writeEntries(
    env,
    { ...configuredTarget(env), snapshot: true },
    limited,
  );
  if (!saved) return;
  const kept = countKept(limited, current);
  const message = selectionChangeMessage(
    env.params.kind,
    limited.length - kept,
    current.length - kept,
  );
  if (message) env.feedback.announce(message);
}

/** Replace one row: the picker in single mode, swapped in place. */
export async function replaceAt(env: ActionEnv, index: number): Promise<void> {
  const row = env.rows[index];
  if (!row) return;
  env.feedback.refine([{ index }, 'first-row']);
  const others = env.rows
    .filter((_, position) => position !== index)
    .map((other) => ({ key: other.key, id: other.node?.id ?? other.entry.id }));
  const result = await openPicker(
    env,
    toPickerSelected([row]),
    'single',
    others,
  );
  const [picked] = result?.selected ?? [];
  if (!picked?.node) return;
  // The replacement is always written fresh, even when it's the same item.
  const [primaryPicked] = (await primarySelection(env, [picked], [])) ?? [];
  if (!primaryPicked?.node) return;
  const [replacement] = entriesFromSelection(
    [primaryPicked],
    [],
    selectionOptions(env),
  );
  if (!replacement) return;
  const swapped = replaceEntryAt(entriesOf(env), index, replacement);
  if (!swapped.ok) {
    if (swapped.reason === 'duplicate') {
      void env.ctx.alert(
        `Couldn't replace the ${kindNoun(env.params.kind)}, as it's already in this field!`,
      );
    }
    return;
  }
  env.seed(nodesFromSelection([primaryPicked]));
  const saved = await writeEntries(
    env,
    { ...configuredTarget(env), snapshot: true },
    swapped.entries,
  );
  if (saved) {
    env.feedback.announce(
      `Replaced ${rowLabel(row)} with ${nodeTitle(primaryPicked.node)}`,
    );
  }
}

export async function removeAt(env: ActionEnv, index: number): Promise<void> {
  const row = env.rows[index];
  if (!row) return;
  // The row that takes its place, else the one before it, else Add/Browse.
  env.feedback.refine([{ index }, { index: index - 1 }, 'add', 'browse']);
  const remaining = entriesOf(env).filter((_, position) => position !== index);
  const saved =
    remaining.length === 0
      ? await writeValue(env, null)
      : await writeEntries(env, storedTarget(env), remaining);
  if (saved) env.feedback.announce(`Removed ${rowLabel(row)}`);
}

/** Drag-and-drop: shows the new order at once, rolls it back if the write fails. */
export async function reorder(
  env: ActionEnv,
  from: number,
  to: number,
): Promise<void> {
  const next = moveEntry(entriesOf(env), from, to);
  env.setOrder(next.map((entry) => entry.key));
  const saved = await writeEntries(env, storedTarget(env), next);
  if (!saved) env.setOrder(null);
}

/** "Update": writes only the new handle, in the format the value is saved in. */
export async function updateHandle(
  env: ActionEnv,
  key: string,
  handle: string,
): Promise<void> {
  const index = env.rows.findIndex((row) => row.key === key);
  env.feedback.refine([{ index }, 'first-row']);
  const saved = await writeEntries(
    env,
    storedTarget(env),
    withEntryHandle(entriesOf(env), key, handle),
  );
  if (saved) env.feedback.announce(`Updated the handle to ${handle}`);
}

/** "Refresh saved data": rewrites the 1.x JSON from fresh Shopify data. */
export async function refreshLegacy(env: ActionEnv): Promise<void> {
  const saved = await writeEntries(
    env,
    { ...storedTarget(env), format: 'legacyProductJson' },
    entriesOf(env),
  );
  if (saved) env.feedback.announce('Refreshed the saved data');
}

/**
 * The rows' live nodes. When they were loaded in a language, their handles
 * are swapped for the primary-language ones (see `primaryClient`). Null when
 * Shopify couldn't be reached (the editor has been told).
 */
async function nodesToConvert(
  env: ActionEnv,
): Promise<Map<string, ShopifyNode | null> | null> {
  const nodes = new Map(env.rows.map((row) => [row.key, row.node] as const));
  if (!savesHandles(env) || !env.client.context.language) return nodes;
  try {
    const live = env.rows.flatMap((row) => (row.node ? [row.node] : []));
    const primary = await loadPrimaryNodes(env, live);
    for (const [key, node] of nodes) {
      if (node) nodes.set(key, withPrimaryHandle(node, primary));
    }
    return nodes;
  } catch (error) {
    reportFailure(env, error);
    return null;
  }
}

/** "Convert to new format": re-saves the resolved items in the configured format. */
export async function convert(env: ActionEnv): Promise<void> {
  const nodes = await nodesToConvert(env);
  if (!nodes) return;
  const options = selectionOptions(env);
  const entries = entriesFromNodes(entriesOf(env), nodes, {
    snapshot: options.snapshot,
    capturedAt: options.capturedAt,
  });
  if (!entries) return;
  const saved = await writeEntries(env, configuredTarget(env), entries);
  if (saved) {
    env.feedback.announce(`Saved as ${FORMAT_LABELS[env.params.format]}`);
  }
}
