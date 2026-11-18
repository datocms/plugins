import type { RawItem } from '../types';

export type ItemStatus = 'draft' | 'updated' | 'published';

export function getItemStatus(item: RawItem | null | undefined): ItemStatus {
  return item?.meta.status ?? 'published';
}
