import type { Client } from '@datocms/cma-client-browser';
import JSZip from 'jszip';
import { createDebugLogger, type DebugLogger } from './debugLogger';
import { withRetry } from './retry';
import type {
  AssetImportFailure,
  AssetImportReport,
  AssetZipManifest,
  AssetZipManifestEntry,
  RetryOptions,
} from './types';

type ParsedZipManifest = {
  zipFilename: string;
  zip: JSZip;
  manifest: AssetZipManifest;
};

type AssetImportTask = {
  sourceUploadId: string;
  zipFilename: string;
  zipEntryName: string;
  manifestEntry: AssetZipManifestEntry;
  zip: JSZip;
};

function asString(value: unknown): string | null {
  return typeof value === 'string' ? value : null;
}

function asNumber(value: unknown): number | null {
  return typeof value === 'number' && Number.isFinite(value) ? value : null;
}

function isObject(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function parseManifest(raw: unknown): AssetZipManifest | null {
  if (!isObject(raw)) {
    return null;
  }

  const chunk = isObject(raw.chunk) ? raw.chunk : null;
  const conventions = isObject(raw.conventions) ? raw.conventions : null;
  const limits = isObject(raw.limits) ? raw.limits : null;

  if (!chunk || !conventions || !limits || !Array.isArray(raw.assets)) {
    return null;
  }

  const assets: AssetZipManifestEntry[] = raw.assets
    .filter((entry): entry is Record<string, unknown> => isObject(entry))
    .map((entry) => ({
      sourceUploadId: asString(entry.sourceUploadId) ?? 'unknown',
      zipEntryName: asString(entry.zipEntryName) ?? '',
      originalFilename: asString(entry.originalFilename) ?? 'file',
      size: asNumber(entry.size),
      mimeType: asString(entry.mimeType),
      width: asNumber(entry.width),
      height: asNumber(entry.height),
      checksum: asString(entry.checksum),
      url: asString(entry.url),
      path: asString(entry.path),
      metadata: isObject(entry.metadata) ? entry.metadata : {},
    }));

  return {
    manifestVersion: asString(raw.manifestVersion) ?? 'unknown',
    generatedAt: asString(raw.generatedAt) ?? new Date().toISOString(),
    chunk: {
      index: asNumber(chunk.index) ?? 0,
      totalChunks: asNumber(chunk.totalChunks) ?? 0,
      filename: asString(chunk.filename) ?? '',
      assetCount: asNumber(chunk.assetCount) ?? assets.length,
      estimatedBytes: asNumber(chunk.estimatedBytes) ?? 0,
    },
    conventions: {
      zipEntryName: asString(conventions.zipEntryName) ?? '',
      zipFilename: asString(conventions.zipFilename) ?? '',
    },
    limits: {
      maxZipBytes: asNumber(limits.maxZipBytes) ?? 0,
      maxFilesPerZip: asNumber(limits.maxFilesPerZip) ?? 0,
      sizeSafetyFactor: asNumber(limits.sizeSafetyFactor) ?? 1,
    },
    assets,
  };
}

async function parseZipFile(file: File): Promise<ParsedZipManifest> {
  const zip = await JSZip.loadAsync(await file.arrayBuffer());
  const manifestEntry = zip.file('manifest.json');

  if (!manifestEntry) {
    throw new Error(`ZIP '${file.name}' is missing manifest.json`);
  }

  const manifestRawText = await manifestEntry.async('string');
  let manifestJson: unknown;

  try {
    manifestJson = JSON.parse(manifestRawText);
  } catch (_error) {
    throw new Error(`ZIP '${file.name}' has invalid manifest.json`);
  }

  const manifest = parseManifest(manifestJson);
  if (!manifest) {
    throw new Error(`ZIP '${file.name}' manifest does not follow expected format`);
  }

  return {
    zipFilename: file.name,
    zip,
    manifest,
  };
}

function createInitialReport(strictMode: boolean): AssetImportReport {
  return {
    ok: true,
    strictMode,
    processedZipFiles: 0,
    importedAssets: 0,
    skippedAssets: 0,
    uploadIdMap: new Map<string, string>(),
    errors: [],
    warnings: [],
    failures: [],
  };
}

function pushFailure(
  report: AssetImportReport,
  failure: AssetImportFailure,
  options: { strictMode: boolean; asWarning?: boolean } = { strictMode: true },
) {
  report.failures.push(failure);

  if (options.asWarning || !options.strictMode) {
    report.warnings.push(failure.message);
    return;
  }

  report.errors.push(failure.message);
  report.ok = false;
}

function validateChunkSet(parsedZips: ParsedZipManifest[]): string[] {
  const warnings: string[] = [];
  if (!parsedZips.length) {
    return warnings;
  }

  const expectedTotal = parsedZips[0].manifest.chunk.totalChunks;
  const seenIndexes = new Set<number>();

  parsedZips.forEach((entry) => {
    seenIndexes.add(entry.manifest.chunk.index);

    if (entry.manifest.chunk.totalChunks !== expectedTotal) {
      warnings.push(
        `Chunk total mismatch in '${entry.zipFilename}': expected ${expectedTotal}, got ${entry.manifest.chunk.totalChunks}.`,
      );
    }
  });

  if (expectedTotal > 0) {
    for (let index = 1; index <= expectedTotal; index += 1) {
      if (!seenIndexes.has(index)) {
        warnings.push(`Missing asset ZIP chunk index ${index}/${expectedTotal}.`);
      }
    }
  }

  return warnings;
}

async function runWithConcurrency<T>(args: {
  inputs: T[];
  limit: number;
  worker: (input: T, index: number) => Promise<void>;
}) {
  if (!args.inputs.length) {
    return;
  }

  const safeLimit = Math.max(1, Math.min(args.limit, args.inputs.length));
  let cursor = 0;

  const runners = Array.from({ length: safeLimit }, async () => {
    while (cursor < args.inputs.length) {
      const index = cursor;
      cursor += 1;
      const input = args.inputs[index];
      await args.worker(input, index);
    }
  });

  await Promise.all(runners);
}

type ExistingUploadIndex = {
  byChecksum: Map<string, string>;
  byFilenameAndSize: Map<string, string>;
  scannedUploads: number;
};

function normalizeFilename(value: string): string {
  return value.trim().toLowerCase();
}

function buildFilenameSizeKey(filename: string | null, size: number | null): string | null {
  if (!filename || typeof size !== 'number' || !Number.isFinite(size)) {
    return null;
  }

  return `${normalizeFilename(filename)}::${size}`;
}

function dedupePendingTasks(tasks: AssetImportTask[]): {
  canonicalTasks: AssetImportTask[];
  aliasesByCanonicalSourceId: Map<string, string[]>;
  dedupedTaskCount: number;
} {
  const canonicalByChecksum = new Map<string, string>();
  const canonicalByFilenameAndSize = new Map<string, string>();
  const canonicalTasksBySourceId = new Map<string, AssetImportTask>();
  const aliasesByCanonicalSourceId = new Map<string, string[]>();
  const canonicalTasks: AssetImportTask[] = [];
  let dedupedTaskCount = 0;

  for (const task of tasks) {
    const checksum = task.manifestEntry.checksum ?? null;
    const filenameSizeKey = buildFilenameSizeKey(
      task.manifestEntry.originalFilename,
      task.manifestEntry.size,
    );

    let canonicalSourceId: string | null = null;

    if (checksum) {
      canonicalSourceId = canonicalByChecksum.get(checksum) ?? null;
    }

    if (!canonicalSourceId && filenameSizeKey) {
      canonicalSourceId =
        canonicalByFilenameAndSize.get(filenameSizeKey) ?? null;
    }

    if (!canonicalSourceId) {
      canonicalTasks.push(task);
      canonicalTasksBySourceId.set(task.sourceUploadId, task);

      if (checksum) {
        canonicalByChecksum.set(checksum, task.sourceUploadId);
      }

      if (filenameSizeKey) {
        canonicalByFilenameAndSize.set(filenameSizeKey, task.sourceUploadId);
      }

      continue;
    }

    const canonicalTask = canonicalTasksBySourceId.get(canonicalSourceId);
    if (!canonicalTask) {
      canonicalTasks.push(task);
      canonicalTasksBySourceId.set(task.sourceUploadId, task);
      continue;
    }

    const aliases = aliasesByCanonicalSourceId.get(canonicalSourceId) ?? [];
    aliases.push(task.sourceUploadId);
    aliasesByCanonicalSourceId.set(canonicalSourceId, aliases);
    dedupedTaskCount += 1;
  }

  return {
    canonicalTasks,
    aliasesByCanonicalSourceId,
    dedupedTaskCount,
  };
}

function pickUploadId(upload: Record<string, unknown>): string | null {
  return asString(upload.id);
}

function pickUploadChecksum(upload: Record<string, unknown>): string | null {
  return asString(upload.md5) ?? asString(upload.checksum);
}

function pickUploadFilename(upload: Record<string, unknown>): string | null {
  return (
    asString(upload.filename) ??
    asString(upload.basename) ??
    asString(upload.path)
  );
}

function pickUploadSize(upload: Record<string, unknown>): number | null {
  return asNumber(upload.size);
}

function extractAllowedLocalesFromError(error: unknown): string[] | null {
  if (!error || typeof error !== 'object') {
    return null;
  }

  const maybeErrors = (error as { errors?: unknown[] }).errors;
  if (!Array.isArray(maybeErrors)) {
    return null;
  }

  for (const entry of maybeErrors) {
    if (!entry || typeof entry !== 'object') {
      continue;
    }

    const attributes = (entry as { attributes?: unknown }).attributes;
    if (!attributes || typeof attributes !== 'object') {
      continue;
    }

    const details = (attributes as { details?: unknown }).details;
    if (!details || typeof details !== 'object') {
      continue;
    }

    const allowedLocales = (details as { allowed_locales?: unknown }).allowed_locales;
    if (!Array.isArray(allowedLocales)) {
      continue;
    }

    const locales = allowedLocales.filter(
      (value): value is string => typeof value === 'string' && value.length > 0,
    );
    if (locales.length > 0) {
      return locales;
    }
  }

  return null;
}

function isInvalidLocalesError(error: unknown): boolean {
  if (error instanceof Error && error.message.includes('INVALID_LOCALES')) {
    return true;
  }

  return extractAllowedLocalesFromError(error) !== null;
}

async function resolveTargetLocales(client: Client): Promise<string[] | null> {
  try {
    const site = await (client.site as { find?: () => Promise<unknown> }).find?.();
    if (!site || typeof site !== 'object') {
      return null;
    }

    const locales = (site as { locales?: unknown }).locales;
    if (!Array.isArray(locales)) {
      return null;
    }

    const normalized = locales.filter(
      (value): value is string => typeof value === 'string' && value.length > 0,
    );
    return normalized.length > 0 ? normalized : null;
  } catch (_error) {
    return null;
  }
}

function sanitizeLocaleMetadataMap(args: {
  mapValue: unknown;
  allowedLocales: Set<string>;
}): {
  value: Record<string, unknown> | null;
  droppedLocales: string[];
} {
  if (!isObject(args.mapValue)) {
    return { value: null, droppedLocales: [] };
  }

  const value: Record<string, unknown> = {};
  const droppedLocales: string[] = [];

  for (const [locale, localeValue] of Object.entries(args.mapValue)) {
    if (!args.allowedLocales.has(locale)) {
      droppedLocales.push(locale);
      continue;
    }
    value[locale] = localeValue;
  }

  return {
    value: Object.keys(value).length > 0 ? value : null,
    droppedLocales,
  };
}

function sanitizeUploadMetadataForLocales(args: {
  metadata: Record<string, unknown>;
  allowedLocales: string[] | null;
}): {
  metadata: Record<string, unknown>;
  droppedDefaultFieldMetadataLocales: string[];
  droppedFieldMetadataLocales: string[];
} {
  const metadata = { ...args.metadata };
  if (!args.allowedLocales || args.allowedLocales.length === 0) {
    return {
      metadata,
      droppedDefaultFieldMetadataLocales: [],
      droppedFieldMetadataLocales: [],
    };
  }

  const allowedLocales = new Set(args.allowedLocales);
  const sanitizedDefaultFieldMetadata = sanitizeLocaleMetadataMap({
    mapValue: metadata.default_field_metadata,
    allowedLocales,
  });
  const sanitizedFieldMetadata = sanitizeLocaleMetadataMap({
    mapValue: metadata.field_metadata,
    allowedLocales,
  });

  if (sanitizedDefaultFieldMetadata.value) {
    metadata.default_field_metadata = sanitizedDefaultFieldMetadata.value;
  } else {
    delete metadata.default_field_metadata;
  }

  if (sanitizedFieldMetadata.value) {
    metadata.field_metadata = sanitizedFieldMetadata.value;
  } else {
    delete metadata.field_metadata;
  }

  return {
    metadata,
    droppedDefaultFieldMetadataLocales:
      sanitizedDefaultFieldMetadata.droppedLocales,
    droppedFieldMetadataLocales: sanitizedFieldMetadata.droppedLocales,
  };
}

async function buildExistingUploadIndex(args: {
  client: Client;
  onProgress?: (message: string) => void;
}): Promise<ExistingUploadIndex> {
  const byChecksum = new Map<string, string>();
  const byFilenameAndSize = new Map<string, string>();
  let scannedUploads = 0;

  try {
    for await (const rawUpload of args.client.uploads.listPagedIterator()) {
      const upload = rawUpload as unknown as Record<string, unknown>;
      const uploadId = pickUploadId(upload);
      if (!uploadId) {
        continue;
      }

      const checksum = pickUploadChecksum(upload);
      if (checksum && !byChecksum.has(checksum)) {
        byChecksum.set(checksum, uploadId);
      }

      const filenameSizeKey = buildFilenameSizeKey(
        pickUploadFilename(upload),
        pickUploadSize(upload),
      );
      if (filenameSizeKey && !byFilenameAndSize.has(filenameSizeKey)) {
        byFilenameAndSize.set(filenameSizeKey, uploadId);
      }

      scannedUploads += 1;
      if (scannedUploads % 250 === 0) {
        args.onProgress?.(`Scanned ${scannedUploads} existing uploads for dedupe...`);
      }
    }
  } catch (_error) {
    // If listing uploads is not available, we keep indexes empty.
  }

  return {
    byChecksum,
    byFilenameAndSize,
    scannedUploads,
  };
}

export async function importAssetsFromZipFiles(args: {
  client: Client;
  zipFiles: File[];
  strictMode: boolean;
  retry: RetryOptions;
  uploadConcurrency?: number;
  scanExistingUploads?: boolean;
  initialUploadIdMap?: Map<string, string>;
  logger?: DebugLogger;
  onProgress?: (progress: { finished: number; total: number; message: string }) => void;
}): Promise<AssetImportReport> {
  const logger = (args.logger ?? createDebugLogger({ enabled: false })).child(
    'asset-import',
  );
  const report = createInitialReport(args.strictMode);
  logger.debug('Starting asset import', {
    strictMode: args.strictMode,
    zipFiles: args.zipFiles.length,
    uploadConcurrency: args.uploadConcurrency ?? 2,
    scanExistingUploads: args.scanExistingUploads ?? true,
    initialUploadIdMapSize: args.initialUploadIdMap?.size ?? 0,
  });

  if (args.initialUploadIdMap) {
    for (const [sourceUploadId, targetUploadId] of args.initialUploadIdMap.entries()) {
      report.uploadIdMap.set(sourceUploadId, targetUploadId);
    }
    logger.debug('Seeded upload ID map from initial values', {
      seededMappings: args.initialUploadIdMap.size,
    });
  }

  if (!args.zipFiles.length) {
    logger.warn('No ZIP files received, skipping asset import');
    return report;
  }

  let targetLocales = await resolveTargetLocales(args.client);
  if (targetLocales) {
    logger.debug('Resolved target locales for metadata sanitization', {
      locales: targetLocales,
    });
  } else {
    logger.warn(
      'Could not resolve target locales from site settings; metadata locale sanitization may be limited',
    );
  }

  const parsedZips: ParsedZipManifest[] = [];

  for (const zipFile of args.zipFiles) {
    try {
      const parsed = await parseZipFile(zipFile);
      parsedZips.push(parsed);
      report.processedZipFiles += 1;
      logger.debug('Parsed ZIP manifest', {
        zipFilename: zipFile.name,
        chunkIndex: parsed.manifest.chunk.index,
        totalChunks: parsed.manifest.chunk.totalChunks,
        manifestAssets: parsed.manifest.assets.length,
      });
    } catch (error) {
      logger.error('Failed to parse ZIP file', {
        zipFilename: zipFile.name,
        error: error instanceof Error ? error.message : 'Unknown parse error',
      });
      pushFailure(
        report,
        {
          zipFilename: zipFile.name,
          message: error instanceof Error ? error.message : 'Could not parse ZIP file',
        },
        { strictMode: args.strictMode },
      );
    }
  }

  if (parsedZips.length === 0) {
    report.ok = false;
    logger.error('No valid ZIP files could be parsed; aborting asset import');
    return report;
  }

  const chunkWarnings = validateChunkSet(parsedZips);
  chunkWarnings.forEach((warning) => report.warnings.push(warning));
  if (chunkWarnings.length > 0) {
    logger.warn('Chunk validation produced warnings', {
      warnings: chunkWarnings,
    });
  }

  const importTasks: AssetImportTask[] = [];

  for (const parsed of parsedZips) {
    for (const manifestEntry of parsed.manifest.assets) {
      if (!manifestEntry.sourceUploadId || !manifestEntry.zipEntryName) {
        logger.warn('Skipping invalid manifest entry', {
          zipFilename: parsed.zipFilename,
          sourceUploadId: manifestEntry.sourceUploadId,
          zipEntryName: manifestEntry.zipEntryName,
        });
        pushFailure(
          report,
          {
            zipFilename: parsed.zipFilename,
            sourceUploadId: manifestEntry.sourceUploadId || undefined,
            message: `Invalid asset entry in '${parsed.zipFilename}': missing sourceUploadId or zipEntryName.`,
          },
          { strictMode: args.strictMode },
        );
        continue;
      }

      const zipEntry = parsed.zip.file(manifestEntry.zipEntryName);
      if (!zipEntry) {
        logger.warn('Manifest entry references missing ZIP entry', {
          zipFilename: parsed.zipFilename,
          sourceUploadId: manifestEntry.sourceUploadId,
          zipEntryName: manifestEntry.zipEntryName,
        });
        pushFailure(
          report,
          {
            zipFilename: parsed.zipFilename,
            sourceUploadId: manifestEntry.sourceUploadId,
            message: `ZIP '${parsed.zipFilename}' is missing entry '${manifestEntry.zipEntryName}'.`,
          },
          { strictMode: args.strictMode },
        );
        continue;
      }

      importTasks.push({
        sourceUploadId: manifestEntry.sourceUploadId,
        zipFilename: parsed.zipFilename,
        zipEntryName: manifestEntry.zipEntryName,
        manifestEntry,
        zip: parsed.zip,
      });
    }
  }

  const uniqueTasks = new Map<string, AssetImportTask>();

  for (const task of importTasks) {
    if (report.uploadIdMap.has(task.sourceUploadId)) {
      report.skippedAssets += 1;
      logger.debug('Skipping task because sourceUploadId is already mapped', {
        sourceUploadId: task.sourceUploadId,
      });
      continue;
    }

    if (uniqueTasks.has(task.sourceUploadId)) {
      report.warnings.push(
        `Duplicate sourceUploadId '${task.sourceUploadId}' found across ZIP manifests. Keeping first occurrence.`,
      );
      report.skippedAssets += 1;
      logger.warn('Duplicate sourceUploadId across manifests; keeping first', {
        sourceUploadId: task.sourceUploadId,
      });
      continue;
    }

    uniqueTasks.set(task.sourceUploadId, task);
  }

  const scanExistingUploads = args.scanExistingUploads ?? true;
  const uploadConcurrency = Math.max(1, args.uploadConcurrency ?? 2);

  let existingUploadIndex: ExistingUploadIndex = {
    byChecksum: new Map(),
    byFilenameAndSize: new Map(),
    scannedUploads: 0,
  };

  if (scanExistingUploads) {
    args.onProgress?.({
      finished: 0,
      total: 1,
      message: 'Scanning existing target uploads for dedupe...',
    });

    existingUploadIndex = await buildExistingUploadIndex({
      client: args.client,
      onProgress: (message) => {
        args.onProgress?.({
          finished: 0,
          total: 1,
          message,
        });
      },
    });

    if (existingUploadIndex.scannedUploads > 0) {
      report.warnings.push(
        `Scanned ${existingUploadIndex.scannedUploads} existing uploads for dedupe.`,
      );
    }

    logger.debug('Finished scanning existing uploads', {
      scannedUploads: existingUploadIndex.scannedUploads,
      checksumIndexSize: existingUploadIndex.byChecksum.size,
      filenameSizeIndexSize: existingUploadIndex.byFilenameAndSize.size,
    });
  }

  const tasksToRun: AssetImportTask[] = [];
  let reusedExistingUploadCount = 0;

  for (const task of uniqueTasks.values()) {
    const checksum = task.manifestEntry.checksum;
    if (checksum) {
      const existingByChecksum = existingUploadIndex.byChecksum.get(checksum);
      if (existingByChecksum) {
        report.uploadIdMap.set(task.sourceUploadId, existingByChecksum);
        report.skippedAssets += 1;
        reusedExistingUploadCount += 1;
        logger.debug('Reused existing upload by checksum', {
          sourceUploadId: task.sourceUploadId,
          targetUploadId: existingByChecksum,
          checksum,
        });
        continue;
      }
    }

    const filenameSizeKey = buildFilenameSizeKey(
      task.manifestEntry.originalFilename,
      task.manifestEntry.size,
    );
    if (filenameSizeKey) {
      const existingByFilenameAndSize =
        existingUploadIndex.byFilenameAndSize.get(filenameSizeKey);
      if (existingByFilenameAndSize) {
        report.uploadIdMap.set(task.sourceUploadId, existingByFilenameAndSize);
        report.skippedAssets += 1;
        reusedExistingUploadCount += 1;
        logger.debug('Reused existing upload by filename+size', {
          sourceUploadId: task.sourceUploadId,
          targetUploadId: existingByFilenameAndSize,
          key: filenameSizeKey,
        });
        continue;
      }
    }

    tasksToRun.push(task);
  }

  if (reusedExistingUploadCount > 0) {
    report.warnings.push(
      `Reused ${reusedExistingUploadCount} target uploads already present in destination.`,
    );
  }

  const {
    canonicalTasks,
    aliasesByCanonicalSourceId,
    dedupedTaskCount,
  } = dedupePendingTasks(tasksToRun);

  if (dedupedTaskCount > 0) {
    report.warnings.push(
      `Deduped ${dedupedTaskCount} uploads within import payload using checksum/filename-size fingerprints.`,
    );
  }

  logger.debug('Prepared upload execution queues', {
    discoveredTasks: importTasks.length,
    uniqueSourceTasks: uniqueTasks.size,
    tasksAfterExistingReuse: tasksToRun.length,
    canonicalTasksToUpload: canonicalTasks.length,
    dedupedWithinImport: dedupedTaskCount,
    reusedExistingUploadCount,
  });

  let processedUploads = 0;

  await runWithConcurrency({
    inputs: canonicalTasks,
    limit: uploadConcurrency,
    worker: async (task) => {
      args.onProgress?.({
        finished: processedUploads,
        total: canonicalTasks.length || 1,
        message: `Importing assets ${processedUploads + 1}/${canonicalTasks.length}`,
      });

      try {
        const zipEntry = task.zip.file(task.zipEntryName);
        if (!zipEntry) {
          throw new Error(`Missing ZIP entry '${task.zipEntryName}'`);
        }

        const blob = await zipEntry.async('blob');
        const metadata = task.manifestEntry.metadata;
        const sanitized = sanitizeUploadMetadataForLocales({
          metadata,
          allowedLocales: targetLocales,
        });
        let sanitizedMetadata = sanitized.metadata;
        if (
          sanitized.droppedDefaultFieldMetadataLocales.length > 0 ||
          sanitized.droppedFieldMetadataLocales.length > 0
        ) {
          logger.warn('Dropped upload metadata locales not available in target', {
            sourceUploadId: task.sourceUploadId,
            droppedDefaultFieldMetadataLocales:
              sanitized.droppedDefaultFieldMetadataLocales,
            droppedFieldMetadataLocales: sanitized.droppedFieldMetadataLocales,
            allowedLocales: targetLocales,
          });
        }
        logger.debug('Uploading asset from ZIP entry', {
          sourceUploadId: task.sourceUploadId,
          zipFilename: task.zipFilename,
          zipEntryName: task.zipEntryName,
          originalFilename: task.manifestEntry.originalFilename,
          size: task.manifestEntry.size,
          checksum: task.manifestEntry.checksum,
        });

        const createPayload = () =>
          ({
            fileOrBlob: blob,
            filename: task.manifestEntry.originalFilename,
            default_field_metadata: sanitizedMetadata.default_field_metadata as any,
            tags: sanitizedMetadata.tags as any,
            notes: sanitizedMetadata.notes as any,
            author: sanitizedMetadata.author as any,
            copyright: sanitizedMetadata.copyright as any,
            custom_data: sanitizedMetadata.custom_data as any,
            focal_point: sanitizedMetadata.focal_point as any,
          }) as any;

        let createdUpload: { id: string };
        try {
          createdUpload = await withRetry({
            operationName: 'upload.createFromFileOrBlob',
            options: args.retry,
            fn: async () => args.client.uploads.createFromFileOrBlob(createPayload()),
          });
        } catch (createError) {
          if (!isInvalidLocalesError(createError)) {
            throw createError;
          }

          logger.warn(
            'Retrying upload creation without locale metadata after INVALID_LOCALES',
            {
              sourceUploadId: task.sourceUploadId,
            },
          );
          sanitizedMetadata = { ...sanitizedMetadata };
          delete sanitizedMetadata.default_field_metadata;
          delete sanitizedMetadata.field_metadata;

          createdUpload = await withRetry({
            operationName: 'upload.createFromFileOrBlob.retryWithoutLocaleMetadata',
            options: args.retry,
            fn: async () => args.client.uploads.createFromFileOrBlob(createPayload()),
          });
        }
        if (!createdUpload?.id) {
          throw new Error('Upload creation returned without ID');
        }

        report.uploadIdMap.set(task.sourceUploadId, createdUpload.id);
        report.importedAssets += 1;
        logger.debug('Created upload in destination', {
          sourceUploadId: task.sourceUploadId,
          targetUploadId: createdUpload.id,
        });

        const aliases = aliasesByCanonicalSourceId.get(task.sourceUploadId) ?? [];
        aliases.forEach((aliasSourceUploadId) => {
          report.uploadIdMap.set(aliasSourceUploadId, createdUpload.id);
          report.skippedAssets += 1;
        });
        if (aliases.length > 0) {
          logger.debug('Propagated upload ID to deduped aliases', {
            sourceUploadId: task.sourceUploadId,
            aliasCount: aliases.length,
            aliases,
            targetUploadId: createdUpload.id,
          });
        }

        const updatableMetadata: Record<string, unknown> = {};
        const keysForUpdate = [
          'default_field_metadata',
          'field_metadata',
          'custom_data',
          'tags',
          'notes',
          'author',
          'copyright',
          'focal_point',
        ];

        keysForUpdate.forEach((key) => {
          if (key in sanitizedMetadata) {
            updatableMetadata[key] = sanitizedMetadata[key];
          }
        });

        if (Object.keys(updatableMetadata).length > 0) {
          await withRetry({
            operationName: 'upload.update',
            options: args.retry,
            fn: async () =>
              args.client.uploads.update(createdUpload.id, updatableMetadata as any),
          });
          logger.debug('Updated upload metadata', {
            targetUploadId: createdUpload.id,
            metadataKeys: Object.keys(updatableMetadata),
          });
        }
      } catch (error) {
        if (isInvalidLocalesError(error)) {
          const localesFromError = extractAllowedLocalesFromError(error);
          if (localesFromError && localesFromError.length > 0) {
            targetLocales = localesFromError;
            logger.warn(
              'Received INVALID_LOCALES from API; updated allowed locales from error details',
              {
                locales: targetLocales,
                sourceUploadId: task.sourceUploadId,
              },
            );
          }
        }
        const aliases = aliasesByCanonicalSourceId.get(task.sourceUploadId) ?? [];
        logger.error('Failed to import upload', {
          sourceUploadId: task.sourceUploadId,
          zipFilename: task.zipFilename,
          error: error instanceof Error ? error.message : 'Unknown upload error',
          aliasCount: aliases.length,
        });
        pushFailure(
          report,
          {
            zipFilename: task.zipFilename,
            sourceUploadId: task.sourceUploadId,
            message:
              error instanceof Error
                ? `Failed to import upload '${task.sourceUploadId}': ${error.message}`
                : `Failed to import upload '${task.sourceUploadId}'.`,
          },
          { strictMode: args.strictMode },
        );

        aliases.forEach((aliasSourceUploadId) => {
          pushFailure(
            report,
            {
              zipFilename: task.zipFilename,
              sourceUploadId: aliasSourceUploadId,
              message: `Skipped deduped upload '${aliasSourceUploadId}' because '${task.sourceUploadId}' failed to import.`,
            },
            { strictMode: args.strictMode, asWarning: !args.strictMode },
          );
        });
      } finally {
        processedUploads += 1;
      }
    },
  });

  args.onProgress?.({
    finished: canonicalTasks.length,
    total: canonicalTasks.length || 1,
    message: `Imported ${report.importedAssets} assets`,
  });

  logger.debug('Asset import finished', {
    ok: report.ok,
    processedZipFiles: report.processedZipFiles,
    importedAssets: report.importedAssets,
    skippedAssets: report.skippedAssets,
    failures: report.failures.length,
    errors: report.errors.length,
    warnings: report.warnings.length,
    finalUploadIdMapSize: report.uploadIdMap.size,
  });

  if (args.strictMode && report.errors.length > 0) {
    report.ok = false;
  }

  return report;
}
