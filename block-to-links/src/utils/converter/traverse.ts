/**
 * Nested Block Traversal Utilities
 * 
 * Functions for traversing and updating nested block structures in DatoCMS.
 * These utilities handle the complex task of navigating through arbitrary
 * nesting depths of blocks within modular content fields.
 * 
 * @module utils/converter/traverse
 */

import type { NestedBlockPath } from '../../types';
import { getBlockTypeId, extractBlocksFromFieldValue, type BlockFieldType } from '../blocks';

// =============================================================================
// Types
// =============================================================================

/** Result of a traversal operation */
export interface TraversalResult {
  /** Whether any updates were made */
  updated: boolean;
  /** The new value after traversal (may be unchanged) */
  newValue: unknown;
}

/** Function that updates a block and returns the modified block */
export type BlockUpdateFn = (
  blockData: Record<string, unknown>,
  locale: string | null
) => Record<string, unknown>;

// =============================================================================
// Block Field Access
// =============================================================================

/**
 * Gets a field value from a block object.
 * Handles both direct properties and values nested in `attributes`.
 * 
 * @param block - The block object to read from
 * @param fieldApiKey - The API key of the field to read
 * @returns The field value, or undefined if not found
 */
export function getNestedFieldValueFromBlock(
  block: Record<string, unknown>,
  fieldApiKey: string
): unknown {
  // Check directly on block first
  if (block[fieldApiKey] !== undefined) {
    return block[fieldApiKey];
  }
  // Check in attributes (CMA client may return block data in attributes)
  const attributes = block.attributes as Record<string, unknown> | undefined;
  if (attributes && attributes[fieldApiKey] !== undefined) {
    return attributes[fieldApiKey];
  }
  return undefined;
}

/**
 * Sets a field value in a block object.
 * Handles both direct properties and values nested in `attributes`.
 * Returns a new block object (does not mutate the original).
 * 
 * @param block - The block object to update
 * @param fieldApiKey - The API key of the field to set
 * @param value - The value to set
 * @returns A new block object with the updated field
 */
export function setNestedFieldValueInBlock(
  block: Record<string, unknown>,
  fieldApiKey: string,
  value: unknown
): Record<string, unknown> {
  // Deep clone to avoid mutation
  const clonedBlock = JSON.parse(JSON.stringify(block));

  // Check if field exists at top level or in attributes
  if (block[fieldApiKey] !== undefined) {
    clonedBlock[fieldApiKey] = value;
  } else {
    const attributes = block.attributes as Record<string, unknown> | undefined;
    if (attributes && attributes[fieldApiKey] !== undefined) {
      clonedBlock.attributes = { ...attributes, [fieldApiKey]: value };
    } else {
      // Default to setting at top level
      clonedBlock[fieldApiKey] = value;
    }
  }

  return clonedBlock;
}

// =============================================================================
// Structured Text Reconstruction
// =============================================================================

/**
 * Reconstructs a structured text value with updated block data.
 * 
 * Handles two formats:
 * - Traditional format: blocks in the `blocks` array
 * - Nested format (nested: true): blocks inlined in `document.children`
 * 
 * @param originalValue - The original structured text value
 * @param updatedBlocks - The updated block objects
 * @returns Reconstructed structured text value
 */
export function reconstructStructuredTextWithUpdatedBlocks(
  originalValue: Record<string, unknown>,
  updatedBlocks: unknown[]
): Record<string, unknown> {
  const result = { ...originalValue };
  
  // Check if we have inlined blocks in document.children
  const document = originalValue.document as Record<string, unknown> | undefined;
  if (document && typeof document === 'object') {
    const children = document.children as unknown[] | undefined;
    if (Array.isArray(children)) {
      // Check if children contain inlined blocks (nested: true format)
      const hasInlinedBlocks = children.some(child => {
        if (child && typeof child === 'object') {
          const childObj = child as Record<string, unknown>;
          return childObj.type === 'block' && 
                 childObj.item !== undefined && 
                 typeof childObj.item === 'object';
        }
        return false;
      });
      
      if (hasInlinedBlocks) {
        // Update inlined blocks in document.children
        let blockIndex = 0;
        const newChildren = children.map(child => {
          if (child && typeof child === 'object') {
            const childObj = child as Record<string, unknown>;
            if (childObj.type === 'block' && childObj.item !== undefined) {
              // Replace with updated block data
              if (blockIndex < updatedBlocks.length) {
                const updatedChild = {
                  ...childObj,
                  item: updatedBlocks[blockIndex],
                };
                blockIndex++;
                return updatedChild;
              }
            }
          }
          return child;
        });
        
        result.document = {
          ...document,
          children: newChildren,
        };
        return result;
      }
    }
  }
  
  // Fallback: use traditional blocks array
  result.blocks = updatedBlocks;
  return result;
}

// =============================================================================
// Block Array Processing
// =============================================================================

/**
 * Processes an array of blocks at the current traversal level.
 * Either applies updates at the final level or recurses into nested blocks.
 * 
 * @param blocks - Array of blocks to process
 * @param locale - Current locale (null if not in localized context)
 * @param currentStep - Current step in the path
 * @param isLastStep - Whether this is the final step in the path
 * @param path - Full path being traversed
 * @param pathIndex - Current index in the path
 * @param updateFn - Function to apply updates
 * @returns Result with updated flag and new blocks array
 */
function processBlocksArray(
  blocks: unknown[],
  locale: string | null,
  currentStep: NestedBlockPath['path'][0],
  isLastStep: boolean,
  path: NestedBlockPath['path'],
  pathIndex: number,
  updateFn: BlockUpdateFn
): { updated: boolean; newBlocks: unknown[] } {
  let updated = false;
  const newBlocks: unknown[] = [];

  for (const block of blocks) {
    if (!block || typeof block !== 'object') {
      newBlocks.push(block);
      continue;
    }

    const blockObj = block as Record<string, unknown>;
    const blockTypeId = getBlockTypeId(blockObj);

    // Check if this block matches the expected type at this path level
    if (blockTypeId === currentStep.expectedBlockTypeId) {
      if (isLastStep) {
        // Final step - apply the update function to this block
        const updatedBlock = updateFn(blockObj, locale);
        newBlocks.push(updatedBlock);
        updated = true;
      } else {
        // Intermediate step - recurse into nested field
        const nextStep = path[pathIndex + 1];
        const nestedFieldValue = getNestedFieldValueFromBlock(blockObj, nextStep.fieldApiKey);

        if (nestedFieldValue !== undefined) {
          // Recurse into the nested field
          const result = traverseAndUpdateNestedBlocks(
            nestedFieldValue,
            path,
            pathIndex + 1,
            updateFn
          );

          if (result.updated) {
            // Update the block with the new nested field value
            const updatedBlock = setNestedFieldValueInBlock(
              blockObj,
              nextStep.fieldApiKey,
              result.newValue
            );
            newBlocks.push(updatedBlock);
            updated = true;
          } else {
            newBlocks.push(block);
          }
        } else {
          newBlocks.push(block);
        }
      }
    } else {
      // Block type doesn't match - keep as is
      newBlocks.push(block);
    }
  }

  return { updated, newBlocks };
}

// =============================================================================
// Main Traversal Functions
// =============================================================================

/**
 * Recursively traverses and updates nested block structures.
 * 
 * This is the core recursive function that navigates through arbitrary
 * nesting depths of blocks, following a path from root to target blocks.
 * 
 * @param fieldValue - The current field value to process
 * @param path - Array of path steps defining the traversal route
 * @param pathIndex - Current index in the path array
 * @param updateFn - Function to call when we reach the target block
 * @returns Result with updated flag and new field value
 * 
 * @example
 * // Path: sections → socials → target_block
 * const result = traverseAndUpdateNestedBlocks(
 *   record.sections,
 *   [
 *     { fieldApiKey: 'sections', expectedBlockTypeId: 'hero_block', ... },
 *     { fieldApiKey: 'socials', expectedBlockTypeId: 'target_block', ... }
 *   ],
 *   0,
 *   (block, locale) => ({ ...block, newField: 'value' })
 * );
 */
export function traverseAndUpdateNestedBlocks(
  fieldValue: unknown,
  path: NestedBlockPath['path'],
  pathIndex: number,
  updateFn: BlockUpdateFn
): TraversalResult {
  // Base case: reached end of path or no value
  if (pathIndex >= path.length || !fieldValue) {
    return { updated: false, newValue: fieldValue };
  }

  const currentStep = path[pathIndex];
  const isLastStep = pathIndex === path.length - 1;

  // Handle localized vs non-localized fields
  if (currentStep.localized && typeof fieldValue === 'object' && !Array.isArray(fieldValue)) {
    // Localized field - process each locale
    let anyUpdated = false;
    const newLocalizedValue: Record<string, unknown> = {};

    for (const [locale, localeValue] of Object.entries(fieldValue as Record<string, unknown>)) {
      const blocks = extractBlocksFromFieldValue(localeValue, currentStep.fieldType);
      
      if (blocks.length > 0) {
        const result = processBlocksArray(
          blocks, locale, currentStep, isLastStep, path, pathIndex, updateFn
        );
        
        if (result.updated) {
          anyUpdated = true;
          newLocalizedValue[locale] = reconstructFieldValue(
            localeValue, 
            result.newBlocks, 
            currentStep.fieldType
          );
        } else {
          newLocalizedValue[locale] = localeValue;
        }
      } else {
        newLocalizedValue[locale] = localeValue;
      }
    }

    return { updated: anyUpdated, newValue: newLocalizedValue };
  }

  // Non-localized field
  const blocks = extractBlocksFromFieldValue(fieldValue, currentStep.fieldType);
  
  if (blocks.length > 0) {
    const result = processBlocksArray(
      blocks, null, currentStep, isLastStep, path, pathIndex, updateFn
    );
    
    if (result.updated) {
      return {
        updated: true,
        newValue: reconstructFieldValue(fieldValue, result.newBlocks, currentStep.fieldType)
      };
    }
  }

  return { updated: false, newValue: fieldValue };
}

/**
 * Traverses blocks at a single level and applies updates.
 * 
 * Used when we need to update blocks at the first level of nesting,
 * without recursing into deeper levels.
 * 
 * @param fieldValue - The field value containing blocks
 * @param step - The path step describing this level
 * @param updateFn - Function to apply to matching blocks
 * @returns Result with updated flag and new field value
 */
export function traverseAndUpdateNestedBlocksAtLevel(
  fieldValue: unknown,
  step: NestedBlockPath['path'][0],
  updateFn: BlockUpdateFn
): TraversalResult {
  if (!fieldValue) {
    return { updated: false, newValue: fieldValue };
  }

  // Helper to process blocks without recursion
  const processBlocksAtLevel = (
    blocks: unknown[],
    locale: string | null
  ): { updated: boolean; newBlocks: unknown[] } => {
    let updated = false;
    const newBlocks: unknown[] = [];

    for (const block of blocks) {
      if (!block || typeof block !== 'object') {
        newBlocks.push(block);
        continue;
      }

      const blockObj = block as Record<string, unknown>;
      const blockTypeId = getBlockTypeId(blockObj);

      if (blockTypeId === step.expectedBlockTypeId) {
        // Apply the update function to this block
        const updatedBlock = updateFn(blockObj, locale);
        newBlocks.push(updatedBlock);
        updated = true;
      } else {
        newBlocks.push(block);
      }
    }

    return { updated, newBlocks };
  };

  // Handle localized vs non-localized fields
  if (step.localized && typeof fieldValue === 'object' && !Array.isArray(fieldValue)) {
    let anyUpdated = false;
    const newLocalizedValue: Record<string, unknown> = {};

    for (const [locale, localeValue] of Object.entries(fieldValue as Record<string, unknown>)) {
      const blocks = extractBlocksFromFieldValue(localeValue, step.fieldType);
      
      if (blocks.length > 0) {
        const result = processBlocksAtLevel(blocks, locale);
        if (result.updated) {
          anyUpdated = true;
          newLocalizedValue[locale] = reconstructFieldValue(
            localeValue, 
            result.newBlocks, 
            step.fieldType
          );
        } else {
          newLocalizedValue[locale] = localeValue;
        }
      } else {
        newLocalizedValue[locale] = localeValue;
      }
    }

    return { updated: anyUpdated, newValue: newLocalizedValue };
  }

  // Non-localized field
  const blocks = extractBlocksFromFieldValue(fieldValue, step.fieldType);
  
  if (blocks.length > 0) {
    const result = processBlocksAtLevel(blocks, null);
    if (result.updated) {
      return {
        updated: true,
        newValue: reconstructFieldValue(fieldValue, result.newBlocks, step.fieldType)
      };
    }
  }

  return { updated: false, newValue: fieldValue };
}

// =============================================================================
// Block Removal Traversal
// =============================================================================

/**
 * Recursively traverses and removes target blocks from nested structures.
 * 
 * Used for cleaning up the original modular content field after migration.
 * Removes blocks of a specific type while preserving all other blocks.
 * 
 * @param fieldValue - The field value to process
 * @param path - Path to traverse to find blocks
 * @param pathIndex - Current index in the path
 * @param targetBlockId - ID of the block type to remove
 * @returns Result with updated flag and cleaned field value
 */
export function traverseAndRemoveBlocks(
  fieldValue: unknown,
  path: NestedBlockPath['path'],
  pathIndex: number,
  targetBlockId: string
): TraversalResult {
  if (pathIndex >= path.length || !fieldValue) {
    return { updated: false, newValue: fieldValue };
  }

  const currentStep = path[pathIndex];
  const isLastStep = pathIndex === path.length - 1;

  // Helper to process and filter blocks
  const processBlocksArray = (blocks: unknown[]): { updated: boolean; newBlocks: unknown[] } => {
    let updated = false;
    const newBlocks: unknown[] = [];

    for (const block of blocks) {
      if (!block || typeof block !== 'object') {
        newBlocks.push(block);
        continue;
      }

      const blockObj = block as Record<string, unknown>;
      const blockTypeId = getBlockTypeId(blockObj);

      if (isLastStep) {
        // At final level - remove target blocks, keep others
        if (blockTypeId === targetBlockId) {
          updated = true; // Block removed
        } else {
          newBlocks.push(block);
        }
      } else {
        // Check if this block matches the expected type
        if (blockTypeId === currentStep.expectedBlockTypeId) {
          const nextStep = path[pathIndex + 1];
          const nestedFieldValue = getNestedFieldValueFromBlock(blockObj, nextStep.fieldApiKey);

          if (nestedFieldValue !== undefined) {
            const result = traverseAndRemoveBlocks(
              nestedFieldValue,
              path,
              pathIndex + 1,
              targetBlockId
            );

            if (result.updated) {
              const updatedBlock = setNestedFieldValueInBlock(
                blockObj,
                nextStep.fieldApiKey,
                result.newValue
              );
              newBlocks.push(updatedBlock);
              updated = true;
            } else {
              newBlocks.push(block);
            }
          } else {
            newBlocks.push(block);
          }
        } else {
          newBlocks.push(block);
        }
      }
    }

    return { updated, newBlocks };
  };

  // Handle localized vs non-localized
  if (currentStep.localized && typeof fieldValue === 'object' && !Array.isArray(fieldValue)) {
    let anyUpdated = false;
    const newLocalizedValue: Record<string, unknown> = {};

    for (const [locale, localeValue] of Object.entries(fieldValue as Record<string, unknown>)) {
      const blocks = extractBlocksFromFieldValue(localeValue, currentStep.fieldType);
      
      if (blocks.length > 0) {
        const result = processBlocksArray(blocks);
        if (result.updated) {
          anyUpdated = true;
          newLocalizedValue[locale] = reconstructFieldValue(
            localeValue, 
            result.newBlocks, 
            currentStep.fieldType
          );
        } else {
          newLocalizedValue[locale] = localeValue;
        }
      } else {
        newLocalizedValue[locale] = localeValue;
      }
    }

    return { updated: anyUpdated, newValue: newLocalizedValue };
  }

  // Non-localized
  const blocks = extractBlocksFromFieldValue(fieldValue, currentStep.fieldType);
  
  if (blocks.length > 0) {
    const result = processBlocksArray(blocks);
    if (result.updated) {
      return {
        updated: true,
        newValue: reconstructFieldValue(fieldValue, result.newBlocks, currentStep.fieldType)
      };
    }
  }

  return { updated: false, newValue: fieldValue };
}

// =============================================================================
// Helper Functions
// =============================================================================

/**
 * Reconstructs a field value with updated blocks based on field type.
 * 
 * @param originalValue - The original field value
 * @param newBlocks - The new/updated blocks array
 * @param fieldType - The type of field
 * @returns Reconstructed field value
 */
function reconstructFieldValue(
  originalValue: unknown,
  newBlocks: unknown[],
  fieldType: BlockFieldType
): unknown {
  if (fieldType === 'single_block') {
    return newBlocks[0] || null;
  }
  
  if (fieldType === 'structured_text') {
    return reconstructStructuredTextWithUpdatedBlocks(
      originalValue as Record<string, unknown>,
      newBlocks
    );
  }
  
  // rich_text - return array directly
  return newBlocks;
}


