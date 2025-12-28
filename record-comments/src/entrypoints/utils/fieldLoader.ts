/**
 * Field Loading Utilities
 *
 * Loads field information from DatoCMS models for the mention system.
 * Supports multiple levels of nesting:
 *
 * - Top-level fields from the current model
 * - Nested fields from modular content blocks
 * - Nested fields from structured text (DAST) blocks
 * - Localized field handling for multi-locale projects
 *
 * **Field Path Notation:**
 * Field paths use underscore notation for storage: `sections_0_heading`
 * This maps to the logical path: `sections[0].heading`
 *
 * **Block Types:**
 * - `modular_content`: Array of typed blocks
 * - `single_block`: Single typed block
 * - `structured_text` / `rich_text`: DAST format with embedded blocks
 *
 * @module fieldLoader
 */

import type { RenderItemFormSidebarCtx } from 'datocms-plugin-sdk';
import type { FieldInfo } from '@hooks/useMentions';
import type { BlockInfo } from '@ctypes/mentions';
import {
  type BlockValue,
  type FieldValue,
  type FieldValidators,
  isBlockValue,
  isPlainObject,
  isFieldValueRecord,
  isBlockContainerType,
  hasBlockAttributes,
  isStructuredTextBlock,
  getBlockModelId,
  safeGetBlockAttributes,
  extractBlocksFromFieldValue,
  getBlockIndex,
  getEditorType,
  getValidators,
} from './blockHelpers';
import { logError } from '@/utils/errorLogger';

// Re-export types for consumers of this module
export type { BlockValue, FieldValue } from './blockHelpers';

/**
 * Extracts locale-specific value from a potentially localized field value.
 *
 * Handles three cases:
 * 1. No locale provided -> returns original value
 * 2. Value is not an object or is an array -> returns original value
 * 3. Value is an object with locale key -> returns the localized value
 *
 * ============================================================================
 * TYPE ASSERTION RATIONALE - DO NOT "FIX" WITHOUT READING
 * ============================================================================
 *
 * This function uses `as T` assertions which appear unsafe but are intentional:
 *
 * WHY TYPE GUARDS WON'T WORK HERE:
 * - TypeScript generics don't narrow through runtime checks
 * - A type guard like `isLocalized<T>(val): val is Record<string, T>` cannot
 *   be written because T is erased at runtime - we can't verify the value type
 * - Returning `unknown` and forcing callers to narrow defeats the purpose of
 *   this utility (callers already know what type they expect)
 *
 * WHY THIS IS SAFE:
 * - DatoCMS localized fields have a consistent structure: { [locale]: value }
 * - The value for each locale has the SAME type (enforced by DatoCMS schema)
 * - Callers pass T based on the field type they're accessing
 * - Runtime checks ensure we only access existing locale keys
 *
 * ALTERNATIVE CONSIDERED:
 * Using Zod validation would add ~50KB to bundle and runtime overhead for
 * every field access, with no practical benefit since DatoCMS already validates
 * data on their end.
 *
 * ============================================================================
 *
 * LOCATION NOTE: This function lives in fieldLoader.ts rather than a separate
 * localization.ts file because:
 * 1. It's tightly coupled to DatoCMS field value handling
 * 2. Only used by field-related utilities (recordPickerHelpers, recordTitleUtils)
 * 3. Moving would add file churn for minimal organizational benefit
 *
 * @param fieldValue - The field value which may be localized (keyed by locale)
 * @param locale - The locale to extract, or undefined to return the original value
 * @returns The extracted localized value, or the original value if not localized
 */
export function extractLocalizedValue<T = unknown>(
  fieldValue: T,
  locale: string | undefined
): T {
  if (!locale || !fieldValue || typeof fieldValue !== 'object' || Array.isArray(fieldValue)) {
    return fieldValue;
  }
  // Safe assertion: we've verified fieldValue is a non-null, non-array object
  const localizedValue = fieldValue as Record<string, unknown>;
  if (locale in localizedValue) {
    // Safe assertion: localized values in DatoCMS maintain consistent structure per locale
    return localizedValue[locale] as T;
  }
  return fieldValue;
}

interface PathNavigationOptions {
  checkBlockAttributes?: boolean;
}

/**
 * Unified path navigation function that handles nested objects, arrays, and block structures.
 * Consolidates logic previously duplicated in getFieldValueByPath and getValueAtPath.
 */
function navigateToPath(
  root: Record<string, FieldValue>,
  path: string,
  options: PathNavigationOptions = {}
): FieldValue | undefined {
  if (!path) return root;

  const pathParts = path.split('.');
  let current: FieldValue = root;

  for (const part of pathParts) {
    if (current === undefined || current === null) return undefined;

    const index = parseInt(part, 10);
    if (!Number.isNaN(index) && Array.isArray(current)) {
      current = current[index];
    } else if (isFieldValueRecord(current)) {
      if (options.checkBlockAttributes && current.attributes && isFieldValueRecord(current.attributes)) {
        current = current.attributes[part];
      } else {
        current = current[part];
      }
    } else {
      return undefined;
    }
  }

  return current;
}

/**
 * Interface for accessing field values from different data sources.
 * Enables unified handling of values from formValues or block attributes.
 */
interface FieldValueAccessor {
  getFieldValue(fieldApiKey: string): FieldValue | undefined;
}

/**
 * Creates an accessor for form values with a path prefix.
 */
function createFormValuesAccessor(
  formValues: Record<string, FieldValue>,
  pathPrefix: string
): FieldValueAccessor {
  return {
    getFieldValue: (apiKey) => getFieldValueByPath(formValues, apiKey, pathPrefix),
  };
}

/**
 * Creates an accessor for block attributes.
 */
function createBlockAttributesAccessor(
  blockAttributes: Record<string, FieldValue>
): FieldValueAccessor {
  return {
    getFieldValue: (apiKey) => blockAttributes[apiKey],
  };
}

// FieldValidators type is imported from blockHelpers.ts

/**
 * Gets the allowed block model IDs from a field's validators.
 */
function getAllowedBlockModelIds(
  fieldType: string,
  validators: FieldValidators | undefined
): string[] {
  if (!validators) return [];

  // For modular_content and single_block, check item_item_type validator
  if (fieldType === 'modular_content' || fieldType === 'single_block') {
    return validators.item_item_type?.item_types ?? [];
  }

  // For structured_text, check structured_text_blocks or rich_text_blocks
  if (fieldType === 'structured_text') {
    return (
      validators.structured_text_blocks?.item_types ??
      validators.rich_text_blocks?.item_types ??
      []
    );
  }

  return [];
}

/**
 * Gets available locales for a localized field based on which locales have values.
 * Returns undefined if field is not localized.
 * Returns array of locales that have values (even if just 1).
 */
function getAvailableLocales(
  fieldValue: FieldValue,
  allLocales: string[]
): string[] | undefined {
  // For localized fields, the value is an object with locale keys
  // If not an object or is an array, field might be empty/undefined but still localized
  if (!isPlainObject(fieldValue)) {
    return allLocales.length > 0 ? [...allLocales] : undefined;
  }

  // Find locales that have non-empty values
  const localesWithValues = allLocales.filter((locale) => {
    const value = fieldValue[locale];
    // Check if value exists and is not empty
    if (value === undefined || value === null) return false;
    if (typeof value === 'string' && value.trim() === '') return false;
    if (Array.isArray(value) && value.length === 0) return false;
    return true;
  });

  // Return locales with values, or all locales if none have values yet
  return localesWithValues.length > 0 ? localesWithValues : [...allLocales];
}

/**
 * Configuration for processing block fields.
 */
interface BlockFieldProcessingConfig {
  ctx: RenderItemFormSidebarCtx;
  blockFields: Awaited<ReturnType<RenderItemFormSidebarCtx['loadItemTypeFields']>>;
  blockAttrs: Record<string, FieldValue>;
  blockModelName: string;
  parentFieldLabel: string;
  basePath: string;
  depth: number;
  allLocales: string[];
  blockIndex?: number;
}

/**
 * Processes fields within a block, creating FieldInfo entries and recursively
 * processing nested block containers. This consolidates the repeated for-loop
 * logic that was duplicated in loadNestedFields and loadNestedFieldsFromBlock.
 */
async function processBlockFields(
  config: BlockFieldProcessingConfig
): Promise<FieldInfo[]> {
  const {
    ctx,
    blockFields,
    blockAttrs,
    blockModelName,
    parentFieldLabel,
    basePath,
    depth,
    allLocales,
    blockIndex,
  } = config;

  const nestedFields: FieldInfo[] = [];
  const displayIndexSuffix = blockIndex !== undefined ? ` #${blockIndex + 1}` : '';

  for (const blockField of blockFields) {
    const blockFieldApiKey = blockField.attributes.api_key;
    const blockFieldLabel = blockField.attributes.label;
    const blockFieldLocalized = blockField.attributes.localized;
    const blockFieldType = blockField.attributes.field_type;
    // Use type guard helper for SDK appearance structure (see blockHelpers.ts)
    const blockFieldEditorType = getEditorType(blockField.attributes.appearance);
    const fieldPath = `${basePath}.${blockFieldApiKey}`;
    const displayLabel = `${parentFieldLabel} > ${blockModelName}${displayIndexSuffix} > ${blockFieldLabel}`;

    // Get available locales for nested localized fields
    const nestedFieldValue = blockAttrs[blockFieldApiKey];
    const availableLocales = blockFieldLocalized
      ? getAvailableLocales(nestedFieldValue, allLocales)
      : undefined;

    // Determine if this is a block container
    const nestedIsBlockContainer = isBlockContainerType(blockFieldType);
    const nestedBlockFieldType = nestedIsBlockContainer ? blockFieldType : undefined;

    nestedFields.push({
      apiKey: blockFieldApiKey,
      label: blockFieldLabel,
      localized: blockFieldLocalized,
      fieldPath,
      displayLabel,
      depth,
      availableLocales,
      fieldType: blockFieldEditorType,
      isBlockContainer: nestedIsBlockContainer,
      blockFieldType: nestedBlockFieldType,
    });

    // Recursively process nested blocks
    if (nestedIsBlockContainer) {
      // Use type guard helper for SDK validators structure (see blockHelpers.ts)
      const nestedValidators = getValidators(blockField.attributes.validators);
      const nestedAllowedIds = getAllowedBlockModelIds(blockFieldType, nestedValidators);
      const deeperFields = await loadNestedFieldsUnified(
        ctx,
        createBlockAttributesAccessor(blockAttrs),
        {
          parentFieldApiKey: blockFieldApiKey,
          parentFieldLabel: blockFieldLabel,
          parentFieldType: blockFieldType,
          allowedBlockModelIds: nestedAllowedIds,
          allLocales,
          depth: depth + 1,
          basePath,
        }
      );
      nestedFields.push(...deeperFields);
    }
  }

  return nestedFields;
}

/**
 * Configuration for unified nested field loading.
 */
interface LoadNestedFieldsConfig {
  parentFieldApiKey: string;
  parentFieldLabel: string;
  parentFieldType: string;
  allowedBlockModelIds: string[];
  allLocales: string[];
  depth: number;
  basePath: string;
}

/**
 * Unified function for loading nested fields from either form values or block attributes.
 * Uses the FieldValueAccessor pattern to abstract the data source.
 */
async function loadNestedFieldsUnified(
  ctx: RenderItemFormSidebarCtx,
  accessor: FieldValueAccessor,
  config: LoadNestedFieldsConfig
): Promise<FieldInfo[]> {
  const {
    parentFieldApiKey,
    parentFieldLabel,
    parentFieldType,
    allowedBlockModelIds,
    allLocales,
    depth,
    basePath,
  } = config;

  const nestedFields: FieldInfo[] = [];
  const fieldValue = accessor.getFieldValue(parentFieldApiKey);

  if (parentFieldType === 'single_block') {
    // Single block - only one instance, no index needed
    if (isBlockValue(fieldValue)) {
      const blockModelId = getBlockModelId(fieldValue);

      if (blockModelId && allowedBlockModelIds.includes(blockModelId)) {
        const blockModel = ctx.itemTypes[blockModelId];
        if (blockModel) {
          const blockModelName = blockModel.attributes.name;
          const newBasePath = basePath ? `${basePath}.${parentFieldApiKey}` : parentFieldApiKey;
          const blockAttrs = safeGetBlockAttributes(fieldValue);
          const blockFields = await ctx.loadItemTypeFields(blockModelId);

          const processedFields = await processBlockFields({
            ctx,
            blockFields,
            blockAttrs,
            blockModelName,
            parentFieldLabel,
            basePath: newBasePath,
            depth,
            allLocales,
          });
          nestedFields.push(...processedFields);
        }
      }
    }
  } else if (parentFieldType === 'modular_content' || parentFieldType === 'structured_text') {
    // Modular content or structured text - array of blocks with indices
    const blocks = extractBlocksFromFieldValue(fieldValue, parentFieldType);

    for (let blockIndex = 0; blockIndex < blocks.length; blockIndex++) {
      const block = blocks[blockIndex];
      const blockModelId = getBlockModelId(block);

      if (!blockModelId) {
        // Log when a block doesn't have a model ID - could indicate data corruption or schema mismatch
        logError('loadNestedFieldsUnified: Block without model ID found', undefined, {
          parentFieldApiKey,
          blockIndex,
          basePath,
          blockKeys: Object.keys(block),
        });
        continue;
      }

      const blockModel = ctx.itemTypes[blockModelId];
      if (!blockModel) {
        // Log when block references a model that doesn't exist - could indicate stale data or deleted model
        logError('loadNestedFieldsUnified: Block references unknown model', undefined, {
          parentFieldApiKey,
          blockIndex,
          blockModelId,
          basePath,
          availableModelIds: Object.keys(ctx.itemTypes).slice(0, 10), // Sample of available models
        });
        continue;
      }

      const blockModelName = blockModel.attributes.name;
      const newBasePath = basePath
        ? `${basePath}.${parentFieldApiKey}.${blockIndex}`
        : `${parentFieldApiKey}.${blockIndex}`;
      const blockAttrs = safeGetBlockAttributes(block);
      const blockFields = await ctx.loadItemTypeFields(blockModelId);

      const processedFields = await processBlockFields({
        ctx,
        blockFields,
        blockAttrs,
        blockModelName,
        parentFieldLabel,
        basePath: newBasePath,
        depth,
        allLocales,
        blockIndex,
      });
      nestedFields.push(...processedFields);
    }
  }

  return nestedFields;
}

/**
 * Recursively loads all fields from the current model, including nested fields
 * from modular content, structured text, and single block fields.
 */
export async function loadAllFields(
  ctx: RenderItemFormSidebarCtx
): Promise<FieldInfo[]> {
  const allFields: FieldInfo[] = [];
  // ctx.formValues is typed as Record<string, unknown> by the SDK
  // We treat it as Record<string, FieldValue> since FieldValue accepts unknown
  const formValues = ctx.formValues as Record<string, FieldValue>;
  const allLocales = ctx.site.attributes.locales;

  // Load top-level fields for the current model
  const topLevelFields = await ctx.loadItemTypeFields(ctx.itemType.id);

  // Process each top-level field
  for (const field of topLevelFields) {
    const fieldType = field.attributes.field_type;
    const apiKey = field.attributes.api_key;
    const label = field.attributes.label;
    const localized = field.attributes.localized;
    // Use type guard helpers for SDK structures (see blockHelpers.ts)
    const validators = getValidators(field.attributes.validators);
    const editorType = getEditorType(field.attributes.appearance);

    // Get available locales for localized fields
    const fieldValue = formValues[apiKey];
    const availableLocales = localized ? getAvailableLocales(fieldValue, allLocales) : undefined;

    // Determine if this is a block container using type guard
    const blockContainerType = isBlockContainerType(fieldType) ? fieldType : undefined;

    // Add the field itself
    allFields.push({
      apiKey,
      label,
      localized,
      fieldPath: apiKey,
      displayLabel: label,
      depth: 0,
      availableLocales,
      fieldType: editorType,
      isBlockContainer: blockContainerType !== undefined,
      blockFieldType: blockContainerType,
    });

    // Check if this field contains blocks
    if (blockContainerType) {
      const allowedBlockModelIds = getAllowedBlockModelIds(fieldType, validators);
      const nestedFields = await loadNestedFields(
        ctx,
        formValues,
        apiKey,
        label,
        fieldType,
        allowedBlockModelIds,
        allLocales,
        1 // depth
      );
      allFields.push(...nestedFields);
    }
  }

  return allFields;
}

/**
 * Loads fields from blocks within a modular content, structured text, or single block field.
 * This is a thin wrapper around loadNestedFieldsUnified for backward compatibility.
 */
async function loadNestedFields(
  ctx: RenderItemFormSidebarCtx,
  formValues: Record<string, FieldValue>,
  parentFieldApiKey: string,
  parentFieldLabel: string,
  parentFieldType: string,
  allowedBlockModelIds: string[],
  allLocales: string[],
  depth: number,
  pathPrefix = ''
): Promise<FieldInfo[]> {
  const accessor = createFormValuesAccessor(formValues, pathPrefix);
  const basePath = pathPrefix || '';

  return loadNestedFieldsUnified(ctx, accessor, {
    parentFieldApiKey,
    parentFieldLabel,
    parentFieldType,
    allowedBlockModelIds,
    allLocales,
    depth,
    basePath,
  });
}

/**
 * Gets a field value from formValues, handling nested paths.
 * Returns undefined if the path doesn't exist or value is null/undefined.
 *
 * Facade over navigateToPath for backward compatibility.
 */
function getFieldValueByPath(
  formValues: Record<string, FieldValue>,
  fieldApiKey: string,
  pathPrefix: string
): FieldValue | undefined {
  if (!pathPrefix) {
    return formValues[fieldApiKey];
  }

  // Navigate to the prefix path first
  const prefixValue = navigateToPath(formValues, pathPrefix, { checkBlockAttributes: true });

  if (isFieldValueRecord(prefixValue)) {
    // Check in attributes first (for block structure), then directly
    if (isFieldValueRecord(prefixValue.attributes)) {
      return prefixValue.attributes[fieldApiKey];
    }
    return prefixValue[fieldApiKey];
  }

  return undefined;
}

// Re-export extractBlocksFromFieldValue for consumers
export { extractBlocksFromFieldValue } from './blockHelpers';

/**
 * Gets blocks for a field at a given path, optionally for a specific locale.
 * Returns BlockInfo[] with block model metadata.
 */
export function getBlocksForField(
  ctx: RenderItemFormSidebarCtx,
  fieldPath: string,
  blockFieldType: 'modular_content' | 'structured_text' | 'single_block' | 'rich_text',
  locale?: string
): BlockInfo[] {
  // ctx.formValues is typed as Record<string, unknown> by the SDK
  const formValues = ctx.formValues as Record<string, FieldValue>;

  // Navigate to the field value at the given path, then extract locale-specific value
  const rawFieldValue = getValueAtPath(formValues, fieldPath);
  const fieldValue = extractLocalizedValue(rawFieldValue, locale);

  // Handle single_block - return single block info if present
  if (blockFieldType === 'single_block') {
    if (isBlockValue(fieldValue)) {
      const blockModelId = getBlockModelId(fieldValue);

      if (blockModelId) {
        const blockModel = ctx.itemTypes[blockModelId];
        if (blockModel) {
          return [{
            index: 0,
            modelId: blockModelId,
            modelName: blockModel.attributes.name,
          }];
        }
      }
    }
    return [];
  }
  
  // For modular_content and structured_text, extract blocks array
  const blocks = extractBlocksFromFieldValue(fieldValue, blockFieldType);
  
  return blocks
    .map((block, arrayIndex) => {
      const blockModelId = block.itemTypeId ?? block.type;
      if (!blockModelId) return null;

      const blockModel = ctx.itemTypes[blockModelId];
      if (!blockModel) return null;

      return {
        index: getBlockIndex(block, arrayIndex),
        modelId: blockModelId,
        modelName: blockModel.attributes.name,
      };
    })
    .filter((b): b is BlockInfo => b !== null);
}

/**
 * Gets fields for a specific block model, with localization info from block values.
 */
export async function getFieldsForBlock(
  ctx: RenderItemFormSidebarCtx,
  blockModelId: string,
  blockValue: Record<string, unknown> | null,
  basePath: string
): Promise<FieldInfo[]> {
  const allLocales = ctx.site.attributes.locales;
  const blockFields = await ctx.loadItemTypeFields(blockModelId);
  const blockAttrs = blockValue ?? {};

  return blockFields.map((field) => {
    const fieldApiKey = field.attributes.api_key;
    const fieldLabel = field.attributes.label;
    const fieldLocalized = field.attributes.localized;
    const fieldType = field.attributes.field_type;
    // Use type guard helper for SDK appearance structure (see blockHelpers.ts)
    const editorType = getEditorType(field.attributes.appearance);
    const fieldPath = basePath ? `${basePath}.${fieldApiKey}` : fieldApiKey;

    // Determine if this is a block container using type guard
    const blockContainerType = isBlockContainerType(fieldType) ? fieldType : undefined;

    // Get available locales for localized fields
    // blockAttrs[fieldApiKey] can be any value type
    const nestedFieldValue = blockAttrs[fieldApiKey];
    const availableLocales = fieldLocalized
      ? getAvailableLocales(nestedFieldValue, allLocales)
      : undefined;

    return {
      apiKey: fieldApiKey,
      label: fieldLabel,
      localized: fieldLocalized,
      fieldPath,
      displayLabel: fieldLabel,
      depth: 0, // Will be displayed in nested context
      availableLocales,
      fieldType: editorType,
      isBlockContainer: blockContainerType !== undefined,
      blockFieldType: blockContainerType,
    };
  });
}

/**
 * Gets a value at a given path from form values.
 * Handles nested objects, arrays, and block structures.
 * Returns undefined if the path doesn't exist or value is null/undefined.
 *
 * Facade over navigateToPath for backward compatibility.
 */
export function getValueAtPath(
  formValues: Record<string, FieldValue>,
  path: string
): FieldValue | undefined {
  return navigateToPath(formValues, path, { checkBlockAttributes: true });
}

/**
 * Extracts attributes from a block, returning either its attributes property or the block itself.
 */
function extractBlockAttrs(block: BlockValue): Record<string, unknown> {
  if (hasBlockAttributes(block)) {
    return block.attributes;
  }
  // If no separate attributes, the block itself contains the field values
  // This is safe because BlockValue has optional properties that are all string or related types
  return block as Record<string, unknown>;
}

/**
 * Gets block attributes at a specific path and index.
 */
export function getBlockAttributesAtPath(
  ctx: RenderItemFormSidebarCtx,
  fieldPath: string,
  blockIndex: number,
  blockFieldType: 'modular_content' | 'structured_text' | 'single_block' | 'rich_text',
  locale?: string
): Record<string, unknown> | null {
  // ctx.formValues is typed as Record<string, unknown> by the SDK
  const formValues = ctx.formValues as Record<string, FieldValue>;

  // Navigate to the field value at the given path, then extract locale-specific value
  const rawFieldValue = getValueAtPath(formValues, fieldPath);
  const fieldValue = extractLocalizedValue(rawFieldValue, locale);

  // Handle single_block - return the block's attributes directly
  if (blockFieldType === 'single_block') {
    if (isBlockValue(fieldValue)) {
      return extractBlockAttrs(fieldValue);
    }
    return null;
  }

  // For modular_content and structured_text, extract blocks array
  const blocks = extractBlocksFromFieldValue(fieldValue, blockFieldType);

  // Check if these are structured text blocks using type guard
  const firstBlock = blocks[0];
  const hasStructuredTextBlocks = firstBlock && isStructuredTextBlock(firstBlock);

  if (hasStructuredTextBlocks) {
    // For structured text, blockIndex is the DAST index, need to find block with matching __dastIndex
    const block = blocks.find((b) => isStructuredTextBlock(b) && b.__dastIndex === blockIndex);
    if (block) {
      return extractBlockAttrs(block);
    }
  } else {
    // Modular content - use array index directly
    if (blockIndex >= 0 && blockIndex < blocks.length) {
      const block = blocks[blockIndex];
      return extractBlockAttrs(block);
    }
  }

  return null;
}

