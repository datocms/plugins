/**
 * FileFieldTranslation.ts
 * ------------------------------------------------------
 * This module handles translation of metadata associated with file fields in DatoCMS,
 * such as alt text, title, and other custom metadata fields that may be attached
 * to file uploads. It supports both single file fields and gallery (array of files) fields.
 * 
 * The module provides functionality to:
 * - Extract translatable metadata from file objects
 * - Process both single files and galleries (collections of files)
 * - Preserve file structure while updating only the relevant metadata
 * - Stream translation progress back to the UI
 */

import type { TranslationProvider, StreamCallbacks } from './types';
import { normalizeProviderError } from './ProviderErrors';
import type { ctxParamsType } from '../../entrypoints/Config/ConfigScreen';
import { createLogger } from '../logging/Logger';

/**
 * Translates metadata for file and gallery fields
 * 
 * This function handles both single file fields and gallery fields (arrays of files).
 * It extracts the metadata from each file object, translates text-based metadata fields,
 * and reconstructs the file objects with the translated metadata while preserving
 * other properties like URLs, dimensions, etc.
 * 
 * @param fieldValue - The file or gallery field data to translate
 * @param pluginParams - Plugin configuration parameters
 * @param toLocale - Target locale code for translation
 * @param fromLocale - Source locale code for translation
 * @param provider - TranslationProvider instance used for translation
 * @param _streamCallbacks - Optional callbacks for streaming progress updates
 * @param recordContext - Optional context about the record to improve translation quality
 * @returns Updated file field data with translated metadata
 */
export async function translateFileFieldValue(
  fieldValue: unknown,
  pluginParams: ctxParamsType,
  toLocale: string,
  fromLocale: string,
  provider: TranslationProvider,
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
    _streamCallbacks,
    recordContext
  );
}

/**
 * Translates metadata for a single file object
 * 
 * This function extracts text-based metadata fields from a file object,
 * translates them using the provider, and then merges the translated metadata
 * back into the original file object, preserving all non-metadata properties.
 * It only translates string-type metadata values, leaving other types untouched.
 * 
 * @param fileValue - The file object containing metadata to translate
 * @param pluginParams - Plugin configuration parameters
 * @param toLocale - Target locale code for translation
 * @param fromLocale - Source locale code for translation
 * @param provider - TranslationProvider instance used for translation
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
  const metadata = fileObj.metadata as Record<string, unknown>;

  if (!metadata) {
    logger.info('No metadata found in file object');
    return fileValue;
  }

  // Extract translatable metadata fields
  const metadataToTranslate: Record<string, unknown> = {};
  for (const key in metadata) {
    // Only include string values for translation
    if (metadata[key] && typeof metadata[key] === 'string') {
      metadataToTranslate[key] = metadata[key];
    }
  }

  // If no translatable metadata, return as is
  if (Object.keys(metadataToTranslate).length === 0) {
    logger.info('No translatable string metadata found');
    return fileValue;
  }

  logger.info('Translating file metadata', metadataToTranslate);

  // No display names needed for array helper path

  try {
    const keys = Object.keys(metadataToTranslate);
    const values = keys.map((k) => String(metadataToTranslate[k] ?? ''));
    const { translateArray } = await import('./translateArray');
    const translatedValues = await translateArray(provider, pluginParams, values, fromLocale, toLocale, { isHTML: false, recordContext });
    const translatedMetadata = keys.reduce((acc, key, idx) => { acc[key] = translatedValues[idx]; return acc; }, {} as Record<string, unknown>);

    // Update the original file object with translated metadata
    return {
      ...fileObj,
      metadata: {
        ...metadata,
        ...translatedMetadata,
      },
    };
  } catch (error) {
    const normalized = normalizeProviderError(error, provider.vendor);
    logger.error('File metadata translation error', { message: normalized.message, code: normalized.code, hint: normalized.hint });
    throw new Error(normalized.message);
  }
}
