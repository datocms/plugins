import type { buildClient } from '@datocms/cma-client-browser';
import type { DatoCMSRecordFromAPI } from './ItemsDropdownUtils';

/** Nested CMA responses support at most 30 records per page. */
export const BULK_RECORD_BATCH_SIZE = 30;
const RECORD_ID_PAGE_SIZE = 500;

type CancellationOptions = {
  checkCancellation?: () => boolean;
  abortSignal?: AbortSignal;
};

export type RecordDiscoveryProgress = {
  loaded: number;
  /** Undefined only while the initial model counts are being requested. */
  total?: number;
  modelId: string;
};

export type RecordLoadingProgress = { loaded: number; total: number };

type RecordDiscoveryOptions = CancellationOptions & {
  onProgress?: (progress: RecordDiscoveryProgress) => void;
};

export type RecordBatch = {
  records: DatoCMSRecordFromAPI[];
  requestedItemIds: string[];
  /** Records deleted or made inaccessible since the selection was collected. */
  missingItemIds: string[];
};

function throwIfCancelled(options: CancellationOptions): void {
  if (options.abortSignal?.aborted || options.checkCancellation?.()) {
    throw new DOMException('Translation cancelled', 'AbortError');
  }
}

function recordLoadingError(error: unknown): Error {
  const message = error instanceof Error ? error.message : String(error);
  return new Error(`DatoCMS error: Could not load records: ${message}`, {
    cause: error,
  });
}

async function loadRecordIdPage(
  client: ReturnType<typeof buildClient>,
  modelId: string,
  offset: number,
  limit: number,
  options: CancellationOptions,
) {
  throwIfCancelled(options);
  try {
    const response = await client.items.rawList({
      filter: { type: modelId },
      version: 'current',
      order_by: 'id_ASC',
      page: { offset, limit },
    });
    throwIfCancelled(options);
    return response;
  } catch (error) {
    throwIfCancelled(options);
    throw recordLoadingError(error);
  }
}

async function loadModelCounts(
  client: ReturnType<typeof buildClient>,
  modelIds: string[],
  options: RecordDiscoveryOptions,
) {
  const modelTotals = new Map<string, number>();
  for (const modelId of modelIds) {
    throwIfCancelled(options);
    options.onProgress?.({ loaded: 0, modelId });
    // biome-ignore lint/performance/noAwaitInLoops: Sequential counts avoid a burst of CMA traffic.
    const response = await loadRecordIdPage(client, modelId, 0, 1, options);
    modelTotals.set(modelId, response.meta.total_count);
  }
  return modelTotals;
}

function discoveryTotal(
  modelTotals: Map<string, number>,
  modelCount: number,
  loaded: number,
): number | undefined {
  if (modelTotals.size !== modelCount) return undefined;
  return Math.max(
    loaded,
    [...modelTotals.values()].reduce((sum, count) => sum + count, 0),
  );
}

/**
 * Collect record IDs for confirmation with non-nested, large CMA pages.
 * CMA has no field projection for records, so discard their content immediately.
 * The selection is kept in memory for this run; no checkpoint is persisted.
 */
export async function collectRecordIds(
  client: ReturnType<typeof buildClient>,
  modelIds: string[],
  options: RecordDiscoveryOptions = {},
): Promise<string[]> {
  const uniqueModelIds = [...new Set(modelIds)];
  const recordIds = new Set<string>();
  // For multiple models, obtain the complete denominator before draining any
  // large listing. A single model gets its count in the first real page.
  const modelTotals =
    uniqueModelIds.length > 1
      ? await loadModelCounts(client, uniqueModelIds, options)
      : new Map<string, number>();

  for (const modelId of uniqueModelIds) {
    throwIfCancelled(options);
    let offset = 0;
    options.onProgress?.({
      loaded: recordIds.size,
      total: discoveryTotal(modelTotals, uniqueModelIds.length, recordIds.size),
      modelId,
    });
    if (modelTotals.get(modelId) === 0) continue;

    while (true) {
      throwIfCancelled(options);
      // biome-ignore lint/performance/noAwaitInLoops: Sequential pages limit CMA traffic and expose cancellable progress.
      const response = await loadRecordIdPage(
        client,
        modelId,
        offset,
        RECORD_ID_PAGE_SIZE,
        options,
      );

      for (const record of response.data) recordIds.add(record.id);
      const modelTotal = response.meta.total_count;
      modelTotals.set(modelId, modelTotal);
      options.onProgress?.({
        loaded: recordIds.size,
        total: discoveryTotal(
          modelTotals,
          uniqueModelIds.length,
          recordIds.size,
        ),
        modelId,
      });

      offset += RECORD_ID_PAGE_SIZE;
      if (response.data.length === 0 || offset >= modelTotal) {
        break;
      }
    }
  }

  return [...recordIds];
}

/**
 * Fetch a bounded set of current nested records only when the consumer needs it.
 * Limiting the ID filter avoids oversized URLs, and awaiting consumption before
 * the next request keeps record content in memory to one batch at a time.
 */
export async function* loadRecordBatches(
  client: ReturnType<typeof buildClient>,
  itemIds: string[],
  options: CancellationOptions & {
    onProgress?: (progress: RecordLoadingProgress) => void;
  } = {},
): AsyncGenerator<RecordBatch> {
  const uniqueItemIds = [...new Set(itemIds)];
  let loaded = 0;
  options.onProgress?.({ loaded, total: uniqueItemIds.length });

  for (
    let offset = 0;
    offset < uniqueItemIds.length;
    offset += BULK_RECORD_BATCH_SIZE
  ) {
    throwIfCancelled(options);
    const requestedItemIds = uniqueItemIds.slice(
      offset,
      offset + BULK_RECORD_BATCH_SIZE,
    );
    let response: DatoCMSRecordFromAPI[];
    try {
      // biome-ignore lint/performance/noAwaitInLoops: Each nested batch is consumed before loading more content.
      response = await client.items.list({
        filter: { ids: requestedItemIds.join(',') },
        nested: true,
        version: 'current',
        page: { offset: 0, limit: BULK_RECORD_BATCH_SIZE },
      });
    } catch (error) {
      throwIfCancelled(options);
      throw recordLoadingError(error);
    }
    throwIfCancelled(options);

    const recordsById = new Map(response.map((record) => [record.id, record]));
    const records: DatoCMSRecordFromAPI[] = [];
    const missingItemIds: string[] = [];
    for (const id of requestedItemIds) {
      const record = recordsById.get(id);
      if (record) records.push(record);
      else missingItemIds.push(id);
    }
    loaded += records.length;
    options.onProgress?.({ loaded, total: uniqueItemIds.length });
    yield { records, requestedItemIds, missingItemIds };
  }
}
