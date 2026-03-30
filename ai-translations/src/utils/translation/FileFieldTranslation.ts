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

import type { TranslationProvider, StreamCallbacks } from './types';
import { buildClient } from '@datocms/cma-client-browser';
import { handleTranslationError } from './ProviderErrors';
import type { ctxParamsType } from '../../entrypoints/Config/ConfigScreen';
import { createLogger } from '../logging/Logger';
import { translateArray } from './translateArray';
import { findExactLocaleKey } from './SharedFieldUtils';

type UploadDefaultFieldMetadata = Record<string, { alt?: string; title?: string }>;

const uploadDefaultMetadataCache = new Map<string, Promise<UploadDefaultFieldMetadata | undefined>>();

async function fetchUploadDefaultMetadata(
  uploadId: string,
  apiToken: string,
  environment: string,
  logger: ReturnType<typeof createLogger>
): Promise<UploadDefaultFieldMetadata | undefined> {
  const cacheKey = `${environment}:${uploadId}`;
  const cached = uploadDefaultMetadataCache.get(cacheKey);
  if (cached) return cached;

  const fetchPromise = (async () => {
    try {
      const client = buildClient({ apiToken, environment });
      const upload = await client.uploads.find(uploadId);
      const metadata = (upload as { default_field_metadata?: unknown }).default_field_metadata;
      if (!metadata || typeof metadata !== 'object') {
        return undefined;
      }
      return metadata as UploadDefaultFieldMetadata;
    } catch (error) {
      logger.warning('Failed to fetch upload default metadata', { uploadId, error });
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
  recordContext = ''
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
          recordContext
        );
      })
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
    recordContext
  );
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
async function translateSingleFileMetadata(
  fileValue: unknown,
  pluginParams: ctxParamsType,
  toLocale: string,
  fromLocale: string,
  provider: TranslationProvider,
  apiToken?: string,
  environment?: string,
  _streamCallbacks?: StreamCallbacks,
  recordContext = ''
): Promise<unknown> {
  // Create logger for this function
  const logger = createLogger(pluginParams, 'FileFieldTranslation.translateSingleFileMetadata');
  
  // If not an object with metadata, return as is
  if (!fileValue || typeof fileValue !== 'object') {
    logger.info('No valid file object to translate');
    return fileValue;
  }

  const fileObj = fileValue as Record<string, unknown>;
  const metadata =
    fileObj.metadata && typeof fileObj.metadata === 'object' && !Array.isArray(fileObj.metadata)
      ? (fileObj.metadata as Record<string, unknown>)
      : undefined;

  const entries: Array<{ kind: 'alt' | 'title' | 'metadata'; key?: string; value: string }> = [];

  const altFromFile = typeof fileObj.alt === 'string' ? fileObj.alt : undefined;
  const altFromMetadata = typeof metadata?.alt === 'string' ? metadata.alt : undefined;
  const titleFromFile = typeof fileObj.title === 'string' ? fileObj.title : undefined;
  const titleFromMetadata = typeof metadata?.title === 'string' ? metadata.title : undefined;

  const pickNonEmpty = (primary?: string, fallback?: string) => {
    if (primary && primary.trim()) return primary;
    if (fallback && fallback.trim()) return fallback;
    return undefined;
  };

  let altSource = pickNonEmpty(altFromFile, altFromMetadata);
  let titleSource = pickNonEmpty(titleFromFile, titleFromMetadata);

  const uploadId =
    typeof fileObj.upload_id === 'string'
      ? fileObj.upload_id
      : typeof fileObj.uploadId === 'string'
        ? fileObj.uploadId
        : undefined;

  if ((!altSource || !titleSource) && uploadId && apiToken && environment) {
    const defaultMetadata = await fetchUploadDefaultMetadata(uploadId, apiToken, environment, logger);
    if (defaultMetadata) {
      const localeKey = findExactLocaleKey(defaultMetadata as Record<string, unknown>, fromLocale);
      const localeMetadata = localeKey ? defaultMetadata[localeKey] : undefined;
      if (localeMetadata && typeof localeMetadata === 'object') {
        if (!altSource && typeof localeMetadata.alt === 'string' && localeMetadata.alt.trim()) {
          altSource = localeMetadata.alt;
        }
        if (!titleSource && typeof localeMetadata.title === 'string' && localeMetadata.title.trim()) {
          titleSource = localeMetadata.title;
        }
      }
    }
  }

  const altValue = typeof altSource === 'string' ? altSource : undefined;
  const titleValue = typeof titleSource === 'string' ? titleSource : undefined;
  const hasAltEntry = typeof altValue === 'string';
  const hasTitleEntry = typeof titleValue === 'string';

  if (altValue) {
    entries.push({ kind: 'alt', value: altValue });
  }
  if (titleValue) {
    entries.push({ kind: 'title', value: titleValue });
  }

  if (metadata) {
    for (const [key, value] of Object.entries(metadata)) {
      // Avoid double-translating alt/title when handled above
      if ((key === 'alt' && hasAltEntry) || (key === 'title' && hasTitleEntry)) {
        continue;
      }
      if (value && typeof value === 'string') {
        entries.push({ kind: 'metadata', key, value });
      }
    }
  }

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
    const translatedValues = await translateArray(provider, pluginParams, values, fromLocale, toLocale, {
      isHTML: false,
      recordContext,
    });

    let metadataOut: Record<string, unknown> | undefined = metadata ? { ...metadata } : undefined;
    const fileOut: Record<string, unknown> = { ...fileObj };

    translatedValues.forEach((translated, idx) => {
      const entry = entries[idx];
      if (!entry) return;
      switch (entry.kind) {
        case 'alt':
          fileOut.alt = translated;
          if (metadataOut && 'alt' in metadataOut) {
            metadataOut.alt = translated;
          }
          break;
        case 'title':
          fileOut.title = translated;
          if (metadataOut && 'title' in metadataOut) {
            metadataOut.title = translated;
          }
          break;
        case 'metadata':
          if (!metadataOut) metadataOut = {};
          metadataOut[entry.key as string] = translated;
          break;
        default:
          break;
      }
    });

    if (metadataOut) {
      fileOut.metadata = metadataOut;
    }

    return fileOut;
  } catch (error) {
    // DRY-001: Use centralized error handler
    handleTranslationError(error, provider.vendor, logger, 'File metadata translation error');
  }
}
