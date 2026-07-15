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

/** Renders a walked path (keys and array indices) as `a.b[0].c`. */
const formatPath = (path: Array<string | number>): string =>
  path.reduce<string>((rendered, segment) => {
    if (typeof segment === 'number') return `${rendered}[${segment}]`;
    return rendered === '' ? segment : `${rendered}.${segment}`;
  }, '');

/**
 * Guard from §2.1: walks `item` looking for an array that mixes a proper
 * block object with a bare id string — the shape a zero-field block model
 * collapses to. Detection is array-scoped (a bare string is only flagged
 * when a block-shaped sibling proves the array holds blocks), so ordinary
 * string arrays/fields elsewhere in the item are never false-flagged.
 *
 * @param item - Any value reachable from a `ctx.formValuesToItem` result
 * (or a subtree of one) to check before handing it to `itemToFormValues`.
 * @throws {EngineInputError} Naming the JSON path of the offending bare id.
 */
export const assertNoBareBlockIds = (item: unknown): void => {
  const walk = (value: unknown, path: Array<string | number>): void => {
    if (Array.isArray(value)) {
      const hasBlockSibling = value.some(isBlockShaped);
      value.forEach((entry, index) => {
        if (hasBlockSibling && typeof entry === 'string') {
          throw new EngineInputError(
            `Bare block id "${entry}" found at "${formatPath([...path, index])}" where a block object was expected. ` +
              'A zero-field block model serialises to a bare id and cannot round-trip through itemToFormValues (spec §2.1).',
          );
        }
        walk(entry, [...path, index]);
      });
      return;
    }

    if (value !== null && typeof value === 'object') {
      for (const [key, val] of Object.entries(value as Record<string, unknown>)) {
        walk(val, [...path, key]);
      }
    }
  };

  walk(item, []);
};
