/**
 * SeoTranslation.ts
 * ------------------------------------------------------
 * This module handles the translation of SEO field values in DatoCMS.
 * SEO fields are structured objects that typically contain title and
 * description properties, which need specialized handling during translation
 * to maintain their structure while updating their content.
 * 
 * The module provides functionality to:
 * - Parse SEO field objects
 * - Maintain field structure during translation
 * - Format localized SEO content for better user experience
 */

import type { TranslationProvider, StreamCallbacks } from './types';
import { normalizeProviderError } from './ProviderErrors';
import locale from 'locale-codes';
import type { ctxParamsType } from '../../entrypoints/Config/ConfigScreen';
import { createLogger } from '../logging/Logger';

/**
 * SEO field character limits as recommended by search engines.
 * Title should be under 60 characters for optimal display in search results.
 * Description should be under 160 characters to avoid truncation.
 */
const SEO_TITLE_MAX_LENGTH = 60;
const SEO_DESCRIPTION_MAX_LENGTH = 160;
const ELLIPSIS_OFFSET = 3; // Reserve space for "..."

/**
 * Interface for SEO field object structure
 */
export interface SeoObject {
  title?: string;
  description?: string;
  [key: string]: unknown;
}

/**
 * Translates SEO field values while preserving their object structure
 * 
 * This function extracts the title and description from an SEO object,
 * translates them using the provider, and reconstructs the object with the
 * translated values. It handles streaming updates for UI feedback and
 * uses record context to improve translation quality when available.
 *
 * @param fieldValue - The SEO field object to translate
 * @param pluginParams - Plugin configuration parameters
 * @param toLocale - Target locale code for translation
 * @param fromLocale - Source locale code for translation
 * @param provider - TranslationProvider instance
 * @param fieldTypePrompt - Additional prompt for SEO format instructions
 * @param _streamCallbacks - Optional callbacks for streaming updates
 * @param recordContext - Optional context about the record being translated
 * @returns The translated SEO object
 */
export async function translateSeoFieldValue(
  fieldValue: SeoObject | undefined | null,
  pluginParams: ctxParamsType,
  toLocale: string,
  fromLocale: string,
  provider: TranslationProvider,
  fieldTypePrompt: string,
  _streamCallbacks?: StreamCallbacks,
  recordContext = ''
): Promise<SeoObject> {
  const logger = createLogger(pluginParams, 'translateSeoFieldValue');
  logger.info('Starting SEO field translation', { fromLocale, toLocale });

  if (!fieldValue) {
    return { title: '', description: '' };
  }
  
  const seoObject = fieldValue;
  const seoObjectToTranslate = {
    title: seoObject.title || '',
    description: seoObject.description || '',
  };
  
  logger.info('SEO object to translate', seoObjectToTranslate);

  try {
    // Extract language names for better prompt clarity
    const fromLocaleName = locale.getByTag(fromLocale)?.name || fromLocale;
    const toLocaleName = locale.getByTag(toLocale)?.name || toLocale;
    
    logger.info(`Translating from ${fromLocaleName} to ${toLocaleName}`);

    // Base prompt with replaceable placeholders
    const prompt = (pluginParams.prompt || '')
      .replace('{fieldValue}', JSON.stringify(seoObjectToTranslate))
      .replace('{fromLocale}', fromLocaleName)
      .replace('{toLocale}', toLocaleName)
      .replace('{recordContext}', recordContext || 'Record context: No additional context available.');

    // Using template literal as per linting rules
    const formattedPrompt = `${prompt}\n${fieldTypePrompt}`;
    logger.info('Formatted prompt prepared for translation');
    // Log prompt only when debugging is enabled
    logger.logPrompt('SEO translation prompt', formattedPrompt);

    // Translate via array helper for parity across vendors
    const { translateArray } = await import('./translateArray');
    const [titleT, descT] = await translateArray(
      provider,
      pluginParams,
      [seoObjectToTranslate.title, seoObjectToTranslate.description],
      fromLocale,
      toLocale,
      { isHTML: false, recordContext }
    );
    const returnedSeoObject: SeoObject = { title: titleT, description: descT };

    // Update the original seoObject
    // Enforce character limits for SEO content
    if (returnedSeoObject.title && returnedSeoObject.title.length > SEO_TITLE_MAX_LENGTH) {
      logger.info(`SEO title exceeds ${SEO_TITLE_MAX_LENGTH} character limit (${returnedSeoObject.title.length}). Truncating...`);
      returnedSeoObject.title = `${returnedSeoObject.title.substring(0, SEO_TITLE_MAX_LENGTH - ELLIPSIS_OFFSET)}...`;
    }
    
    if (returnedSeoObject.description && returnedSeoObject.description.length > SEO_DESCRIPTION_MAX_LENGTH) {
      logger.info(`SEO description exceeds ${SEO_DESCRIPTION_MAX_LENGTH} character limit (${returnedSeoObject.description.length}). Truncating...`);
      returnedSeoObject.description = `${returnedSeoObject.description.substring(0, SEO_DESCRIPTION_MAX_LENGTH - ELLIPSIS_OFFSET)}...`;
    }
    
    seoObject.title = (returnedSeoObject.title as string) || (seoObject.title as string);
    seoObject.description = (returnedSeoObject.description as string) || (seoObject.description as string);
    
    logger.info('SEO translation completed successfully');
    return seoObject;
  } catch (error) {
    const normalized = normalizeProviderError(error, provider.vendor);
    logger.error('SEO translation error', { message: normalized.message, code: normalized.code, hint: normalized.hint });
    throw new Error(normalized.message);
  }
}
