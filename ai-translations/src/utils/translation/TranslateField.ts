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

import type { TranslationProvider, StreamCallbacks } from './types';
import { buildClient } from '@datocms/cma-client-browser';
import type { ExecuteFieldDropdownActionCtx } from 'datocms-plugin-sdk';
import {
  type ctxParamsType,
  modularContentVariations,
} from '../../entrypoints/Config/ConfigScreen';
import { fieldPrompt } from '../../prompts/FieldPrompts';
import { findExactLocaleKey, getExactSourceValue, isFieldTranslatable, prepareFieldTypePrompt } from './SharedFieldUtils';
import { translateDefaultFieldValue } from './DefaultTranslation';
import { type SeoObject, translateSeoFieldValue } from './SeoTranslation';
import { translateStructuredTextValue } from './StructuredTextTranslation';
import { translateFileFieldValue } from './FileFieldTranslation';
import { deleteItemIdKeys } from './utils';
import { createLogger, type Logger } from '../logging/Logger';
import { getProvider } from './ProviderFactory';
import { handleTranslationError } from './ProviderErrors';
import {
  type SchemaRepository,
  type BlockFieldMeta,
  getBlockFieldsFromRepo,
} from '../schemaRepository';

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
} & BlockWithItem;

/**
 * Type guard to check if a block has nested item structure.
 *
 * @param block - The block to check.
 * @returns True if block has item.attributes structure.
 */
function hasNestedItem(block: DatoCMSBlock): block is DatoCMSBlock & { item: { attributes: Record<string, unknown> } } {
  return (
    block.item !== undefined &&
    typeof block.item === 'object' &&
    block.item !== null &&
    'attributes' in block.item &&
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

  // From relationships
  const relationshipId = block.relationships?.item_type?.data?.id;
  if (relationshipId) return relationshipId;

  // From nested item relationships
  const nestedRelationshipId = block.item?.relationships?.item_type?.data?.id;
  if (nestedRelationshipId) return nestedRelationshipId;

  return undefined;
}

/**
 * Represents a cancelled operation during concurrent execution.
 * Used internally by runWithConcurrency to signal early termination.
 */
class CancellationError extends Error {
  constructor() {
    super('Operation cancelled');
    this.name = 'CancellationError';
  }
}

/**
 * Result wrapper for concurrent task execution.
 * Tracks both the result and whether the task completed successfully.
 */
interface ConcurrencyResult<T> {
  index: number;
  result?: T;
  completed: boolean;
}

/**
 * Executes an array of async tasks with a maximum concurrency limit.
 * Uses a worker-pool pattern where workers pull tasks from a shared queue.
 *
 * @param tasks - Array of async task functions to execute.
 * @param maxConcurrency - Maximum number of concurrent tasks.
 * @param checkCancellation - Optional function that throws if cancelled.
 * @returns Array of results in the same order as input tasks.
 *          Incomplete tasks (due to cancellation) will have undefined results.
 */
async function runWithConcurrency<T>(
  tasks: Array<() => Promise<T>>,
  maxConcurrency: number,
  checkCancellation?: () => void
): Promise<ConcurrencyResult<T>[]> {
  const results: ConcurrencyResult<T>[] = tasks.map((_, index) => ({
    index,
    completed: false,
  }));

  let nextIndex = 0;
  let cancelled = false;

  async function worker(): Promise<void> {
    while (!cancelled && nextIndex < tasks.length) {
      const index = nextIndex++;

      // Check for cancellation before starting each task
      try {
        checkCancellation?.();
      } catch {
        cancelled = true;
        return;
      }

      try {
        const result = await tasks[index]();
        results[index] = { index, result, completed: true };
      } catch (error) {
        // If task throws due to cancellation, stop this worker
        if (error instanceof CancellationError) {
          cancelled = true;
          return;
        }
        // Re-throw other errors to fail the whole operation
        throw error;
      }
    }
  }

  // Start workers up to maxConcurrency or task count, whichever is smaller
  const workerCount = Math.min(maxConcurrency, tasks.length);
  const workers = Array(workerCount)
    .fill(null)
    .map(() => worker());

  await Promise.all(workers);
  return results;
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
  schemaRepository?: SchemaRepository
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
        recordContext,
        schemaRepository
      );
    case 'rich_text':
    case 'framed_single_block':
    case 'frameless_single_block':
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
        recordContext,
        schemaRepository
      );
    case 'file':
    case 'gallery':
      return translateFileFieldValue(
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
 * Maximum number of block field entries to cache.
 * SMELL-004: Prevents unbounded cache growth.
 */
const BLOCK_FIELDS_CACHE_MAX_SIZE = 100;

/**
 * Maximum number of block fields to translate in parallel.
 * Conservative value to avoid rate limits within a single block.
 */
const BLOCK_FIELD_CONCURRENCY = 3;

/**
 * Module-level cache for block field metadata.
 * Avoids repeated CMA calls when translating multiple blocks of the same type.
 * Limited to BLOCK_FIELDS_CACHE_MAX_SIZE entries to prevent memory leaks.
 *
 * BUGFIX: We store Promises to prevent race conditions where multiple concurrent
 * requests for the same block model ID would all make API calls. By caching the
 * Promise itself, subsequent requests wait for the same pending request.
 */
const blockFieldsCache = new Map<string, Promise<Record<string, BlockFieldMeta>>>();

/**
 * Adds an entry to the block fields cache with size management.
 * When cache exceeds max size, oldest entries are removed.
 *
 * @param key - The cache key (typically block model ID).
 * @param value - Promise resolving to the field metadata dictionary.
 */
function addToBlockFieldsCache(key: string, value: Promise<Record<string, BlockFieldMeta>>): void {
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
  schemaRepository?: SchemaRepository
): Promise<Record<string, BlockFieldMeta>> {
  // If SchemaRepository is provided, use it for cached lookups
  if (schemaRepository) {
    return getBlockFieldsFromRepo(schemaRepository, blockModelId);
  }

  // Fall back to manual cache for backwards compatibility
  // Check if we already have a pending or completed request for this block model
  const cached = blockFieldsCache.get(blockModelId);
  if (cached) return cached;

  // Create the fetch Promise and cache it immediately to prevent race conditions
  const fetchPromise = (async () => {
    const client = buildClient({ apiToken, environment });
    const fields = await client.fields.list(blockModelId);
    return fields.reduce((acc, field) => {
      acc[field.api_key] = {
        editor: field.appearance.editor,
        id: field.id,
        localized: field.localized,
        validators: field.validators,
      };
      return acc;
    }, {} as Record<string, BlockFieldMeta>);
  })();

  // Store the Promise in cache before awaiting, so concurrent requests share it
  addToBlockFieldsCache(blockModelId, fetchPromise);

  try {
    return await fetchPromise;
  } catch (error) {
    // On error, remove from cache so subsequent requests can retry
    blockFieldsCache.delete(blockModelId);
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
function resolveLocaleKey(obj: Record<string, unknown>, locale: string): string {
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
  ctx: BlockFieldProcessingContext
): Promise<unknown> {
  if (!fieldValue || typeof fieldValue !== 'object' || Array.isArray(fieldValue)) {
    return fieldValue;
  }

  const blockModelId = getSingleBlockModelId(fieldMeta?.validators);
  if (!blockModelId) {
    ctx.logger.warning('Frameless single block missing item type validators', fieldMeta);
    return fieldValue;
  }

  const nestedFieldTypes = await fetchBlockFields(
    ctx.apiToken,
    ctx.environment,
    blockModelId,
    ctx.schemaRepository
  );

  const cleanedValue = deleteItemIdKeys(fieldValue) as Record<string, unknown>;
  await processBlockFields(cleanedValue, nestedFieldTypes, ctx);
  return cleanedValue;
}

/**
 * Represents a translated field result.
 */
interface TranslatedFieldResult {
  field: string;
  value: unknown;
}

/**
 * Processes fields within a block's source object using parallel execution.
 *
 * Translates multiple fields concurrently (up to BLOCK_FIELD_CONCURRENCY) to improve
 * performance while respecting rate limits. Supports cancellation and applies
 * partial results if translation is interrupted.
 *
 * @param source - The source object containing fields to translate.
 * @param fieldTypeDictionary - Dictionary mapping field API keys to their editor type and ID.
 * @param ctx - Processing context containing all translation configuration.
 * @returns Resolves when all fields in the block have been translated.
 */
async function processBlockFields(
  source: Record<string, unknown>,
  fieldTypeDictionary: Record<string, BlockFieldMeta>,
  ctx: BlockFieldProcessingContext
): Promise<void> {
  // Collect translatable fields (skip metadata fields)
  const translatableFields = Object.keys(source).filter(
    (field) => !BLOCK_METADATA_FIELDS.includes(field as typeof BLOCK_METADATA_FIELDS[number])
  );

  if (translatableFields.length === 0) {
    return;
  }

  // Create translation tasks for each field
  const tasks = translatableFields.map((field) => async (): Promise<TranslatedFieldResult> => {
    // Show progress if using streaming callbacks
    ctx.streamCallbacks?.onStream?.(`Translating block field: ${field}...`);

    const fieldMeta = fieldTypeDictionary[field];
    const fieldEditor = fieldMeta?.editor || 'text';
    const isLocalizedField = fieldMeta?.localized === true;

    let valueToTranslate: unknown = source[field];
    let localizedContainer: Record<string, unknown> | null = null;
    let targetLocaleKey: string | null = null;

    if (
      isLocalizedField &&
      valueToTranslate &&
      typeof valueToTranslate === 'object' &&
      !Array.isArray(valueToTranslate)
    ) {
      const sourceValue = getExactSourceValue(
        valueToTranslate as Record<string, unknown>,
        ctx.fromLocale
      );
      if (sourceValue === undefined || sourceValue === null || sourceValue === '') {
        return { field, value: valueToTranslate };
      }
      localizedContainer = { ...(valueToTranslate as Record<string, unknown>) };
      targetLocaleKey = resolveLocaleKey(localizedContainer, ctx.toLocale);
      valueToTranslate = sourceValue;
    }

    let translatedValue: unknown;
    if (fieldEditor === 'frameless_single_block') {
      translatedValue = await translateFramelessSingleBlockValue(
        valueToTranslate,
        fieldMeta,
        ctx
      );
    } else {
      let nestedPrompt = ' Return the response in the format of ';
      nestedPrompt += fieldPrompt[fieldEditor as keyof typeof fieldPrompt] || '';

      translatedValue = await translateFieldValue(
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
        ctx.schemaRepository
      );
    }

    if (localizedContainer && targetLocaleKey) {
      localizedContainer[targetLocaleKey] = translatedValue;
      return { field, value: localizedContainer };
    }

    return { field, value: translatedValue };
  });

  // Execute tasks with concurrency limit, checking for cancellation between tasks
  const results = await runWithConcurrency(
    tasks,
    BLOCK_FIELD_CONCURRENCY,
    ctx.streamCallbacks?.checkCancellation
  );

  // Apply completed results to source object
  for (const result of results) {
    if (result.completed && result.result) {
      source[result.result.field] = result.result.value;
    }
  }

  // Log if cancelled mid-way
  const completedCount = results.filter((r) => r.completed).length;
  if (completedCount < translatableFields.length) {
    ctx.logger.info(`Translation cancelled: ${completedCount}/${translatableFields.length} fields translated`);
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
  schemaRepository?: SchemaRepository
) {
  const logger = createLogger(pluginParams, 'translateBlockValue');
  logger.info('Translating block value');

  const isSingleBlock = fieldType === 'framed_single_block' || fieldType === 'frameless_single_block';
  // Clean block array from any leftover item IDs
  const cleanedFieldValue = deleteItemIdKeys(
    isSingleBlock ? [fieldValue] : fieldValue
  ) as Array<DatoCMSBlock>;

  // Create processing context with all translation configuration
  const processingContext: BlockFieldProcessingContext = {
    pluginParams,
    toLocale,
    fromLocale,
    provider,
    apiToken,
    environment,
    streamCallbacks,
    recordContext,
    logger,
    schemaRepository,
  };

  for (const block of cleanedFieldValue) {
    // Determine the block model ID using type-safe extraction
    const blockModelId = extractBlockModelId(block);
    if (!blockModelId) {
      logger.warning('Block model ID not found', block);
      continue;
    }

    // Fetch fields for this specific block using SchemaRepository or manual cache
    const fieldTypeDictionary = await fetchBlockFields(apiToken, environment, blockModelId, schemaRepository);

    const sourceObject = block.attributes
      ? block.attributes
      : hasNestedItem(block)
        ? block.item.attributes
        : (block as Record<string, unknown>);

    // Handle frameless single block flattening: if the frameless field key is absent
    // but its nested fields are flattened into the parent, merge nested field types.
    let effectiveFieldTypes = fieldTypeDictionary;
    const framelessFields = Object.entries(fieldTypeDictionary).filter(
      ([, meta]) => meta.editor === 'frameless_single_block'
    );
    if (framelessFields.length > 0) {
      const merged: Record<string, BlockFieldMeta> = { ...fieldTypeDictionary };
      for (const [fieldKey, meta] of framelessFields) {
        if (fieldKey in sourceObject) {
          continue;
        }
        const nestedModelId = getSingleBlockModelId(meta.validators);
        if (!nestedModelId) {
          logger.warning('Frameless single block missing validators', { fieldKey, blockModelId });
          continue;
        }
        const nestedFieldTypes = await fetchBlockFields(apiToken, environment, nestedModelId, schemaRepository);
        for (const [nestedKey, nestedMeta] of Object.entries(nestedFieldTypes)) {
          if (!(nestedKey in merged)) {
            merged[nestedKey] = nestedMeta;
          }
        }
      }
      effectiveFieldTypes = merged;
    }

    // Translate each field within the block using type guard for nested item check
    await processBlockFields(sourceObject, effectiveFieldTypes, processingContext);
  }

  logger.info('Block translation completed');
  return isSingleBlock ? cleanedFieldValue[0] : cleanedFieldValue;
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
  schemaRepository?: SchemaRepository
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
    schemaRepository
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
    // DRY-001: Use centralized error handler
    handleTranslationError(error, provider.vendor, logger, 'Translation failed');
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

export default TranslateField;
