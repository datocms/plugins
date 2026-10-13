export const ASSET_EXPORT_VERSION = '3.0.0';
export const ASSET_MANIFEST_FILENAME = 'manifest.json';
export const ASSET_ZIP_ENTRY_PATTERN =
  'u_<sourceUploadId>__<sanitizedOriginalFilename>';
export const ASSET_ZIP_FILENAME_TEMPLATE = 'allAssets.{timestamp}.zip';
export const LAST_ASSET_EXPORT_STORAGE_KEY =
  'datocms.project-exporter.last-asset-export';

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

export type AssetExportFailure = {
  sourceUploadId: string;
  originalFilename: string;
  zipEntryName: string;
  url: string | null;
  message: string;
};

export type LastAssetExportSnapshot = {
  sourceProjectId?: string;
  sourceEnvironment?: string;
  packageVersion: string;
  generatedAt: string;
  filename: string;
  totalAssets: number;
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
  originalFilename: string,
): string {
  return `u_${sanitizeIdentifier(sourceUploadId)}__${sanitizeFilename(
    originalFilename,
  )}`;
}

export function getUploadFilename(upload: Record<string, unknown>): string {
  return (
    asString(upload.filename) ??
    asString(upload.basename) ??
    `asset-${asString(upload.id) ?? 'unknown'}`
  );
}

export function buildAssetManifestEntry(
  upload: Record<string, unknown>,
  zipEntryName: string,
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
  try {
    return (
      typeof window !== 'undefined' &&
      typeof window.localStorage !== 'undefined'
    );
  } catch (_err) {
    // Sandboxed iframes can deny access even to the localStorage getter.
    return false;
  }
}

export function persistLastAssetExportSnapshot(
  snapshot: LastAssetExportSnapshot,
): void {
  if (!localStorageAvailable()) {
    return;
  }

  try {
    window.localStorage.setItem(
      LAST_ASSET_EXPORT_STORAGE_KEY,
      JSON.stringify(snapshot),
    );
  } catch (_err) {
    // Ignore storage errors to avoid blocking exports.
  }
}

export function readLastAssetExportSnapshot(
  sourceProjectId?: string | null,
  sourceEnvironment?: string | null,
): LastAssetExportSnapshot | null {
  if (sourceProjectId === null || sourceEnvironment === null) return null;
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

    if (typeof parsed.filename !== 'string') {
      return null;
    }

    if (
      (sourceProjectId !== undefined &&
        parsed.sourceProjectId !== sourceProjectId) ||
      (sourceEnvironment !== undefined &&
        parsed.sourceEnvironment !== sourceEnvironment)
    ) {
      return null;
    }

    return parsed;
  } catch (_err) {
    return null;
  }
}
