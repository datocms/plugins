import { buildClient } from '@datocms/cma-client-browser';
import JSZip from 'jszip';
import {
  ASSET_EXPORT_VERSION,
  ASSET_MANIFEST_FILENAME,
  ASSET_ZIP_ENTRY_PATTERN,
  ASSET_ZIP_FILENAME_TEMPLATE,
  ASSET_EXPORT_PROGRESS_START,
  MAX_FILES_PER_ZIP,
  MAX_ZIP_BYTES,
  SIZE_SAFETY_FACTOR,
  buildAssetChunkZipFilename,
  calculateAssetExportProgress,
  buildAssetManifestEntry,
  buildAssetZipEntryName,
  createAssetChunks,
  getUploadFilename,
  getUploadSize,
  persistLastAssetExportSnapshot,
  type AssetManifestEntry,
} from './assetExport';

type UploadLike = Record<string, unknown>;

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

export default async function downloadAllAssets(
  apiToken: string,
  onProgress?: (progress: number, msg: string) => void
) {
  const client = buildClient({
    apiToken,
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
    }
  );

  const timestamp = new Date().toISOString().replace(/:/g, '-');
  const chunkFilenames: string[] = [];

  onProgress?.(
    ASSET_EXPORT_PROGRESS_START,
    `Preparing ${chunks.length} zip file(s) from ${uploads.length} assets...`
  );

  let downloadedAssets = 0;

  for (let chunkIndex = 0; chunkIndex < chunks.length; chunkIndex++) {
    const chunk = chunks[chunkIndex];
    const currentChunk = chunkIndex + 1;
    const chunkFilename = buildAssetChunkZipFilename({
      part: currentChunk,
      totalParts: chunks.length,
      timestamp,
    });

    chunkFilenames.push(chunkFilename);
    const zip = new JSZip();
    const manifestEntries: AssetManifestEntry[] = [];

    onProgress?.(
      calculateAssetExportProgress(downloadedAssets, uploads.length),
      `ZIP ${currentChunk}/${chunks.length}: downloading ${chunk.assets.length} assets...`
    );

    for (let assetIndex = 0; assetIndex < chunk.assets.length; assetIndex++) {
      const asset = chunk.assets[assetIndex];
      const upload = asset.payload;
      const originalFilename = getUploadFilename(upload);
      const zipEntryName = buildAssetZipEntryName(
        asset.sourceUploadId,
        originalFilename
      );
      const uploadUrl = typeof upload.url === 'string' ? upload.url : null;

      if (!uploadUrl) {
        throw new Error(
          `Upload ${asset.sourceUploadId} does not have a downloadable URL`
        );
      }

      const response = await fetch(uploadUrl);
      if (!response.ok) {
        throw new Error(
          `Failed to download upload ${asset.sourceUploadId} (${response.status})`
        );
      }

      const file = await response.blob();
      zip.file(zipEntryName, file);
      manifestEntries.push(buildAssetManifestEntry(upload, zipEntryName));
      downloadedAssets++;

      if ((assetIndex + 1) % 5 === 0 || assetIndex + 1 === chunk.assets.length) {
        onProgress?.(
          calculateAssetExportProgress(downloadedAssets, uploads.length),
          `ZIP ${currentChunk}/${chunks.length}: downloaded ${
            assetIndex + 1
          }/${chunk.assets.length} assets`
        );
      }
    }

    zip.file(
      ASSET_MANIFEST_FILENAME,
      JSON.stringify(
        {
          manifestVersion: ASSET_EXPORT_VERSION,
          generatedAt: new Date().toISOString(),
          chunk: {
            index: currentChunk,
            totalChunks: chunks.length,
            filename: chunkFilename,
            assetCount: chunk.assets.length,
            estimatedBytes: chunk.estimatedBytes,
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
        2
      )
    );

    onProgress?.(
      calculateAssetExportProgress(downloadedAssets, uploads.length),
      `ZIP ${currentChunk}/${chunks.length}: generating archive...`
    );
    const finishedZip = await zip.generateAsync({
      type: 'blob',
      compression: 'STORE',
    });

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
    `Completed asset export: ${uploads.length} assets in ${chunks.length} ZIP file(s).`
  );
}
