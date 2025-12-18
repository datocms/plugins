/**
 * Data Sanitization Utilities
 * 
 * Functions for sanitizing block and record data before creating new records
 * via the DatoCMS CMA. Removes read-only properties like `id` and restructures
 * block references to the format expected by the API.
 * 
 * @module utils/converter/sanitize
 */

import { getBlockTypeId } from '../blocks';

// =============================================================================
// Types
// =============================================================================

/** Properties that should be removed from blocks when creating new records */
const BLOCK_SKIP_KEYS = new Set([
  'id',
  'item_type', 
  '__itemTypeId',
  'relationships',
  'type',
  'meta',
  'creator',
  'attributes'
]);

// =============================================================================
// Block Data Sanitization
// =============================================================================

/**
 * Recursively sanitizes block data to remove properties that shouldn't be included
 * when creating new records (like `id`, `item_type`, `relationships`, etc.).
 * 
 * This function handles:
 * - Removing block instance IDs
 * - Restructuring item_type references for the CMA
 * - Recursively sanitizing nested blocks (e.g., blocks within modular content fields)
 * 
 * @param data - The data to sanitize (can be any value type)
 * @returns Sanitized data ready for record creation
 * 
 * @example
 * const sanitized = sanitizeBlockDataForCreation({
 *   id: 'block123',
 *   item_type: 'hero_block',
 *   title: 'Hello World',
 *   nested_blocks: [{ id: 'block456', item_type: 'text_block', content: '...' }]
 * });
 * // Returns data without IDs, with proper structure for CMA
 */
export function sanitizeBlockDataForCreation(data: unknown): unknown {
  // Handle null/undefined
  if (data === null || data === undefined) {
    return data;
  }

  // Handle arrays recursively
  if (Array.isArray(data)) {
    return data.map(sanitizeBlockDataForCreation);
  }

  // Handle objects
  if (typeof data === 'object') {
    const obj = data as Record<string, unknown>;
    
    // Check if this looks like a block object
    const isBlock = isBlockObject(obj);

    if (isBlock) {
      return sanitizeBlockObject(obj);
    }

    // Not a block - recursively sanitize nested values
    const sanitized: Record<string, unknown> = {};
    for (const [key, value] of Object.entries(obj)) {
      sanitized[key] = sanitizeBlockDataForCreation(value);
    }
    return sanitized;
  }

  // Primitive value - return as-is
  return data;
}

/**
 * Checks if an object looks like a DatoCMS block.
 * 
 * @param obj - Object to check
 * @returns True if the object appears to be a block
 */
function isBlockObject(obj: Record<string, unknown>): boolean {
  if (obj.__itemTypeId !== undefined) return true;
  if (obj.item_type !== undefined) return true;
  
  if (obj.relationships && typeof obj.relationships === 'object') {
    const relationships = obj.relationships as Record<string, unknown>;
    if (relationships.item_type !== undefined) return true;
  }
  
  return false;
}

/**
 * Sanitizes a block object for creation via the CMA.
 * Removes IDs and restructures the item_type reference.
 * 
 * @param obj - Block object to sanitize
 * @returns Sanitized block object
 */
function sanitizeBlockObject(obj: Record<string, unknown>): Record<string, unknown> {
  const sanitized: Record<string, unknown> = {};
  
  // Extract the item_type ID using the shared utility
  const itemTypeId = getBlockTypeId(obj);

  // Set up the proper structure for CMA
  if (itemTypeId) {
    sanitized.type = 'item';
    sanitized.attributes = {};
    sanitized.relationships = {
      item_type: {
        data: {
          type: 'item_type',
          id: itemTypeId,
        },
      },
    };
  }

  // Get and sanitize the attributes (field values)
  const attributes = obj.attributes as Record<string, unknown> | undefined;
  if (attributes) {
    // Attributes wrapper exists - sanitize its contents
    for (const [key, value] of Object.entries(attributes)) {
      (sanitized.attributes as Record<string, unknown>)[key] = sanitizeBlockDataForCreation(value);
    }
  } else {
    // No attributes wrapper - check for field values directly on the object
    // (this can happen with different CMA client versions)
    for (const [key, value] of Object.entries(obj)) {
      if (!BLOCK_SKIP_KEYS.has(key)) {
        (sanitized.attributes as Record<string, unknown>)[key] = sanitizeBlockDataForCreation(value);
      }
    }
  }

  return sanitized;
}

// =============================================================================
// Field Value Sanitization
// =============================================================================

/**
 * Sanitizes field values for creating a new top-level record.
 * This is simpler than block sanitization - we just need to sanitize nested blocks.
 * 
 * @param data - Record field data to sanitize
 * @returns Sanitized field data ready for record creation
 * 
 * @example
 * const sanitized = sanitizeFieldValuesForCreation({
 *   title: 'My Article',
 *   content: [{ id: 'block123', item_type: 'text_block', ... }],
 *   body: { document: {...}, blocks: [...] }
 * });
 */
export function sanitizeFieldValuesForCreation(
  data: Record<string, unknown>
): Record<string, unknown> {
  const result: Record<string, unknown> = {};
  
  for (const [key, value] of Object.entries(data)) {
    if (Array.isArray(value)) {
      // Could be an array of blocks (modular content field)
      result[key] = value.map((item) => {
        if (item && typeof item === 'object') {
          const obj = item as Record<string, unknown>;
          if (isBlockObject(obj)) {
            return sanitizeBlockDataForCreation(item);
          }
        }
        return sanitizeBlockDataForCreation(item);
      });
    } else if (value && typeof value === 'object') {
      // Could be a single block, structured text, or other complex value
      const obj = value as Record<string, unknown>;
      
      // Check for structured text (has document and possibly blocks)
      if ('document' in obj || 'blocks' in obj) {
        result[key] = sanitizeStructuredTextValue(obj);
      } else {
        // Regular object or single block
        result[key] = sanitizeBlockDataForCreation(value);
      }
    } else {
      result[key] = value;
    }
  }
  
  return result;
}

/**
 * Sanitizes a structured text field value.
 * Preserves the document structure while sanitizing blocks.
 * 
 * @param value - Structured text value to sanitize
 * @returns Sanitized structured text value
 */
function sanitizeStructuredTextValue(value: Record<string, unknown>): Record<string, unknown> {
  return {
    ...value,
    blocks: value.blocks 
      ? (value.blocks as unknown[]).map(b => sanitizeBlockDataForCreation(b)) 
      : undefined,
  };
}

// =============================================================================
// Localized Field Value Sanitization
// =============================================================================

/**
 * Sanitizes localized field values for creating a new top-level record.
 * Each field value is expected to be an object with locale keys.
 * 
 * @param data - Localized field data to sanitize
 * @returns Sanitized localized field data
 * 
 * @example
 * const sanitized = sanitizeLocalizedFieldValuesForCreation({
 *   title: { en: 'Hello', es: 'Hola' },
 *   content: { en: [...blocks...], es: [...blocks...] }
 * });
 */
export function sanitizeLocalizedFieldValuesForCreation(
  data: Record<string, Record<string, unknown>>
): Record<string, Record<string, unknown>> {
  const result: Record<string, Record<string, unknown>> = {};

  for (const [fieldKey, localizedValue] of Object.entries(data)) {
    const sanitizedLocalizedValue: Record<string, unknown> = {};
    
    for (const [locale, value] of Object.entries(localizedValue)) {
      if (Array.isArray(value)) {
        // Could be an array of blocks (modular content field)
        sanitizedLocalizedValue[locale] = value.map((item) => {
          if (item && typeof item === 'object') {
            const obj = item as Record<string, unknown>;
            if (isBlockObject(obj)) {
              return sanitizeBlockDataForCreation(item);
            }
          }
          return sanitizeBlockDataForCreation(item);
        });
      } else if (value && typeof value === 'object') {
        const obj = value as Record<string, unknown>;

        // Check for structured text (has document and possibly blocks)
        if ('document' in obj || 'blocks' in obj) {
          sanitizedLocalizedValue[locale] = sanitizeStructuredTextValue(obj);
        } else {
          // Regular object or single block
          sanitizedLocalizedValue[locale] = sanitizeBlockDataForCreation(value);
        }
      } else {
        sanitizedLocalizedValue[locale] = value;
      }
    }
    
    result[fieldKey] = sanitizedLocalizedValue;
  }

  return result;
}

