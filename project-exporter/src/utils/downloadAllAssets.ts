import { buildClient, type Client } from '@datocms/cma-client-browser';
import { BlobReader } from '@zip.js/zip.js';
import { downloadAssetFile, originalFileUrl } from './assetDownload';
import {
  ASSET_EXPORT_VERSION,
  ASSET_MANIFEST_FILENAME,
  ASSET_ZIP_ENTRY_PATTERN,
  ASSET_ZIP_FILENAME_TEMPLATE,
  type AssetExportFailure,
  buildAssetManifestEntry,
  buildAssetZipEntryName,
  getUploadFilename,
  persistLastAssetExportSnapshot,
} from './assetExport';
import { throwIfAborted, yieldToBrowser } from './exportRuntime';
import { ExportWorkspace } from './exportWorkspace';

type ProgressHandler = (progress: number, msg: string) => void;
type ExportClient = Client;

/** What the download pass needs; the full metadata is already in the manifest. */
type PendingAsset = {
  sourceUploadId: string;
  originalFilename: string;
  zipEntryName: string;
  url: string | null;
  size: number | null;
  md5: string | null;
};

// Workspace files besides the zip: the manifest, written while uploads are
// listed, and the asset being downloaded.
const MANIFEST_FILE = 'manifest.json';
const ASSET_FILE = 'asset.download';

const UPLOADS_PER_PAGE = 500;
const encoder = new TextEncoder();

async function uploadCount(client: ExportClient): Promise<number> {
  return (await client.uploads.rawList({ page: { limit: 1, offset: 0 } })).meta
    .total_count;
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

/**
 * Lists every upload, writing its manifest entry as it goes, and returns what
 * the downloads need. The list must not change while it is read.
 */
async function scanAssets(
  client: ExportClient,
  expectedAssets: number,
  write: (text: string) => Promise<void>,
  onProgress?: ProgressHandler,
  signal?: AbortSignal,
): Promise<PendingAsset[]> {
  const assets: PendingAsset[] = [];
  const seenIds = new Set<string>();
  onProgress?.(0, 'Scanning assets...');
  let offset = 0;
  while (offset < expectedAssets) {
    throwIfAborted(signal);
    // biome-ignore lint/performance/noAwaitInLoops: Sequential pages bound localized metadata memory.
    const uploads = await client.uploads.list({
      order_by: '_created_at_ASC',
      page: { limit: UPLOADS_PER_PAGE, offset },
    });
    if (!uploads.length)
      throw new Error('Asset list ended before the expected total count');
    for (const upload of uploads) {
      throwIfAborted(signal);
      if (seenIds.has(upload.id))
        throw new Error(
          `Asset list changed while scanning: duplicate upload ID ${upload.id}.`,
        );
      seenIds.add(upload.id);
      const originalFilename = getUploadFilename(upload);
      const entry = buildAssetManifestEntry(
        upload,
        buildAssetZipEntryName(upload.id, originalFilename),
      );
      // biome-ignore lint/performance/noAwaitInLoops: Manifest entries are written in order.
      await write(`${assets.length ? ',' : ''}${JSON.stringify(entry)}`);
      assets.push({
        sourceUploadId: upload.id,
        originalFilename,
        zipEntryName: entry.zipEntryName,
        url: entry.url,
        size: entry.size,
        md5: entry.checksum,
      });
    }
    offset += uploads.length;
    onProgress?.(
      5 * (assets.length / expectedAssets),
      `Scanned ${assets.length}/${expectedAssets} assets...`,
    );
    await yieldToBrowser();
  }
  throwIfAborted(signal);
  const scannedCount = await uploadCount(client);
  if (scannedCount !== expectedAssets || assets.length !== expectedAssets) {
    throw new Error(
      `Asset list changed while scanning: expected ${expectedAssets} assets, scanned ${assets.length}, found ${scannedCount}.`,
    );
  }
  return assets;
}

async function verifyFinalAssetCount(
  client: ExportClient,
  expectedAssets: number,
  signal?: AbortSignal,
): Promise<string[]> {
  try {
    const finalCount = await uploadCount(client);
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

/**
 * Writes every asset file and the manifest into the workspace zip `filename`.
 * An asset that cannot be downloaded is listed in the manifest's
 * `failedAssets`; anything else stops the export.
 */
async function writeAssetZip(args: {
  client: ExportClient;
  workspace: ExportWorkspace;
  filename: string;
  expectedAssets: number;
  manifestHeader: Record<string, unknown>;
  onProgress?: ProgressHandler;
  signal?: AbortSignal;
}) {
  const { client, workspace, expectedAssets, onProgress, signal } = args;
  const manifest = (await workspace.writable(MANIFEST_FILE)).getWriter();
  const write = (text: string) => manifest.write(encoder.encode(text));
  await write(`${JSON.stringify(args.manifestHeader).slice(0, -1)},"assets":[`);
  const assets = await scanAssets(
    client,
    expectedAssets,
    write,
    onProgress,
    signal,
  );

  const zip = await workspace.zip(args.filename);
  const failures: AssetExportFailure[] = [];
  for (let index = 0; index < assets.length; index++) {
    throwIfAborted(signal);
    const asset = assets[index];
    let file: File | undefined;
    try {
      if (!asset.url) throw new Error('Asset does not have a downloadable URL');
      // biome-ignore lint/performance/noAwaitInLoops: One download at a time keeps a single asset file on disk besides the zip.
      file = await downloadAssetFile(
        originalFileUrl(asset.url),
        workspace,
        ASSET_FILE,
        { signal, expectedBytes: asset.size, md5: asset.md5 },
      );
    } catch (error) {
      throwIfAborted(signal);
      failures.push({
        sourceUploadId: asset.sourceUploadId,
        originalFilename: asset.originalFilename,
        zipEntryName: asset.zipEntryName,
        url: asset.url,
        message: errorMessage(error),
      });
    }
    if (file)
      await zip.add(asset.zipEntryName, new BlobReader(file), { level: 0 });
    onProgress?.(
      5 + 90 * ((index + 1) / assets.length),
      `Downloaded ${index + 1}/${assets.length} assets${failures.length ? ` (${failures.length} failed)` : ''}...`,
    );
  }
  await workspace.remove(ASSET_FILE);

  throwIfAborted(signal);
  const issues = await verifyFinalAssetCount(client, expectedAssets, signal);
  await write(
    `],"failedAssets":${JSON.stringify(failures)},"issues":${JSON.stringify(issues)}}`,
  );
  await manifest.close();
  onProgress?.(95, 'Finishing the zip file...');
  await zip.add(
    ASSET_MANIFEST_FILENAME,
    new BlobReader(await workspace.file(MANIFEST_FILE)),
  );
  await zip.close();
  await workspace.remove(MANIFEST_FILE);
  return { totalAssets: assets.length, failures, issues };
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
  const expectedAssets = await uploadCount(client);
  if (!expectedAssets) {
    onProgress?.(100, 'No assets found to export.');
    return;
  }

  const workspace = await ExportWorkspace.open();
  const timestamp = new Date().toISOString().replace(/:/g, '-');
  const filename = ASSET_ZIP_FILENAME_TEMPLATE.replace(
    '{timestamp}',
    timestamp,
  );
  let result: Awaited<ReturnType<typeof writeAssetZip>>;
  try {
    result = await writeAssetZip({
      client,
      workspace,
      filename,
      expectedAssets,
      manifestHeader: {
        manifestVersion: ASSET_EXPORT_VERSION,
        generatedAt: new Date().toISOString(),
        sourceProjectId: site.id,
        sourceEnvironment: environment,
        conventions: {
          zipEntryName: ASSET_ZIP_ENTRY_PATTERN,
          zipFilename: ASSET_ZIP_FILENAME_TEMPLATE,
        },
      },
      onProgress,
      signal,
    });
  } catch (error) {
    await workspace.clear();
    throw error;
  }
  await workspace.download(filename);

  const { totalAssets, failures, issues } = result;
  if (failures.length || issues.length) {
    throw new Error(
      `Asset export incomplete: ${totalAssets - failures.length}/${totalAssets} assets exported; ${failures.length} failed.${issues.length ? ` ${issues.join('; ')}.` : ''} The zip's ${ASSET_MANIFEST_FILENAME} lists them.`,
    );
  }

  persistLastAssetExportSnapshot({
    sourceProjectId: site.id,
    sourceEnvironment: environment,
    packageVersion: ASSET_EXPORT_VERSION,
    generatedAt: new Date().toISOString(),
    filename,
    totalAssets,
  });
  onProgress?.(
    100,
    `Completed asset export: ${totalAssets} assets in ${filename}.`,
  );
}
