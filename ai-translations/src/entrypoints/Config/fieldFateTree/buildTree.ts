/**
 * buildTree.ts
 * ------------
 * Pure schema crawl: turns loaded item types + fields into the fate tree
 * (spec §3). Block-container fields recurse into their block types' fields with
 * a per-path cycle guard and a depth cap. Non-translatable fields are collected
 * into a per-model footer rather than becoming nodes (spec §3.3).
 */

import { translateFieldTypes } from '../configConstants';
import { cannotBeBlank } from '../../../utils/translation/SharedFieldUtils';
import type { FateFieldNode, FateModelNode } from './types';

/** A field as returned by `ctx.loadItemTypeFields`, narrowed to what we read. */
export interface LoadedField {
  id: string;
  attributes: {
    label: string;
    api_key: string;
    field_type: string;
    validators: Record<string, unknown>;
  };
}

/** An item type as held in `ctx.itemTypes`, narrowed to what we read. */
export interface LoadedItemType {
  id: string;
  attributes: {
    name: string;
    modular_block?: boolean;
  };
}

/** DatoCMS block-relationship validators, all shaped `{ item_types: string[] }`. */
const BLOCK_VALIDATOR_KEYS = [
  'rich_text_blocks',
  'structured_text_blocks',
  'single_block_blocks',
] as const;

/**
 * The block item-type ids a field can embed, across all block-container editors
 * (modular content, structured text, single block). Empty for a plain field.
 */
export const blockTypeIdsOf = (validators: Record<string, unknown>): string[] => {
  for (const key of BLOCK_VALIDATOR_KEYS) {
    const validator = validators[key] as { item_types?: unknown } | undefined;
    const ids = validator?.item_types;
    if (Array.isArray(ids) && ids.length > 0) return ids.map(String);
  }
  return [];
};

const MAX_DEPTH = 5;

const isTranslatableType = (fieldType: string): boolean =>
  Object.prototype.hasOwnProperty.call(translateFieldTypes, fieldType);

/**
 * Builds a leaf-or-block node for one field. Block containers recurse into their
 * block types; `ancestry` is the chain of block-type ids currently being
 * expanded (per-path cycle guard — the same block under sibling fields still
 * expands, only a self-cycle stops). Returns `null` for a field that is neither
 * translatable nor a block container with translatable descendants.
 */
const buildFieldNode = (
  field: LoadedField,
  fieldsByItemType: Map<string, LoadedField[]>,
  itemTypesById: Map<string, LoadedItemType>,
  ancestry: ReadonlySet<string>,
  depth: number,
): FateFieldNode | null => {
  const { id, attributes } = field;
  const base: FateFieldNode = {
    id,
    apiKey: attributes.api_key,
    label: attributes.label,
    required: cannotBeBlank(attributes.validators),
    fieldType: attributes.field_type,
  };

  const blockTypeIds = blockTypeIdsOf(attributes.validators);
  const canRecurse = depth < MAX_DEPTH;
  if (blockTypeIds.length > 0 && canRecurse) {
    const children: FateFieldNode[] = [];
    for (const blockTypeId of blockTypeIds) {
      if (ancestry.has(blockTypeId)) continue; // cycle — stop this path
      const nextAncestry = new Set(ancestry).add(blockTypeId);
      const blockFields = fieldsByItemType.get(blockTypeId) ?? [];
      for (const blockField of blockFields) {
        const child = buildFieldNode(
          blockField,
          fieldsByItemType,
          itemTypesById,
          nextAncestry,
          depth + 1,
        );
        if (child) children.push(child);
      }
    }
    if (children.length > 0) return { ...base, children };
    // A block container with no translatable descendants is not worth a row.
    return null;
  }

  if (isTranslatableType(attributes.field_type)) return base;
  return null;
};

/**
 * Builds a model node: its translatable field tree plus the footer list of
 * fields the filter dropped.
 *
 * @param itemType - The owning model/item type.
 * @param fieldsByItemType - All loaded fields keyed by item-type id.
 * @param itemTypesById - All item types keyed by id (for block metadata).
 * @returns The model node.
 */
export const buildModelNode = (
  itemType: LoadedItemType,
  fieldsByItemType: Map<string, LoadedField[]>,
  itemTypesById: Map<string, LoadedItemType>,
): FateModelNode => {
  const fields: FateFieldNode[] = [];
  const nonTranslatable: { label: string }[] = [];
  for (const field of fieldsByItemType.get(itemType.id) ?? []) {
    const node = buildFieldNode(
      field,
      fieldsByItemType,
      itemTypesById,
      new Set<string>(),
      0,
    );
    if (node) fields.push(node);
    else nonTranslatable.push({ label: field.attributes.label });
  }
  return {
    id: itemType.id,
    name: itemType.attributes.name,
    fields,
    nonTranslatable,
  };
};
