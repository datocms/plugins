/**
 * Model Management Utilities
 * 
 * Functions for creating, deleting, and renaming DatoCMS models
 * during block-to-model conversion.
 * 
 * @module utils/converter/model
 */

import type { CMAClient, BlockAnalysis, FieldInfo } from '../../types';

// =============================================================================
// Constants
// =============================================================================

/** Maximum length for DatoCMS API keys */
const API_KEY_MAX_LENGTH = 40;

// =============================================================================
// Model Creation
// =============================================================================

/**
 * Creates a new regular model from a block model, copying all fields.
 * 
 * @param client - DatoCMS CMA client
 * @param analysis - Analysis of the block being converted
 * @param forceLocalizedFields - If true, all fields will be created as localized
 * @returns The created model's ID and API key
 */
export async function createNewModelFromBlock(
  client: CMAClient,
  analysis: BlockAnalysis,
  forceLocalizedFields: boolean = false
): Promise<{ id: string; api_key: string }> {
  // Generate unique name and api_key
  const { name: finalName, apiKey: validatedApiKey } = await generateUniqueModelIdentifiers(
    client,
    analysis.block.name,
    analysis.block.apiKey
  );
  
  // Create the model
  const newModel = await client.itemTypes.create({
    name: finalName,
    api_key: validatedApiKey,
    modular_block: false,
    sortable: true,
    draft_mode_active: false,
    collection_appearance: 'table',
  });

  // Copy fields from block to new model
  const { titleFieldId } = await copyFieldsToModel(
    client,
    newModel.id,
    analysis.fields,
    forceLocalizedFields
  );

  // Set title field if we found a suitable one
  if (titleFieldId) {
    await client.itemTypes.update(newModel.id, {
      title_field: { type: 'field', id: titleFieldId },
    });
  }

  return { id: newModel.id, api_key: newModel.api_key };
}

/**
 * Generates unique model name and API key based on the original block.
 */
async function generateUniqueModelIdentifiers(
  client: CMAClient,
  originalName: string,
  originalApiKey: string
): Promise<{ name: string; apiKey: string }> {
  // Sanitize the api_key
  let sanitizedBlockApiKey = originalApiKey
    .toLowerCase()
    .replace(/[^a-z0-9_]/g, '_')
    .replace(/_+/g, '_')
    .replace(/^_|_$/g, '');
  
  // DatoCMS requires model API keys to be plural
  if (!sanitizedBlockApiKey.endsWith('s')) {
    sanitizedBlockApiKey = sanitizedBlockApiKey + 's';
  }
  
  // Calculate space for base api_key
  const suffixPart = `_conv`;
  const maxBaseLength = API_KEY_MAX_LENGTH - suffixPart.length - 3;
  
  // Truncate if needed
  const truncatedBlockApiKey = sanitizedBlockApiKey.length > maxBaseLength 
    ? sanitizedBlockApiKey.slice(0, maxBaseLength).replace(/_$/, '')
    : sanitizedBlockApiKey;
  
  const baseApiKey = `${truncatedBlockApiKey}${suffixPart}`;
  const baseName = originalName.replace(/[^\w\s-]/g, '').trim() || 'Converted Block';
  
  const existingModels = await client.itemTypes.list();

  let finalApiKey = sanitizeApiKey(baseApiKey);
  let finalName = `${baseName} (Converted)`;
  let counter = 0;

  // Find unique name/api_key combination
  while (
    existingModels.some((m) => m.api_key === finalApiKey) ||
    existingModels.some((m) => m.name === finalName)
  ) {
    counter++;
    const letterSuffix = counterToLetterSuffix(counter);
    finalApiKey = sanitizeApiKey(`${baseApiKey}_${letterSuffix}`);
    finalName = `${baseName} (Converted ${counter})`;

    if (counter > 100) {
      throw new Error('Could not find a unique model name/api_key after 100 attempts');
    }
  }

  // Final length check
  let validatedApiKey = finalApiKey;
  if (validatedApiKey.length > API_KEY_MAX_LENGTH) {
    validatedApiKey = validatedApiKey.slice(0, API_KEY_MAX_LENGTH).replace(/_$/, '');
  }
  
  if (!validatedApiKey || validatedApiKey.length < 1) {
    throw new Error(`Invalid api_key generated: "${baseApiKey}" -> "${validatedApiKey}"`);
  }

  return { name: finalName, apiKey: validatedApiKey };
}

/**
 * Copies fields from a block to the new model.
 */
async function copyFieldsToModel(
  client: CMAClient,
  modelId: string,
  fields: FieldInfo[],
  forceLocalizedFields: boolean
): Promise<{ titleFieldId: string | null; fieldIdMapping: Record<string, string> }> {
  let titleFieldId: string | null = null;
  const fieldIdMapping: Record<string, string> = {};
  
  // Sort fields so non-slug fields are created first
  const sortedFields = [...fields].sort((a, b) => {
    if (a.fieldType === 'slug' && b.fieldType !== 'slug') return 1;
    if (a.fieldType !== 'slug' && b.fieldType === 'slug') return -1;
    return a.position - b.position;
  });

  for (const field of sortedFields) {
    const sanitizedAppearance = sanitizeAppearance(field.appearance as Record<string, unknown>);
    const shouldBeLocalized = forceLocalizedFields ? true : field.localized;

    // Update validators that reference other fields
    let updatedValidators = field.validators;
    if (field.validators && typeof field.validators === 'object') {
      updatedValidators = updateValidatorFieldReferences(
        field.validators as Record<string, unknown>,
        fieldIdMapping
      );
    }

    // Build field creation data
    const newFieldData: Record<string, unknown> = {
      label: field.label,
      api_key: field.apiKey,
      field_type: field.fieldType,
      localized: shouldBeLocalized,
      validators: updatedValidators,
      appearance: sanitizedAppearance,
      position: field.position,
    };

    if (field.hint) {
      newFieldData.hint = field.hint;
    }

    // Handle default values carefully when forcing localization
    if (field.defaultValue !== undefined && !(forceLocalizedFields && !field.localized)) {
      newFieldData.default_value = field.defaultValue;
    }

    const newField = await client.fields.create(
      modelId,
      newFieldData as Parameters<typeof client.fields.create>[1]
    );

    // Store mapping for validator references
    fieldIdMapping[field.id] = newField.id;

    // Use first string field as title
    if (!titleFieldId && field.fieldType === 'string') {
      titleFieldId = newField.id;
    }
  }

  return { titleFieldId, fieldIdMapping };
}

// =============================================================================
// Model Deletion
// =============================================================================

/**
 * Deletes the original block model.
 * 
 * @param client - DatoCMS CMA client
 * @param blockId - ID of the block to delete
 */
export async function deleteOriginalBlock(
  client: CMAClient,
  blockId: string
): Promise<void> {
  await client.itemTypes.destroy(blockId);
}

// =============================================================================
// Model Renaming
// =============================================================================

/**
 * Result of a model rename operation.
 */
export interface RenameResult {
  success: boolean;
  finalName: string;
  finalApiKey: string;
  error?: string;
}

/**
 * Renames a model to have the same name and api_key as the original block.
 * Also updates the corresponding menu item's label.
 * 
 * Should be called AFTER the original block has been deleted.
 * 
 * @param client - DatoCMS CMA client
 * @param modelId - ID of the model to rename
 * @param originalName - Original block name
 * @param originalApiKey - Original block API key
 * @returns Result of the rename operation
 */
export async function renameModelToOriginal(
  client: CMAClient,
  modelId: string,
  originalName: string,
  originalApiKey: string
): Promise<RenameResult> {
  try {
    // Sanitize the target api_key
    const targetApiKey = originalApiKey
      .toLowerCase()
      .replace(/[^a-z0-9_]/g, '_')
      .replace(/_+/g, '_')
      .replace(/^_|_$/g, '');
    
    let finalName = originalName;
    let finalApiKey = targetApiKey;
    let partialError: string | undefined;
    
    // Try to update with exact original api_key
    try {
      await client.itemTypes.update(modelId, {
        name: originalName,
        api_key: targetApiKey,
      });
      finalApiKey = targetApiKey;
    } catch (firstError) {
      const errorMessage = firstError instanceof Error ? firstError.message : String(firstError);
      
      // Try with 's' suffix if it's a plural requirement error
      if (errorMessage.toLowerCase().includes('api_key') || errorMessage.toLowerCase().includes('plural')) {
        if (!targetApiKey.endsWith('s')) {
          const pluralApiKey = targetApiKey + 's';
          
          try {
            await client.itemTypes.update(modelId, {
              name: originalName,
              api_key: pluralApiKey,
            });
            finalApiKey = pluralApiKey;
          } catch {
            // Both attempts failed - try updating just the name
            const result = await tryUpdateNameOnly(client, modelId, originalName, targetApiKey);
            finalApiKey = result.apiKey;
            partialError = result.error;
          }
        }
      } else {
        const result = await tryUpdateNameOnly(client, modelId, originalName, errorMessage);
        finalApiKey = result.apiKey;
        partialError = result.error;
      }
    }
    
    // Update menu item label
    const menuError = await updateMenuItemLabel(client, modelId, originalName);
    if (menuError) {
      partialError = partialError ? `${partialError}; ${menuError}` : menuError;
    }
    
    return {
      success: true,
      finalName,
      finalApiKey,
      error: partialError,
    };
  } catch (error) {
    const errorMessage = error instanceof Error ? error.message : String(error);
    
    try {
      const model = await client.itemTypes.find(modelId);
      return {
        success: false,
        finalName: model.name,
        finalApiKey: model.api_key,
        error: `Failed to rename model: ${errorMessage}`,
      };
    } catch {
      return {
        success: false,
        finalName: '',
        finalApiKey: '',
        error: `Failed to rename model: ${errorMessage}`,
      };
    }
  }
}

// =============================================================================
// Helper Functions
// =============================================================================

/**
 * Converts a counter number to a letter suffix (a, b, c, ... z, aa, ab, ...).
 * DatoCMS api_keys don't allow numbers, so we use letters.
 */
function counterToLetterSuffix(n: number): string {
  let result = '';
  while (n > 0) {
    n--;
    result = String.fromCharCode(97 + (n % 26)) + result;
    n = Math.floor(n / 26);
  }
  return result;
}

/**
 * Sanitizes an API key - only lowercase letters and underscores.
 */
function sanitizeApiKey(key: string): string {
  return key
    .toLowerCase()
    .replace(/[^a-z_]/g, '')
    .replace(/_+/g, '_')
    .replace(/^_+|_+$/g, '');
}

/**
 * Sanitizes the appearance object by removing invalid properties.
 */
function sanitizeAppearance(
  appearance: Record<string, unknown> | undefined
): Record<string, unknown> | undefined {
  if (!appearance) return undefined;
  const { type: _type, ...sanitized } = appearance;
  return sanitized;
}

/**
 * Updates field ID references in validators (e.g., slug_title_field).
 */
function updateValidatorFieldReferences(
  validators: Record<string, unknown>,
  fieldIdMapping: Record<string, string>
): Record<string, unknown> {
  const updatedValidators = { ...validators };
  
  // Handle slug_title_field validator
  if (updatedValidators.slug_title_field && typeof updatedValidators.slug_title_field === 'object') {
    const slugValidator = updatedValidators.slug_title_field as Record<string, unknown>;
    const oldTitleFieldId = slugValidator.title_field_id as string | undefined;
    
    if (oldTitleFieldId && fieldIdMapping[oldTitleFieldId]) {
      updatedValidators.slug_title_field = {
        ...slugValidator,
        title_field_id: fieldIdMapping[oldTitleFieldId],
      };
    } else if (oldTitleFieldId) {
      // Referenced field not created yet - remove validator
      delete updatedValidators.slug_title_field;
    }
  }
  
  return updatedValidators;
}

/**
 * Attempts to update only the model name when api_key update fails.
 */
async function tryUpdateNameOnly(
  client: CMAClient,
  modelId: string,
  originalName: string,
  errorContext: string
): Promise<{ apiKey: string; error: string }> {
  try {
    await client.itemTypes.update(modelId, {
      name: originalName,
    });
    
    const model = await client.itemTypes.find(modelId);
    return {
      apiKey: model.api_key,
      error: `Could not update api_key: ${errorContext}`,
    };
  } catch {
    throw new Error(errorContext);
  }
}

/**
 * Updates the menu item label for a model.
 */
async function updateMenuItemLabel(
  client: CMAClient,
  modelId: string,
  newLabel: string
): Promise<string | undefined> {
  try {
    const menuItems = await client.menuItems.list();
    const menuItem = menuItems.find((item) => item.item_type?.id === modelId);
    
    if (menuItem) {
      await client.menuItems.update(menuItem.id, {
        label: newLabel,
      });
    }
    return undefined;
  } catch (error) {
    const errorMessage = error instanceof Error ? error.message : String(error);
    return `Menu item label could not be updated: ${errorMessage}`;
  }
}


