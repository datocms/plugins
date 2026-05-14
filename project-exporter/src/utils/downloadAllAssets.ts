import { buildClient } from '@datocms/cma-client-browser';
import JSZip from 'jszip';
import {
  ASSET_EXPORT_PROGRESS_START,
  ASSET_EXPORT_VERSION,
  ASSET_MANIFEST_FILENAME,
  ASSET_ZIP_ENTRY_PATTERN,
  ASSET_ZIP_FILENAME_TEMPLATE,
  type AssetForChunk,
  type AssetManifestEntry,
  buildAssetChunkZipFilename,
  buildAssetManifestEntry,
  buildAssetZipEntryName,
  calculateAssetExportProgress,
  createAssetChunks,
  getUploadFilename,
  getUploadSize,
  MAX_FILES_PER_ZIP,
  MAX_ZIP_BYTES,
  persistLastAssetExportSnapshot,
  SIZE_SAFETY_FACTOR,
} from './assetExport';

type UploadLike = Record<string, unknown>;

type DownloadedAssetResult = {
  zipEntryName: string;
  file: Blob;
  manifestEntry: AssetManifestEntry;
};

function downloadBlob(blob: Blob, filename: string) {
  const objectUrl = URL.createObjectURL(blob);
  const element = document.createElement('a');

  element.href = objectUrl;
  element.download = filename;
  document.body.appendChild(element);
  element.click();
  document.body.removeChild(element);

  setTimeout(() => {
    URL.revokeObjectURL(objectUrl);
  }, 1000);
}

async function downloadSingleAsset(
  asset: AssetForChunk<UploadLike>,
): Promise<DownloadedAssetResult> {
  const upload = asset.payload;
  const originalFilename = getUploadFilename(upload);
  const zipEntryName = buildAssetZipEntryName(
    asset.sourceUploadId,
    originalFilename,
  );
  const uploadUrl = typeof upload.url === 'string' ? upload.url : null;

  if (!uploadUrl) {
    throw new Error(
      `Upload ${asset.sourceUploadId} does not have a downloadable URL`,
    );
  }

  const response = await fetch(uploadUrl);
  if (!response.ok) {
    throw new Error(
      `Failed to download upload ${asset.sourceUploadId} (${response.status})`,
    );
  }

  const file = await response.blob();
  const manifestEntry = buildAssetManifestEntry(upload, zipEntryName);

  return { zipEntryName, file, manifestEntry };
}

async function buildZipForChunk(
  chunkAssets: AssetForChunk<UploadLike>[],
  chunkInfo: {
    currentChunk: number;
    totalChunks: number;
    chunkFilename: string;
    estimatedBytes: number;
  },
  totalUploads: number,
  downloadedBefore: number,
  onProgress: ((progress: number, msg: string) => void) | undefined,
): Promise<{
  zip: JSZip;
  manifestEntries: AssetManifestEntry[];
  downloadedCount: number;
}> {
  const downloadResults = await Promise.all(
    chunkAssets.map((asset) => downloadSingleAsset(asset)),
  );

  const zip = new JSZip();
  const manifestEntries: AssetManifestEntry[] = [];

  for (const result of downloadResults) {
    zip.file(result.zipEntryName, result.file);
    manifestEntries.push(result.manifestEntry);
  }

  const downloadedCount = downloadedBefore + downloadResults.length;
  onProgress?.(
    calculateAssetExportProgress(downloadedCount, totalUploads),
    `ZIP ${chunkInfo.currentChunk}/${chunkInfo.totalChunks}: downloaded ${downloadResults.length}/${chunkAssets.length} assets`,
  );

  zip.file(
    ASSET_MANIFEST_FILENAME,
    JSON.stringify(
      {
        manifestVersion: ASSET_EXPORT_VERSION,
        generatedAt: new Date().toISOString(),
        chunk: {
          index: chunkInfo.currentChunk,
          totalChunks: chunkInfo.totalChunks,
          filename: chunkInfo.chunkFilename,
          assetCount: chunkAssets.length,
          estimatedBytes: chunkInfo.estimatedBytes,
        },
        conventions: {
          zipEntryName: ASSET_ZIP_ENTRY_PATTERN,
          zipFilename: ASSET_ZIP_FILENAME_TEMPLATE,
        },
        limits: {
          maxZipBytes: MAX_ZIP_BYTES,
          maxFilesPerZip: MAX_FILES_PER_ZIP,
          sizeSafetyFactor: SIZE_SAFETY_FACTOR,
        },
        assets: manifestEntries,
      },
      null,
      2,
    ),
  );

  return { zip, manifestEntries, downloadedCount };
}

export default async function downloadAllAssets(
  apiToken: string,
  environment: string,
  baseUrl: string | undefined,
  onProgress?: (progress: number, msg: string) => void,
) {
  const client = buildClient({
    apiToken,
    environment,
    baseUrl,
  });

  const uploads: UploadLike[] = [];
  let scannedCount = 0;

  onProgress?.(0, 'Scanning assets...');

  for await (const upload of client.uploads.listPagedIterator()) {
    uploads.push(upload as UploadLike);
    scannedCount++;

    if (scannedCount % 50 === 0) {
      onProgress?.(0, `Scanned ${scannedCount} assets...`);
    }
  }

  if (!uploads.length) {
    onProgress?.(100, 'No assets found to export.');
    return;
  }

  const chunks = createAssetChunks(
    uploads.map((upload) => ({
      sourceUploadId: String(upload.id ?? 'unknown'),
      originalFilename: getUploadFilename(upload),
      size: getUploadSize(upload),
      payload: upload,
    })),
    {
      maxZipBytes: MAX_ZIP_BYTES,
      maxFilesPerZip: MAX_FILES_PER_ZIP,
      sizeSafetyFactor: SIZE_SAFETY_FACTOR,
    },
  );

  const timestamp = new Date().toISOString().replace(/:/g, '-');

  onProgress?.(
    ASSET_EXPORT_PROGRESS_START,
    `Preparing ${chunks.length} zip file(s) from ${uploads.length} assets...`,
  );

  // Track total downloaded across all chunks using a shared counter object
  let globalDownloadedAssets = 0;

  const chunkResults = await Promise.all(
    chunks.map(async (chunk, chunkIndex) => {
      const currentChunk = chunkIndex + 1;
      const chunkFilename = buildAssetChunkZipFilename({
        part: currentChunk,
        totalParts: chunks.length,
        timestamp,
      });

      onProgress?.(
        calculateAssetExportProgress(globalDownloadedAssets, uploads.length),
        `ZIP ${currentChunk}/${chunks.length}: downloading ${chunk.assets.length} assets...`,
      );

      const { zip, downloadedCount } = await buildZipForChunk(
        chunk.assets,
        {
          currentChunk,
          totalChunks: chunks.length,
          chunkFilename,
          estimatedBytes: chunk.estimatedBytes,
        },
        uploads.length,
        globalDownloadedAssets,
        onProgress,
      );

      globalDownloadedAssets = downloadedCount;

      onProgress?.(
        calculateAssetExportProgress(globalDownloadedAssets, uploads.length),
        `ZIP ${currentChunk}/${chunks.length}: generating archive...`,
      );

      const finishedZip = await zip.generateAsync({
        type: 'blob',
        compression: 'STORE',
      });

      return { chunkFilename, finishedZip };
    }),
  );

  const chunkFilenames = chunkResults.map((result) => result.chunkFilename);

  for (const { finishedZip, chunkFilename } of chunkResults) {
    downloadBlob(finishedZip, chunkFilename);
  }

  persistLastAssetExportSnapshot({
    packageVersion: ASSET_EXPORT_VERSION,
    generatedAt: new Date().toISOString(),
    chunkFilenames,
    totalChunks: chunks.length,
    totalAssets: uploads.length,
    maxZipBytes: MAX_ZIP_BYTES,
    maxFilesPerZip: MAX_FILES_PER_ZIP,
    sizeSafetyFactor: SIZE_SAFETY_FACTOR,
  });

  onProgress?.(
    100,
    `Completed asset export: ${uploads.length} assets in ${chunks.length} ZIP file(s).`,
  );
}
