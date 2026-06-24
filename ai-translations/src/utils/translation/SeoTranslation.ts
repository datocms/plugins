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

import locale from 'locale-codes';
import type { ctxParamsType } from '../../entrypoints/Config/ConfigScreen';
import { createLogger } from '../logging/Logger';
import { handleTranslationError } from './ProviderErrors';
import type { OnQcFlag } from './qc/types';
import { translateArray } from './translateArray';
import type { StreamCallbacks, TranslationProvider } from './types';

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
  recordContext = '',
  onQcFlag?: OnQcFlag,
): Promise<SeoObject> {
  const logger = createLogger(pluginParams, 'translateSeoFieldValue');
  logger.info('Starting SEO field translation', { fromLocale, toLocale });

  if (!fieldValue) {
    return { title: '', description: '' };
  }

  // Translate against a separate snapshot, never the input reference. The
  // input object can be the source-locale value in a localized field (e.g.
  // formValues.seo.en) which the "Translate to all locales" loop re-reads
  // on every iteration — mutating it would corrupt subsequent iterations
  // and the source locale itself.
  const sourceTitle = fieldValue.title || '';
  const sourceDescription = fieldValue.description || '';

  logger.info('SEO object to translate', {
    title: sourceTitle,
    description: sourceDescription,
  });

  try {
    // Extract language names for better prompt clarity
    const fromLocaleName = locale.getByTag(fromLocale)?.name || fromLocale;
    const toLocaleName = locale.getByTag(toLocale)?.name || toLocale;

    logger.info(`Translating from ${fromLocaleName} to ${toLocaleName}`);

    // Base prompt with replaceable placeholders
    const prompt = (pluginParams.prompt || '')
      .replace(
        '{fieldValue}',
        JSON.stringify({ title: sourceTitle, description: sourceDescription }),
      )
      .replace('{fromLocale}', fromLocaleName)
      .replace('{toLocale}', toLocaleName)
      .replace(
        '{recordContext}',
        recordContext || 'Record context: No additional context available.',
      );

    // Using template literal as per linting rules
    const formattedPrompt = `${prompt}\n${fieldTypePrompt}`;
    logger.info('Formatted prompt prepared for translation');
    // Log prompt only when debugging is enabled
    logger.logPrompt('SEO translation prompt', formattedPrompt);

    // Translate via array helper for parity across vendors
    const [titleT, descT] = await translateArray(
      provider,
      pluginParams,
      [sourceTitle, sourceDescription],
      fromLocale,
      toLocale,
      { isHTML: false, recordContext, onQcFlag, qcAtomicSegments: true },
    );

    // Build a fresh result preserving any non-translated properties (e.g.
    // `image`, `twitterCard`) without mutating the caller's object.
    const result: SeoObject = { ...fieldValue };

    let translatedTitle = titleT || sourceTitle;
    if (translatedTitle.length > SEO_TITLE_MAX_LENGTH) {
      logger.info(
        `SEO title exceeds ${SEO_TITLE_MAX_LENGTH} character limit (${translatedTitle.length}). Truncating...`,
      );
      translatedTitle = `${translatedTitle.substring(0, SEO_TITLE_MAX_LENGTH - ELLIPSIS_OFFSET)}...`;
    }

    let translatedDescription = descT || sourceDescription;
    if (translatedDescription.length > SEO_DESCRIPTION_MAX_LENGTH) {
      logger.info(
        `SEO description exceeds ${SEO_DESCRIPTION_MAX_LENGTH} character limit (${translatedDescription.length}). Truncating...`,
      );
      translatedDescription = `${translatedDescription.substring(0, SEO_DESCRIPTION_MAX_LENGTH - ELLIPSIS_OFFSET)}...`;
    }

    result.title = translatedTitle;
    result.description = translatedDescription;

    logger.info('SEO translation completed successfully');
    return result;
  } catch (error) {
    // DRY-001: Use centralized error handler
    handleTranslationError(
      error,
      provider.vendor,
      logger,
      'SEO translation error',
    );
  }
}
