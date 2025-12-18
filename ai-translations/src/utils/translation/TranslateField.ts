/**
 * TranslateField.ts
 * ------------------------------------------------------
 * This module serves as the main orchestrator for the AI translation system.
 * It coordinates the logic for translating various field types in DatoCMS by
 * delegating to specialized translator modules based on field type.
 * 
 * The module handles field type detection and routing to the appropriate
 * specialized translators for complex fields like SEO, structured text,
 * rich text, and file fields.
 */

import type { TranslationProvider, StreamCallbacks } from './types';
import { buildClient } from '@datocms/cma-client-browser';
import type { ExecuteFieldDropdownActionCtx } from 'datocms-plugin-sdk';
import { 
  type ctxParamsType,
  modularContentVariations,
} from '../../entrypoints/Config/ConfigScreen';
import { fieldPrompt } from '../../prompts/FieldPrompts';
import { isFieldTranslatable } from './SharedFieldUtils';
import { translateDefaultFieldValue } from './DefaultTranslation';
import { type SeoObject, translateSeoFieldValue } from './SeoTranslation';
import { translateStructuredTextValue } from './StructuredTextTranslation';
import { translateFileFieldValue } from './FileFieldTranslation';
import { deleteItemIdKeys } from './utils';
import { createLogger } from '../logging/Logger';
import { getProvider } from './ProviderFactory';
import { normalizeProviderError } from './ProviderErrors';

// Re-export StreamCallbacks for backwards compatibility
export type { StreamCallbacks } from './types';

/**
 * Routes field translation to the appropriate specialized translator based on field type
 * 
 * This function serves as the primary decision point for determining which translator
 * to use for a given field. It examines the field type and delegates to specialized
 * translators for complex fields (SEO, structured text, etc.) or falls back to the
 * default translator for simple field types.
 * 
 * @param fieldValue - The value of the field to translate
 * @param pluginParams - Plugin configuration parameters
 * @param toLocale - Target locale code
 * @param fromLocale - Source locale code
 * @param fieldType - The DatoCMS field type
 * @param provider - TranslationProvider instance
 * @param fieldTypePrompt - Additional prompt for special field types
 * @param apiToken - DatoCMS API token
 * @param fieldId - ID of the field being translated
 * @param environment - Dato environment for any API lookups
 * @param streamCallbacks - Optional callbacks for streaming translations
 * @param recordContext - Additional context about the record being translated
 * @returns The translated field value
 */
export async function translateFieldValue(
  fieldValue: unknown,
  pluginParams: ctxParamsType,
  toLocale: string,
  fromLocale: string,
  fieldType: string,
  provider: TranslationProvider,
  fieldTypePrompt: string,
  apiToken: string,
  fieldId: string | undefined,
  environment: string,
  streamCallbacks?: StreamCallbacks,
  recordContext = ''
): Promise<unknown> {
  const logger = createLogger(pluginParams, 'translateFieldValue');
  
  logger.info(`Translating field of type: ${fieldType}`, { fromLocale, toLocale });
  
  // Convert fieldId to a string to handle the undefined case
  const safeFieldId = fieldId || '';

  if (pluginParams.apiKeysToBeExcludedFromThisPlugin.includes(safeFieldId)) {
    return fieldValue;
  }

  // If this field type is not in the plugin config or has no value, return as is
  const fieldTranslatable = isFieldTranslatable(
    fieldType,
    pluginParams.translationFields,
    modularContentVariations
  );

  if (!fieldTranslatable || !fieldValue) {
    return fieldValue;
  }

  switch (fieldType) {
    case 'seo':
      return translateSeoFieldValue(
        fieldValue as SeoObject,
        pluginParams,
        toLocale,
        fromLocale,
        provider,
        fieldTypePrompt,
        streamCallbacks,
        recordContext
      );
    case 'structured_text':
      return translateStructuredTextValue(
        fieldValue,
        pluginParams,
        toLocale,
        fromLocale,
        provider,
        apiToken,
        environment,
        streamCallbacks,
        recordContext
      );
    case 'rich_text':
    case 'framed_single_block':
      return translateBlockValue(
        fieldValue,
        pluginParams,
        toLocale,
        fromLocale,
        provider,
        apiToken,
        fieldType,
        environment,
        streamCallbacks,
        recordContext
      );
    case 'file':
    case 'gallery':
      return translateFileFieldValue(
        fieldValue,
        pluginParams,
        toLocale,
        fromLocale,
        provider,
        streamCallbacks,
        recordContext
      );
    default:
      return translateDefaultFieldValue(
        fieldValue,
        pluginParams,
        toLocale,
        fromLocale,
        provider,
        streamCallbacks,
        recordContext
      );
  }
}

/**
 * Module-level cache for block field metadata.
 * Avoids repeated CMA calls when translating multiple blocks of the same type.
 */
const blockFieldsCache = new Map<string, Record<string, { editor: string; id: string }>>();

/**
 * Translates modular content and framed block fields
 * 
 * This specialized translator handles block-based content structures,
 * including nested fields within blocks. It dynamically fetches field metadata
 * for each block and processes each field according to its type.
 * 
 * @param fieldValue - The block value to translate
 * @param pluginParams - Plugin configuration parameters
 * @param toLocale - Target locale code
 * @param fromLocale - Source locale code
 * @param provider - TranslationProvider instance
 * @param apiToken - DatoCMS API token
 * @param fieldType - The specific block field type
 * @param environment - Dato environment
 * @param streamCallbacks - Optional callbacks for streaming translations
 * @param recordContext - Additional context about the record being translated
 * @returns The translated block value
 */
async function translateBlockValue(
  fieldValue: unknown,
  pluginParams: ctxParamsType,
  toLocale: string,
  fromLocale: string,
  provider: TranslationProvider,
  apiToken: string,
  fieldType: string,
  environment: string,
  streamCallbacks?: StreamCallbacks,
  recordContext = ''
) {
  const logger = createLogger(pluginParams, 'translateBlockValue');
  logger.info('Translating block value');
  
  const isFramedSingleBlock = fieldType === 'framed_single_block';
  // Clean block array from any leftover item IDs
  const cleanedFieldValue = deleteItemIdKeys(
    !isFramedSingleBlock ? fieldValue : [fieldValue]
  ) as Array<Record<string, unknown>>;

  const client = buildClient({ apiToken, environment });

  for (const block of cleanedFieldValue) {
    // Determine the block model ID
    // biome-ignore lint/suspicious/noExplicitAny: <i need to type blocks here>
    const blockModelId = block.itemTypeId || block.blockModelId || (block as any)?.relationships?.item_type?.data?.id ||(block as any)?.item?.relationships?.item_type?.data?.id;
    if (!blockModelId) {
      logger.warning('Block model ID not found', block);
      continue;
    }

    // Fetch fields for this specific block (with memoization)
    let fieldTypeDictionary = blockFieldsCache.get(String(blockModelId));
    if (!fieldTypeDictionary) {
      const fields = await client.fields.list(blockModelId as string);
      fieldTypeDictionary = fields.reduce((acc, field) => {
        acc[field.api_key] = {
          editor: field.appearance.editor,
          id: field.id,
        };
        return acc;
      }, {} as Record<string, { editor: string; id: string }>);
      blockFieldsCache.set(String(blockModelId), fieldTypeDictionary);
    }

    // Translate each field within the block
    if (block.attributes) {
      // Process fields in block.attributes
      await processBlockFields(block.attributes as Record<string, unknown>, fieldTypeDictionary);
    // biome-ignore lint/suspicious/noExplicitAny: <i need to type blocks here>
    } else if ((block as any).item?.attributes) {
      // biome-ignore lint/suspicious/noExplicitAny: <i need to type blocks here>
      await processBlockFields((block as any).item.attributes as Record<string, unknown>, fieldTypeDictionary);
    } else {
      await processBlockFields(block, fieldTypeDictionary);
    }

    // Helper function to process fields and avoid code duplication
    async function processBlockFields(
      source: Record<string, unknown>,
      fieldTypeDictionary: Record<string, { editor: string; id: string }>
    ) {
      for (const field in source) {
        if (
          field === 'itemTypeId' ||
          field === 'originalIndex' ||
          field === 'blockModelId' ||
          field === 'type' ||
          field === 'children' ||
          field === "relationships" ||
          field === "attributes" // Skip the attributes object itself
        ) {
          continue;
        }

        // Show progress if using streaming callbacks
        if (streamCallbacks?.onStream) {
          streamCallbacks.onStream(`Translating block field: ${field}...`);
        }
        
        // Check for cancellation
        if (streamCallbacks?.checkCancellation?.()) {
          logger.info('Translation cancelled by user');
          return cleanedFieldValue;
        }

        let nestedPrompt = ' Return the response in the format of ';
        nestedPrompt +=
          fieldPrompt[fieldTypeDictionary[field]?.editor as keyof typeof fieldPrompt] ||
          '';

        source[field] = await translateFieldValue(
          source[field],
          pluginParams,
          toLocale,
          fromLocale,
          fieldTypeDictionary[field]?.editor || 'text',
          provider,
          nestedPrompt,
          apiToken,
          fieldTypeDictionary[field]?.id || '',
          environment,
          streamCallbacks,
          recordContext
        );
      }
    }
  }

  logger.info('Block translation completed');
  return isFramedSingleBlock ? cleanedFieldValue[0] : cleanedFieldValue;
}

/**
 * Main entry point for translating a field value from one locale to another
 * 
 * This function is the primary interface called by the DatoCMS plugin UI.
 * It handles all the setup, including creating a provider client, generating
 * record context, and managing streaming responses back to the UI.
 * 
 * @param fieldValue - The field value to translate
 * @param ctx - DatoCMS plugin context
 * @param pluginParams - Plugin configuration parameters
 * @param toLocale - Target locale code
 * @param fromLocale - Source locale code
 * @param fieldType - The DatoCMS field type
 * @param environment - Dato environment
 * @param streamCallbacks - Optional callbacks for streaming translations
 * @param recordContext - Additional context about the record being translated
 * @returns The translated field value
 */
async function TranslateField(
  fieldValue: unknown,
  ctx: ExecuteFieldDropdownActionCtx,
  pluginParams: ctxParamsType,
  toLocale: string,
  fromLocale: string,
  fieldType: string,
  environment: string,
  streamCallbacks?: StreamCallbacks,
  recordContext = ''
) {
  const apiToken = await ctx.currentUserAccessToken;
  // Resolve provider (OpenAI for now; vendor-agnostic interface)
  const provider = getProvider(pluginParams);
  const logger = createLogger(pluginParams, 'TranslateField');

  try {
    logger.info('Starting field translation', { fieldType, fromLocale, toLocale });

    // Generate record context if not provided or use the existing one
    const contextToUse = ctx.formValues && !recordContext
      ? generateRecordContext(ctx.formValues, fromLocale)
      : recordContext;

    if (streamCallbacks?.onStream) {
      streamCallbacks.onStream('Loading...');
    }

    // Get the field API key and ensure it's always a string
    // Using nullish coalescing operator to handle undefined value
    const fieldApiKey = ctx.fieldPath ?? '';

    let fieldTypePrompt = 'Return the response in the format of ';
    const fieldPromptObject = fieldPrompt;
    const baseFieldPrompts = fieldPromptObject ? fieldPromptObject : {};
    
    // Structured and rich text fields use specialized prompts defined elsewhere
    if (fieldType !== 'structured_text' && fieldType !== 'rich_text') {
      fieldTypePrompt +=
        baseFieldPrompts[fieldType as keyof typeof baseFieldPrompts] || '';
    }
  

    const translatedValue = await translateFieldValue(
      fieldValue,
      pluginParams,
      toLocale,
      fromLocale,
      fieldType,
      provider,
      fieldTypePrompt,
      apiToken as string,
      fieldApiKey, // This is already a string because of the nullish coalescing operator
      environment,
      streamCallbacks,
      contextToUse
    );

    logger.info('Field translation completed');
    return translatedValue;
  } catch (error) {
    const normalized = normalizeProviderError(error, provider.vendor);
    logger.error('Translation failed', { message: normalized.message, code: normalized.code, hint: normalized.hint });
    throw new Error(normalized.message);
  }
}

/**
 * Generates descriptive context about a record to improve translation accuracy
 * 
 * This function extracts key information from a record's source locale values
 * to provide context for the AI model, helping it understand the content
 * it's translating. It focuses on title, name, and content fields.
 * 
 * @param formValues - The current form values from DatoCMS
 * @param sourceLocale - The source locale code
 * @returns Formatted context string for use in translation prompts
 */
export function generateRecordContext(formValues: Record<string, unknown>, sourceLocale: string): string {
  if (!formValues) return '';

  let contextStr = 'Content context: ';
  let hasAddedContext = false;

  // Look for values that might represent titles, names, or main content
  for (const key in formValues) {
    const val = formValues[key];
    // Only use string values from the source locale
    if (typeof val === 'object' && val !== null) {
      const localized = val as Record<string, unknown>;
      if (typeof localized[sourceLocale] === 'string') {
        const value = localized[sourceLocale] as string;
        if (value && value.length < 300) {
          // Focus on fields likely to contain important context
          if (
            key.toLowerCase().includes('title') ||
            key.toLowerCase().includes('name') ||
            key.toLowerCase().includes('content') ||
            key.toLowerCase().includes('description')
          ) {
            contextStr += `${key}: ${value}. `;
            hasAddedContext = true;
          }
        }
      }
    }
  }

  return hasAddedContext ? contextStr : '';
}

// Re-export findExactLocaleKey for backwards compatibility
export { findExactLocaleKey } from './SharedFieldUtils';

export default TranslateField;
