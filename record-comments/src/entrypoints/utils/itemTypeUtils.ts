import { COMMENTS_MODEL_API_KEY } from '@/constants';

type ItemType = {
  id: string;
  attributes: {
    api_key: string;
    name: string;
    modular_block: boolean;
    singleton?: boolean;
    [key: string]: unknown;
  };
  relationships?: {
    [key: string]: unknown;
  };
};

type ItemTypesMap = Record<string, ItemType | undefined>;

/**
 * Find the comments model from the item types map
 */
export function findCommentsModel(itemTypes: ItemTypesMap): ItemType | undefined {
  return Object.values(itemTypes).find(
    (model) => model?.attributes.api_key === COMMENTS_MODEL_API_KEY
  );
}

/**
 * Get all valid (non-undefined) item types as an array
 */
export function getValidItemTypes(itemTypes: ItemTypesMap): ItemType[] {
  return Object.values(itemTypes).filter(
    (model): model is ItemType => model !== undefined
  );
}

/**
 * Get all item types excluding the comments model
 */
export function getNonCommentsItemTypes(itemTypes: ItemTypesMap): ItemType[] {
  return getValidItemTypes(itemTypes).filter(
    (model) => model.attributes.api_key !== COMMENTS_MODEL_API_KEY
  );
}

/**
 * Safely extract the emoji/icon from an item type's attributes.
 *
 * DatoCMS stores model icons in the `icon` attribute, but the SDK types
 * don't expose this property directly. This helper safely extracts it
 * with proper type narrowing.
 *
 * @param itemType - The item type to extract the icon from (can be undefined)
 * @returns The emoji string or null if not available
 */
export function getItemTypeEmoji(itemType: ItemType | undefined): string | null {
  if (!itemType) return null;
  const attrs = itemType.attributes as Record<string, unknown>;
  const icon = attrs.icon;
  return typeof icon === 'string' ? icon : null;
}
