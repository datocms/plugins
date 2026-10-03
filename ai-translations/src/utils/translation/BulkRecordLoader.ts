import type { buildClient } from '@datocms/cma-client-browser';
import type { DatoCMSRecordFromAPI } from './ItemsDropdownUtils';

/** Nested CMA responses support at most 30 records per page. */
export const BULK_RECORD_BATCH_SIZE = 30;
const RECORD_ID_PAGE_SIZE = 500;
const DISCOVERY_RESPONSE_BUDGET = 4 * 1024 * 1024;
const MAX_DISCOVERY_PASSES = 3;

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

function validateRecordCount(count: number): number {
  if (!Number.isSafeInteger(count) || count < 0) {
    throw recordLoadingError(
      new Error('Invalid record count returned by DatoCMS.'),
    );
  }
  return count;
}

async function loadRecordIdPage(
  client: ReturnType<typeof buildClient>,
  modelId: string,
  offset: number,
  limit: number,
  createdBefore: string,
  options: CancellationOptions,
) {
  throwIfCancelled(options);
  try {
    const response = await client.items.rawList({
      filter: {
        type: modelId,
        fields: { _created_at: { lte: createdBefore } },
      },
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
  createdBefore: string,
  options: RecordDiscoveryOptions,
) {
  const modelTotals = new Map<string, number>();
  for (const modelId of modelIds) {
    throwIfCancelled(options);
    options.onProgress?.({ loaded: 0, modelId });
    // biome-ignore lint/performance/noAwaitInLoops: Sequential counts avoid a burst of CMA traffic.
    const response = await loadRecordIdPage(
      client,
      modelId,
      0,
      1,
      createdBefore,
      options,
    );
    modelTotals.set(modelId, validateRecordCount(response.meta.total_count));
  }
  return modelTotals;
}

type ModelDiscoveryOptions = RecordDiscoveryOptions & {
  expectedTotal?: number;
  onModelProgress: (total: number, loaded: number) => void;
};

function discoveryPageSize(records: Array<{ id: string }>): number {
  // CMA does not project fields. Start small and adapt to the actual regular
  // response rather than requesting 500 content-heavy records immediately.
  // Two bytes per UTF-16 code unit conservatively estimates string storage.
  const serializedSize = JSON.stringify(records).length * 2;
  const recordSize = Math.max(1, serializedSize / records.length);
  return Math.max(
    1,
    Math.min(
      RECORD_ID_PAGE_SIZE,
      Math.floor(DISCOVERY_RESPONSE_BUDGET / recordSize),
    ),
  );
}

async function scanModelRecordIds(
  client: ReturnType<typeof buildClient>,
  modelId: string,
  createdBefore: string,
  options: ModelDiscoveryOptions,
) {
  const recordIds = new Set<string>();
  let offset = 0;
  let expectedTotal = options.expectedTotal;
  let changed = false;
  let pageSize = BULK_RECORD_BATCH_SIZE;
  while (true) {
    // biome-ignore lint/performance/noAwaitInLoops: Sequential pages keep only one response of content in flight.
    const response = await loadRecordIdPage(
      client,
      modelId,
      offset,
      pageSize,
      createdBefore,
      options,
    );
    const total = validateRecordCount(response.meta.total_count);
    if (expectedTotal !== undefined && expectedTotal !== total) changed = true;
    expectedTotal = total;
    const previousSize = recordIds.size;
    for (const record of response.data) recordIds.add(record.id);
    if (recordIds.size - previousSize !== response.data.length) changed = true;
    options.onModelProgress(total, recordIds.size);
    offset += response.data.length;
    if (response.data.length === 0 || offset >= total) {
      return { recordIds, total, stable: !changed && recordIds.size === total };
    }
    pageSize = discoveryPageSize(response.data);
  }
}

async function loadStableModelRecordIds(
  client: ReturnType<typeof buildClient>,
  modelId: string,
  createdBefore: string,
  options: ModelDiscoveryOptions,
): Promise<Set<string>> {
  let expectedTotal = options.expectedTotal;
  for (let pass = 0; pass < MAX_DISCOVERY_PASSES; pass++) {
    // biome-ignore lint/performance/noAwaitInLoops: Automatically restart an unstable offset scan without parallel listings.
    const result = await scanModelRecordIds(client, modelId, createdBefore, {
      ...options,
      expectedTotal,
    });
    if (result.stable) return result.recordIds;
    expectedTotal = result.total;
  }
  throw recordLoadingError(
    new Error(
      `Record selection for model ${modelId} kept changing during discovery. No translation was started.`,
    ),
  );
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
  // Freeze additions at the start of discovery. The CMA only offers offset
  // pagination, so deletions still require a fresh, bounded reconciliation.
  const createdBefore = new Date().toISOString();
  // For multiple models, obtain the complete denominator before draining any
  // large listing. A single model gets its count in the first real page.
  const modelTotals =
    uniqueModelIds.length > 1
      ? await loadModelCounts(client, uniqueModelIds, createdBefore, options)
      : new Map<string, number>();

  for (const modelId of uniqueModelIds) {
    throwIfCancelled(options);
    options.onProgress?.({
      loaded: recordIds.size,
      total: discoveryTotal(modelTotals, uniqueModelIds.length, recordIds.size),
      modelId,
    });
    // biome-ignore lint/performance/noAwaitInLoops: Complete one model selection before requesting the next.
    const modelRecordIds = await loadStableModelRecordIds(
      client,
      modelId,
      createdBefore,
      {
        ...options,
        expectedTotal: modelTotals.get(modelId),
        onModelProgress: (modelTotal, modelLoaded) => {
          modelTotals.set(modelId, modelTotal);
          options.onProgress?.({
            loaded: recordIds.size + modelLoaded,
            total: discoveryTotal(
              modelTotals,
              uniqueModelIds.length,
              recordIds.size + modelLoaded,
            ),
            modelId,
          });
        },
      },
    );
    for (const id of modelRecordIds) recordIds.add(id);
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
