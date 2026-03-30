/**
 * Field utility functions for the Locale Duplicate plugin
 */

import { LocalizedField, isLocalizedField } from '../types';

/**
 * Checks if a field type is supported for locale duplication
 */
export function isFieldTypeSupported(fieldType: string): boolean {
  const supportedTypes = [
    'string',
    'text',
    'structured_text',
    'json',
    'seo',
    'slug'
  ];
  
  return supportedTypes.includes(fieldType);
}

/**
 * Gets the value of a field from a localized field object
 */
export function getFieldValue(
  field: LocalizedField | unknown,
  locale: string
): unknown {
  if (isLocalizedField(field)) {
    return field[locale];
  }
  return undefined;
}

/**
 * Sets the value of a field in a localized field object
 */
export function setFieldValue(
  field: LocalizedField | unknown,
  locale: string,
  value: unknown
): LocalizedField {
  if (!isLocalizedField(field)) {
    return { [locale]: value };
  }
  
  return {
    ...field,
    [locale]: value
  };
}


/**
 * Removes block item IDs - version for field extension (creates new objects)
 * This version creates new objects without ID fields, suitable for field-level copying
 */
export function removeBlockItemIdsImmutable(value: unknown): unknown {
  // Base case: primitive values or null
  if (typeof value !== 'object' || value === null) {
    return value;
  }

  // Recursively process arrays
  // Filter out inlineItem nodes as they reference locale-specific items and can't be copied
  if (Array.isArray(value)) {
    return value
      .map(item => removeBlockItemIdsImmutable(item))
      .filter(item => {
        // Remove inlineItem nodes completely as they can't be copied between locales
        if (typeof item === 'object' && item !== null && 'type' in item) {
          return (item as { type: unknown }).type !== 'inlineItem';
        }
        return true;
      });
  }

  // Process objects that might contain block or item structures
  const typedObj = value as Record<string, unknown>;
  const result: Record<string, unknown> = {};
  
  // Handle 'block' type objects in structured text (which have 'id' directly on the block)
  if (typedObj.type === 'block' && 'id' in typedObj) {
    const { id, ...blockWithoutId } = typedObj;
    // Recursively process all properties of the block
    for (const [key, val] of Object.entries(blockWithoutId)) {
      result[key] = removeBlockItemIdsImmutable(val);
    }
    return result;
  }
  
  // Handle 'block' type objects which have nested 'item' objects with IDs (modular content)
  if (
    typedObj.type === 'block' && 
    typedObj.item && 
    typeof typedObj.item === 'object' && 
    typedObj.item !== null
  ) {
    const itemObj = typedObj.item as Record<string, unknown>;
    // Create a new item object without the 'id' field
    const { id, ...itemWithoutId } = itemObj;
    
    result.type = typedObj.type;
    result.item = removeBlockItemIdsImmutable(itemWithoutId);
    
    // Copy other properties from the block object
    for (const [key, val] of Object.entries(typedObj)) {
      if (key !== 'type' && key !== 'item') {
        result[key] = removeBlockItemIdsImmutable(val);
      }
    }
    return result;
  }


  // Handle 'item' type objects which have direct IDs
  if (typedObj.type === 'item' && 'id' in typedObj) {
    const { id, ...itemWithoutId } = typedObj;
    return removeBlockItemIdsImmutable(itemWithoutId);
  }

  // For other objects, only remove 'id' if the object has 'itemId' or 'itemTypeId' (modular content blocks)
  // Otherwise preserve 'id' fields as they may be legitimate metadata (e.g., in 'meta' arrays)
  const hasItemId = 'itemId' in typedObj;
  const hasItemTypeId = 'itemTypeId' in typedObj;
  const shouldRemoveId = hasItemId || hasItemTypeId;

  for (const [key, val] of Object.entries(typedObj)) {
    if (key === 'id' && shouldRemoveId) {
      // Skip this id field
      continue;
    }
    if (key === 'itemId') {
      // Skip itemId field
      continue;
    }
    result[key] = removeBlockItemIdsImmutable(val);
  }
  return result;
}

/**
 * Removes block item IDs - version for settings area (mutates objects)
 * This version mutates objects in place, suitable for bulk operations
 */
export function removeBlockItemIdsMutable(obj: unknown): unknown {
  // Handle array structures recursively
  if (Array.isArray(obj)) {
    for (let i = 0; i < obj.length; i++) {
      removeBlockItemIdsMutable(obj[i]);
    }
  } else if (obj && typeof obj === 'object') {
    // Process objects that might contain block or item structures
    const typedObj = obj as Record<string, unknown>;
    
    // Handle 'block' type objects in structured text (which have 'id' directly on the block)
    if (typedObj.type === 'block' && 'id' in typedObj) {
      // Remove the ID by setting to undefined rather than using delete operator
      (typedObj as { id?: unknown }).id = undefined;
    }
    
    // Handle 'block' type objects which have nested 'item' objects with IDs (modular content)
    if (
      typedObj.type === 'block' && 
      typedObj.item && 
      typeof typedObj.item === 'object' && 
      typedObj.item !== null
    ) {
      const itemObj = typedObj.item as { id?: unknown };
      if ('id' in itemObj) {
        // Remove the ID by setting to undefined rather than using delete operator
        itemObj.id = undefined;
      }
    }

    // Handle 'inlineItem' type objects in structured text (which have 'item' as a string ID)
    // We need to set 'item' to null instead of removing it, as DatoCMS expects the property to exist
    if (typedObj.type === 'inlineItem' && 'item' in typedObj) {
      (typedObj as { item: unknown }).item = null;
    }

    // Handle 'item' type objects which have direct IDs
    if (
      typedObj.type === 'item' && 
      'id' in typedObj
    ) {
      // Remove the ID by setting to undefined rather than using delete operator
      (typedObj as { id?: unknown }).id = undefined;
    }

    // Remove itemId field (used in modular content blocks), but keep itemTypeId as it's needed to identify block type
    if ('itemId' in typedObj) {
      (typedObj as { itemId?: unknown }).itemId = undefined;
    }

    // Only remove 'id' if the object has 'itemId' or 'itemTypeId' (modular content blocks)
    // Otherwise preserve 'id' fields as they may be legitimate metadata (e.g., in 'meta' arrays)
    const hasItemId = 'itemId' in typedObj;
    const hasItemTypeId = 'itemTypeId' in typedObj;
    const shouldRemoveId = hasItemId || hasItemTypeId;
    
    if (shouldRemoveId && 'id' in typedObj) {
      (typedObj as { id?: unknown }).id = undefined;
    }

    // Process all properties of the object recursively
    for (const key in typedObj) {
      removeBlockItemIdsMutable(typedObj[key]);
    }
  }
  return obj;
}

/**
 * Validates if a locale code is valid
 */
export function isValidLocale(locale: string): boolean {
  // Matches patterns like 'en', 'en-US', 'pt-BR'
  return /^[a-z]{2}(-[A-Z]{2})?$/.test(locale);
}

/**
 * Extracts locale codes from a localized field
 */
export function getLocalesFromField(field: LocalizedField | unknown): string[] {
  if (!isLocalizedField(field)) {
    return [];
  }
  
  return Object.keys(field).filter(isValidLocale);
}