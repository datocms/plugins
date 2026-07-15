/**
 * Form adapter — the normalization layer between the SDK's JSON:API
 * converters (`ctx.formValuesToItem` / `ctx.itemToFormValues`) and the
 * simple client shape the engine speaks (spec §2.1, §2 architecture
 * diagram: "NORMALIZE (JSON:API ⇄ simple client shape)").
 *
 * The record (sidebar) path produces/consumes raw JSON:API items —
 * `attributes` holds the fields, `relationships.item_type.data.id` holds the
 * model id. The bulk path's `DatoCMSRecordFromAPI` already has fields at top
 * level. Nested block values (`{ type: 'item', id, attributes,
 * relationships }`) are identical in both shapes and pass through unchanged —
 * only the top-level envelope differs.
 */

/** Raw JSON:API item shape produced by `ctx.formValuesToItem`. */
export type JsonApiItem = {
  attributes: Record<string, unknown>;
  relationships: { item_type: { data: { id: string } } };
};

/**
 * Thrown by {@link assertNoBareBlockIds} when a value normally shaped as a
 * block object (`{ type: 'item', id, attributes, relationships }`) is
 * instead a bare id string — the §2.1 edge case where a zero-field block
 * model serialises to just its id and cannot round-trip through
 * `itemToFormValues` (which throws on it uncontrolled). The message names
 * the offending JSON path so the caller can act before handing the item to
 * the SDK.
 */
export class EngineInputError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'EngineInputError';
  }
}

/**
 * JSON:API item → the simple client shape the engine speaks.
 *
 * @param item - Raw item from `ctx.formValuesToItem` (never a CMA item
 * fetched without `nested: true` — see §2.1 — but this function does no
 * fetching itself, it only reshapes the envelope already in hand).
 * @returns `itemTypeId` from `relationships.item_type.data.id`; `fields`
 * from `attributes` (nested block values pass through unchanged).
 */
export const itemToSimpleShape = (
  item: JsonApiItem,
): { itemTypeId: string; fields: Record<string, unknown> } => ({
  itemTypeId: item.relationships.item_type.data.id,
  fields: item.attributes,
});

/**
 * Engine payload (per-field locale hashes) → per-(fieldPath, value) form
 * writes, restricted to newly-translated locales.
 *
 * The payload keeps every locale's value per field (including the
 * spread-in original locales the payload builder carries forward for
 * locale-sync bookkeeping — see `buildTranslatedUpdatePayload`'s
 * `{ ...fieldData, [toLocale]: value }` spreads). Writing all of them back
 * into a live form would silently re-stage untouched locales the user never
 * asked to touch. `writtenLocales` is threaded straight out of the engine
 * (which fields/locales it actually wrote this build) rather than
 * reconstructed by diffing values, so the guard can't be fooled by a
 * translation that happens to match the original text.
 *
 * @param payload - `{ apiKey: { locale: value } }`, as returned by
 * `buildTranslatedUpdatePayload`/`translateRecordUnits`.
 * @param writtenLocales - `{ apiKey: string[] }` — the locales this build
 * newly wrote for that field. A locale present in `payload[field]` but
 * absent from `writtenLocales[field]` is skipped.
 * @returns One write per (field, newLocale), `fieldPath` dot-joined as
 * `` `${apiKey}.${locale}` ``.
 */
export const payloadToFormWrites = (
  payload: Record<string, Record<string, unknown>>,
  writtenLocales: Record<string, string[]>,
): Array<{ fieldPath: string; locale: string; value: unknown }> => {
  const writes: Array<{ fieldPath: string; locale: string; value: unknown }> =
    [];

  for (const [field, localeValues] of Object.entries(payload)) {
    const newLocales = new Set(writtenLocales[field] ?? []);
    for (const [locale, value] of Object.entries(localeValues)) {
      if (!newLocales.has(locale)) continue;
      writes.push({ fieldPath: `${field}.${locale}`, locale, value });
    }
  }

  return writes;
};

/** A DatoCMS block object: `{ type: 'item', id, attributes, relationships }`. */
const isBlockShaped = (
  value: unknown,
): value is { type: string; id: string } =>
  typeof value === 'object' &&
  value !== null &&
  (value as Record<string, unknown>).type === 'item' &&
  typeof (value as Record<string, unknown>).id === 'string';

/** Throws the §2.1 bare-block-id error naming `path`. */
const throwBareBlockId = (id: string, path: string): never => {
  throw new EngineInputError(
    `Bare block id "${id}" found at "${path}" where a block object was expected. ` +
      'A zero-field block model serialises to a bare id and cannot round-trip through itemToFormValues (spec §2.1).',
  );
};

/**
 * Nested safety-net walk: within any array, flag a bare string that sits
 * beside a block-shaped sibling (a zero-field block collapsed inside modular
 * content nested one or more levels below a top-level block field). Purely
 * additional to the schema-aware pass — it needs no schema because a
 * block-shaped sibling proves the array holds blocks.
 */
const walkNestedHeuristic = (value: unknown, path: string): void => {
  if (Array.isArray(value)) {
    const hasBlockSibling = value.some(isBlockShaped);
    value.forEach((entry, index) => {
      if (hasBlockSibling && typeof entry === 'string') {
        throwBareBlockId(entry, `${path}[${index}]`);
      }
      walkNestedHeuristic(entry, `${path}[${index}]`);
    });
    return;
  }
  if (value !== null && typeof value === 'object') {
    for (const [key, val] of Object.entries(value as Record<string, unknown>)) {
      walkNestedHeuristic(val, path === '' ? key : `${path}.${key}`);
    }
  }
};

/**
 * Checks one value that occupies a block-bearing position — the value of a
 * `single_block`/`frameless_single_block` field (a lone block object) or of a
 * `rich_text`/`structured_text` field (an array of block objects). Handles the
 * localized wrapper (`{ [locale]: value }`) transparently by recursing into
 * each locale, since a localized wrapper is a plain object that is NOT
 * block-shaped.
 */
const checkBlockPosition = (value: unknown, path: string): void => {
  if (value === null || value === undefined) return;

  // A bare id string sitting directly in a block position is the §2.1 hazard:
  // a zero-field single_block collapsed to just its id.
  if (typeof value === 'string') {
    throwBareBlockId(value, path);
    return;
  }

  // Modular content / rich text: every element must be a block object. A
  // block-bearing field's array never legitimately holds a bare string.
  if (Array.isArray(value)) {
    value.forEach((entry, index) => {
      if (typeof entry === 'string') {
        throwBareBlockId(entry, `${path}[${index}]`);
      }
      // Recurse into the block's own sub-values for nested modular content.
      walkNestedHeuristic(entry, `${path}[${index}]`);
    });
    return;
  }

  if (typeof value === 'object') {
    // A well-formed single_block value: recurse into its sub-values for any
    // nested modular content that might itself hide a bare id.
    if (isBlockShaped(value)) {
      walkNestedHeuristic(value, path);
      return;
    }
    // Otherwise this is a localized wrapper `{ [locale]: <block position> }`.
    for (const [locale, inner] of Object.entries(
      value as Record<string, unknown>,
    )) {
      checkBlockPosition(inner, `${path}.${locale}`);
    }
  }
};

/**
 * Guard from §2.1: a block model with **zero fields** serialises to a bare id
 * string instead of `{ type: 'item', id, attributes, relationships }`, and
 * `ctx.itemToFormValues` throws uncontrolled on it. This asserts, ahead of the
 * SDK converter, that no block-bearing field holds such a bare id — throwing a
 * message that names the JSON path so the sidebar can surface it.
 *
 * The check is **schema-aware**: without knowing which fields carry blocks,
 * `hero: "abc123"` (a bare block id) is indistinguishable from
 * `external_id: "abc123"` (a scalar string), so the caller must supply the set
 * of block-bearing top-level field api_keys. There are therefore no false
 * positives on scalar string fields — they are simply not in the set.
 *
 * **Caller usage (Task 8, the sidebar).** Compute `blockBearingFieldApiKeys`
 * from `ctx.fields`: the api_keys of every field whose editor/field type is
 * `single_block` / `frameless_single_block` / `rich_text` / `structured_text`.
 * Pass the JSON:API item from `ctx.formValuesToItem` and that set, before ever
 * handing the item to `ctx.itemToFormValues`.
 *
 * Both localized (`{ [locale]: value }`) and non-localized field values are
 * handled; nested modular content inside a block is additionally swept by a
 * schema-free sibling heuristic.
 *
 * @param item - The JSON:API item (its `attributes` are inspected).
 * @param blockBearingFieldApiKeys - Top-level api_keys whose fields carry
 * blocks (single_block/frameless_single_block/rich_text/structured_text).
 * @throws {EngineInputError} Naming the JSON path of the offending bare id.
 */
export const assertNoBareBlockIds = (
  item: { attributes: Record<string, unknown>; [key: string]: unknown },
  blockBearingFieldApiKeys: ReadonlySet<string> | string[],
): void => {
  const blockFields = Array.isArray(blockBearingFieldApiKeys)
    ? new Set(blockBearingFieldApiKeys)
    : blockBearingFieldApiKeys;

  const attributes = item.attributes ?? {};
  for (const apiKey of blockFields) {
    if (!(apiKey in attributes)) continue;
    checkBlockPosition(attributes[apiKey], `attributes.${apiKey}`);
  }
};
