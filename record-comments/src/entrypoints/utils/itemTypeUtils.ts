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

export function findCommentsModel(itemTypes: ItemTypesMap): ItemType | undefined {
  return Object.values(itemTypes).find(
    (model) => model?.attributes.api_key === COMMENTS_MODEL_API_KEY
  );
}

export function getValidItemTypes(itemTypes: ItemTypesMap): ItemType[] {
  return Object.values(itemTypes).filter(
    (model): model is ItemType => model !== undefined
  );
}

export function getNonCommentsItemTypes(itemTypes: ItemTypesMap): ItemType[] {
  return getValidItemTypes(itemTypes).filter(
    (model) => model.attributes.api_key !== COMMENTS_MODEL_API_KEY
  );
}

/** Safely extracts icon attribute (not exposed in SDK types). */
export function getItemTypeEmoji(itemType: ItemType | undefined): string | null {
  if (!itemType) return null;
  const attrs = itemType.attributes as Record<string, unknown>;
  const icon = attrs.icon;
  return typeof icon === 'string' ? icon : null;
}
