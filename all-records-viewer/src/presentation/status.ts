import type { RawItem } from '../types';

export type ItemStatus = 'draft' | 'updated' | 'published';

export type ItemValidity = {
  currentValid: boolean | null;
  publishedValid: boolean | null;
  hasCurrentError: boolean;
  hasPublishedError: boolean;
};

export const ITEM_STATUS_LABEL: Record<ItemStatus, string> = {
  draft: 'Draft',
  updated: 'Unpublished changes',
  published: 'Published',
};

export function getItemStatus(item: RawItem | null | undefined): ItemStatus {
  return item?.meta.status ?? 'published';
}

export function getItemValidity(
  item: RawItem,
  draftModeActive: boolean,
): ItemValidity {
  const currentValid = item.meta.is_current_version_valid;
  const publishedValid = item.meta.is_published_version_valid;

  return {
    currentValid,
    publishedValid,
    hasCurrentError: currentValid === false,
    hasPublishedError: draftModeActive && publishedValid === false,
  };
}
