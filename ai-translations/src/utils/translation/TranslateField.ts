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
 * 2. **`translateFieldValue()`** (named export)
 *    - Context-free entry point for CMA-based flows and testing
 *    - No dependency on DatoCMS plugin SDK context
 *    - Used by the engine (`engine/index.ts`) for bulk/modal and sidebar runs
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

import { buildClient } from '@datocms/cma-client-browser';
import type { ExecuteFieldDropdownActionCtx } from 'datocms-plugin-sdk';
import type { ctxParamsType } from '../../entrypoints/Config/ConfigScreen';
import { modularContentVariations } from '../../entrypoints/Config/configConstants';
import { fieldPrompt } from '../../prompts/FieldPrompts';
import { resolveFieldFate } from '../../engine/fieldFate';
import { createLogger, type Logger } from '../logging/Logger';
import {
  type BlockFieldMeta,
  getBlockFieldsFromRepo,
  type SchemaRepository,
} from '../schemaRepository';
import { translateDefaultFieldValue } from './DefaultTranslation';
import type { OnQcFlag } from './qc/types';
import { translateFileFieldValue } from './FileFieldTranslation';
import { translateJsonFieldValue } from './JsonFieldTranslation';
import { handleTranslationError } from './ProviderErrors';
import { getProvider } from './ProviderFactory';
import { type SeoObject, translateSeoFieldValue } from './SeoTranslation';
import {
  isFieldExcluded,
  isFieldTranslatable,
  normalizeTranslatedSlug,
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
function hasNestedItem(
  block: DatoCMSBlock,
): block is DatoCMSBlock & { item: { attributes: Record<string, unknown> } } {
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
 * Internal options used to fine-tune translation behavior for special cases.
 */
interface TranslateFieldValueOptions {
  bypassFieldTypeAllowlist?: boolean;
  fieldApiKey?: string;
  cmaBaseUrl?: string;
  /** Optional sink for QC flags; stamped with fieldPath/locale before forwarding. */
  onQcFlag?: OnQcFlag;
}

/**
 * Wraps a raw engine QC callback so each flag is stamped with this field's path
 * and target locale (engine-level checks don't know either). Returns undefined
 * when no sink was provided.
 */
function stampFieldQcFlag(
  onQcFlag: OnQcFlag | undefined,
  fieldApiKey: string | undefined,
  toLocale: string,
): OnQcFlag | undefined {
  if (!onQcFlag) return undefined;
  return (flag) =>
    onQcFlag({
      ...flag,
      fieldPath: flag.fieldPath ?? fieldApiKey,
      locale: flag.locale ?? toLocale,
    });
}

/**
 * Creates a deep clone of a JSON-like value while preserving nested identifiers.
 *
 * @param value - The value to clone.
 * @returns A deep clone of the provided value.
 */
function deepCloneValue<T>(value: T): T {
  if (Array.isArray(value)) {
    return value.map((entry) => deepCloneValue(entry)) as T;
  }

  if (value && typeof value === 'object') {
    return Object.fromEntries(
      Object.entries(value as Record<string, unknown>).map(([key, entry]) => [
        key,
        deepCloneValue(entry),
      ]),
    ) as T;
  }

  return value;
}

/**
 * Marker keys that identify an object as a DatoCMS block wrapper (as opposed to
 * a DAST inline node like a `link` whose `id` names a meta attribute, which must
 * be preserved). Any one marker is sufficient.
 */
const BLOCK_MARKER_KEYS = [
  'blockModelId',
  'itemTypeId',
  'attributes',
  'relationships',
  'item',
] as const;

/**
 * Detects whether a plain object is a DatoCMS block wrapper across the several
 * payload shapes the plugin handles (nested CMA `{ type: 'item', … }`, the
 * flattened `{ blockModelId, … }` form, and `item`-nested variants).
 */
function isBlockNode(obj: Record<string, unknown>): boolean {
  return obj.type === 'item' || BLOCK_MARKER_KEYS.some((key) => key in obj);
}

/**
 * Recursively strips block-wrapper identifiers (`id`/`itemId`) at every nesting
 * level so a value can be rebuilt as fresh block instances (spec §4.3). The walk
 * is block-aware: identifiers are removed only from block wrappers, so DAST inline
 * ids (e.g. a `link` node's `id` meta key) and relationship ids (`item_type`)
 * survive untouched.
 *
 * @param value - The value to sanitize (cloned; the input is not mutated).
 * @returns A deep clone with block identifiers removed at every depth.
 */
function deepStripBlockIdentifiers<T>(value: T): T {
  if (Array.isArray(value)) {
    return value.map((entry) => deepStripBlockIdentifiers(entry)) as T;
  }

  if (value && typeof value === 'object') {
    const obj = value as Record<string, unknown>;
    const stripHere = isBlockNode(obj);
    return Object.fromEntries(
      Object.entries(obj)
        .filter(([key]) => !(stripHere && (key === 'id' || key === 'itemId')))
        .map(([key, entry]) => [key, deepStripBlockIdentifiers(entry)]),
    ) as T;
  }

  return value;
}

/**
 * Removes block-wrapper identifiers from a block payload, recursively at every
 * nesting level (spec §4.3 — rebuilt blocks are always fresh instances).
 *
 * @param block - The block payload to sanitize.
 * @returns A cloned block with block identifiers stripped at every depth.
 */
function stripBlockWrapperIdentifiers(block: DatoCMSBlock): DatoCMSBlock {
  return deepStripBlockIdentifiers(block);
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
  checkCancellation?: () => void,
): Promise<ConcurrencyResult<T>[]> {
  const results: ConcurrencyResult<T>[] = tasks.map((_, index) => ({
    index,
    completed: false,
  }));

  let nextIndex = 0;
  let cancelled = false;

  /**
   * Processes a single task and recursively continues to the next one.
   * Recursive approach avoids await-in-loop lint errors while preserving
   * the sequential-within-one-worker execution model.
   */
  async function processNextTask(): Promise<void> {
    if (cancelled || nextIndex >= tasks.length) return;

    const index = nextIndex++;

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
      if (error instanceof CancellationError) {
        cancelled = true;
        return;
      }
      throw error;
    }

    return processNextTask();
  }

  // Each worker is an independent call to processNextTask
  const worker = () => processNextTask();

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

  // Stamp QC flags emitted by the engine with this field's path + locale.
  const onQcFlag = stampFieldQcFlag(
    options.onQcFlag,
    options.fieldApiKey,
    toLocale,
  );

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
        onQcFlag,
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
        onQcFlag,
      );
      break;
    case 'rich_text':
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
        onQcFlag,
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
        onQcFlag,
      );
      break;
    case 'json':
      // Structural: translate only string leaf values so keys/numbers/syntax
      // survive and the result is valid JSON by construction. The old
      // whole-document-as-text path let providers translate keys and break
      // syntax, which DatoCMS rejected at save time (422 INVALID_FORMAT).
      translatedValue = await translateJsonFieldValue(
        fieldValue,
        pluginParams,
        toLocale,
        fromLocale,
        provider,
        streamCallbacks,
        recordContext,
        { onQcFlag },
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
        {
          isHTML: fieldType === 'wysiwyg',
          kind:
            fieldType === 'wysiwyg'
              ? 'html'
              : fieldType === 'markdown'
                ? 'markdown'
                : 'text',
          onQcFlag,
        },
      );
      break;
  }

  if (fieldType === 'slug') {
    const normalizedSlug = normalizeTranslatedSlug(translatedValue);
    if (!normalizedSlug) {
      throw new Error(
        "The translation produced an empty slug — slugs keep only lowercase letters, numbers, and hyphens, so a fully non-Latin translation (e.g. Japanese or Arabic) reduces to nothing. Set this locale's slug manually, or exclude the slug field from translation for these locales",
      );
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
  const cacheKey = `${cmaBaseUrl ?? ''}:${environment}:${blockModelId}`;
  const cached = blockFieldsCache.get(cacheKey);
  if (cached) return cached;

  // Create the fetch Promise and cache it immediately to prevent race conditions
  const fetchPromise = (async () => {
    const client = buildClient({
      apiToken,
      environment,
      baseUrl: cmaBaseUrl,
    });
    const fields = await client.fields.list(blockModelId);
    return fields.reduce(
      (acc, field) => {
        acc[field.api_key] = {
          editor: field.appearance.editor,
          id: field.id,
          localized: field.localized,
          validators: field.validators,
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
    blockFieldsCache.delete(cacheKey);
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
  onQcFlag?: OnQcFlag;
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

  const cleanedValue = deepCloneValue(fieldValue) as Record<string, unknown>;
  delete cleanedValue.id;
  delete cleanedValue.itemId;
  await processBlockFields(cleanedValue, nestedFieldTypes, blockModelId, ctx);
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
 * Translates a single block sub-field value, applying its rev-7 fate (§4.2/§4.3)
 * before any editor-specific routing.
 *
 * The fate check is deliberately hoisted above the frameless-single-block branch:
 * an `exclude`-fated sub-field yields `null` (left empty in the rebuilt block) and
 * a `copy`-fated one yields the source value verbatim (block ids stripped at every
 * depth), regardless of its editor. Only `translate`-fated sub-fields reach the
 * editor-specific translators.
 *
 * @param field - The sub-field API key.
 * @param fieldMeta - Metadata for the sub-field (editor, id, validators, etc.).
 * @param valueToTranslate - The source value to translate/copy.
 * @param ctx - Processing context with translation configuration.
 * @returns The resolved value for the target locale slot.
 */
async function translateBlockFieldValue(
  field: string,
  fieldMeta: BlockFieldMeta,
  valueToTranslate: unknown,
  ctx: BlockFieldProcessingContext,
): Promise<unknown> {
  const fate = resolveFieldFate({
    fieldId: fieldMeta.id,
    fieldApiKey: field,
    validators: fieldMeta.validators ?? {},
    excludedTokens: ctx.pluginParams.apiKeysToBeExcludedFromThisPlugin,
    copyTokens: ctx.pluginParams.fieldsToCopyFromSource ?? [],
  });

  if (fate === 'exclude') return null;
  if (fate === 'copy') return deepStripBlockIdentifiers(valueToTranslate);

  const fieldEditor = fieldMeta.editor || 'text';

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
    fieldMeta.id,
    ctx.environment,
    ctx.streamCallbacks,
    ctx.recordContext,
    ctx.schemaRepository,
    { fieldApiKey: field, cmaBaseUrl: ctx.cmaBaseUrl, onQcFlag: ctx.onQcFlag },
  );
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
 * @param blockModelId - Model ID of the block being processed, used for error context.
 * @param ctx - Processing context containing all translation configuration.
 * @returns Resolves when all fields in the block have been translated.
 */
async function processBlockFields(
  source: Record<string, unknown>,
  fieldTypeDictionary: Record<string, BlockFieldMeta>,
  blockModelId: string,
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

  // Create translation tasks for each field
  const tasks = translatableFields.map(
    (field) => async (): Promise<TranslatedFieldResult> => {
      ctx.streamCallbacks?.onStream?.(`Translating block field: ${field}...`);

      const fieldMeta = fieldTypeDictionary[field];
      if (!fieldMeta) {
        // The engine always has the block schema; a non-metadata sub-field
        // absent from the dictionary is an upstream bug. Silently matching on
        // api_key alone (the old `fieldId: ''` fallback) would defeat §5.1's
        // id-keyed fate enforcement, so fail loudly instead.
        throw new Error(
          `Block sub-field "${field}" is missing from the schema of block ` +
            `model "${blockModelId}"; cannot resolve its translation fate.`,
        );
      }
      const fieldEditor = fieldMeta.editor || 'text';

      // §3.1: block sub-fields are NEVER localized — DatoCMS 422s `localized`
      // on any field of a modular_block item type — so the sub-field value is
      // always the direct value, never a per-locale container. There is no
      // locale extraction or write-back here; the fate check + editor routing in
      // translateBlockFieldValue operate on the raw value directly.
      ctx.logger.info('Block field translation input', {
        fieldKey: field,
        fieldId: fieldMeta?.id,
        editor: fieldEditor,
        fromLocale: ctx.fromLocale,
        toLocale: ctx.toLocale,
        value: source[field],
      });

      const translatedValue = await translateBlockFieldValue(
        field,
        fieldMeta,
        source[field],
        ctx,
      );

      ctx.logger.info('Block field translated payload', {
        fieldKey: field,
        fieldId: fieldMeta?.id,
        editor: fieldEditor,
        fromLocale: ctx.fromLocale,
        toLocale: ctx.toLocale,
        translatedValue,
        writtenValue: translatedValue,
      });

      return { field, value: translatedValue };
    },
  );

  // Execute tasks with concurrency limit, checking for cancellation between tasks
  const results = await runWithConcurrency(
    tasks,
    BLOCK_FIELD_CONCURRENCY,
    ctx.streamCallbacks?.checkCancellation,
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
    ctx.logger.info(
      `Translation cancelled: ${completedCount}/${translatableFields.length} fields translated`,
    );
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
  onQcFlag?: OnQcFlag,
) {
  const logger = createLogger(pluginParams, 'translateBlockValue');
  logger.info('Translating block value', {
    fieldType,
    fromLocale,
    toLocale,
    value: fieldValue,
  });

  const isSingleBlock =
    fieldType === 'framed_single_block' ||
    fieldType === 'frameless_single_block';
  const rawBlocks = (
    isSingleBlock ? [fieldValue] : fieldValue
  ) as Array<DatoCMSBlock>;
  const cleanedFieldValue = rawBlocks.map(stripBlockWrapperIdentifiers);
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
    onQcFlag,
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

    const sourceObject = block.attributes
      ? block.attributes
      : hasNestedItem(block)
        ? block.item.attributes
        : (block as Record<string, unknown>);

    let effectiveFieldTypes = fieldTypeDictionary;
    const framelessFields = Object.entries(fieldTypeDictionary).filter(
      ([, meta]) => meta.editor === 'frameless_single_block',
    );

    if (framelessFields.length > 0) {
      const merged: Record<string, BlockFieldMeta> = { ...fieldTypeDictionary };

      await framelessFields.reduce(async (chain, [fieldKey, meta]) => {
        await chain;
        await mergeFramelessBlockFields(
          fieldKey,
          meta,
          sourceObject,
          blockModelId,
          merged,
        );
      }, Promise.resolve());

      effectiveFieldTypes = merged;
    }

    await processBlockFields(
      sourceObject,
      effectiveFieldTypes,
      blockModelId,
      processingContext,
    );
    logger.info('Block processing completed', {
      blockModelId,
      block,
      sourceObject,
    });
  }

  // Process blocks sequentially using reduce to avoid await-in-loop
  await cleanedFieldValue.reduce(
    (chain, block) => chain.then(() => processBlock(block)),
    Promise.resolve(),
  );

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
 * Main entry point for translating a field value from one locale to another.
 *
 * This function is the primary interface called by the DatoCMS plugin UI
 * (field dropdown actions). It requires a full `ExecuteFieldDropdownActionCtx`
 * because it:
 * - Reads the current user's access token from context
 * - Generates record context from form values
 * - Handles streaming UI updates
 *
 * For CMA-based flows or testing, use `translateFieldValue()` instead.
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
  onQcFlag?: OnQcFlag,
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
        onQcFlag,
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
  const localized = val as Record<string, unknown>;
  const localeValue = localized[sourceLocale];
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
      contextStr += `${key}: ${value}. `;
      hasAddedContext = true;
    }
  }

  return hasAddedContext ? contextStr : '';
}

export default TranslateField;
