import type { buildClient } from '@datocms/cma-client-browser';
import { checkCancellation } from './Cancellation';
import type { CancellationOptions } from './types';
import type { ProgressUpdate } from './ItemsDropdownUtils';

/** Maximum number of records accepted by one CMA bulk-publish request. */
export const BULK_PUBLISH_BATCH_SIZE = 200;

type BulkPublishClient = {
  items: Pick<
    ReturnType<typeof buildClient>['items'],
    'rawBulkPublish' | 'list'
  >;
};
const MODEL_LOOKUP_CONCURRENCY = 4;
const PUBLICATION_STATUS_BATCH_SIZE = 30;

type ItemTypeWithDraftMode = {
  draft_mode_active: boolean;
};

export type BulkPublishProgressCallback = (
  publishedRecordIds: string[],
  publishedCount: number,
  totalCount: number,
) => void;

export type BulkPublishOptions = CancellationOptions & {
  /** Version saved by the translation. Skip records edited afterwards. */
  expectedVersions?: ReadonlyMap<string, string>;
};

export function hasPersistedUpdates(update: ProgressUpdate): boolean {
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
  options: CancellationOptions = {},
): Promise<string[]> {
  const uniqueItemTypeIds = [...new Set(itemTypeIds)];
  const draftMode = new Set<string>();
  let nextIndex = 0;
  let failed = false;
  const worker = async () => {
    while (!failed && nextIndex < uniqueItemTypeIds.length) {
      checkCancellation(options);
      const itemTypeId = uniqueItemTypeIds[nextIndex++];
      try {
        // biome-ignore lint/performance/noAwaitInLoops: Bounded workers avoid a CMA request for every model at once.
        const itemType = await getItemType(itemTypeId);
        checkCancellation(options);
        if (itemType.draft_mode_active) draftMode.add(itemTypeId);
      } catch (error) {
        failed = true;
        throw error;
      }
    }
  };
  await Promise.all(
    Array.from(
      { length: Math.min(MODEL_LOOKUP_CONCURRENCY, uniqueItemTypeIds.length) },
      worker,
    ),
  );
  return uniqueItemTypeIds.filter((id) => draftMode.has(id));
}

export class BulkPublishPartialError extends Error {
  constructor(
    public readonly failedRecordIds: string[],
    public readonly publishedCount: number,
  ) {
    super(
      `DatoCMS error: ${failedRecordIds.length} record${failedRecordIds.length === 1 ? '' : 's'} could not be confirmed as published. Records may have changed since translation, become inaccessible, or failed publishing validation or permissions.`,
    );
    this.name = 'BulkPublishPartialError';
  }
}

async function* loadCurrentRecordStates(
  client: BulkPublishClient,
  batch: string[],
  options: CancellationOptions,
) {
  for (
    let offset = 0;
    offset < batch.length;
    offset += PUBLICATION_STATUS_BATCH_SIZE
  ) {
    checkCancellation(options);
    // biome-ignore lint/performance/noAwaitInLoops: Small sequential ID filters keep URLs and read traffic bounded.
    const records = await client.items.list({
      filter: {
        ids: batch
          .slice(offset, offset + PUBLICATION_STATUS_BATCH_SIZE)
          .join(','),
      },
      nested: false,
      version: 'current',
      page: { offset: 0, limit: PUBLICATION_STATUS_BATCH_SIZE },
    });
    yield records;
  }
}

async function confirmPublishedRecordIds(
  client: BulkPublishClient,
  batch: string[],
): Promise<string[]> {
  const publishedIds = new Set<string>();
  // CMA reports counts for partial bulk operations, but no individual IDs.
  // Finish acknowledging an accepted mutation through reads even after Cancel.
  for await (const records of loadCurrentRecordStates(client, batch, {})) {
    for (const record of records) {
      if (record.meta?.status === 'published') publishedIds.add(record.id);
    }
  }
  return batch.filter((id) => publishedIds.has(id));
}

async function filterUnchangedRecordIds(
  client: BulkPublishClient,
  batch: string[],
  options: BulkPublishOptions,
): Promise<string[]> {
  const expectedVersions = options.expectedVersions;
  if (!expectedVersions) return batch;
  const knownIds = batch.filter((id) => expectedVersions.has(id));
  const unchangedIds = new Set<string>();
  for await (const records of loadCurrentRecordStates(
    client,
    knownIds,
    options,
  )) {
    for (const record of records) {
      if (record.meta.current_version === expectedVersions.get(record.id)) {
        unchangedIds.add(record.id);
      }
    }
  }
  return batch.filter(
    (id) => !expectedVersions.has(id) || unchangedIds.has(id),
  );
}

async function publishRecordBatch(
  client: BulkPublishClient,
  requestedIds: string[],
  options: BulkPublishOptions,
) {
  const batch = await filterUnchangedRecordIds(client, requestedIds, options);
  checkCancellation(options);
  let publishedIds: string[] = [];
  if (batch.length > 0) {
    const result = await client.items.rawBulkPublish({
      data: {
        type: 'item_bulk_publish_operation',
        relationships: {
          items: { data: batch.map((id) => ({ type: 'item', id })) },
        },
      },
    });
    // A resolved job confirms the mutation even if Cancel happened in flight.
    publishedIds =
      result.meta?.failed === 0 && result.meta.successful === batch.length
        ? batch
        : await confirmPublishedRecordIds(client, batch);
  }
  const publishedSet = new Set(publishedIds);
  return {
    publishedIds,
    failedIds: requestedIds.filter((id) => !publishedSet.has(id)),
  };
}

/**
 * Publish continuously in CMA-sized batches. rawBulkPublish retains the
 * successful/failed counters that bulkPublish discards. A partial batch is
 * reconciled through safe reads; its failures do not block subsequent batches.
 * Mutation transport errors are deliberately not replayed here.
 */
export async function bulkPublishTranslatedRecords(
  client: BulkPublishClient,
  recordIds: Iterable<string>,
  onBatchPublished?: BulkPublishProgressCallback,
  options: BulkPublishOptions = {},
): Promise<number> {
  const uniqueRecordIds = [...new Set(recordIds)].filter(Boolean);
  const failedRecordIds: string[] = [];
  let publishedCount = 0;
  for (
    let offset = 0;
    offset < uniqueRecordIds.length;
    offset += BULK_PUBLISH_BATCH_SIZE
  ) {
    checkCancellation(options);
    const batch = uniqueRecordIds.slice(
      offset,
      offset + BULK_PUBLISH_BATCH_SIZE,
    );
    // biome-ignore lint/performance/noAwaitInLoops: Await each CMA job before submitting the next mutation.
    const { publishedIds, failedIds } = await publishRecordBatch(
      client,
      batch,
      options,
    );
    publishedCount += publishedIds.length;
    if (publishedIds.length > 0) {
      onBatchPublished?.(publishedIds, publishedCount, uniqueRecordIds.length);
    }
    failedRecordIds.push(...failedIds);
    checkCancellation(options);
  }
  if (failedRecordIds.length > 0) {
    throw new BulkPublishPartialError(failedRecordIds, publishedCount);
  }
  return publishedCount;
}
