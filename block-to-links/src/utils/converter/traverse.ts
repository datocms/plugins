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
import {
  type BlockFieldType,
  extractBlocksFromFieldValue,
  getBlockId,
  getBlockTypeId,
} from '../blocks';

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
  locale: string | null,
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
  fieldApiKey: string,
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
 * Builds a minimal CMA update for one field of an existing nested block.
 *
 * Expanded `nested: true` responses must not be round-tripped: they can contain
 * unrelated attributes that became stale after a schema change. Existing blocks
 * are therefore represented as an ID plus only the changed attribute.
 *
 * @param block - The block object to update
 * @param fieldApiKey - The API key of the field to set
 * @param value - The value to set
 * @returns A new block object with the updated field
 */
export function setNestedFieldValueInBlock(
  block: Record<string, unknown>,
  fieldApiKey: string,
  value: unknown,
): Record<string, unknown> {
  const blockId = getBlockId(block);
  if (blockId) {
    const blockTypeId = getBlockTypeId(block);
    return {
      type: 'item',
      id: blockId,
      ...(blockTypeId
        ? {
            relationships: {
              item_type: {
                data: {
                  type: 'item_type',
                  id: blockTypeId,
                },
              },
            },
          }
        : {}),
      attributes: {
        [fieldApiKey]: value,
      },
    };
  }

  // Defensive fallback for an unsaved block. Nested responses normally always
  // have IDs, but preserving the complete creation envelope is safer here.
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

/**
 * Represents an untouched existing block with its ID, as required by the CMA
 * request contract. Unsaved blocks are kept as complete creation payloads.
 */
function unchangedBlockReference(block: unknown): unknown {
  if (!block || typeof block !== 'object') return block;
  return getBlockId(block as Record<string, unknown>) ?? block;
}

// =============================================================================
// Structured Text Reconstruction
// =============================================================================

/**
 * Reconstructs a structured text value with updated block data.
 *
 * Handles two formats:
 * - Traditional format: blocks in the `blocks` array
 * - Nested format (nested: true): blocks inlined anywhere in the DAST document
 *
 * @param originalValue - The original structured text value
 * @param updatedBlocks - The updated block objects
 * @returns Reconstructed structured text value
 */
function hasInlinedBlockNode(node: unknown): boolean {
  if (Array.isArray(node)) return node.some(hasInlinedBlockNode);
  if (!node || typeof node !== 'object') return false;

  const nodeObject = node as Record<string, unknown>;
  if (
    (nodeObject.type === 'block' || nodeObject.type === 'inlineBlock') &&
    nodeObject.item !== undefined &&
    typeof nodeObject.item === 'object'
  ) {
    return true;
  }

  return Object.values(nodeObject).some(hasInlinedBlockNode);
}

function replaceInlinedBlockNodes(
  node: unknown,
  updatedBlocks: unknown[],
  blockIndex: { current: number },
): unknown {
  if (Array.isArray(node)) {
    return node.map((child) =>
      replaceInlinedBlockNodes(child, updatedBlocks, blockIndex),
    );
  }
  if (!node || typeof node !== 'object') return node;

  const nodeObject = node as Record<string, unknown>;
  if (
    (nodeObject.type === 'block' || nodeObject.type === 'inlineBlock') &&
    nodeObject.item !== undefined &&
    typeof nodeObject.item === 'object' &&
    blockIndex.current < updatedBlocks.length
  ) {
    const updatedNode = {
      ...nodeObject,
      item: updatedBlocks[blockIndex.current],
    };
    blockIndex.current++;
    return updatedNode;
  }

  return Object.fromEntries(
    Object.entries(nodeObject).map(([key, value]) => [
      key,
      replaceInlinedBlockNodes(value, updatedBlocks, blockIndex),
    ]),
  );
}

export function reconstructStructuredTextWithUpdatedBlocks(
  originalValue: Record<string, unknown>,
  updatedBlocks: unknown[],
): Record<string, unknown> {
  const result = { ...originalValue };

  // Check if we have inlined blocks anywhere in the DAST document.
  const document = originalValue.document as
    | Record<string, unknown>
    | undefined;
  if (document && typeof document === 'object') {
    if (hasInlinedBlockNode(document)) {
      result.document = replaceInlinedBlockNodes(
        document,
        updatedBlocks,
        { current: 0 },
      );
      return result;
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
/**
 * Handles the intermediate-step case: recurses into the nested field of a matching block.
 */
function recurseIntoNestedBlock(
  block: unknown,
  blockObj: Record<string, unknown>,
  path: NestedBlockPath['path'],
  pathIndex: number,
  updateFn: BlockUpdateFn,
): { didUpdate: boolean; resultBlock: unknown } {
  const nextStep = path[pathIndex + 1];
  const nestedFieldValue = getNestedFieldValueFromBlock(
    blockObj,
    nextStep.fieldApiKey,
  );

  if (nestedFieldValue === undefined) {
    return {
      didUpdate: false,
      resultBlock: unchangedBlockReference(block),
    };
  }

  const result = traverseAndUpdateNestedBlocks(
    nestedFieldValue,
    path,
    pathIndex + 1,
    updateFn,
  );

  if (result.updated) {
    const updatedBlock = setNestedFieldValueInBlock(
      blockObj,
      nextStep.fieldApiKey,
      result.newValue,
    );
    return { didUpdate: true, resultBlock: updatedBlock };
  }

  return {
    didUpdate: false,
    resultBlock: unchangedBlockReference(block),
  };
}

function processBlocksArray(
  blocks: unknown[],
  locale: string | null,
  currentStep: NestedBlockPath['path'][0],
  isLastStep: boolean,
  path: NestedBlockPath['path'],
  pathIndex: number,
  updateFn: BlockUpdateFn,
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

    if (blockTypeId !== currentStep.expectedBlockTypeId) {
      newBlocks.push(unchangedBlockReference(block));
      continue;
    }

    if (isLastStep) {
      const updatedBlock = updateFn(blockObj, locale);
      if (updatedBlock === blockObj) {
        newBlocks.push(unchangedBlockReference(block));
      } else {
        newBlocks.push(updatedBlock);
        updated = true;
      }
    } else {
      const { didUpdate, resultBlock } = recurseIntoNestedBlock(
        block,
        blockObj,
        path,
        pathIndex,
        updateFn,
      );
      newBlocks.push(resultBlock);
      if (didUpdate) updated = true;
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
/**
 * Processes a single locale value when traversing a localized field.
 * Returns the new locale value (updated or original) and whether it changed.
 */
function processLocalizedLocale(
  locale: string,
  localeValue: unknown,
  currentStep: NestedBlockPath['path'][0],
  isLastStep: boolean,
  path: NestedBlockPath['path'],
  pathIndex: number,
  updateFn: BlockUpdateFn,
): { updated: boolean; newLocaleValue: unknown } {
  const blocks = extractBlocksFromFieldValue(
    localeValue,
    currentStep.fieldType,
  );
  if (blocks.length === 0)
    return { updated: false, newLocaleValue: localeValue };

  const result = processBlocksArray(
    blocks,
    locale,
    currentStep,
    isLastStep,
    path,
    pathIndex,
    updateFn,
  );

  return {
    updated: result.updated,
    // Keep every locale request-safe. If another locale is updated, this value
    // becomes part of the same localized field payload.
    newLocaleValue: reconstructFieldValue(
      localeValue,
      result.newBlocks,
      currentStep.fieldType,
    ),
  };
}

/**
 * Processes a localized field value (object keyed by locale).
 */
function processLocalizedFieldForUpdate(
  fieldValue: Record<string, unknown>,
  currentStep: NestedBlockPath['path'][0],
  isLastStep: boolean,
  path: NestedBlockPath['path'],
  pathIndex: number,
  updateFn: BlockUpdateFn,
): TraversalResult {
  let anyUpdated = false;
  const newLocalizedValue: Record<string, unknown> = {};

  for (const [locale, localeValue] of Object.entries(fieldValue)) {
    const { updated, newLocaleValue } = processLocalizedLocale(
      locale,
      localeValue,
      currentStep,
      isLastStep,
      path,
      pathIndex,
      updateFn,
    );
    newLocalizedValue[locale] = newLocaleValue;
    if (updated) anyUpdated = true;
  }

  return { updated: anyUpdated, newValue: newLocalizedValue };
}

export function traverseAndUpdateNestedBlocks(
  fieldValue: unknown,
  path: NestedBlockPath['path'],
  pathIndex: number,
  updateFn: BlockUpdateFn,
): TraversalResult {
  // Base case: reached end of path or no value
  if (pathIndex >= path.length || !fieldValue) {
    return { updated: false, newValue: fieldValue };
  }

  const currentStep = path[pathIndex];
  const isLastStep = pathIndex === path.length - 1;

  // Handle localized fields
  if (
    currentStep.localized &&
    typeof fieldValue === 'object' &&
    !Array.isArray(fieldValue)
  ) {
    return processLocalizedFieldForUpdate(
      fieldValue as Record<string, unknown>,
      currentStep,
      isLastStep,
      path,
      pathIndex,
      updateFn,
    );
  }

  // Non-localized field
  const blocks = extractBlocksFromFieldValue(fieldValue, currentStep.fieldType);
  if (blocks.length === 0) return { updated: false, newValue: fieldValue };

  const result = processBlocksArray(
    blocks,
    null,
    currentStep,
    isLastStep,
    path,
    pathIndex,
    updateFn,
  );
  if (result.updated) {
    return {
      updated: true,
      newValue: reconstructFieldValue(
        fieldValue,
        result.newBlocks,
        currentStep.fieldType,
      ),
    };
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
/**
 * Applies an update function to each matching block in a flat array (no recursion).
 */
function applyUpdateToBlocksAtLevel(
  blocks: unknown[],
  locale: string | null,
  expectedBlockTypeId: string,
  updateFn: BlockUpdateFn,
): { updated: boolean; newBlocks: unknown[] } {
  let updated = false;
  const newBlocks: unknown[] = [];

  for (const block of blocks) {
    if (!block || typeof block !== 'object') {
      newBlocks.push(block);
      continue;
    }
    const blockObj = block as Record<string, unknown>;
    if (getBlockTypeId(blockObj) === expectedBlockTypeId) {
      const updatedBlock = updateFn(blockObj, locale);
      if (updatedBlock === blockObj) {
        newBlocks.push(unchangedBlockReference(block));
      } else {
        newBlocks.push(updatedBlock);
        updated = true;
      }
    } else {
      newBlocks.push(unchangedBlockReference(block));
    }
  }

  return { updated, newBlocks };
}

/**
 * Processes a single locale value for `traverseAndUpdateNestedBlocksAtLevel`.
 */
function applyUpdateAtLevelForLocale(
  locale: string,
  localeValue: unknown,
  step: NestedBlockPath['path'][0],
  updateFn: BlockUpdateFn,
): { updated: boolean; newLocaleValue: unknown } {
  const blocks = extractBlocksFromFieldValue(localeValue, step.fieldType);
  if (blocks.length === 0)
    return { updated: false, newLocaleValue: localeValue };

  const result = applyUpdateToBlocksAtLevel(
    blocks,
    locale,
    step.expectedBlockTypeId,
    updateFn,
  );
  return {
    updated: result.updated,
    newLocaleValue: reconstructFieldValue(
      localeValue,
      result.newBlocks,
      step.fieldType,
    ),
  };
}

/**
 * Handles the localized field case for `traverseAndUpdateNestedBlocksAtLevel`.
 */
function applyUpdateAtLevelForLocalizedField(
  fieldValue: Record<string, unknown>,
  step: NestedBlockPath['path'][0],
  updateFn: BlockUpdateFn,
): TraversalResult {
  let anyUpdated = false;
  const newLocalizedValue: Record<string, unknown> = {};

  for (const [locale, localeValue] of Object.entries(fieldValue)) {
    const { updated, newLocaleValue } = applyUpdateAtLevelForLocale(
      locale,
      localeValue,
      step,
      updateFn,
    );
    newLocalizedValue[locale] = newLocaleValue;
    if (updated) anyUpdated = true;
  }

  return { updated: anyUpdated, newValue: newLocalizedValue };
}

export function traverseAndUpdateNestedBlocksAtLevel(
  fieldValue: unknown,
  step: NestedBlockPath['path'][0],
  updateFn: BlockUpdateFn,
): TraversalResult {
  if (!fieldValue) return { updated: false, newValue: fieldValue };

  // Handle localized fields
  if (
    step.localized &&
    typeof fieldValue === 'object' &&
    !Array.isArray(fieldValue)
  ) {
    return applyUpdateAtLevelForLocalizedField(
      fieldValue as Record<string, unknown>,
      step,
      updateFn,
    );
  }

  // Non-localized field
  const blocks = extractBlocksFromFieldValue(fieldValue, step.fieldType);
  if (blocks.length > 0) {
    const result = applyUpdateToBlocksAtLevel(
      blocks,
      null,
      step.expectedBlockTypeId,
      updateFn,
    );
    if (result.updated) {
      return {
        updated: true,
        newValue: reconstructFieldValue(
          fieldValue,
          result.newBlocks,
          step.fieldType,
        ),
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
/**
 * Filters or recurses into a single block during a removal traversal.
 * Returns the block to keep (possibly updated) or null if it should be removed.
 */
function filterOrRecurseBlock(
  block: unknown,
  blockObj: Record<string, unknown>,
  isLastStep: boolean,
  currentStep: NestedBlockPath['path'][0],
  path: NestedBlockPath['path'],
  pathIndex: number,
  targetBlockId: string,
): { keep: boolean; changed: boolean; updatedBlock: unknown } {
  const blockTypeId = getBlockTypeId(blockObj);

  if (isLastStep) {
    // Remove target blocks, keep others
    if (blockTypeId === targetBlockId) {
      return { keep: false, changed: true, updatedBlock: null };
    }
    return {
      keep: true,
      changed: false,
      updatedBlock: unchangedBlockReference(block),
    };
  }

  if (blockTypeId !== currentStep.expectedBlockTypeId) {
    return {
      keep: true,
      changed: false,
      updatedBlock: unchangedBlockReference(block),
    };
  }

  const nextStep = path[pathIndex + 1];
  const nestedFieldValue = getNestedFieldValueFromBlock(
    blockObj,
    nextStep.fieldApiKey,
  );

  if (nestedFieldValue === undefined) {
    return {
      keep: true,
      changed: false,
      updatedBlock: unchangedBlockReference(block),
    };
  }

  const result = traverseAndRemoveBlocks(
    nestedFieldValue,
    path,
    pathIndex + 1,
    targetBlockId,
  );
  if (result.updated) {
    const updatedBlock = setNestedFieldValueInBlock(
      blockObj,
      nextStep.fieldApiKey,
      result.newValue,
    );
    return { keep: true, changed: true, updatedBlock };
  }
  return {
    keep: true,
    changed: false,
    updatedBlock: unchangedBlockReference(block),
  };
}

/**
 * Filters blocks array during a removal traversal at one path level.
 */
function filterBlocksForRemoval(
  blocks: unknown[],
  isLastStep: boolean,
  currentStep: NestedBlockPath['path'][0],
  path: NestedBlockPath['path'],
  pathIndex: number,
  targetBlockId: string,
): { updated: boolean; newBlocks: unknown[] } {
  let updated = false;
  const newBlocks: unknown[] = [];

  for (const block of blocks) {
    if (!block || typeof block !== 'object') {
      newBlocks.push(block);
      continue;
    }
    const blockObj = block as Record<string, unknown>;
    const { keep, changed, updatedBlock } = filterOrRecurseBlock(
      block,
      blockObj,
      isLastStep,
      currentStep,
      path,
      pathIndex,
      targetBlockId,
    );
    if (!keep) {
      updated = true;
    } else {
      if (changed) updated = true;
      newBlocks.push(updatedBlock);
    }
  }

  return { updated, newBlocks };
}

/**
 * Processes a single locale value during block removal traversal.
 */
function removeBlocksForLocaleValue(
  localeValue: unknown,
  currentStep: NestedBlockPath['path'][0],
  isLastStep: boolean,
  path: NestedBlockPath['path'],
  pathIndex: number,
  targetBlockId: string,
): { updated: boolean; newLocaleValue: unknown } {
  const blocks = extractBlocksFromFieldValue(
    localeValue,
    currentStep.fieldType,
  );
  if (blocks.length === 0)
    return { updated: false, newLocaleValue: localeValue };

  const result = filterBlocksForRemoval(
    blocks,
    isLastStep,
    currentStep,
    path,
    pathIndex,
    targetBlockId,
  );
  return {
    updated: result.updated,
    newLocaleValue: reconstructFieldValue(
      localeValue,
      result.newBlocks,
      currentStep.fieldType,
    ),
  };
}

/**
 * Handles the localized field case for `traverseAndRemoveBlocks`.
 */
function removeBlocksFromLocalizedField(
  fieldValue: Record<string, unknown>,
  currentStep: NestedBlockPath['path'][0],
  isLastStep: boolean,
  path: NestedBlockPath['path'],
  pathIndex: number,
  targetBlockId: string,
): TraversalResult {
  let anyUpdated = false;
  const newLocalizedValue: Record<string, unknown> = {};

  for (const [locale, localeValue] of Object.entries(fieldValue)) {
    const { updated, newLocaleValue } = removeBlocksForLocaleValue(
      localeValue,
      currentStep,
      isLastStep,
      path,
      pathIndex,
      targetBlockId,
    );
    newLocalizedValue[locale] = newLocaleValue;
    if (updated) anyUpdated = true;
  }

  return { updated: anyUpdated, newValue: newLocalizedValue };
}

export function traverseAndRemoveBlocks(
  fieldValue: unknown,
  path: NestedBlockPath['path'],
  pathIndex: number,
  targetBlockId: string,
): TraversalResult {
  if (pathIndex >= path.length || !fieldValue) {
    return { updated: false, newValue: fieldValue };
  }

  const currentStep = path[pathIndex];
  const isLastStep = pathIndex === path.length - 1;

  // Handle localized fields
  if (
    currentStep.localized &&
    typeof fieldValue === 'object' &&
    !Array.isArray(fieldValue)
  ) {
    return removeBlocksFromLocalizedField(
      fieldValue as Record<string, unknown>,
      currentStep,
      isLastStep,
      path,
      pathIndex,
      targetBlockId,
    );
  }

  // Non-localized
  const blocks = extractBlocksFromFieldValue(fieldValue, currentStep.fieldType);
  if (blocks.length > 0) {
    const result = filterBlocksForRemoval(
      blocks,
      isLastStep,
      currentStep,
      path,
      pathIndex,
      targetBlockId,
    );
    if (result.updated) {
      return {
        updated: true,
        newValue: reconstructFieldValue(
          fieldValue,
          result.newBlocks,
          currentStep.fieldType,
        ),
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
  fieldType: BlockFieldType,
): unknown {
  if (fieldType === 'single_block') {
    return newBlocks[0] || null;
  }

  if (fieldType === 'structured_text') {
    return reconstructStructuredTextWithUpdatedBlocks(
      originalValue as Record<string, unknown>,
      newBlocks,
    );
  }

  // rich_text - return array directly
  return newBlocks;
}
