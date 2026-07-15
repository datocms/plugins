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
  Object.hasOwn(translateFieldTypes, fieldType);

/**
 * Recurses into a block-container field's block types and returns the built
 * sub-field nodes. `ancestry` is the chain of block-type ids currently being
 * expanded — a per-path cycle guard, so the same block under sibling fields
 * still expands while a self-cycle stops.
 */
const buildBlockChildren = (
  blockTypeIds: string[],
  fieldsByItemType: Map<string, LoadedField[]>,
  itemTypesById: Map<string, LoadedItemType>,
  ancestry: ReadonlySet<string>,
  depth: number,
): FateFieldNode[] => {
  const children: FateFieldNode[] = [];
  for (const blockTypeId of blockTypeIds) {
    if (ancestry.has(blockTypeId)) continue; // cycle — stop this path
    const nextAncestry = new Set(ancestry).add(blockTypeId);
    for (const blockField of fieldsByItemType.get(blockTypeId) ?? []) {
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
  return children;
};

/**
 * Builds a leaf-or-block node for one field. A block container with at least
 * one translatable descendant becomes a parent node; one with none, or a plain
 * non-translatable field, returns `null` (dropped to the model footer).
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
  if (blockTypeIds.length > 0 && depth < MAX_DEPTH) {
    const children = buildBlockChildren(
      blockTypeIds,
      fieldsByItemType,
      itemTypesById,
      ancestry,
      depth,
    );
    return children.length > 0 ? { ...base, children } : null;
  }

  return isTranslatableType(attributes.field_type) ? base : null;
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

/**
 * Builds the fate tree for every top-level model (item types that are not
 * modular blocks — blocks appear nested under the fields that embed them).
 *
 * @param itemTypes - All item types (models and blocks).
 * @param fieldsByItemType - All loaded fields keyed by item-type id.
 * @returns One model node per top-level model.
 */
export const buildModelsFromSchema = (
  itemTypes: LoadedItemType[],
  fieldsByItemType: Map<string, LoadedField[]>,
): FateModelNode[] => {
  const itemTypesById = new Map(itemTypes.map((it) => [it.id, it]));
  return itemTypes
    .filter((it) => it.attributes.modular_block !== true)
    .map((it) => buildModelNode(it, fieldsByItemType, itemTypesById));
};
