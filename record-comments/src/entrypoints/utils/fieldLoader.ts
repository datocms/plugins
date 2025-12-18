import type { RenderItemFormSidebarCtx } from 'datocms-plugin-sdk';
import type { FieldInfo } from '../hooks/useMentions';

// Field types that contain nested block structures
const BLOCK_CONTAINER_TYPES = ['modular_content', 'structured_text', 'single_block'];

type BlockValue = {
  id?: string;
  type?: string;
  itemTypeId?: string;
  attributes?: Record<string, unknown>;
  // For structured text, blocks are in a different format
  item?: string;
};

type FieldValue = BlockValue[] | BlockValue | unknown;

// Type for field validators that contain block model IDs
type FieldValidators = {
  item_item_type?: { item_types: string[] };
  rich_text_blocks?: { item_types: string[] };
  structured_text_blocks?: { item_types: string[] };
};

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
  if (!fieldValue || typeof fieldValue !== 'object' || Array.isArray(fieldValue)) {
    // Field value might be empty/undefined but field is still localized
    // Return all locales in this case so user can still select one
    return allLocales.length > 0 ? [...allLocales] : undefined;
  }

  const localizedValue = fieldValue as Record<string, unknown>;
  
  // Find locales that have non-empty values
  const localesWithValues = allLocales.filter((locale) => {
    const value = localizedValue[locale];
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
 * Recursively loads all fields from the current model, including nested fields
 * from modular content, structured text, and single block fields.
 */
export async function loadAllFields(
  ctx: RenderItemFormSidebarCtx
): Promise<FieldInfo[]> {
  const allFields: FieldInfo[] = [];
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
    const validators = field.attributes.validators as FieldValidators | undefined;
    const editorType = (field.attributes.appearance as { editor?: string } | undefined)?.editor;

    // Get available locales for localized fields
    const fieldValue = formValues[apiKey];
    const availableLocales = localized ? getAvailableLocales(fieldValue, allLocales) : undefined;

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
    });

    // Check if this field contains blocks
    if (BLOCK_CONTAINER_TYPES.includes(fieldType)) {
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
  const nestedFields: FieldInfo[] = [];
  const fieldValue = getFieldValueByPath(formValues, parentFieldApiKey, pathPrefix);

  if (parentFieldType === 'single_block') {
    // Single block - only one instance, no index needed
    if (fieldValue && typeof fieldValue === 'object' && !Array.isArray(fieldValue)) {
      const blockValue = fieldValue as BlockValue;
      const blockModelId = blockValue.itemTypeId ?? blockValue.type;

      if (blockModelId && allowedBlockModelIds.includes(blockModelId)) {
        const blockModel = ctx.itemTypes[blockModelId];
        if (blockModel) {
          const blockModelName = blockModel.attributes.name;
          const basePath = pathPrefix ? `${pathPrefix}.${parentFieldApiKey}` : parentFieldApiKey;
          const blockAttrs = (blockValue.attributes ?? blockValue) as Record<string, FieldValue>;

          // Load fields for this block model
          const blockFields = await ctx.loadItemTypeFields(blockModelId);

          for (const blockField of blockFields) {
            const blockFieldApiKey = blockField.attributes.api_key;
            const blockFieldLabel = blockField.attributes.label;
            const blockFieldLocalized = blockField.attributes.localized;
            const blockFieldType = blockField.attributes.field_type;
            const blockFieldEditorType = (blockField.attributes.appearance as { editor?: string } | undefined)?.editor;
            const fieldPath = `${basePath}.${blockFieldApiKey}`;
            const displayLabel = `${parentFieldLabel} > ${blockModelName} > ${blockFieldLabel}`;

            // Get available locales for nested localized fields
            const nestedFieldValue = blockAttrs[blockFieldApiKey];
            const availableLocales = blockFieldLocalized 
              ? getAvailableLocales(nestedFieldValue, allLocales) 
              : undefined;

            nestedFields.push({
              apiKey: blockFieldApiKey,
              label: blockFieldLabel,
              localized: blockFieldLocalized,
              fieldPath,
              displayLabel,
              depth,
              availableLocales,
              fieldType: blockFieldEditorType,
            });

            // Recursively process nested blocks
            if (BLOCK_CONTAINER_TYPES.includes(blockFieldType)) {
              const nestedValidators = blockField.attributes.validators as FieldValidators | undefined;
              const nestedAllowedIds = getAllowedBlockModelIds(blockFieldType, nestedValidators);
              const deeperFields = await loadNestedFields(
                ctx,
                formValues,
                blockFieldApiKey,
                blockFieldLabel,
                blockFieldType,
                nestedAllowedIds,
                allLocales,
                depth + 1,
                basePath
              );
              nestedFields.push(...deeperFields);
            }
          }
        }
      }
    }
  } else if (parentFieldType === 'modular_content' || parentFieldType === 'structured_text') {
    // Modular content or structured text - array of blocks with indices
    const blocks = extractBlocksFromFieldValue(fieldValue, parentFieldType);

    for (let blockIndex = 0; blockIndex < blocks.length; blockIndex++) {
      const block = blocks[blockIndex];
      const blockModelId = block.itemTypeId ?? block.type;

      if (!blockModelId) continue;

      const blockModel = ctx.itemTypes[blockModelId];
      if (!blockModel) continue;

      const blockModelName = blockModel.attributes.name;
      const basePath = pathPrefix
        ? `${pathPrefix}.${parentFieldApiKey}.${blockIndex}`
        : `${parentFieldApiKey}.${blockIndex}`;
      const blockAttrs = (block.attributes ?? block) as Record<string, FieldValue>;

      // Load fields for this block model
      const blockFields = await ctx.loadItemTypeFields(blockModelId);

      for (const blockField of blockFields) {
        const blockFieldApiKey = blockField.attributes.api_key;
        const blockFieldLabel = blockField.attributes.label;
        const blockFieldLocalized = blockField.attributes.localized;
        const blockFieldType = blockField.attributes.field_type;
        const blockFieldEditorType = (blockField.attributes.appearance as { editor?: string } | undefined)?.editor;
        const fieldPath = `${basePath}.${blockFieldApiKey}`;
        const displayLabel = `${parentFieldLabel} > ${blockModelName} #${blockIndex + 1} > ${blockFieldLabel}`;

        // Get available locales for nested localized fields
        const nestedFieldValue = blockAttrs[blockFieldApiKey];
        const availableLocales = blockFieldLocalized 
          ? getAvailableLocales(nestedFieldValue, allLocales) 
          : undefined;

        nestedFields.push({
          apiKey: blockFieldApiKey,
          label: blockFieldLabel,
          localized: blockFieldLocalized,
          fieldPath,
          displayLabel,
          depth,
          availableLocales,
          fieldType: blockFieldEditorType,
        });

        // Recursively process nested blocks
        if (BLOCK_CONTAINER_TYPES.includes(blockFieldType)) {
          const nestedValidators = blockField.attributes.validators as FieldValidators | undefined;
          const nestedAllowedIds = getAllowedBlockModelIds(blockFieldType, nestedValidators);
          const deeperFields = await loadNestedFieldsFromBlock(
            ctx,
            blockAttrs,
            blockFieldApiKey,
            blockFieldLabel,
            blockFieldType,
            nestedAllowedIds,
            allLocales,
            depth + 1,
            basePath
          );
          nestedFields.push(...deeperFields);
        }
      }
    }
  }

  return nestedFields;
}

/**
 * Loads nested fields from within a block's attributes.
 */
async function loadNestedFieldsFromBlock(
  ctx: RenderItemFormSidebarCtx,
  blockAttributes: Record<string, FieldValue>,
  parentFieldApiKey: string,
  parentFieldLabel: string,
  parentFieldType: string,
  allowedBlockModelIds: string[],
  allLocales: string[],
  depth: number,
  pathPrefix: string
): Promise<FieldInfo[]> {
  const nestedFields: FieldInfo[] = [];
  const fieldValue = blockAttributes[parentFieldApiKey];

  if (parentFieldType === 'single_block') {
    // Single block within a block
    if (fieldValue && typeof fieldValue === 'object' && !Array.isArray(fieldValue)) {
      const blockValue = fieldValue as BlockValue;
      const blockModelId = blockValue.itemTypeId ?? blockValue.type;

      if (blockModelId && allowedBlockModelIds.includes(blockModelId)) {
        const blockModel = ctx.itemTypes[blockModelId];
        if (blockModel) {
          const blockModelName = blockModel.attributes.name;
          const basePath = `${pathPrefix}.${parentFieldApiKey}`;
          const blockAttrs = (blockValue.attributes ?? blockValue) as Record<string, FieldValue>;

          const blockFields = await ctx.loadItemTypeFields(blockModelId);

          for (const blockField of blockFields) {
            const blockFieldApiKey = blockField.attributes.api_key;
            const blockFieldLabel = blockField.attributes.label;
            const blockFieldLocalized = blockField.attributes.localized;
            const blockFieldType = blockField.attributes.field_type;
            const blockFieldEditorType = (blockField.attributes.appearance as { editor?: string } | undefined)?.editor;
            const fieldPath = `${basePath}.${blockFieldApiKey}`;
            const displayLabel = `${parentFieldLabel} > ${blockModelName} > ${blockFieldLabel}`;

            // Get available locales for nested localized fields
            const nestedFieldValue = blockAttrs[blockFieldApiKey];
            const availableLocales = blockFieldLocalized 
              ? getAvailableLocales(nestedFieldValue, allLocales) 
              : undefined;

            nestedFields.push({
              apiKey: blockFieldApiKey,
              label: blockFieldLabel,
              localized: blockFieldLocalized,
              fieldPath,
              displayLabel,
              depth,
              availableLocales,
              fieldType: blockFieldEditorType,
            });

            // Continue recursion
            if (BLOCK_CONTAINER_TYPES.includes(blockFieldType)) {
              const nestedValidators = blockField.attributes.validators as FieldValidators | undefined;
              const nestedAllowedIds = getAllowedBlockModelIds(blockFieldType, nestedValidators);
              const deeperFields = await loadNestedFieldsFromBlock(
                ctx,
                blockAttrs,
                blockFieldApiKey,
                blockFieldLabel,
                blockFieldType,
                nestedAllowedIds,
                allLocales,
                depth + 1,
                basePath
              );
              nestedFields.push(...deeperFields);
            }
          }
        }
      }
    }
  } else if (parentFieldType === 'modular_content' || parentFieldType === 'structured_text') {
    // Modular content or structured text within a block
    const blocks = extractBlocksFromFieldValue(fieldValue, parentFieldType);

    for (let blockIndex = 0; blockIndex < blocks.length; blockIndex++) {
      const block = blocks[blockIndex];
      const blockModelId = block.itemTypeId ?? block.type;

      if (!blockModelId) continue;

      const blockModel = ctx.itemTypes[blockModelId];
      if (!blockModel) continue;

      const blockModelName = blockModel.attributes.name;
      const basePath = `${pathPrefix}.${parentFieldApiKey}.${blockIndex}`;
      const blockAttrs = (block.attributes ?? block) as Record<string, FieldValue>;

      const blockFields = await ctx.loadItemTypeFields(blockModelId);

      for (const blockField of blockFields) {
        const blockFieldApiKey = blockField.attributes.api_key;
        const blockFieldLabel = blockField.attributes.label;
        const blockFieldLocalized = blockField.attributes.localized;
        const blockFieldType = blockField.attributes.field_type;
        const blockFieldEditorType = (blockField.attributes.appearance as { editor?: string } | undefined)?.editor;
        const fieldPath = `${basePath}.${blockFieldApiKey}`;
        const displayLabel = `${parentFieldLabel} > ${blockModelName} #${blockIndex + 1} > ${blockFieldLabel}`;

        // Get available locales for nested localized fields
        const nestedFieldValue = blockAttrs[blockFieldApiKey];
        const availableLocales = blockFieldLocalized 
          ? getAvailableLocales(nestedFieldValue, allLocales) 
          : undefined;

        nestedFields.push({
          apiKey: blockFieldApiKey,
          label: blockFieldLabel,
          localized: blockFieldLocalized,
          fieldPath,
          displayLabel,
          depth,
          availableLocales,
          fieldType: blockFieldEditorType,
        });

        // Continue recursion
        if (BLOCK_CONTAINER_TYPES.includes(blockFieldType)) {
          const nestedValidators = blockField.attributes.validators as FieldValidators | undefined;
          const nestedAllowedIds = getAllowedBlockModelIds(blockFieldType, nestedValidators);
          const deeperFields = await loadNestedFieldsFromBlock(
            ctx,
            blockAttrs,
            blockFieldApiKey,
            blockFieldLabel,
            blockFieldType,
            nestedAllowedIds,
            allLocales,
            depth + 1,
            basePath
          );
          nestedFields.push(...deeperFields);
        }
      }
    }
  }

  return nestedFields;
}

/**
 * Gets a field value from formValues, handling nested paths.
 */
function getFieldValueByPath(
  formValues: Record<string, FieldValue>,
  fieldApiKey: string,
  pathPrefix: string
): FieldValue {
  if (!pathPrefix) {
    return formValues[fieldApiKey];
  }

  // Navigate through the path to get the nested value
  const pathParts = pathPrefix.split('.');
  let current: FieldValue = formValues;

  for (const part of pathParts) {
    if (current === undefined || current === null) return undefined as unknown as FieldValue;

    // Check if this is a numeric index
    const index = parseInt(part, 10);
    if (!Number.isNaN(index) && Array.isArray(current)) {
      current = current[index];
    } else if (typeof current === 'object' && !Array.isArray(current)) {
      const obj = current as Record<string, FieldValue>;
      // Check in attributes first (for block structure), then directly
      if (obj.attributes && typeof obj.attributes === 'object') {
        current = (obj.attributes as Record<string, FieldValue>)[part];
      } else {
        current = obj[part];
      }
    }
  }

  if (current && typeof current === 'object' && !Array.isArray(current)) {
    const obj = current as Record<string, FieldValue>;
    if (obj.attributes && typeof obj.attributes === 'object') {
      return (obj.attributes as Record<string, FieldValue>)[fieldApiKey];
    }
    return obj[fieldApiKey];
  }

  return undefined as unknown as FieldValue;
}

/**
 * Extracts blocks from a field value, handling both modular content and structured text formats.
 */
function extractBlocksFromFieldValue(
  fieldValue: FieldValue,
  fieldType: string
): BlockValue[] {
  if (!fieldValue) return [];

  if (fieldType === 'structured_text') {
    // Structured text stores blocks in a DAST (document) format
    // We need to extract blocks from the document
    if (typeof fieldValue === 'object' && 'document' in (fieldValue as Record<string, unknown>)) {
      const doc = fieldValue as { document: unknown; schema: string; blocks?: BlockValue[] };
      // Blocks are stored separately in the blocks array
      return doc.blocks ?? [];
    }
    // May also just be an array of blocks directly
    if (Array.isArray(fieldValue)) {
      return fieldValue as BlockValue[];
    }
    return [];
  }

  // Modular content is just an array of blocks
  if (Array.isArray(fieldValue)) {
    return fieldValue as BlockValue[];
  }

  return [];
}

