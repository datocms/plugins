import type { SimpleSchemaTypes } from '@datocms/cma-client-browser';

// Upload pages allow 500 entries. Keep writes below the server's 200-upload limit.
export const ASSET_PAGE_SIZE = 500;
export const DELETE_BATCH_SIZE = 100;
const MAX_BATCH_ATTEMPTS = 3;
const MAX_SCAN_ATTEMPTS = 3;

export class AssetOperationError extends Error {}
export class AssetOperationRejectedError extends AssetOperationError {}
class AssetLibraryChangedError extends AssetOperationError {}

export type UnusedAsset = { id: string; filename: string; url: string };
export type DiscoveryProgress = {
  scanned: number;
  found: number;
  total: number;
  attempt?: number;
};
type DiscoveryOptions = {
  signal?: AbortSignal;
  onProgress?: (progress: DiscoveryProgress) => void;
};
export type DeletionProgress = {
  total: number;
  processed: number;
  deleted: number;
  skipped: number;
  missing: number;
  failed: number;
};
export type DeletionResult = DeletionProgress & {
  cancelled: boolean;
  uncertain: number;
  error?: string;
};
export type AssetPage = { assets: UnusedAsset[]; total: number };
export type AssetApi = {
  list: (
    query: SimpleSchemaTypes.UploadInstancesHrefSchema,
    signal?: AbortSignal,
  ) => Promise<AssetPage>;
  destroy: (ids: string[]) => Promise<{ successful: number; failed: number }>;
};

const unusedFilter = { in_use: { eq: false } };

function checkCancellation(signal?: AbortSignal) {
  if (signal?.aborted) {
    throw new AssetOperationError('Asset discovery cancelled.');
  }
}

function validatePage(page: AssetPage, limit: number) {
  if (
    !Number.isSafeInteger(page.total) ||
    page.total < 0 ||
    page.assets.length > limit ||
    page.assets.some((asset) => !asset.id)
  ) {
    throw new AssetOperationError(
      'The API returned an invalid asset page. No further assets were deleted.',
    );
  }
}

function rememberPage(
  page: AssetPage,
  total: number,
  offset: number,
  seen: Set<string>,
) {
  validatePage(page, ASSET_PAGE_SIZE);
  if (
    page.total !== total ||
    page.assets.length !== Math.min(ASSET_PAGE_SIZE, total - offset)
  ) {
    throw new AssetLibraryChangedError(
      'The asset library changed during discovery. No assets were deleted.',
    );
  }
  for (const asset of page.assets) {
    if (seen.has(asset.id)) {
      throw new AssetLibraryChangedError(
        'The asset library changed during discovery. No assets were deleted.',
      );
    }
    seen.add(asset.id);
  }
}

async function classifyPage(
  client: AssetApi,
  page: AssetPage,
  offset: number,
  assets: UnusedAsset[],
  options: DiscoveryOptions,
) {
  // Paginate the full library: changes in record usage cannot shift offsets.
  // ID filters stay small enough for GET URLs, even with UUID asset IDs.
  for (let start = 0; start < page.assets.length; start += DELETE_BATCH_SIZE) {
    checkCancellation(options.signal);
    const group = page.assets.slice(start, start + DELETE_BATCH_SIZE);
    // biome-ignore lint/performance/noAwaitInLoops: Bound API concurrency and only retain one page.
    const unused = await listBatch(
      client,
      group.map((asset) => asset.id),
      true,
      options.signal,
    );
    checkCancellation(options.signal);
    for (const asset of group) {
      if (unused.has(asset.id))
        assets.push({ id: asset.id, filename: asset.filename, url: asset.url });
    }
    options.onProgress?.({
      scanned: offset + start + group.length,
      found: assets.length,
      total: page.total,
    });
  }
}

async function scanUnusedAssets(
  client: AssetApi,
  options: DiscoveryOptions = {},
): Promise<UnusedAsset[]> {
  const assets: UnusedAsset[] = [];
  const seen = new Set<string>();
  let total: number | undefined;
  // No deletion starts until discovery completes and the user confirms IDs.
  for (
    let offset = 0;
    total === undefined || offset < total;
    offset += ASSET_PAGE_SIZE
  ) {
    checkCancellation(options.signal);
    // biome-ignore lint/performance/noAwaitInLoops: Sequential pages prevent an unbounded request queue.
    const page = await client.list(
      { order_by: 'id_ASC', page: { offset, limit: ASSET_PAGE_SIZE } },
      options.signal,
    );
    checkCancellation(options.signal);
    total ??= page.total;
    rememberPage(page, total, offset, seen);
    await classifyPage(client, page, offset, assets, options);
  }
  if (total === 0) options.onProgress?.({ scanned: 0, found: 0, total: 0 });
  return assets;
}

export async function discoverUnusedAssets(
  client: AssetApi,
  options: DiscoveryOptions = {},
): Promise<UnusedAsset[]> {
  for (let attempt = 1; attempt <= MAX_SCAN_ATTEMPTS; attempt++) {
    checkCancellation(options.signal);
    try {
      // biome-ignore lint/performance/noAwaitInLoops: Automatically retry only a proven changing asset library.
      return await scanUnusedAssets(client, {
        ...options,
        onProgress: (progress) =>
          options.onProgress?.(
            attempt === 1 ? progress : { ...progress, attempt },
          ),
      });
    } catch (error) {
      if (
        !(error instanceof AssetLibraryChangedError) ||
        attempt === MAX_SCAN_ATTEMPTS
      )
        throw error;
    }
  }
  throw new AssetOperationError(
    'The asset library kept changing during discovery. No assets were deleted.',
  );
}

async function listBatch(
  client: AssetApi,
  ids: string[],
  unusedOnly: boolean,
  signal?: AbortSignal,
): Promise<Set<string>> {
  if (!ids.length) return new Set<string>();
  const page = await client.list(
    {
      filter: {
        ids: ids.join(','),
        ...(unusedOnly ? { fields: unusedFilter } : {}),
      },
      page: { offset: 0, limit: DELETE_BATCH_SIZE },
    },
    signal,
  );
  validatePage(page, DELETE_BATCH_SIZE);
  const selected = new Set(ids);
  const found = new Set(page.assets.map((asset) => asset.id));
  if (
    found.size !== page.assets.length ||
    page.total !== found.size ||
    [...found].some((id) => !selected.has(id))
  ) {
    throw new AssetOperationError(
      'The API returned an incomplete or unexpected asset selection. No further assets were deleted.',
    );
  }
  return found;
}

async function revalidateBatch(
  client: AssetApi,
  ids: string[],
  result: DeletionResult,
  signal?: AbortSignal,
) {
  const unused = await listBatch(client, ids, true, signal);
  const excluded = ids.filter((id) => !unused.has(id));
  const existing = await listBatch(client, excluded, false, signal);
  for (const id of excluded) {
    if (existing.has(id)) result.skipped++;
    else result.missing++;
  }
  return [...unused];
}

function errorMessage(error: unknown) {
  return error instanceof AssetOperationError
    ? error.message
    : 'The asset operation failed. No further assets were deleted.';
}

type DeleteOutcome = { successful: number; failed: number };

function validateOutcome(outcome: DeleteOutcome, count: number) {
  if (
    !Number.isSafeInteger(outcome.successful) ||
    !Number.isSafeInteger(outcome.failed) ||
    outcome.successful < 0 ||
    outcome.failed < 0 ||
    outcome.successful + outcome.failed > count
  ) {
    throw new AssetOperationError(
      'The API returned an invalid deletion result.',
    );
  }
}

async function reconcileUnknownMutation(
  client: AssetApi,
  pending: string[],
  result: DeletionResult,
  error: unknown,
) {
  if (error instanceof AssetOperationRejectedError) {
    result.error = error.message;
    result.failed += pending.length;
    return;
  }
  // An accepted job may still be running: reconcile, never replay this POST.
  result.error = errorMessage(error);
  try {
    const remaining = await listBatch(client, pending, false);
    result.missing += pending.length - remaining.size;
    result.uncertain += remaining.size;
  } catch {
    result.uncertain += pending.length;
  }
}

async function reconcileCompletedMutation(
  client: AssetApi,
  pending: string[],
  result: DeletionResult,
  outcome: DeleteOutcome,
) {
  let remaining: Set<string>;
  try {
    remaining = await listBatch(client, pending, false);
  } catch (error) {
    // The job counters are authoritative; stop without replaying unknown IDs.
    result.deleted += outcome.successful;
    result.failed += outcome.failed;
    result.uncertain += pending.length - outcome.successful - outcome.failed;
    result.error = errorMessage(error);
    return [];
  }
  const absent = pending.length - remaining.size;
  result.deleted += outcome.successful;
  if (absent < outcome.successful) {
    result.error =
      'The API returned inconsistent deletion counts. No further assets were deleted.';
    result.uncertain += pending.length - outcome.successful;
    return [];
  }
  result.missing += absent - outcome.successful;
  return [...remaining];
}

async function deleteBatch(
  client: AssetApi,
  ids: string[],
  result: DeletionResult,
  signal?: AbortSignal,
) {
  let pending = ids;
  for (
    let attempt = 0;
    attempt < MAX_BATCH_ATTEMPTS && pending.length;
    attempt++
  ) {
    if (signal?.aborted) return;
    // biome-ignore lint/performance/noAwaitInLoops: Recheck only the IDs from the preceding completed attempt.
    pending = await revalidateBatch(client, pending, result, signal);
    if (!pending.length || signal?.aborted) return;

    let outcome: DeleteOutcome;
    try {
      outcome = await client.destroy(pending);
      validateOutcome(outcome, pending.length);
    } catch (error) {
      await reconcileUnknownMutation(client, pending, result, error);
      return;
    }

    // Finish accounting for the current job even after Stop or unmount. Only
    // confirmed, completed partial jobs are eligible for an automatic retry.
    pending = await reconcileCompletedMutation(
      client,
      pending,
      result,
      outcome,
    );
    if (result.error) return;
    if (attempt === MAX_BATCH_ATTEMPTS - 1) result.failed += pending.length;
  }
}

export async function deleteUnusedAssets(
  client: AssetApi,
  assets: UnusedAsset[],
  options: {
    signal?: AbortSignal;
    onProgress?: (progress: DeletionProgress) => void;
  } = {},
): Promise<DeletionResult> {
  const ids = [...new Set(assets.map((asset) => asset.id))];
  const result: DeletionResult = {
    total: ids.length,
    processed: 0,
    deleted: 0,
    skipped: 0,
    missing: 0,
    failed: 0,
    uncertain: 0,
    cancelled: false,
  };
  options.onProgress?.({ ...result });
  for (let offset = 0; offset < ids.length; offset += DELETE_BATCH_SIZE) {
    if (options.signal?.aborted || result.error) break;
    try {
      // biome-ignore lint/performance/noAwaitInLoops: At most one destructive job may be in flight.
      await deleteBatch(
        client,
        ids.slice(offset, offset + DELETE_BATCH_SIZE),
        result,
        options.signal,
      );
    } catch (error) {
      if (!options.signal?.aborted) result.error = errorMessage(error);
    }
    result.processed =
      result.deleted + result.skipped + result.missing + result.failed;
    options.onProgress?.({ ...result });
  }
  result.cancelled = options.signal?.aborted ?? false;
  return result;
}
