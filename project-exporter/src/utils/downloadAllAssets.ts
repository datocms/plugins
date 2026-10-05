import { buildClient, type Client } from '@datocms/cma-client-browser';
import JSZip from 'jszip';
import { downloadAssetFile } from './assetDownload';
import {
  ASSET_EXPORT_PROGRESS_START,
  ASSET_EXPORT_VERSION,
  ASSET_MANIFEST_FILENAME,
  ASSET_ZIP_ENTRY_PATTERN,
  ASSET_ZIP_FILENAME_TEMPLATE,
  type AssetExportFailure,
  type AssetForChunk,
  type AssetManifestEntry,
  buildAssetChunkZipFilename,
  buildAssetManifestEntry,
  buildAssetZipEntryName,
  calculateAssetExportProgress,
  createAssetChunks,
  getUploadFilename,
  MAX_ASSET_CHUNK_DATA_BYTES,
  MAX_FILES_PER_ZIP,
  MAX_ZIP_BYTES,
  persistLastAssetExportSnapshot,
  SIZE_SAFETY_FACTOR,
} from './assetExport';
import { downloadBlob, throwIfAborted, yieldToBrowser } from './exportRuntime';

type ExportAsset = AssetForChunk<AssetManifestEntry> & {
  metadataError?: string;
};
type ProgressHandler = (progress: number, msg: string) => void;

const ASSET_PAGE_SIZE = 500;

function listUploads(
  client: Client,
  limit: number,
  offset: number,
  ids?: string,
) {
  return client.uploads.list({
    ...(ids ? { filter: { ids } } : { order_by: '_created_at_ASC' }),
    page: { limit, offset },
  });
}

async function loadChunkMetadata(
  client: Client,
  assets: ExportAsset[],
  signal?: AbortSignal,
): Promise<ExportAsset[]> {
  try {
    const byId = new Map<
      string,
      Awaited<ReturnType<typeof client.uploads.list>>[number]
    >();
    const ids = assets.map((asset) => asset.sourceUploadId).join(',');
    let offset = 0;
    while (offset < assets.length) {
      throwIfAborted(signal);
      // biome-ignore lint/performance/noAwaitInLoops: Only the current ZIP's metadata is loaded.
      const uploads = await listUploads(
        client,
        assets.length - offset,
        offset,
        ids,
      );
      throwIfAborted(signal);
      if (!uploads.length) break;
      for (const upload of uploads) {
        if (byId.has(upload.id))
          throw new Error('Duplicate upload IDs while loading ZIP metadata');
        byId.set(upload.id, upload);
      }
      offset += uploads.length;
    }
    return assets.map((asset) => {
      const upload = byId.get(asset.sourceUploadId);
      return upload
        ? {
            ...asset,
            payload: buildAssetManifestEntry(
              upload,
              asset.payload.zipEntryName,
            ),
          }
        : {
            ...asset,
            metadataError: 'Asset disappeared while loading ZIP metadata',
          };
    });
  } catch (error) {
    throwIfAborted(signal);
    const message = error instanceof Error ? error.message : String(error);
    return assets.map((asset) => ({ ...asset, metadataError: message }));
  }
}

function generateAssetZip(
  zip: JSZip,
  onProgress: (percent: number) => void,
  signal?: AbortSignal,
): Promise<Blob> {
  throwIfAborted(signal);
  return new Promise((resolve, reject) => {
    const stream = zip.generateInternalStream({
      type: 'uint8array',
      compression: 'STORE',
      streamFiles: true,
    });
    const output: BlobPart[] = [];
    let bytes = 0;
    let settled = false;
    const fail = (error: unknown) => {
      if (settled) return;
      settled = true;
      stream.pause();
      output.length = 0;
      signal?.removeEventListener('abort', onAbort);
      reject(error);
    };
    const onAbort = () =>
      fail(new DOMException('Asset export cancelled', 'AbortError'));
    signal?.addEventListener('abort', onAbort, { once: true });
    stream.on('data', (data, metadata) => {
      if (settled) return;
      try {
        bytes += data.byteLength;
        if (bytes > MAX_ZIP_BYTES) {
          throw new Error('Generated archive exceeds the ZIP byte limit');
        }
        output.push(new Uint8Array(data));
        onProgress(metadata.percent);
      } catch (error) {
        fail(error);
      }
    });
    stream.on('error', fail);
    stream.on('end', () => {
      if (settled) return;
      try {
        const result = new Blob(output, { type: 'application/zip' });
        settled = true;
        signal?.removeEventListener('abort', onAbort);
        resolve(result);
        output.length = 0;
      } catch (error) {
        fail(error);
      }
    });
    stream.resume();
  });
}

function trackUnique(
  value: string,
  seen: Set<string>,
  duplicateMessage: string,
) {
  if (seen.has(value)) throw new Error(`${duplicateMessage} ${value}.`);
  seen.add(value);
}

async function scanAssets(
  client: Client,
  expectedAssets: number,
  onProgress?: ProgressHandler,
  signal?: AbortSignal,
): Promise<ExportAsset[]> {
  const assets: ExportAsset[] = [];
  const seenIds = new Set<string>();
  const seenEntryNames = new Set<string>();
  onProgress?.(0, 'Scanning assets...');
  // The SDK iterator eagerly schedules its later pages. Await each page here
  // so complete localized metadata is retained for at most one page and ZIP.
  let offset = 0;
  while (offset < expectedAssets) {
    throwIfAborted(signal);
    // biome-ignore lint/performance/noAwaitInLoops: Sequential pages bound localized metadata memory.
    const uploads = await listUploads(client, ASSET_PAGE_SIZE, offset);
    if (!uploads.length)
      throw new Error('Asset list ended before the expected total count');
    for (const upload of uploads) {
      throwIfAborted(signal);
      const filename = getUploadFilename(upload);
      const sourceUploadId = String(upload.id ?? 'unknown');
      trackUnique(
        sourceUploadId,
        seenIds,
        'Asset list changed while scanning: duplicate upload ID',
      );
      const zipEntryName = buildAssetZipEntryName(sourceUploadId, filename);
      trackUnique(zipEntryName, seenEntryNames, 'Duplicate ZIP entry name:');
      const manifestEntry = buildAssetManifestEntry(upload, zipEntryName);
      assets.push({
        sourceUploadId,
        originalFilename: filename,
        size: manifestEntry.size ?? 0,
        metadataBytes: new Blob([JSON.stringify(manifestEntry)]).size,
        payload: { ...manifestEntry, metadata: {} },
      });
      if (assets.length % 50 === 0) {
        onProgress?.(0, `Scanned ${assets.length} assets...`);
        // biome-ignore lint/performance/noAwaitInLoops: Yield keeps the scanning UI responsive.
        await yieldToBrowser();
      }
    }
    offset += uploads.length;
  }
  throwIfAborted(signal);
  const scannedCount = (
    await client.uploads.rawList({ page: { limit: 1, offset: 0 } })
  ).meta.total_count;
  if (scannedCount !== expectedAssets || assets.length !== expectedAssets) {
    throw new Error(
      `Asset list changed while scanning: expected ${expectedAssets} assets, scanned ${assets.length}, found ${scannedCount}.`,
    );
  }
  return assets;
}

async function writeIncompleteReport(
  timestamp: string,
  report: Record<string, unknown>,
): Promise<string> {
  const filename = `allAssets.failures.${timestamp}.json`;
  await downloadBlob(
    new Blob(
      [
        JSON.stringify(
          {
            manifestVersion: ASSET_EXPORT_VERSION,
            generatedAt: new Date().toISOString(),
            ...report,
          },
          null,
          2,
        ),
      ],
      { type: 'application/json' },
    ),
    filename,
  );
  return filename;
}

function assetFailure(asset: ExportAsset, error: unknown): AssetExportFailure {
  return {
    sourceUploadId: asset.sourceUploadId,
    originalFilename: asset.originalFilename,
    zipEntryName: asset.payload.zipEntryName,
    url: asset.payload.url,
    message: error instanceof Error ? error.message : String(error),
  };
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

async function downloadSingleAsset(
  asset: ExportAsset,
  remainingBytes: number,
  addedNames: Set<string>,
  signal?: AbortSignal,
): Promise<Blob> {
  const entry = asset.payload;
  if (asset.metadataError) throw new Error(asset.metadataError);
  if (asset.sourceUploadId === 'unknown' || !asset.sourceUploadId) {
    throw new Error('Asset does not have a source upload ID');
  }
  if (!entry.url) throw new Error('Asset does not have a downloadable URL');
  if (addedNames.has(entry.zipEntryName)) {
    throw new Error(`Duplicate ZIP entry name: ${entry.zipEntryName}`);
  }
  if (asset.size > remainingBytes) {
    throw new Error(
      `Asset exceeds this ZIP's remaining ${remainingBytes} byte budget (${asset.size} bytes in metadata)`,
    );
  }
  return downloadAssetFile(
    entry.url,
    remainingBytes,
    signal,
    undefined,
    entry.size ?? undefined,
  );
}

async function verifyFinalAssetCount(
  client: Client,
  expectedAssets: number,
  signal?: AbortSignal,
): Promise<string[]> {
  try {
    const finalCount = (
      await client.uploads.rawList({ page: { limit: 1, offset: 0 } })
    ).meta.total_count;
    throwIfAborted(signal);
    return finalCount === expectedAssets
      ? []
      : [
          `Asset library changed during export (${expectedAssets} assets before, ${finalCount} after)`,
        ];
  } catch (error) {
    throwIfAborted(signal);
    return [`Could not verify the final asset count: ${errorMessage(error)}`];
  }
}

async function exportChunk(
  assets: ExportAsset[],
  chunkInfo: {
    index: number;
    totalChunks: number;
    filename: string;
    estimatedBytes: number;
  },
  onProcessedAsset: (message: string) => void,
  onGeneratingZip: (percent: number) => void,
  signal?: AbortSignal,
): Promise<{
  successfulAssets: number;
  failures: AssetExportFailure[];
  delivered: boolean;
}> {
  const zip = new JSZip();
  const manifestEntries: AssetManifestEntry[] = [];
  const failures: AssetExportFailure[] = [];
  const addedNames = new Set<string>();
  let dataBytes = 0;

  // One download and one archive at a time: memory does not grow with the
  // total number of assets or ZIPs, and a retry cannot duplicate ZIP output.
  for (const asset of assets) {
    throwIfAborted(signal);
    try {
      const entry = asset.payload;
      const remainingBytes = MAX_ASSET_CHUNK_DATA_BYTES - dataBytes;

      // biome-ignore lint/performance/noAwaitInLoops: One active binary download keeps ZIP memory bounded.
      const file = await downloadSingleAsset(
        asset,
        remainingBytes,
        addedNames,
        signal,
      );
      zip.file(entry.zipEntryName, file);
      addedNames.add(entry.zipEntryName);
      dataBytes += file.size;
      manifestEntries.push({ ...entry, downloadedSize: file.size });
    } catch (error) {
      throwIfAborted(signal);
      failures.push(assetFailure(asset, error));
    }

    onProcessedAsset(
      `ZIP ${chunkInfo.index}/${chunkInfo.totalChunks}: processed ${manifestEntries.length + failures.length}/${assets.length} assets${failures.length ? ` (${failures.length} failed)` : ''}`,
    );
    // Keep cancellation and progress responsive between assets.
    await yieldToBrowser();
  }

  throwIfAborted(signal);
  const manifest = JSON.stringify(
    {
      manifestVersion: ASSET_EXPORT_VERSION,
      generatedAt: new Date().toISOString(),
      chunk: {
        ...chunkInfo,
        assetCount: manifestEntries.length,
        requestedAssetCount: assets.length,
        downloadedBytes: dataBytes,
      },
      conventions: {
        zipEntryName: ASSET_ZIP_ENTRY_PATTERN,
        zipFilename: ASSET_ZIP_FILENAME_TEMPLATE,
      },
      limits: {
        maxZipBytes: MAX_ZIP_BYTES,
        maxFilesPerZip: MAX_FILES_PER_ZIP,
        sizeSafetyFactor: SIZE_SAFETY_FACTOR,
        maxAssetChunkDataBytes: MAX_ASSET_CHUNK_DATA_BYTES,
      },
      assets: manifestEntries,
      ...(failures.length ? { failedAssets: failures } : {}),
    },
    null,
    2,
  );

  try {
    // Check the manifest before asking JSZip to allocate the complete result.
    if (dataBytes + new Blob([manifest]).size > MAX_ZIP_BYTES) {
      throw new Error('Asset metadata and files exceed the ZIP byte limit');
    }
    zip.file(ASSET_MANIFEST_FILENAME, manifest);
    const finishedZip = await generateAssetZip(zip, onGeneratingZip, signal);
    throwIfAborted(signal);
    if (finishedZip.size > MAX_ZIP_BYTES) {
      throw new Error('Generated archive exceeds the ZIP byte limit');
    }
    await downloadBlob(finishedZip, chunkInfo.filename);
    // The handoff already happened even if cancellation arrived while its
    // object URL was being released. Keep it in the incomplete report.
    return {
      successfulAssets: manifestEntries.length,
      failures,
      delivered: true,
    };
  } catch (error) {
    throwIfAborted(signal);
    // A ZIP that could not be delivered contributes no successful assets.
    const failedIds = new Set(
      failures.map((failure) => failure.sourceUploadId),
    );
    for (const asset of assets) {
      if (!failedIds.has(asset.sourceUploadId)) {
        failures.push(assetFailure(asset, error));
      }
    }
    return { successfulAssets: 0, failures, delivered: false };
  }
}

export default async function downloadAllAssets(
  apiToken: string,
  environment: string,
  baseUrl: string | undefined,
  onProgress?: ProgressHandler,
  signal?: AbortSignal,
) {
  throwIfAborted(signal);
  const client = buildClient({ apiToken, environment, baseUrl });
  const site = await client.site.find();
  const expectedAssets = (
    await client.uploads.rawList({ page: { limit: 1, offset: 0 } })
  ).meta.total_count;
  const assets = await scanAssets(client, expectedAssets, onProgress, signal);
  if (!assets.length) {
    onProgress?.(100, 'No assets found to export.');
    return;
  }

  const chunks = createAssetChunks(assets);
  const timestamp = new Date().toISOString().replace(/:/g, '-');
  const chunkFilenames: string[] = [];
  const failures: AssetExportFailure[] = [];
  let processedAssets = 0;
  let successfulAssets = 0;
  let issues: string[] = [];
  onProgress?.(
    ASSET_EXPORT_PROGRESS_START,
    `Preparing ${chunks.length} zip file(s) from ${assets.length} assets...`,
  );

  try {
    for (let chunkIndex = 0; chunkIndex < chunks.length; chunkIndex++) {
      throwIfAborted(signal);
      const chunk = chunks[chunkIndex];
      const filename = buildAssetChunkZipFilename({
        part: chunkIndex + 1,
        totalParts: chunks.length,
        timestamp,
      });
      onProgress?.(
        calculateAssetExportProgress(processedAssets, assets.length),
        `ZIP ${chunkIndex + 1}/${chunks.length}: downloading ${chunk.assets.length} assets...`,
      );
      // biome-ignore lint/performance/noAwaitInLoops: Hydrate only the current ZIP's localized metadata.
      const chunkAssets = await loadChunkMetadata(client, chunk.assets, signal);
      // One active ZIP bounds binary memory and prevents duplicate downloads.
      const result = await exportChunk(
        chunkAssets,
        {
          index: chunkIndex + 1,
          totalChunks: chunks.length,
          filename,
          estimatedBytes: chunk.estimatedBytes,
        },
        (message) => {
          processedAssets++;
          onProgress?.(
            calculateAssetExportProgress(processedAssets, assets.length),
            message,
          );
        },
        (percent) =>
          onProgress?.(
            calculateAssetExportProgress(processedAssets, assets.length),
            `ZIP ${chunkIndex + 1}/${chunks.length}: generating archive (${Math.round(percent)}%)...`,
          ),
        signal,
      );
      successfulAssets += result.successfulAssets;
      failures.push(...result.failures);
      if (result.delivered) {
        chunkFilenames.push(filename);
      }
      // Yield after each archive keeps cancellation responsive.
      await yieldToBrowser();
    }
    throwIfAborted(signal);
    issues = await verifyFinalAssetCount(client, expectedAssets, signal);
  } catch (error) {
    if (chunkFilenames.length) {
      await writeIncompleteReport(timestamp, {
        status: signal?.aborted ? 'cancelled' : 'incomplete',
        sourceProjectId: site.id,
        sourceEnvironment: environment,
        totalAssets: assets.length,
        successfulAssets,
        chunkFilenames,
        failedAssets: failures,
        unexportedAssets: assets.length - successfulAssets,
        message: errorMessage(error),
      });
    }
    throw error;
  }

  if (failures.length || issues.length) {
    const reportFilename = await writeIncompleteReport(timestamp, {
      status: 'incomplete',
      sourceProjectId: site.id,
      sourceEnvironment: environment,
      totalAssets: assets.length,
      successfulAssets,
      chunkFilenames,
      failedAssets: failures,
      issues,
    });
    throw new Error(
      `Asset export incomplete: ${successfulAssets}/${assets.length} assets exported; ${failures.length} failed.${issues.length ? ` ${issues.join('; ')}.` : ''} See ${reportFilename} for details.`,
    );
  }

  persistLastAssetExportSnapshot({
    sourceProjectId: site.id,
    sourceEnvironment: environment,
    packageVersion: ASSET_EXPORT_VERSION,
    generatedAt: new Date().toISOString(),
    chunkFilenames,
    totalChunks: chunks.length,
    totalAssets: assets.length,
    maxZipBytes: MAX_ZIP_BYTES,
    maxFilesPerZip: MAX_FILES_PER_ZIP,
    sizeSafetyFactor: SIZE_SAFETY_FACTOR,
  });
  onProgress?.(
    100,
    `Completed asset export: ${assets.length} assets in ${chunks.length} ZIP file(s).`,
  );
}
