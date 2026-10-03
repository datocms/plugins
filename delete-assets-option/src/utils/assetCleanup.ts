import {
  createUploadCollector,
  type UploadFieldDescriptor,
} from './collectUploadIds';

// Keep URLs short, nested responses bounded (the nested API limit is 30),
// and bulk operations below the server's 200-upload limit.
export const ID_BATCH_SIZE = 100;
export const NESTED_PAGE_SIZE = 30;
const WORKERS = 4;
const NO_DELETION_PROGRESS_TIMEOUT = 30 * 60 * 1000;

export type CleanupProgress = {
  phase: 'collecting' | 'waiting' | 'deleting';
  completed: number;
  total: number;
  assets: number;
};

export type CleanupOptions = {
  signal?: AbortSignal;
  onProgress?: (progress: CleanupProgress) => void;
  wait?: (milliseconds: number) => Promise<void>;
  now?: () => number;
  deletionTimeout?: number;
};

export type CleanupResult = {
  deleted: number;
  kept: number;
  unavailable: number;
  unconfirmed: number;
  cancelled: boolean;
};

type ListQuery = {
  filter: { ids: string };
  nested?: true;
  version?: string;
  page: { limit: number; offset?: number };
};
type ResourcePage = { data: { id: string }[]; meta: { total_count: number } };
type DestroyRequest = {
  data: {
    type: 'upload_bulk_destroy_operation';
    relationships: { uploads: { data: { type: 'upload'; id: string }[] } };
  };
};

// Keep the workflow's API surface small; records are inspected as unknown raw
// payloads by the schema-aware collector, rather than retained or copied.
export type CleanupClient = {
  items: { rawList: (query: ListQuery) => Promise<ResourcePage> };
  fields: {
    list: (modelId: string) => Promise<readonly UploadFieldDescriptor[]>;
  };
  uploads: {
    rawList: (query: ListQuery) => Promise<ResourcePage>;
    rawBulkDestroy: (body: DestroyRequest) => Promise<{
      meta: { successful: number; failed: number };
    }>;
  };
};

function checkCancelled(options: CleanupOptions) {
  options.signal?.throwIfAborted();
}

function wait(milliseconds: number) {
  return new Promise<void>((resolve) => setTimeout(resolve, milliseconds));
}

function batches(ids: readonly string[]) {
  return Array.from({ length: Math.ceil(ids.length / ID_BATCH_SIZE) }, (_, i) =>
    ids.slice(i * ID_BATCH_SIZE, (i + 1) * ID_BATCH_SIZE),
  );
}

async function inParallel<T>(
  values: readonly T[],
  visit: (value: T) => Promise<void>,
  options: CleanupOptions,
) {
  let index = 0;
  let failure: unknown;
  let failed = false;
  const worker = async () => {
    while (!failed && index < values.length) {
      checkCancelled(options);
      const value = values[index++];
      try {
        // biome-ignore lint/performance/noAwaitInLoops: each of four workers drains one bounded queue.
        await visit(value);
      } catch (error) {
        failed = true;
        failure = error;
      }
    }
  };
  // Drain outstanding reads before handing deletion back to the dashboard.
  const workers = await Promise.allSettled(
    Array.from({ length: Math.min(WORKERS, values.length) }, worker),
  );
  if (failed) throw failure;
  const rejected = workers.find((result) => result.status === 'rejected');
  if (rejected?.status === 'rejected') throw rejected.reason;
}

export async function collectAssets(
  client: CleanupClient,
  recordIds: readonly string[],
  options: CleanupOptions = {},
): Promise<string[]> {
  const uniqueRecordIds = [...new Set(recordIds)];
  const uploadIds = new Set<string>();
  let completed = 0;
  const reportCollection = () =>
    options.onProgress?.({
      phase: 'collecting',
      completed,
      total: uniqueRecordIds.length,
      assets: uploadIds.size,
    });
  const collect = createUploadCollector(
    (modelId) => client.fields.list(modelId),
    {
      signal: options.signal,
      onUploadId: (id) => {
        const previous = uploadIds.size;
        uploadIds.add(id);
        // Publish bounded updates even inside a record with hundreds of blocks.
        if (uploadIds.size !== previous && uploadIds.size % 100 === 0)
          reportCollection();
      },
    },
  );
  await inParallel(
    batches(uniqueRecordIds),
    async (ids) => {
      // A draft can have replaced an image still present in the published version.
      for (const version of ['current', 'published']) {
        // biome-ignore lint/performance/noAwaitInLoops: keep at most four nested pages in memory.
        await collectVersion(client, ids, version, collect, uploadIds, options);
      }
      completed += ids.length;
      reportCollection();
    },
    options,
  );
  return [...uploadIds];
}

function validateRecordPage(
  page: { data: readonly { id: string }[]; meta: { total_count: number } },
  expected: number,
  previous: number | undefined,
  version: string,
  offset: number,
) {
  const total = page.meta.total_count;
  if (previous !== undefined && previous !== total) {
    throw new Error('Records changed while collecting their assets.');
  }
  if (
    !Number.isInteger(total) ||
    total < 0 ||
    total > expected ||
    page.data.length > NESTED_PAGE_SIZE ||
    offset + page.data.length > total
  ) {
    throw new Error('The API returned an invalid record page.');
  }
  if (version === 'current' && total !== expected) {
    throw new Error('Some selected records could not be read.');
  }
  if (page.data.length === 0 && offset < total) {
    throw new Error('The API returned an incomplete record page.');
  }
  return total;
}

async function collectVersion(
  client: CleanupClient,
  ids: readonly string[],
  version: string,
  collect: (record: unknown) => Promise<string[]>,
  uploadIds: Set<string>,
  options: CleanupOptions,
) {
  let offset = 0;
  let total: number | undefined;
  const seen = new Set<string>();
  const selected = new Set(ids);
  do {
    checkCancelled(options);
    // biome-ignore lint/performance/noAwaitInLoops: each page depends on the previous page's count and offset.
    const page = await client.items.rawList({
      filter: { ids: ids.join(',') },
      nested: true,
      version,
      page: { limit: NESTED_PAGE_SIZE, offset },
    });
    total = validateRecordPage(page, ids.length, total, version, offset);
    for (const record of page.data) {
      checkCancelled(options);
      if (!selected.has(record.id) || seen.has(record.id)) {
        throw new Error('The API returned an unexpected or repeated record.');
      }
      seen.add(record.id);
      for (const id of await collect(record)) uploadIds.add(id);
    }
    offset += page.data.length;
  } while (offset < total);
}

export async function waitForRecordDeletion(
  client: CleanupClient,
  recordIds: readonly string[],
  options: CleanupOptions = {},
) {
  const now = options.now ?? Date.now;
  let lastProgress = now();
  let previousRemaining = recordIds.length;
  let pending: (readonly string[])[] = batches(recordIds);
  const groupCounts = new Map(pending.map((ids) => [ids[0], ids.length]));
  let interval = 1000;
  while (pending.length > 0) {
    checkCancelled(options);
    let remaining = previousRemaining;
    const nextPending: (readonly string[])[] = [];
    // biome-ignore lint/performance/noAwaitInLoops: polling must wait for a complete bounded pass.
    await inParallel(
      pending,
      async (ids) => {
        const page = await client.items.rawList({
          filter: { ids: ids.join(',') },
          page: { limit: 0 },
        });
        if (
          !Number.isInteger(page.meta.total_count) ||
          page.meta.total_count < 0 ||
          page.meta.total_count > ids.length
        ) {
          throw new Error('The API returned an invalid record count.');
        }
        remaining +=
          page.meta.total_count - (groupCounts.get(ids[0]) ?? ids.length);
        groupCounts.set(ids[0], page.meta.total_count);
        options.onProgress?.({
          phase: 'waiting',
          completed: recordIds.length - remaining,
          total: recordIds.length,
          assets: 0,
        });
        if (page.meta.total_count > 0) nextPending.push(ids);
      },
      options,
    );
    options.onProgress?.({
      phase: 'waiting',
      completed: recordIds.length - remaining,
      total: recordIds.length,
      assets: 0,
    });
    if (remaining === 0) return;
    if (remaining < previousRemaining) lastProgress = now();
    if (
      now() - lastProgress >=
      (options.deletionTimeout ?? NO_DELETION_PROGRESS_TIMEOUT)
    ) {
      throw new Error(
        'Record deletion stopped making progress. Assets were kept.',
      );
    }
    previousRemaining = remaining;
    pending = nextPending;
    await (options.wait ?? wait)(interval);
    interval = Math.min(interval * 2, 15000);
  }
}

async function visibleUploads(client: CleanupClient, ids: readonly string[]) {
  const page = await client.uploads.rawList({
    filter: { ids: ids.join(',') },
    page: { limit: ID_BATCH_SIZE },
  });
  if (
    page.data.length !== page.meta.total_count ||
    page.data.length > ids.length
  ) {
    throw new Error('The API returned an incomplete asset page.');
  }
  const requested = new Set(ids);
  if (
    page.data.some((upload) => !requested.has(upload.id)) ||
    new Set(page.data.map((upload) => upload.id)).size !== page.data.length
  ) {
    throw new Error('The API returned an unexpected asset.');
  }
  return page.data.map((upload) => upload.id);
}

export async function deleteCollectedAssets(
  client: CleanupClient,
  uploadIds: readonly string[],
  options: CleanupOptions = {},
): Promise<CleanupResult> {
  const result: CleanupResult = {
    deleted: 0,
    kept: 0,
    unavailable: 0,
    unconfirmed: 0,
    cancelled: false,
  };
  const uniqueIds = [...new Set(uploadIds)];
  let completed = 0;
  // Mutations stay sequential, including job completion and reconciliation.
  for (const ids of batches(uniqueIds)) {
    if (options.signal?.aborted) {
      result.cancelled = true;
      result.unconfirmed += uniqueIds.length - completed;
      break;
    }
    let availableCount = ids.length;
    try {
      // biome-ignore lint/performance/noAwaitInLoops: reconcile each mutation before submitting the next batch.
      const existing = await visibleUploads(client, ids);
      availableCount = existing.length;
      result.unavailable += ids.length - existing.length;
      checkCancelled(options);
      if (existing.length > 0) {
        const receipt = await client.uploads.rawBulkDestroy({
          data: {
            type: 'upload_bulk_destroy_operation',
            relationships: {
              uploads: { data: existing.map((id) => ({ type: 'upload', id })) },
            },
          },
        });
        if (
          !Number.isInteger(receipt.meta.successful) ||
          receipt.meta.successful < 0 ||
          receipt.meta.successful > existing.length
        ) {
          throw new Error('The API returned an invalid deletion receipt.');
        }
        // The server atomically protects shared/current/published references.
        // The simplified bulkDestroy() response discards partial-failure counts.
        const remaining = await visibleUploads(client, existing);
        const confirmed = Math.min(
          receipt.meta.successful,
          existing.length - remaining.length,
        );
        result.deleted += confirmed;
        result.kept += remaining.length;
        result.unconfirmed += existing.length - remaining.length - confirmed;
      }
    } catch {
      // Never repeat an ambiguous mutation: its asynchronous job may still run.
      // Count this entire batch as unconfirmed instead of claiming success.
      result.unconfirmed += availableCount;
      if (options.signal?.aborted) result.cancelled = true;
    }
    completed += ids.length;
    options.onProgress?.({
      phase: 'deleting',
      completed,
      total: uniqueIds.length,
      assets: result.deleted,
    });
  }
  result.cancelled ||= options.signal?.aborted ?? false;
  return result;
}
