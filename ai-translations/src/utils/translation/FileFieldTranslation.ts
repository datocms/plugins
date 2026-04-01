/**
 * FileFieldTranslation.ts
 * ------------------------------------------------------
 * This module handles translation of metadata associated with file fields in DatoCMS,
 * including alt text, title, and other custom metadata fields that may be attached
 * to file uploads. It supports both single file fields and gallery (array of files) fields.
 *
 * The module provides functionality to:
 * - Extract translatable alt/title and metadata from file objects
 * - Process both single files and galleries (collections of files)
 * - Preserve file structure while updating only the relevant metadata
 * - Stream translation progress back to the UI
 */

import { buildClient } from '@datocms/cma-client-browser';
import type { ctxParamsType } from '../../entrypoints/Config/ConfigScreen';
import { createLogger } from '../logging/Logger';
import { handleTranslationError } from './ProviderErrors';
import { findExactLocaleKey } from './SharedFieldUtils';
import { translateArray } from './translateArray';
import type { StreamCallbacks, TranslationProvider } from './types';

type UploadDefaultFieldMetadata = Record<
  string,
  { alt?: string; title?: string }
>;

const uploadDefaultMetadataCache = new Map<
  string,
  Promise<UploadDefaultFieldMetadata | undefined>
>();

async function fetchUploadDefaultMetadata(
  uploadId: string,
  apiToken: string,
  environment: string,
  logger: ReturnType<typeof createLogger>,
): Promise<UploadDefaultFieldMetadata | undefined> {
  const cacheKey = `${environment}:${uploadId}`;
  const cached = uploadDefaultMetadataCache.get(cacheKey);
  if (cached) return cached;

  const fetchPromise = (async () => {
    try {
      const client = buildClient({ apiToken, environment });
      const upload = await client.uploads.find(uploadId);
      const metadata = (upload as { default_field_metadata?: unknown })
        .default_field_metadata;
      if (!metadata || typeof metadata !== 'object') {
        return undefined;
      }
      return metadata as UploadDefaultFieldMetadata;
    } catch (error) {
      logger.warning('Failed to fetch upload default metadata', {
        uploadId,
        error,
      });
      return undefined;
    }
  })();

  uploadDefaultMetadataCache.set(cacheKey, fetchPromise);
  return fetchPromise;
}

/**
 * Translates metadata for file and gallery fields
 *
 * This function handles both single file fields and gallery fields (arrays of files).
 * It extracts alt/title and metadata from each file object, translates text-based fields,
 * and reconstructs the file objects with the translated metadata while preserving
 * other properties like URLs, dimensions, etc.
 *
 * @param fieldValue - The file or gallery field data to translate
 * @param pluginParams - Plugin configuration parameters
 * @param toLocale - Target locale code for translation
 * @param fromLocale - Source locale code for translation
 * @param provider - TranslationProvider instance used for translation
 * @param apiToken - Optional CMA API token used to enrich metadata during translation
 * @param environment - Optional environment identifier for CMA requests
 * @param _streamCallbacks - Optional callbacks for streaming progress updates
 * @param recordContext - Optional context about the record to improve translation quality
 * @returns Updated file field data with translated alt/title and metadata
 */
export async function translateFileFieldValue(
  fieldValue: unknown,
  pluginParams: ctxParamsType,
  toLocale: string,
  fromLocale: string,
  provider: TranslationProvider,
  apiToken?: string,
  environment?: string,
  _streamCallbacks?: StreamCallbacks,
  recordContext = '',
): Promise<unknown> {
  // Create logger for this module
  const logger = createLogger(pluginParams, 'FileFieldTranslation');

  // If no value, return as is
  if (!fieldValue) {
    logger.info('No field value to translate');
    return fieldValue;
  }

  // Handle gallery type (array of file objects)
  if (Array.isArray(fieldValue)) {
    if (fieldValue.length === 0) {
      logger.info('Empty array, nothing to translate');
      return fieldValue;
    }

    logger.info(`Translating gallery with ${fieldValue.length} files`);

    // Translate each file in the gallery
    const translatedFiles = await Promise.all(
      fieldValue.map(async (file) => {
        return translateSingleFileMetadata(
          file,
          pluginParams,
          toLocale,
          fromLocale,
          provider,
          apiToken,
          environment,
          _streamCallbacks,
          recordContext,
        );
      }),
    );

    return translatedFiles;
  }

  // Handle single file field
  logger.info('Translating single file metadata');
  return translateSingleFileMetadata(
    fieldValue,
    pluginParams,
    toLocale,
    fromLocale,
    provider,
    apiToken,
    environment,
    _streamCallbacks,
    recordContext,
  );
}

/**
 * Shape of a single translatable entry extracted from a file object.
 */
type FileMetadataEntry = {
  kind: 'alt' | 'title' | 'metadata';
  key?: string;
  value: string;
};

/**
 * Returns the first non-empty trimmed string from the candidates provided.
 *
 * @param primary - Primary candidate string.
 * @param fallback - Fallback candidate string.
 * @returns First candidate with non-empty trimmed content, or undefined.
 */
function pickNonEmpty(primary?: string, fallback?: string): string | undefined {
  if (primary?.trim()) return primary;
  if (fallback?.trim()) return fallback;
  return undefined;
}

/**
 * Enriches alt/title sources by fetching the upload's default field metadata
 * when either value is missing.
 *
 * @param altSource - Current alt source (may be undefined).
 * @param titleSource - Current title source (may be undefined).
 * @param uploadId - DatoCMS upload ID to look up.
 * @param fromLocale - Source locale key for looking up the right locale block.
 * @param apiToken - CMA API token.
 * @param environment - Environment slug.
 * @param logger - Logger instance.
 * @returns Enriched alt/title values.
 */
async function enrichFromUploadDefaults(
  altSource: string | undefined,
  titleSource: string | undefined,
  uploadId: string,
  fromLocale: string,
  apiToken: string,
  environment: string,
  logger: ReturnType<typeof createLogger>,
): Promise<{ altSource: string | undefined; titleSource: string | undefined }> {
  const defaultMetadata = await fetchUploadDefaultMetadata(
    uploadId,
    apiToken,
    environment,
    logger,
  );
  if (!defaultMetadata) return { altSource, titleSource };

  const localeKey = findExactLocaleKey(
    defaultMetadata as Record<string, unknown>,
    fromLocale,
  );
  const localeMetadata = localeKey ? defaultMetadata[localeKey] : undefined;
  if (!localeMetadata || typeof localeMetadata !== 'object') {
    return { altSource, titleSource };
  }

  const enrichedAlt =
    !altSource &&
    typeof localeMetadata.alt === 'string' &&
    localeMetadata.alt.trim()
      ? localeMetadata.alt
      : altSource;
  const enrichedTitle =
    !titleSource &&
    typeof localeMetadata.title === 'string' &&
    localeMetadata.title.trim()
      ? localeMetadata.title
      : titleSource;

  return { altSource: enrichedAlt, titleSource: enrichedTitle };
}

/**
 * Collects extra metadata string entries from the metadata block,
 * skipping alt/title when they are already tracked as dedicated entries.
 *
 * @param metadata - The metadata sub-object from the file.
 * @param hasAltEntry - Whether alt is already tracked.
 * @param hasTitleEntry - Whether title is already tracked.
 * @returns Array of metadata entries (kind='metadata') ready for translation.
 */
function collectMetadataBlockEntries(
  metadata: Record<string, unknown>,
  hasAltEntry: boolean,
  hasTitleEntry: boolean,
): FileMetadataEntry[] {
  const entries: FileMetadataEntry[] = [];
  for (const [key, value] of Object.entries(metadata)) {
    if ((key === 'alt' && hasAltEntry) || (key === 'title' && hasTitleEntry))
      continue;
    if (value && typeof value === 'string') {
      entries.push({ kind: 'metadata', key, value });
    }
  }
  return entries;
}

/**
 * Collects all translatable entries from a file object (alt, title, and custom metadata).
 *
 * @param metadata - Optional parsed metadata sub-object.
 * @param altValue - Resolved alt text to translate (if any).
 * @param titleValue - Resolved title text to translate (if any).
 * @returns Array of entries ready for batch translation.
 */
function collectFileMetadataEntries(
  metadata: Record<string, unknown> | undefined,
  altValue: string | undefined,
  titleValue: string | undefined,
): FileMetadataEntry[] {
  const entries: FileMetadataEntry[] = [];

  if (altValue) entries.push({ kind: 'alt', value: altValue });
  if (titleValue) entries.push({ kind: 'title', value: titleValue });

  if (metadata) {
    const metadataEntries = collectMetadataBlockEntries(
      metadata,
      altValue !== undefined,
      titleValue !== undefined,
    );
    entries.push(...metadataEntries);
  }

  return entries;
}

/**
 * Applies a single translated entry onto the mutable output objects.
 *
 * @param entry - The entry describing what kind of field to update.
 * @param translated - The translated string value.
 * @param fileOut - Mutable copy of the file object to update.
 * @param metadataOut - Mutable copy of the metadata sub-object (updated in-place if present).
 * @returns Possibly updated metadataOut (created on-demand for 'metadata' kind entries).
 */
function applySingleFileEntry(
  entry: FileMetadataEntry,
  translated: string,
  fileOut: Record<string, unknown>,
  metadataOut: Record<string, unknown> | undefined,
): Record<string, unknown> | undefined {
  if (entry.kind === 'alt') {
    fileOut.alt = translated;
    if (metadataOut && 'alt' in metadataOut) metadataOut.alt = translated;
  } else if (entry.kind === 'title') {
    fileOut.title = translated;
    if (metadataOut && 'title' in metadataOut) metadataOut.title = translated;
  } else if (entry.kind === 'metadata' && entry.key) {
    const updatedMetadata = metadataOut ?? {};
    updatedMetadata[entry.key] = translated;
    return updatedMetadata;
  }
  return metadataOut;
}

/**
 * Applies translated values back onto cloned file and metadata output objects.
 *
 * @param entries - Original entry list used for translation (same order as translatedValues).
 * @param translatedValues - Translated strings from the provider.
 * @param fileObj - Original file object to clone and update.
 * @param metadata - Original metadata sub-object (may be undefined).
 * @returns Updated file object with translated fields merged in.
 */
function applyTranslatedFileEntries(
  entries: FileMetadataEntry[],
  translatedValues: string[],
  fileObj: Record<string, unknown>,
  metadata: Record<string, unknown> | undefined,
): Record<string, unknown> {
  let metadataOut: Record<string, unknown> | undefined = metadata
    ? { ...metadata }
    : undefined;
  const fileOut: Record<string, unknown> = { ...fileObj };

  for (let idx = 0; idx < entries.length; idx++) {
    const entry = entries[idx];
    const translated = translatedValues[idx];
    if (!entry || translated === undefined) continue;
    metadataOut = applySingleFileEntry(entry, translated, fileOut, metadataOut);
  }

  if (metadataOut) fileOut.metadata = metadataOut;
  return fileOut;
}

/**
 * Translates metadata for a single file object
 *
 * This function extracts text-based alt/title and metadata fields from a file object,
 * translates them using the provider, and then merges the translated values
 * back into the original file object, preserving all non-text properties.
 * It only translates string-type values, leaving other types untouched.
 *
 * @param fileValue - The file object containing metadata to translate
 * @param pluginParams - Plugin configuration parameters
 * @param toLocale - Target locale code for translation
 * @param fromLocale - Source locale code for translation
 * @param provider - TranslationProvider instance used for translation
 * @param apiToken - Optional CMA API token used to fetch default metadata for uploads
 * @param environment - Optional environment identifier for CMA requests
 * @param _streamCallbacks - Optional callbacks for streaming progress updates
 * @param recordContext - Optional context about the record to improve translation quality
 * @returns Updated file object with translated metadata
 */
/**
 * Extracts the upload ID from a file object, checking both snake_case and camelCase keys.
 *
 * @param fileObj - The raw file object.
 * @returns The upload ID string if found, or undefined.
 */
function extractUploadId(fileObj: Record<string, unknown>): string | undefined {
  if (typeof fileObj.upload_id === 'string') return fileObj.upload_id;
  if (typeof fileObj.uploadId === 'string') return fileObj.uploadId;
  return undefined;
}

/**
 * Resolves the alt and title source values from the file object and its metadata block,
 * then optionally enriches them from the upload's default field metadata.
 *
 * @param fileObj - The parsed file object.
 * @param metadata - Parsed metadata sub-object, if present.
 * @param fromLocale - Source locale for upload default lookup.
 * @param apiToken - CMA API token (required to fetch upload defaults).
 * @param environment - Dato environment slug (required to fetch upload defaults).
 * @param logger - Logger instance.
 * @returns Resolved alt and title source strings.
 */
async function resolveAltAndTitle(
  fileObj: Record<string, unknown>,
  metadata: Record<string, unknown> | undefined,
  fromLocale: string,
  apiToken: string | undefined,
  environment: string | undefined,
  logger: ReturnType<typeof createLogger>,
): Promise<{ altSource: string | undefined; titleSource: string | undefined }> {
  let altSource = pickNonEmpty(
    typeof fileObj.alt === 'string' ? fileObj.alt : undefined,
    typeof metadata?.alt === 'string' ? metadata.alt : undefined,
  );
  let titleSource = pickNonEmpty(
    typeof fileObj.title === 'string' ? fileObj.title : undefined,
    typeof metadata?.title === 'string' ? metadata.title : undefined,
  );

  const uploadId = extractUploadId(fileObj);
  if ((!altSource || !titleSource) && uploadId && apiToken && environment) {
    const enriched = await enrichFromUploadDefaults(
      altSource,
      titleSource,
      uploadId,
      fromLocale,
      apiToken,
      environment,
      logger,
    );
    altSource = enriched.altSource;
    titleSource = enriched.titleSource;
  }

  return { altSource, titleSource };
}

async function translateSingleFileMetadata(
  fileValue: unknown,
  pluginParams: ctxParamsType,
  toLocale: string,
  fromLocale: string,
  provider: TranslationProvider,
  apiToken?: string,
  environment?: string,
  _streamCallbacks?: StreamCallbacks,
  recordContext = '',
): Promise<unknown> {
  const logger = createLogger(
    pluginParams,
    'FileFieldTranslation.translateSingleFileMetadata',
  );

  if (!fileValue || typeof fileValue !== 'object') {
    logger.info('No valid file object to translate');
    return fileValue;
  }

  const fileObj = fileValue as Record<string, unknown>;
  const metadata =
    fileObj.metadata &&
    typeof fileObj.metadata === 'object' &&
    !Array.isArray(fileObj.metadata)
      ? (fileObj.metadata as Record<string, unknown>)
      : undefined;

  const { altSource, titleSource } = await resolveAltAndTitle(
    fileObj,
    metadata,
    fromLocale,
    apiToken,
    environment,
    logger,
  );

  const entries = collectFileMetadataEntries(
    metadata,
    typeof altSource === 'string' ? altSource : undefined,
    typeof titleSource === 'string' ? titleSource : undefined,
  );

  if (entries.length === 0) {
    logger.info('No translatable alt/title or metadata found');
    return fileValue;
  }

  logger.info('Translating file metadata', {
    alt: altSource,
    title: titleSource,
    metadataKeys: metadata ? Object.keys(metadata) : [],
  });

  try {
    const values = entries.map((entry) => entry.value);
    const translatedValues = await translateArray(
      provider,
      pluginParams,
      values,
      fromLocale,
      toLocale,
      { isHTML: false, recordContext },
    );

    return applyTranslatedFileEntries(
      entries,
      translatedValues,
      fileObj,
      metadata,
    );
  } catch (error) {
    handleTranslationError(
      error,
      provider.vendor,
      logger,
      'File metadata translation error',
    );
  }
}
