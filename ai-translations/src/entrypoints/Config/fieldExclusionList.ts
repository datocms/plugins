/**
 * fieldExclusionList.ts
 * ---------------------
 * Pure helpers backing the "Fields to be excluded from translation" picker on
 * the config screen. Kept separate from the (very large) ConfigScreen component
 * so the mapping — especially the block handling that lets a field *inside a
 * block* be excluded — is unit-testable.
 */

/** One selectable entry in the exclusion picker. */
export interface FieldListEntry {
  /** DatoCMS field id — the stable token stored in the exclusion list. */
  id: string;
  /** Human field label. */
  name: string;
  /** Owning model/block label, e.g. "Article" or "Hero block". */
  model: string;
}

/** Minimal shape of a field returned by `ctx.loadItemTypeFields`. */
interface FieldLike {
  id: string;
  attributes: { label: string };
}

/** Minimal shape of an entry in `ctx.itemTypes`. */
interface ItemTypeLike {
  attributes: { name?: string; modular_block?: boolean };
}

/**
 * Maps a model's (or block's) loaded fields into exclusion-picker entries.
 *
 * Block fields are suffixed " block" so a nested field (e.g. a block's `title`)
 * is disambiguated from a same-named top-level model field — and, crucially, so
 * block fields appear in the picker AT ALL. Enumerating every item type
 * (models AND blocks) is what makes "exclude a field on a block" possible; the
 * translation engine already honors an excluded block field by id/api_key.
 *
 * @param fields - Fields of one item type (`ctx.loadItemTypeFields`).
 * @param itemType - The owning item type (`ctx.itemTypes[id]`), or undefined.
 */
export function buildFieldListEntries(
  fields: FieldLike[],
  itemType: ItemTypeLike | undefined,
): FieldListEntry[] {
  const isBlock = itemType?.attributes.modular_block === true;
  const modelName = itemType?.attributes.name ?? '';
  return fields.map((field) => ({
    id: field.id,
    name: field.attributes.label,
    model: isBlock ? `${modelName} block` : modelName,
  }));
}

/**
 * Appends only the fields whose id is not already present, deduping by id so
 * loading every item type's fields into one flat list never double-lists a
 * field across re-renders.
 */
export function mergeUniqueFields(
  prevFields: FieldListEntry[],
  newFields: FieldListEntry[],
): FieldListEntry[] {
  const existingIds = new Set(prevFields.map((field) => field.id));
  return [
    ...prevFields,
    ...newFields.filter((field) => !existingIds.has(field.id)),
  ];
}
