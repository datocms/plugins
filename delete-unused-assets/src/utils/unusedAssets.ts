import type { Client, RawApiTypes } from '@datocms/cma-client-browser';

// Upload pages allow 500 entries; bulk deletes allow 200 uploads.
export const ASSET_PAGE_SIZE = 500;
export const DELETE_BATCH_SIZE = 100;

export type UnusedAsset = {
  id: string;
  filename: string;
  url: string;
  size: number;
};
export type DiscoveryProgress = { found: number; total: number };
export type DeletionProgress = {
  total: number;
  processed: number;
  deleted: number;
  /** In use again, or already removed, when the batch was re-checked. */
  skipped: number;
  failed: number;
  freedBytes: number;
};
export type DeletionResult = DeletionProgress & {
  cancelled: boolean;
  /** True when a partially failed job doesn't say which assets it removed. */
  freedBytesEstimated: boolean;
  error?: string;
};

const unusedFilter = { fields: { in_use: { eq: false } } };

function toAsset(upload: RawApiTypes.Upload): UnusedAsset {
  return {
    id: upload.id,
    filename: upload.attributes.filename,
    url: upload.attributes.url,
    size: upload.attributes.size,
  };
}

export async function discoverUnusedAssets(
  client: Client,
  options: {
    signal?: AbortSignal;
    onProgress?: (progress: DiscoveryProgress) => void;
  } = {},
): Promise<UnusedAsset[]> {
  // Keyed by ID: usage changes during the scan can shift a page boundary.
  const assets = new Map<string, UnusedAsset>();
  let total = 0;
  let offset = 0;
  do {
    if (options.signal?.aborted) throw new Error('Asset discovery cancelled.');
    // biome-ignore lint/performance/noAwaitInLoops: Each page needs the previous one's total.
    const page = await client.uploads.rawList({
      filter: unusedFilter,
      order_by: 'id_ASC',
      page: { offset, limit: ASSET_PAGE_SIZE },
    });
    total = page.meta.total_count;
    for (const upload of page.data) assets.set(upload.id, toAsset(upload));
    options.onProgress?.({ found: assets.size, total });
    offset += ASSET_PAGE_SIZE;
  } while (offset < total);
  return [...assets.values()];
}

async function deleteBatch(
  client: Client,
  batch: UnusedAsset[],
  result: DeletionResult,
) {
  // Re-check right before deleting: a record may have started using an asset
  // since the scan.
  const stillUnused = await client.uploads.rawList({
    filter: { ids: batch.map((asset) => asset.id).join(','), ...unusedFilter },
    page: { offset: 0, limit: DELETE_BATCH_SIZE },
  });
  const unusedIds = new Set(stillUnused.data.map((upload) => upload.id));
  const toDelete = batch.filter((asset) => unusedIds.has(asset.id));
  const skipped = batch.length - toDelete.length;
  if (toDelete.length === 0) {
    result.skipped += skipped;
    return;
  }

  const { meta } = await client.uploads.rawBulkDestroy({
    data: {
      type: 'upload_bulk_destroy_operation',
      relationships: {
        uploads: {
          data: toDelete.map((asset) => ({ type: 'upload', id: asset.id })),
        },
      },
    },
  });
  const deleted = Math.min(meta.successful, toDelete.length);
  const bytes = toDelete.reduce((sum, asset) => sum + asset.size, 0);
  result.skipped += skipped;
  result.deleted += deleted;
  result.failed += toDelete.length - deleted;
  if (deleted === toDelete.length) {
    result.freedBytes += bytes;
  } else {
    result.freedBytes += Math.round((bytes * deleted) / toDelete.length);
    result.freedBytesEstimated = true;
  }
}

export async function deleteUnusedAssets(
  client: Client,
  assets: UnusedAsset[],
  options: {
    signal?: AbortSignal;
    onProgress?: (progress: DeletionProgress) => void;
  } = {},
): Promise<DeletionResult> {
  const result: DeletionResult = {
    total: assets.length,
    processed: 0,
    deleted: 0,
    skipped: 0,
    failed: 0,
    freedBytes: 0,
    freedBytesEstimated: false,
    cancelled: false,
  };
  options.onProgress?.({ ...result });
  for (let offset = 0; offset < assets.length; offset += DELETE_BATCH_SIZE) {
    if (options.signal?.aborted) break;
    const batch = assets.slice(offset, offset + DELETE_BATCH_SIZE);
    try {
      // biome-ignore lint/performance/noAwaitInLoops: One deletion job at a time.
      await deleteBatch(client, batch, result);
    } catch {
      result.error =
        'Deletion stopped because of an API error. No further assets were deleted.';
      break;
    }
    result.processed += batch.length;
    options.onProgress?.({ ...result });
  }
  result.cancelled =
    !result.error &&
    result.processed < result.total &&
    !!options.signal?.aborted;
  return result;
}
