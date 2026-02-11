export const ASSET_EXPORT_VERSION = '2.0.0';
export const ASSET_MANIFEST_FILENAME = 'manifest.json';
export const ASSET_ZIP_ENTRY_PATTERN =
  'u_<sourceUploadId>__<sanitizedOriginalFilename>';
export const ASSET_ZIP_FILENAME_TEMPLATE =
  'allAssets.part-{part}-of-{total}.{timestamp}.zip';
export const LAST_ASSET_EXPORT_STORAGE_KEY =
  'datocms.project-exporter.last-asset-export';

export const MAX_ZIP_BYTES = 150 * 1024 * 1024;
export const MAX_FILES_PER_ZIP = 100;
export const SIZE_SAFETY_FACTOR = 1.2;
export const ASSET_EXPORT_PROGRESS_START = 5;
export const ASSET_EXPORT_PROGRESS_END = 95;

export type AssetChunkingOptions = {
  maxZipBytes?: number;
  maxFilesPerZip?: number;
  sizeSafetyFactor?: number;
};

export type AssetForChunk<TPayload = unknown> = {
  sourceUploadId: string;
  originalFilename: string;
  size: number;
  payload: TPayload;
};

export type AssetChunk<TPayload = unknown> = {
  assets: AssetForChunk<TPayload>[];
  estimatedBytes: number;
};

export type AssetManifestEntry = {
  sourceUploadId: string;
  zipEntryName: string;
  originalFilename: string;
  size: number | null;
  mimeType: string | null;
  width: number | null;
  height: number | null;
  checksum: string | null;
  url: string | null;
  path: string | null;
  metadata: Record<string, unknown>;
};

export type LastAssetExportSnapshot = {
  packageVersion: string;
  generatedAt: string;
  chunkFilenames: string[];
  totalChunks: number;
  totalAssets: number;
  maxZipBytes: number;
  maxFilesPerZip: number;
  sizeSafetyFactor: number;
};

function asString(value: unknown): string | null {
  return typeof value === 'string' ? value : null;
}

function asNumber(value: unknown): number | null {
  return typeof value === 'number' && Number.isFinite(value) ? value : null;
}

function sanitizeIdentifier(value: string): string {
  const clean = value
    .trim()
    .replace(/\s+/g, '_')
    .replace(/[^A-Za-z0-9_-]/g, '-')
    .replace(/-+/g, '-');

  return clean || 'unknown';
}

export function sanitizeFilename(filename: string): string {
  const clean = filename
    .trim()
    .replace(/\s+/g, '_')
    .replace(/[^A-Za-z0-9._-]/g, '-')
    .replace(/-+/g, '-')
    .replace(/^\.+/, '');

  return clean || 'file';
}

export function buildAssetZipEntryName(
  sourceUploadId: string,
  originalFilename: string
): string {
  return `u_${sanitizeIdentifier(sourceUploadId)}__${sanitizeFilename(
    originalFilename
  )}`;
}

export function buildAssetChunkZipFilename(args: {
  part: number;
  totalParts: number;
  timestamp: string;
}): string {
  const paddedPart = String(args.part).padStart(3, '0');
  const paddedTotal = String(args.totalParts).padStart(3, '0');

  return `allAssets.part-${paddedPart}-of-${paddedTotal}.${args.timestamp}.zip`;
}

export function getUploadFilename(upload: Record<string, unknown>): string {
  return (
    asString(upload.filename) ??
    asString(upload.basename) ??
    `asset-${asString(upload.id) ?? 'unknown'}`
  );
}

export function getUploadSize(upload: Record<string, unknown>): number {
  return asNumber(upload.size) ?? 0;
}

export function calculateAssetExportProgress(
  downloadedAssets: number,
  totalAssets: number
): number {
  if (totalAssets <= 0) {
    return ASSET_EXPORT_PROGRESS_END;
  }

  const normalizedRatio = Math.min(
    Math.max(downloadedAssets / totalAssets, 0),
    1
  );
  const progressRange =
    ASSET_EXPORT_PROGRESS_END - ASSET_EXPORT_PROGRESS_START;

  return ASSET_EXPORT_PROGRESS_START + normalizedRatio * progressRange;
}

function estimateAssetSizeBytes(size: number, sizeSafetyFactor: number): number {
  if (!Number.isFinite(size) || size <= 0) {
    return 1;
  }

  return Math.max(1, Math.ceil(size * sizeSafetyFactor));
}

export function createAssetChunks<TPayload>(
  assets: AssetForChunk<TPayload>[],
  options: AssetChunkingOptions = {}
): AssetChunk<TPayload>[] {
  const maxZipBytes = options.maxZipBytes ?? MAX_ZIP_BYTES;
  const maxFilesPerZip = options.maxFilesPerZip ?? MAX_FILES_PER_ZIP;
  const sizeSafetyFactor = options.sizeSafetyFactor ?? SIZE_SAFETY_FACTOR;

  if (!assets.length) {
    return [];
  }

  const chunks: AssetChunk<TPayload>[] = [];
  let currentChunk: AssetChunk<TPayload> = { assets: [], estimatedBytes: 0 };

  function flushCurrentChunk() {
    if (!currentChunk.assets.length) {
      return;
    }

    chunks.push(currentChunk);
    currentChunk = { assets: [], estimatedBytes: 0 };
  }

  for (const asset of assets) {
    const estimatedSize = estimateAssetSizeBytes(asset.size, sizeSafetyFactor);
    const isOversized = estimatedSize > maxZipBytes;

    if (isOversized) {
      flushCurrentChunk();
      chunks.push({
        assets: [asset],
        estimatedBytes: estimatedSize,
      });
      continue;
    }

    const wouldExceedFileLimit =
      currentChunk.assets.length >= maxFilesPerZip &&
      currentChunk.assets.length > 0;
    const wouldExceedByteLimit =
      currentChunk.estimatedBytes + estimatedSize > maxZipBytes &&
      currentChunk.assets.length > 0;

    if (wouldExceedFileLimit || wouldExceedByteLimit) {
      flushCurrentChunk();
    }

    currentChunk.assets.push(asset);
    currentChunk.estimatedBytes += estimatedSize;
  }

  flushCurrentChunk();
  return chunks;
}

export function buildAssetManifestEntry(
  upload: Record<string, unknown>,
  zipEntryName: string
): AssetManifestEntry {
  const sourceUploadId = asString(upload.id) ?? 'unknown';
  const originalFilename = getUploadFilename(upload);
  const size = asNumber(upload.size);
  const mimeType = asString(upload.mime_type) ?? asString(upload.format);
  const width = asNumber(upload.width);
  const height = asNumber(upload.height);
  const checksum = asString(upload.md5);
  const url = asString(upload.url);
  const path = asString(upload.path);

  const metadataKeys = [
    'default_field_metadata',
    'field_metadata',
    'custom_data',
    'tags',
    'notes',
    'author',
    'copyright',
    'focal_point',
    'is_image',
    'blurhash',
  ];

  const metadata: Record<string, unknown> = {};
  for (const key of metadataKeys) {
    if (key in upload) {
      metadata[key] = upload[key];
    }
  }

  return {
    sourceUploadId,
    zipEntryName,
    originalFilename,
    size,
    mimeType,
    width,
    height,
    checksum,
    url,
    path,
    metadata,
  };
}

function localStorageAvailable(): boolean {
  return (
    typeof window !== 'undefined' &&
    typeof window.localStorage !== 'undefined'
  );
}

export function persistLastAssetExportSnapshot(
  snapshot: LastAssetExportSnapshot
): void {
  if (!localStorageAvailable()) {
    return;
  }

  try {
    window.localStorage.setItem(
      LAST_ASSET_EXPORT_STORAGE_KEY,
      JSON.stringify(snapshot)
    );
  } catch (_err) {
    // Ignore storage errors to avoid blocking exports.
  }
}

export function readLastAssetExportSnapshot(): LastAssetExportSnapshot | null {
  if (!localStorageAvailable()) {
    return null;
  }

  try {
    const rawValue = window.localStorage.getItem(LAST_ASSET_EXPORT_STORAGE_KEY);
    if (!rawValue) {
      return null;
    }

    const parsed = JSON.parse(rawValue) as LastAssetExportSnapshot;
    if (!parsed || typeof parsed !== 'object') {
      return null;
    }

    if (!Array.isArray(parsed.chunkFilenames)) {
      return null;
    }

    return parsed;
  } catch (_err) {
    return null;
  }
}
