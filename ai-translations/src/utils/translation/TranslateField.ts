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
 *
 * ## Entry Points
 *
 * This module provides two main entry points:
 *
 * 1. **`TranslateField()`** (default export)
 *    - Used by field dropdown actions in the DatoCMS UI
 *    - Requires `ExecuteFieldDropdownActionCtx` from the plugin SDK
 *    - Handles form values, streaming UI updates, and provider resolution
 *
 * 2. **`translateFieldValueDirect()`** (named export)
 *    - Context-free entry point for CMA-based flows and testing
 *    - No dependency on DatoCMS plugin SDK context
 *    - Used by `ItemsDropdownUtils.ts` for bulk/modal translation
 *    - Can be tested without mocking the full DatoCMS context
 *
 * Both entry points ultimately delegate to `translateFieldValue()` which
 * routes to specialized translators based on field type.
 *
 * ## Circular Dependency Note
 *
 * This module has a circular import relationship with StructuredTextTranslation.ts:
 * - TranslateField imports translateStructuredTextValue from StructuredTextTranslation
 * - StructuredTextTranslation imports translateFieldValue from TranslateField
 *
 * This is intentional and necessary because:
 * - Structured text fields can contain blocks (handled by TranslateField)
 * - Blocks within structured text need to translate their nested fields recursively
 *
 * TypeScript handles this correctly at build time. The circular dependency is
 * a natural consequence of DatoCMS's recursive content structure.
 */

import { buildDatoCMSClient } from '../clients';
import type { ExecuteFieldDropdownActionCtx } from 'datocms-plugin-sdk';
import type { ctxParamsType } from '../../entrypoints/Config/ConfigScreen';
import { modularContentVariations } from '../../entrypoints/Config/configConstants';
import { fieldPrompt } from '../../prompts/FieldPrompts';
import { createLogger, type Logger } from '../logging/Logger';
import {
  type BlockFieldMeta,
  getBlockFieldsFromRepo,
  type SchemaRepository,
} from '../schemaRepository';
import { checkCancellation } from './Cancellation';
import { cloneContent } from './ContentIntegrity';
import { translateDefaultFieldValue } from './DefaultTranslation';
import { translateFileFieldValue } from './FileFieldTranslation';
import { handleTranslationError } from './ProviderErrors';
import { getProvider } from './ProviderFactory';
import { type SeoObject, translateSeoFieldValue } from './SeoTranslation';
import {
  findExactLocaleKey,
  getExactSourceValue,
  isFieldExcluded,
  isFieldTranslatable,
  isReferenceField,
  normalizeTranslatedSlug,
  prepareFieldTypePrompt,
} from './SharedFieldUtils';
import { translateStructuredTextValue } from './StructuredTextTranslation';
import type { StreamCallbacks, TranslationProvider } from './types';

/**
 * Block structure that may contain relationships with item_type data.
 * Used for accessing block model ID from various block formats.
 */
interface BlockRelationships {
  item_type?: {
    data?: {
      id?: string;
    };
  };
}

/**
 * Represents a block with potential nested item structure.
 * Supports both direct attributes and nested item.attributes patterns.
 */
interface BlockWithItem {
  item?: {
    attributes?: Record<string, unknown>;
    item_type?: { id?: string };
    relationships?: BlockRelationships;
  };
  relationships?: BlockRelationships;
}

/**
 * Combined block type supporting all possible block structures in DatoCMS.
 */
type DatoCMSBlock = Record<string, unknown> & {
  itemTypeId?: string;
  blockModelId?: string;
  attributes?: Record<string, unknown>;
  item_type?: { id?: string };
} & BlockWithItem;

/**
 * Type guard to check if a block has nested item structure.
 *
 * @param block - The block to check.
 * @returns True if block has item.attributes structure.
 */
function hasNestedItem(
  block: DatoCMSBlock,
): block is DatoCMSBlock & { item: { attributes: Record<string, unknown> } } {
  return (
    block.item !== undefined &&
    typeof block.item === 'object' &&
    block.item !== null &&
    'attributes' in block.item &&
    block.item.attributes !== null &&
    typeof block.item.attributes === 'object'
  );
}

/**
 * Extracts the block model ID from various possible locations in a block structure.
 *
 * @param block - The block to extract the model ID from.
 * @returns The block model ID or undefined if not found.
 */
function extractBlockModelId(block: DatoCMSBlock): string | undefined {
  // Direct properties
  if (block.itemTypeId) return String(block.itemTypeId);
  if (block.blockModelId) return String(block.blockModelId);

  const simplifiedModelId = block.item_type?.id ?? block.item?.item_type?.id;
  if (simplifiedModelId) return simplifiedModelId;

  // From relationships
  const relationshipId = block.relationships?.item_type?.data?.id;
  if (relationshipId) return relationshipId;

  // From nested item relationships
  const nestedRelationshipId = block.item?.relationships?.item_type?.data?.id;
  if (nestedRelationshipId) return nestedRelationshipId;

  return undefined;
}

/**
 * Internal options used to fine-tune translation behavior for special cases.
 */
interface TranslateFieldValueOptions {
  bypassFieldTypeAllowlist?: boolean;
  fieldApiKey?: string;
  cmaBaseUrl?: string;
  contentAlreadyCloned?: boolean;
}

/**
 * Removes only wrapper-level identifiers from a block payload.
 *
 * @param block - The block payload to sanitize.
 * @returns A cloned block with wrapper identifiers removed.
 */
function stripBlockWrapperIdentifiers(block: DatoCMSBlock, contentAlreadyCloned = false): DatoCMSBlock {
  const clonedBlock = contentAlreadyCloned ? block : cloneContent(block);
  const wrapper = clonedBlock as Record<string, unknown>;

  delete wrapper.id;
  delete wrapper.itemId;

  if (wrapper.item && typeof wrapper.item === 'object') {
    delete (wrapper.item as Record<string, unknown>).id;
    delete (wrapper.item as Record<string, unknown>).itemId;
  }

  return clonedBlock;
}

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
 * @param schemaRepository - Optional SchemaRepository for cached schema lookups
 * @param options - Internal options for special-case translation flows
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
  recordContext = '',
  schemaRepository?: SchemaRepository,
  options: TranslateFieldValueOptions = {},
): Promise<unknown> {
  checkCancellation(streamCallbacks ?? {});
  const logger = createLogger(pluginParams, 'translateFieldValue');

  logger.info(`Translating field of type: ${fieldType}`, {
    fromLocale,
    toLocale,
  });
  logger.info('Source field payload', {
    fieldType,
    fieldId,
    fieldApiKey: options.fieldApiKey,
    fromLocale,
    toLocale,
    recordContext,
    value: fieldValue,
  });

  if (
    isFieldExcluded(pluginParams.apiKeysToBeExcludedFromThisPlugin, [
      fieldId,
      options.fieldApiKey,
    ])
  ) {
    logger.info('Skipping field translation', {
      reason: 'excluded',
      fieldType,
      fieldId,
      fieldApiKey: options.fieldApiKey,
      fromLocale,
      toLocale,
      value: fieldValue,
    });
    return fieldValue;
  }

  // If this field type is not in the plugin config or has no value, return as is
  const fieldTranslatable = isFieldTranslatable(
    fieldType,
    pluginParams.translationFields,
    modularContentVariations,
  );

  if (
    (!fieldTranslatable && !options.bypassFieldTypeAllowlist) ||
    !fieldValue
  ) {
    logger.info('Skipping field translation', {
      reason: !fieldValue ? 'empty-value' : 'field-type-not-enabled',
      fieldType,
      fieldId,
      fieldApiKey: options.fieldApiKey,
      fromLocale,
      toLocale,
      value: fieldValue,
    });
    return fieldValue;
  }

  // Record references are identities shared across locales, never prose.
  if (fieldType === 'link' || fieldType === 'links') return fieldValue;

  let translatedValue: unknown;

  switch (fieldType) {
    case 'seo':
      translatedValue = await translateSeoFieldValue(
        fieldValue as SeoObject,
        pluginParams,
        toLocale,
        fromLocale,
        provider,
        fieldTypePrompt,
        streamCallbacks,
        recordContext,
      );
      break;
    case 'structured_text':
      translatedValue = await translateStructuredTextValue(
        fieldValue,
        pluginParams,
        toLocale,
        fromLocale,
        provider,
        apiToken,
        environment,
        streamCallbacks,
        recordContext,
        schemaRepository,
        options.cmaBaseUrl,
        options.contentAlreadyCloned,
      );
      break;
    case 'rich_text':
    case 'single_block':
    case 'framed_single_block':
    case 'frameless_single_block':
      translatedValue = await translateBlockValue(
        fieldValue,
        pluginParams,
        toLocale,
        fromLocale,
        provider,
        apiToken,
        fieldType,
        environment,
        streamCallbacks,
        recordContext,
        schemaRepository,
        options.cmaBaseUrl,
        options.contentAlreadyCloned,
      );
      break;
    case 'file':
    case 'gallery':
      translatedValue = await translateFileFieldValue(
        fieldValue,
        pluginParams,
        toLocale,
        fromLocale,
        provider,
        apiToken,
        environment,
        streamCallbacks,
        recordContext,
        options.cmaBaseUrl,
      );
      break;
    default:
      translatedValue = await translateDefaultFieldValue(
        fieldValue,
        pluginParams,
        toLocale,
        fromLocale,
        provider,
        streamCallbacks,
        recordContext,
        { isHTML: fieldType === 'wysiwyg' },
      );
      break;
  }

  checkCancellation(streamCallbacks ?? {});
  if (fieldType === 'slug') {
    const normalizedSlug = normalizeTranslatedSlug(translatedValue);
    if (!normalizedSlug) {
      throw new Error('Translated slug is empty after normalization');
    }
    logger.info('Translated field payload', {
      fieldType,
      fieldId,
      fieldApiKey: options.fieldApiKey,
      fromLocale,
      toLocale,
      value: normalizedSlug,
    });
    return normalizedSlug;
  }

  logger.info('Translated field payload', {
    fieldType,
    fieldId,
    fieldApiKey: options.fieldApiKey,
    fromLocale,
    toLocale,
    value: translatedValue,
  });

  return translatedValue;
}

/**
 * Maximum number of block field entries to cache.
 * SMELL-004: Prevents unbounded cache growth.
 */
const BLOCK_FIELDS_CACHE_MAX_SIZE = 100;

/**
 * Module-level cache for block field metadata.
 * Avoids repeated CMA calls when translating multiple blocks of the same type.
 * Limited to BLOCK_FIELDS_CACHE_MAX_SIZE entries to prevent memory leaks.
 *
 * BUGFIX: We store Promises to prevent race conditions where multiple concurrent
 * requests for the same block model ID would all make API calls. By caching the
 * Promise itself, subsequent requests wait for the same pending request.
 */
const blockFieldsCache = new Map<
  string,
  Promise<Record<string, BlockFieldMeta>>
>();

/**
 * Adds an entry to the block fields cache with size management.
 * When cache exceeds max size, oldest entries are removed.
 *
 * @param key - The cache key (typically block model ID).
 * @param value - Promise resolving to the field metadata dictionary.
 */
function addToBlockFieldsCache(
  key: string,
  value: Promise<Record<string, BlockFieldMeta>>,
): void {
  // Remove oldest entries if at capacity
  if (blockFieldsCache.size >= BLOCK_FIELDS_CACHE_MAX_SIZE) {
    const firstKey = blockFieldsCache.keys().next().value;
    if (firstKey) {
      blockFieldsCache.delete(firstKey);
    }
  }
  blockFieldsCache.set(key, value);
}

/**
 * Fetches field metadata for a block model from the CMA.
 * Results are cached to avoid repeated API calls for the same block type.
 *
 * This function is exported for testing and for cases where field metadata
 * is needed outside the translation flow.
 *
 * BUGFIX: Uses Promise-based caching to prevent race conditions. The Promise
 * is stored in the cache immediately, so concurrent requests for the same
 * block model ID will await the same Promise.
 *
 * @param apiToken - DatoCMS API token.
 * @param environment - Dato environment slug.
 * @param blockModelId - The block model ID to fetch fields for.
 * @param schemaRepository - Optional SchemaRepository for cached lookups.
 * @returns Dictionary mapping field API keys to editor type and ID.
 */
export async function fetchBlockFields(
  apiToken: string,
  environment: string,
  blockModelId: string,
  schemaRepository?: SchemaRepository,
  cmaBaseUrl?: string,
): Promise<Record<string, BlockFieldMeta>> {
  // If SchemaRepository is provided, use it for cached lookups
  if (schemaRepository) {
    return getBlockFieldsFromRepo(schemaRepository, blockModelId);
  }

  // Fall back to manual cache for backwards compatibility
  // Check if we already have a pending or completed request for this block model
  // Credentials can target distinct projects with identical environment/model IDs.
  // The key stays private and is never included in debug output.
  const cacheKey = JSON.stringify([apiToken, cmaBaseUrl, environment, blockModelId]);
  const cached = blockFieldsCache.get(cacheKey);
  if (cached) return cached;

  // Create the fetch Promise and cache it immediately to prevent race conditions
  const fetchPromise = (async () => {
    const client = buildDatoCMSClient(apiToken, environment, cmaBaseUrl);
    const fields = await client.fields.list(blockModelId);
    return fields.reduce(
      (acc, field) => {
        acc[field.api_key] = {
          editor: field.appearance.editor,
          id: field.id,
          localized: field.localized,
          validators: field.validators,
          field_type: field.field_type,
        };
        return acc;
      },
      {} as Record<string, BlockFieldMeta>,
    );
  })();

  // Store the Promise in cache before awaiting, so concurrent requests share it
  addToBlockFieldsCache(cacheKey, fetchPromise);

  try {
    return await fetchPromise;
  } catch (error) {
    // On error, remove from cache so subsequent requests can retry
    if (blockFieldsCache.get(cacheKey) === fetchPromise) {
      blockFieldsCache.delete(cacheKey);
    }
    throw error;
  }
}

/**
 * Context object for block field processing.
 * Groups all the parameters needed to translate fields within a block,
 * making the processBlockFields function easier to call and test.
 */
interface BlockFieldProcessingContext {
  pluginParams: ctxParamsType;
  toLocale: string;
  fromLocale: string;
  provider: TranslationProvider;
  apiToken: string;
  environment: string;
  cmaBaseUrl?: string;
  streamCallbacks?: StreamCallbacks;
  recordContext: string;
  logger: Logger;
  schemaRepository?: SchemaRepository;
}

/**
 * Fields to skip when processing block content.
 * These are metadata or structural fields, not translatable content.
 */
const BLOCK_METADATA_FIELDS = [
  'itemTypeId',
  'originalIndex',
  'blockModelId',
  'type',
  'children',
  'relationships',
  'attributes',
  'item_type',
  'meta',
  'id',
  'itemId',
  'key',
] as const;

/**
 * Extracts the single block model ID from a field validators object.
 * Returns the first item type when multiple are present.
 *
 * @param validators - Field validator object that may contain `single_block_blocks.item_types`
 * @returns The first configured block model ID, if available
 */
function getSingleBlockModelId(validators: unknown): string | undefined {
  if (!validators || typeof validators !== 'object') return undefined;
  const obj = validators as Record<string, unknown>;
  const singleBlock = obj.single_block_blocks;
  if (!singleBlock || typeof singleBlock !== 'object') return undefined;
  const itemTypes = (singleBlock as Record<string, unknown>).item_types;
  if (!Array.isArray(itemTypes) || itemTypes.length === 0) return undefined;
  return String(itemTypes[0]);
}

/**
 * Resolves the exact-cased locale key in a localized map, falling back to the provided locale.
 *
 * @param obj - Localized value map keyed by locale codes
 * @param locale - Requested locale code
 * @returns The exact matching key from `obj`, or the input locale when no exact match exists
 */
function resolveLocaleKey(
  obj: Record<string, unknown>,
  locale: string,
): string {
  return findExactLocaleKey(obj, locale) ?? locale;
}

/**
 * Translates a frameless single block value by translating its nested fields.
 *
 * @param fieldValue - Raw field value that should contain a frameless block object
 * @param fieldMeta - Field metadata used to resolve block model validators
 * @param ctx - Translation execution context for nested field processing
 * @returns The translated block object, or the original value when it is not translatable
 */
async function translateFramelessSingleBlockValue(
  fieldValue: unknown,
  fieldMeta: BlockFieldMeta | undefined,
  ctx: BlockFieldProcessingContext,
): Promise<unknown> {
  if (
    !fieldValue ||
    typeof fieldValue !== 'object' ||
    Array.isArray(fieldValue)
  ) {
    return fieldValue;
  }

  const blockModelId = getSingleBlockModelId(fieldMeta?.validators);
  if (!blockModelId) {
    ctx.logger.warning(
      'Frameless single block missing item type validators',
      fieldMeta,
    );
    return fieldValue;
  }

  const nestedFieldTypes = await fetchBlockFields(
    ctx.apiToken,
    ctx.environment,
    blockModelId,
    ctx.schemaRepository,
    ctx.cmaBaseUrl,
  );

  // This nested value already belongs to the outer field's private clone.
  const cleanedValue = fieldValue as Record<string, unknown>;
  delete cleanedValue.id;
  delete cleanedValue.itemId;
  await processBlockFields(cleanedValue, nestedFieldTypes, ctx);
  return cleanedValue;
}

/**
 * Extracts the value to translate from a (possibly localized) field entry,
 * and returns the localized container and target locale key when applicable.
 *
 * @param rawValue - The raw value stored in the source object for this field.
 * @param isLocalizedField - Whether the field has per-locale values.
 * @param fromLocale - Source locale to extract the value from.
 * @param toLocale - Target locale to write the translated value to.
 * @returns Object describing the value to translate and how to write it back.
 */
function resolveFieldValueForTranslation(
  rawValue: unknown,
  isLocalizedField: boolean,
  fromLocale: string,
  toLocale: string,
): {
  valueToTranslate: unknown;
  localizedContainer: Record<string, unknown> | null;
  targetLocaleKey: string | null;
  skip: boolean;
} {
  if (
    !isLocalizedField ||
    !rawValue ||
    typeof rawValue !== 'object' ||
    Array.isArray(rawValue)
  ) {
    return {
      valueToTranslate: rawValue,
      localizedContainer: null,
      targetLocaleKey: null,
      skip: false,
    };
  }

  const sourceValue = getExactSourceValue(
    rawValue as Record<string, unknown>,
    fromLocale,
  );

  if (sourceValue === undefined || sourceValue === null || sourceValue === '') {
    return {
      valueToTranslate: rawValue,
      localizedContainer: null,
      targetLocaleKey: null,
      skip: true,
    };
  }

  const localizedContainer = { ...(rawValue as Record<string, unknown>) };
  const targetLocaleKey = resolveLocaleKey(localizedContainer, toLocale);

  return {
    // Nested translators mutate their private working tree. The source locale
    // inside this copied block must remain independent of its translated target.
    valueToTranslate: cloneContent(sourceValue),
    localizedContainer,
    targetLocaleKey,
    skip: false,
  };
}

/**
 * Translates a single block field value using the appropriate strategy.
 *
 * @param field - The field API key.
 * @param fieldMeta - Metadata for the field (editor, id, etc.).
 * @param valueToTranslate - The value to translate.
 * @param ctx - Processing context with translation configuration.
 * @returns The translated value.
 */
function resolveBlockFieldEditor(meta: BlockFieldMeta | undefined): string {
  const editor = meta?.editor || 'text';
  // Preserve editor variations, while structural types with custom editors
  // still need their corresponding translator rather than a string prompt.
  if (meta?.field_type === 'single_block' && editor.includes('single_block')) return editor;
  if (meta?.field_type && ['single_block', 'rich_text', 'structured_text', 'file', 'gallery', 'seo', 'link', 'links'].includes(meta.field_type)) return meta.field_type;
  return editor;
}

async function translateBlockFieldValue(
  field: string,
  fieldMeta: BlockFieldMeta | undefined,
  valueToTranslate: unknown,
  ctx: BlockFieldProcessingContext,
): Promise<unknown> {
  const fieldEditor = resolveBlockFieldEditor(fieldMeta);

  if (fieldEditor === 'frameless_single_block') {
    return translateFramelessSingleBlockValue(valueToTranslate, fieldMeta, ctx);
  }

  const nestedPrompt =
    ' Return the response in the format of ' +
    (fieldPrompt[fieldEditor as keyof typeof fieldPrompt] || '');

  return translateFieldValue(
    valueToTranslate,
    ctx.pluginParams,
    ctx.toLocale,
    ctx.fromLocale,
    fieldEditor,
    ctx.provider,
    nestedPrompt,
    ctx.apiToken,
    fieldMeta?.id || '',
    ctx.environment,
    ctx.streamCallbacks,
    ctx.recordContext,
    ctx.schemaRepository,
    { fieldApiKey: field, cmaBaseUrl: ctx.cmaBaseUrl, contentAlreadyCloned: true },
  );
}

/**
 * Processes fields on a private block clone sequentially.
 * Outer record/field scheduling controls concurrency; cancellation rejects the
 * whole field so partially translated content is never written as success.
 *
 * @param source - The source object containing fields to translate.
 * @param fieldTypeDictionary - Dictionary mapping field API keys to their editor type and ID.
 * @param ctx - Processing context containing all translation configuration.
 * @returns Resolves when all fields in the block have been translated.
 */
function skipBlockField(meta: BlockFieldMeta | undefined, field: string, params: ctxParamsType): boolean {
  if (!meta) return true;
  if (isReferenceField(meta.validators)) return true;
  if (meta.field_type === 'link' || meta.field_type === 'links') return true;
  return isFieldExcluded(params.apiKeysToBeExcludedFromThisPlugin, [meta.id, field]);
}

function getBlockSourceObject(block: DatoCMSBlock): Record<string, unknown> {
  if (block.attributes) return block.attributes;
  if (hasNestedItem(block)) return block.item.attributes;
  if (block.item && typeof block.item === 'object') return block.item as Record<string, unknown>;
  return block;
}

async function processBlockFields(
  source: Record<string, unknown>,
  fieldTypeDictionary: Record<string, BlockFieldMeta>,
  ctx: BlockFieldProcessingContext,
): Promise<void> {
  // Collect translatable fields (skip metadata fields)
  const translatableFields: string[] = [];
  for (const field of Object.keys(source)) {
    if (
      BLOCK_METADATA_FIELDS.includes(
        field as (typeof BLOCK_METADATA_FIELDS)[number],
      )
    ) {
      ctx.logger.info('Block field skipped', {
        fieldKey: field,
        reason: 'metadata-field',
        value: source[field],
      });
      continue;
    }
    translatableFields.push(field);
  }

  if (translatableFields.length === 0) {
    ctx.logger.info('Block processing skipped', {
      reason: 'no-translatable-fields',
      source,
    });
    return;
  }

  // The record/field scheduler already bounds parallelism. A pool at each
  // nested block level multiplies in-flight work exponentially with depth.
  for (const field of translatableFields) {
      checkCancellation(ctx.streamCallbacks ?? {});
      ctx.streamCallbacks?.onStream?.(`Translating block field: ${field}...`);

      const fieldMeta = fieldTypeDictionary[field];
      if (skipBlockField(fieldMeta, field, ctx.pluginParams)) continue;
      const isLocalizedField = fieldMeta?.localized === true;
      const fieldEditor = resolveBlockFieldEditor(fieldMeta);

      ctx.logger.info('Block field source payload', {
        fieldKey: field,
        fieldId: fieldMeta?.id,
        editor: fieldEditor,
        localized: isLocalizedField,
        fromLocale: ctx.fromLocale,
        toLocale: ctx.toLocale,
        value: source[field],
      });

      const resolved = resolveFieldValueForTranslation(
        source[field],
        isLocalizedField,
        ctx.fromLocale,
        ctx.toLocale,
      );

      if (resolved.skip) {
        ctx.logger.info('Block field skipped', {
          fieldKey: field,
          fieldId: fieldMeta?.id,
          editor: fieldEditor,
          localized: isLocalizedField,
          reason: 'missing-source-locale-value',
          fromLocale: ctx.fromLocale,
          toLocale: ctx.toLocale,
          value: source[field],
        });
        continue;
      }

      ctx.logger.info('Block field translation input', {
        fieldKey: field,
        fieldId: fieldMeta?.id,
        editor: fieldEditor,
        localized: isLocalizedField,
        fromLocale: ctx.fromLocale,
        toLocale: ctx.toLocale,
        value: resolved.valueToTranslate,
      });

      // biome-ignore lint/performance/noAwaitInLoops: the outer scheduler owns concurrency; nested pools multiply with depth.
      const translatedValue = await translateBlockFieldValue(
        field,
        fieldMeta,
        resolved.valueToTranslate,
        ctx,
      );

      if (resolved.localizedContainer && resolved.targetLocaleKey) {
        resolved.localizedContainer[resolved.targetLocaleKey] = translatedValue;
        ctx.logger.info('Block field translated payload', {
          fieldKey: field,
          fieldId: fieldMeta?.id,
          editor: fieldEditor,
          localized: isLocalizedField,
          targetLocaleKey: resolved.targetLocaleKey,
          fromLocale: ctx.fromLocale,
          toLocale: ctx.toLocale,
          translatedValue,
          writtenValue: resolved.localizedContainer,
        });
        checkCancellation(ctx.streamCallbacks ?? {});
        source[field] = resolved.localizedContainer;
        continue;
      }

      ctx.logger.info('Block field translated payload', {
        fieldKey: field,
        fieldId: fieldMeta?.id,
        editor: fieldEditor,
        localized: isLocalizedField,
        fromLocale: ctx.fromLocale,
        toLocale: ctx.toLocale,
        translatedValue,
        writtenValue: translatedValue,
      });

      checkCancellation(ctx.streamCallbacks ?? {});
      source[field] = translatedValue;
  }


}

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
 * @param schemaRepository - Optional SchemaRepository for cached schema lookups
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
  recordContext = '',
  schemaRepository?: SchemaRepository,
  cmaBaseUrl?: string,
  contentAlreadyCloned = false,
) {
  const logger = createLogger(pluginParams, 'translateBlockValue');
  logger.info('Translating block value', {
    fieldType,
    fromLocale,
    toLocale,
    value: fieldValue,
  });

  const isSingleBlock =
    fieldType === 'single_block' ||
    fieldType === 'framed_single_block' ||
    fieldType === 'frameless_single_block';
  const rawBlocks = (
    isSingleBlock ? [fieldValue] : fieldValue
  ) as Array<DatoCMSBlock>;
  if (!Array.isArray(rawBlocks) || rawBlocks.some((block) => !block || typeof block !== 'object')) {
    throw new Error('Invalid block content: expected block objects');
  }
  const cleanedFieldValue = rawBlocks.map((block) => stripBlockWrapperIdentifiers(block, contentAlreadyCloned));
  logger.info('Block payload before processing', {
    fieldType,
    fromLocale,
    toLocale,
    rawBlocks,
    cleanedFieldValue,
  });

  // Create processing context with all translation configuration
  const processingContext: BlockFieldProcessingContext = {
    pluginParams,
    toLocale,
    fromLocale,
    provider,
    apiToken,
    environment,
    cmaBaseUrl,
    streamCallbacks,
    recordContext,
    logger,
    schemaRepository,
  };

  /**
   * Merges field metadata from a single frameless block field into the accumulated map.
   * Fetches the nested block's field types and adds entries that don't already exist.
   *
   * @param fieldKey - The API key of the frameless block field.
   * @param meta - Field metadata for the frameless block field.
   * @param sourceObject - Source object to check if the field is already present.
   * @param parentBlockModelId - Model ID of the parent block (used for warning context).
   * @param merged - Mutable map being accumulated.
   */
  async function mergeFramelessBlockFields(
    fieldKey: string,
    meta: BlockFieldMeta,
    sourceObject: Record<string, unknown>,
    parentBlockModelId: string,
    merged: Record<string, BlockFieldMeta>,
  ): Promise<void> {
    if (fieldKey in sourceObject) return;
    const nestedModelId = getSingleBlockModelId(meta.validators);
    if (!nestedModelId) {
      logger.warning('Frameless single block missing validators', {
        fieldKey,
        blockModelId: parentBlockModelId,
      });
      return;
    }
    const nestedFieldTypes = await fetchBlockFields(
      apiToken,
      environment,
      nestedModelId,
      schemaRepository,
      cmaBaseUrl,
    );
    for (const [nestedKey, nestedMeta] of Object.entries(nestedFieldTypes)) {
      if (!(nestedKey in merged)) {
        merged[nestedKey] = nestedMeta;
      }
    }
  }

  /**
   * Processes a single block: fetches its field metadata, resolves frameless
   * field type merging, and translates all its fields.
   * Extracted to avoid await-in-loop lint errors.
   */
  async function processBlock(block: DatoCMSBlock): Promise<void> {
    checkCancellation(streamCallbacks ?? {});
    const blockModelId = extractBlockModelId(block);
    if (!blockModelId) {
      logger.warning('Block model ID not found', block);
      return;
    }
    logger.info('Block processing started', {
      blockModelId,
      block,
    });

    const fieldTypeDictionary = await fetchBlockFields(
      apiToken,
      environment,
      blockModelId,
      schemaRepository,
      cmaBaseUrl,
    );

    const sourceObject = getBlockSourceObject(block);

    let effectiveFieldTypes = fieldTypeDictionary;
    const framelessFields = Object.entries(fieldTypeDictionary).filter(
      ([, meta]) => meta.editor === 'frameless_single_block',
    );

    if (framelessFields.length > 0) {
      const merged: Record<string, BlockFieldMeta> = { ...fieldTypeDictionary };

      for (const [fieldKey, meta] of framelessFields) {
        checkCancellation(streamCallbacks ?? {});
        // biome-ignore lint/performance/noAwaitInLoops: bound CMA schema requests for deeply nested models.
        await mergeFramelessBlockFields(
          fieldKey,
          meta,
          sourceObject,
          blockModelId,
          merged,
        );
      }

      effectiveFieldTypes = merged;
    }

    await processBlockFields(
      sourceObject,
      effectiveFieldTypes,
      processingContext,
    );
    logger.info('Block processing completed', {
      blockModelId,
      block,
      sourceObject,
    });
  }

  // One loop keeps promise/closure allocation bounded for large block arrays.
  for (const block of cleanedFieldValue) {
    // biome-ignore lint/performance/noAwaitInLoops: bound block traversal and provider work independently of document width.
    await processBlock(block);
  }
  checkCancellation(streamCallbacks ?? {});

  const translatedBlockValue = isSingleBlock
    ? cleanedFieldValue[0]
    : cleanedFieldValue;
  logger.info('Block translation completed', {
    fieldType,
    fromLocale,
    toLocale,
    value: translatedBlockValue,
  });
  return translatedBlockValue;
}

/**
 * Context-free entry point for translating a field value.
 *
 * This function can be used without a DatoCMS plugin context, making it suitable
 * for CMA-based flows (like bulk translation via `ItemsDropdownUtils.ts`) and
 * for unit testing translation logic without mocking the full SDK context.
 *
 * @param fieldValue - The field value to translate.
 * @param pluginParams - Plugin configuration parameters.
 * @param toLocale - Target locale code.
 * @param fromLocale - Source locale code.
 * @param fieldType - The DatoCMS field type (e.g., 'single_line', 'structured_text').
 * @param apiToken - DatoCMS API token for any required CMA calls.
 * @param fieldId - ID of the field being translated (for exclusion checking).
 * @param environment - Dato environment slug.
 * @param streamCallbacks - Optional callbacks for streaming translations.
 * @param recordContext - Optional context about the record being translated.
 * @param schemaRepository - Optional SchemaRepository for cached schema lookups.
 * @returns The translated field value.
 */
export async function translateFieldValueDirect(
  fieldValue: unknown,
  pluginParams: ctxParamsType,
  toLocale: string,
  fromLocale: string,
  fieldType: string,
  apiToken: string,
  fieldId: string | undefined,
  environment: string,
  streamCallbacks?: StreamCallbacks,
  recordContext = '',
  schemaRepository?: SchemaRepository,
  cmaBaseUrl?: string,
): Promise<unknown> {
  const provider = getProvider(pluginParams);
  const fieldTypePrompt = prepareFieldTypePrompt(fieldType);

  return translateFieldValue(
    fieldValue,
    pluginParams,
    toLocale,
    fromLocale,
    fieldType,
    provider,
    fieldTypePrompt,
    apiToken,
    fieldId,
    environment,
    streamCallbacks,
    recordContext,
    schemaRepository,
    cmaBaseUrl ? { cmaBaseUrl } : {},
  );
}

/**
 * Main entry point for translating a field value from one locale to another.
 *
 * This function is the primary interface called by the DatoCMS plugin UI
 * (field dropdown actions). It requires a full `ExecuteFieldDropdownActionCtx`
 * because it:
 * - Reads the current user's access token from context
 * - Generates record context from form values
 * - Handles streaming UI updates
 *
 * For CMA-based flows or testing, use `translateFieldValueDirect()` instead.
 *
 * @param fieldValue - The field value to translate
 * @param ctx - DatoCMS plugin context (provides access token and form values)
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
  recordContext = '',
) {
  const apiToken = await ctx.currentUserAccessToken;
  // Resolve provider (OpenAI for now; vendor-agnostic interface)
  const provider = getProvider(pluginParams);
  const logger = createLogger(pluginParams, 'TranslateField');

  try {
    logger.info('Starting field translation', {
      fieldType,
      fromLocale,
      toLocale,
    });

    // Generate record context if not provided or use the existing one
    const contextToUse =
      ctx.formValues && !recordContext
        ? generateRecordContext(ctx.formValues, fromLocale)
        : recordContext;

    if (streamCallbacks?.onStream) {
      streamCallbacks.onStream('Loading...');
    }

    // Get the field API key and ensure it's always a string
    const fieldApiKey = ctx.field.attributes.api_key ?? '';
    const fieldIdentifier = ctx.field.id ?? ctx.fieldPath ?? '';
    logger.info('Dropdown source payload', {
      fieldType,
      fieldId: fieldIdentifier,
      fieldApiKey,
      fieldPath: ctx.fieldPath,
      fromLocale,
      toLocale,
      value: fieldValue,
    });

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
      fieldIdentifier,
      environment,
      streamCallbacks,
      contextToUse,
      undefined,
      {
        fieldApiKey,
        cmaBaseUrl: ctx.cmaBaseUrl,
      },
    );

    logger.info('Dropdown translated payload', {
      fieldType,
      fieldId: fieldIdentifier,
      fieldApiKey,
      fieldPath: ctx.fieldPath,
      fromLocale,
      toLocale,
      value: translatedValue,
    });
    logger.info('Field translation completed');
    return translatedValue;
  } catch (error) {
    // DRY-001: Use centralized error handler
    handleTranslationError(
      error,
      provider.vendor,
      logger,
      'Translation failed',
    );
  }
}

/** Field name keywords that suggest a field carries meaningful context for translation. */
const CONTEXT_FIELD_KEYWORDS = ['title', 'name', 'content', 'description'];
const RECORD_CONTEXT_MAX_CHARACTERS = 2000;

/**
 * Checks whether a field key is likely to provide useful context for translation.
 *
 * @param key - The field API key.
 * @returns True if the key contains a context keyword.
 */
function isContextField(key: string): boolean {
  const lowerKey = key.toLowerCase();
  return CONTEXT_FIELD_KEYWORDS.some((keyword) => lowerKey.includes(keyword));
}

/**
 * Extracts the source locale string from a localized field value.
 * Returns null if the value is missing, not a string, or too long to be useful.
 *
 * @param val - The raw field value (expected to be a localized object).
 * @param sourceLocale - The locale code to extract.
 * @returns The string value at the source locale, or null.
 */
function extractLocaleString(
  val: unknown,
  sourceLocale: string,
): string | null {
  if (typeof val !== 'object' || val === null) return null;
  const localeValue = getExactSourceValue(val as Record<string, unknown>, sourceLocale);
  if (typeof localeValue !== 'string') return null;
  if (!localeValue || localeValue.length >= 300) return null;
  return localeValue;
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
export function generateRecordContext(
  formValues: Record<string, unknown>,
  sourceLocale: string,
): string {
  if (!formValues) return '';

  let contextStr = 'Content context: ';
  let hasAddedContext = false;

  for (const key in formValues) {
    if (!isContextField(key)) continue;
    const value = extractLocaleString(formValues[key], sourceLocale);
    if (value) {
      const entry = `${key}: ${value}. `;
      const remaining = RECORD_CONTEXT_MAX_CHARACTERS - contextStr.length;
      if (remaining <= 0) break;
      contextStr += entry.slice(0, remaining);
      hasAddedContext = true;
      if (entry.length >= remaining) break;
    }
  }

  return hasAddedContext ? contextStr : '';
}

export default TranslateField;
