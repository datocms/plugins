import type { ProgressUpdate } from './ItemsDropdownUtils';

/** Maximum number of records accepted by one CMA bulk-publish request. */
export const BULK_PUBLISH_BATCH_SIZE = 200;

type BulkPublishClient = {
  items: {
    bulkPublish: (body: {
      items: Array<{ type: 'item'; id: string }>;
    }) => Promise<unknown>;
  };
};

type ItemTypeWithDraftMode = {
  draft_mode_active: boolean;
};

export type BulkPublishProgressCallback = (
  publishedRecordIds: string[],
  publishedCount: number,
  totalCount: number,
) => void;

function hasPersistedUpdates(update: ProgressUpdate): boolean {
  return [
    update.translatedFieldApiKeys,
    update.translatedFieldIds,
    update.copiedLinkFieldApiKeys,
    update.copiedLinkFieldIds,
  ].some((fields) => (fields?.length ?? 0) > 0);
}

/**
 * Returns the successfully updated records whose models support publishing.
 * Completed records with no eligible fields are deliberately excluded because
 * no new draft was written for them.
 */
export function getPublishableTranslatedRecordIds(
  updates: ProgressUpdate[],
  draftModeItemTypeIds: Iterable<string>,
): string[] {
  const draftModeItemTypes = new Set(draftModeItemTypeIds);
  const seenRecordIds = new Set<string>();

  return updates.reduce<string[]>((recordIds, update) => {
    if (
      update.status !== 'completed' ||
      !update.itemTypeId ||
      !draftModeItemTypes.has(update.itemTypeId) ||
      !hasPersistedUpdates(update) ||
      seenRecordIds.has(update.recordId)
    ) {
      return recordIds;
    }

    seenRecordIds.add(update.recordId);
    recordIds.push(update.recordId);
    return recordIds;
  }, []);
}

/** Resolve the selected model IDs that have DatoCMS draft/published mode on. */
export async function getDraftModeItemTypeIds(
  itemTypeIds: Iterable<string>,
  getItemType: (itemTypeId: string) => Promise<ItemTypeWithDraftMode>,
): Promise<string[]> {
  const uniqueItemTypeIds = [...new Set(itemTypeIds)];
  const itemTypes = await Promise.all(
    uniqueItemTypeIds.map(async (itemTypeId) => ({
      itemTypeId,
      itemType: await getItemType(itemTypeId),
    })),
  );

  return itemTypes
    .filter(({ itemType }) => itemType.draft_mode_active)
    .map(({ itemTypeId }) => itemTypeId);
}

/**
 * Publishes records sequentially in CMA-sized batches. The callback only fires
 * after a batch succeeds, allowing the UI to report accurate partial progress
 * and retry only the records that remain if a later batch fails.
 */
export async function bulkPublishTranslatedRecords(
  client: BulkPublishClient,
  recordIds: Iterable<string>,
  onBatchPublished?: BulkPublishProgressCallback,
): Promise<number> {
  const uniqueRecordIds = [...new Set(recordIds)].filter(Boolean);
  const batches = Array.from(
    { length: Math.ceil(uniqueRecordIds.length / BULK_PUBLISH_BATCH_SIZE) },
    (_, index) =>
      uniqueRecordIds.slice(
        index * BULK_PUBLISH_BATCH_SIZE,
        (index + 1) * BULK_PUBLISH_BATCH_SIZE,
      ),
  );

  return batches.reduce<Promise<number>>(
    (publishedCountPromise, batch) =>
      publishedCountPromise.then(async (publishedCount) => {
        await client.items.bulkPublish({
          items: batch.map((id) => ({ type: 'item', id })),
        });
        const nextPublishedCount = publishedCount + batch.length;
        onBatchPublished?.(
          [...batch],
          nextPublishedCount,
          uniqueRecordIds.length,
        );
        return nextPublishedCount;
      }),
    Promise.resolve(0),
  );
}
