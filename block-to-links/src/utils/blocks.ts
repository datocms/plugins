/**
 * Block Extraction Utilities
 * 
 * Shared utilities for extracting and handling block data from various
 * DatoCMS field types (rich_text, structured_text, single_block).
 * 
 * These utilities are used by both the analyzer and converter modules
 * to consistently handle block extraction across different field types.
 * 
 * @module utils/blocks
 */

import type { DastBlockRecord, StructuredTextValue } from '../types';
import { isStructuredTextValue, findBlockNodesInDast } from './dast';

// =============================================================================
// Block Type Identification
// =============================================================================

/**
 * Extracts the block type ID from a block object.
 * Handles multiple formats that DatoCMS CMA client may return:
 * - __itemTypeId (convenience property)
 * - relationships.item_type.data.id (nested structure)
 * - item_type (string or object with id)
 * 
 * @param block - The block object to extract the type from
 * @returns The block type ID, or undefined if not found
 */
export function getBlockTypeId(block: Record<string, unknown>): string | undefined {
  // Check for __itemTypeId first (convenience property added by CMA)
  if (typeof block.__itemTypeId === 'string') {
    return block.__itemTypeId;
  }

  // Check for relationships.item_type.data.id (nested structure from CMA client)
  const relationships = block.relationships as Record<string, unknown> | undefined;
  if (relationships) {
    const itemTypeRel = relationships.item_type as Record<string, unknown> | undefined;
    if (itemTypeRel) {
      const data = itemTypeRel.data as Record<string, unknown> | undefined;
      if (data && typeof data.id === 'string') {
        return data.id;
      }
    }
  }

  // Fallback: check for item_type directly (string or object with id)
  const itemType = block.item_type;
  if (typeof itemType === 'string') {
    return itemType;
  }
  if (itemType && typeof itemType === 'object') {
    const obj = itemType as Record<string, unknown>;
    if (typeof obj.id === 'string') {
      return obj.id;
    }
  }

  return undefined;
}

/**
 * Gets the block ID from a block object.
 * 
 * @param block - The block object to get the ID from
 * @returns The block ID, or undefined if not found
 */
export function getBlockId(block: Record<string, unknown>): string | undefined {
  if (typeof block.id === 'string') {
    return block.id;
  }
  return undefined;
}

/**
 * Gets block attributes/data from a block object.
 * Extracts the field values stored in the attributes property.
 * 
 * @param block - The block object to get attributes from
 * @returns The block's attributes object, or empty object if none
 */
export function getBlockAttributes(block: Record<string, unknown>): Record<string, unknown> {
  const attributes = block.attributes as Record<string, unknown> | undefined;
  return attributes || {};
}

// =============================================================================
// Block Extraction from Field Values
// =============================================================================

/** Supported field types that can contain blocks */
export type BlockFieldType = 'rich_text' | 'structured_text' | 'single_block';

/**
 * Extracts blocks from a field value based on the field type.
 * 
 * Handles three DatoCMS field types:
 * - rich_text: Value is directly an array of blocks
 * - structured_text: Uses DAST traversal to find only blocks actually referenced in the document
 * - single_block: Value is a single block object (wrapped in array for consistency)
 * 
 * @param fieldValue - The raw field value from a record
 * @param fieldType - The type of field (rich_text, structured_text, single_block)
 * @returns Array of block objects found in the field value
 * 
 * @example
 * // For rich_text field
 * const blocks = extractBlocksFromFieldValue(record.content, 'rich_text');
 * 
 * @example
 * // For structured_text field (only returns blocks referenced in DAST)
 * const blocks = extractBlocksFromFieldValue(record.body, 'structured_text');
 */
export function extractBlocksFromFieldValue(
  fieldValue: unknown,
  fieldType: BlockFieldType
): unknown[] {
  if (!fieldValue) return [];

  if (fieldType === 'rich_text') {
    // Rich text (modular content) - value is directly an array of blocks
    if (Array.isArray(fieldValue)) {
      return fieldValue;
    }
    return [];
  }
  
  if (fieldType === 'structured_text') {
    // Structured text - traverse DAST document to find block references
    // Only return blocks that are actually referenced in the document tree
    return extractBlocksFromStructuredTextValue(fieldValue);
  }
  
  if (fieldType === 'single_block') {
    // Single block - value is a single block object (not an array)
    if (typeof fieldValue === 'object' && fieldValue !== null && !Array.isArray(fieldValue)) {
      return [fieldValue]; // Wrap in array for consistent processing
    }
    return [];
  }

  return [];
}

/**
 * Extracts blocks from a structured text field value.
 * 
 * This is important because the blocks array in structured text may contain
 * blocks that were previously used but are no longer referenced in the document.
 * This function only returns blocks that are actually referenced.
 * 
 * Handles two formats:
 * - Standard format: blocks array with string IDs in document nodes
 * - Nested format (nested: true): block data inlined in document nodes
 * 
 * @param fieldValue - The structured text field value
 * @returns Array of block records that are referenced in the document
 */
function extractBlocksFromStructuredTextValue(fieldValue: unknown): DastBlockRecord[] {
  if (!isStructuredTextValue(fieldValue)) {
    // Fallback: if not proper structured text, try extracting blocks array directly
    if (typeof fieldValue === 'object' && fieldValue !== null) {
      const stValue = fieldValue as Record<string, unknown>;
      const blocks = stValue.blocks;
      if (Array.isArray(blocks)) {
        return blocks as DastBlockRecord[];
      }
    }
    return [];
  }

  const structuredText = fieldValue as StructuredTextValue;
  const blocks = structuredText.blocks || [];
  
  // Get document children and check for block/inlineBlock types
  const doc = structuredText.document as unknown as Record<string, unknown>;
  const children = doc?.children as unknown[] || [];
  const allChildTypes = children.map((c: unknown) => (c as Record<string, unknown>)?.type);
  
  // Check if there are any 'block' or 'inlineBlock' types in the children
  const hasBlockTypes = allChildTypes.some((t) => t === 'block' || t === 'inlineBlock');
  
  if (hasBlockTypes) {
    // Find the actual block nodes
    const blockChildren = children.filter((c: unknown) => {
      const child = c as Record<string, unknown>;
      return child?.type === 'block' || child?.type === 'inlineBlock';
    });
    
    // With nested: true, blocks are inlined in the document tree
    // The 'item' property contains the full block object, not just an ID
    const inlinedBlocks: DastBlockRecord[] = blockChildren.map((child) => {
      const blockNode = child as Record<string, unknown>;
      const itemData = blockNode.item;
      
      // If item is an object (inlined block), extract it
      if (itemData && typeof itemData === 'object') {
        return itemData as DastBlockRecord;
      }
      // If item is just an ID string, look it up in blocks array
      if (typeof itemData === 'string' && blocks.length > 0) {
        const found = blocks.find((b) => b.id === itemData);
        if (found) return found;
      }
      return null;
    }).filter((b): b is DastBlockRecord => b !== null);
    
    if (inlinedBlocks.length > 0) {
      return inlinedBlocks;
    }
  }
  
  // Fallback to the original approach for cases where blocks array is populated
  if (blocks.length === 0) {
    return [];
  }

  // Find all block/inlineBlock nodes in the document
  const blockNodes = findBlockNodesInDast(structuredText);
  
  if (blockNodes.length === 0) {
    return [];
  }

  // Get the IDs of blocks that are actually referenced
  const referencedBlockIds = new Set(blockNodes.map(node => node.itemId));
  
  // Return only blocks that are referenced in the document
  return blocks.filter(block => referencedBlockIds.has(block.id));
}


