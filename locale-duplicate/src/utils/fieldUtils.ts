/**
 * Field utility functions for the Locale Duplicate plugin
 */

import { isLocalizedField, type LocalizedField } from '../types';

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
    'slug',
  ];

  return supportedTypes.includes(fieldType);
}

/**
 * Gets the value of a field from a localized field object
 */
export function getFieldValue(
  field: LocalizedField | unknown,
  locale: string,
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
  value: unknown,
): LocalizedField {
  if (!isLocalizedField(field)) {
    return { [locale]: value };
  }

  return {
    ...field,
    [locale]: value,
  };
}

// ─── removeBlockItemIdsImmutable helpers ─────────────────────────────────────

/**
 * Processes an array by recursively removing block IDs and filtering out inlineItem nodes.
 */
function processArrayImmutable(arr: unknown[]): unknown[] {
  return arr
    .map((item) => removeBlockItemIdsImmutable(item))
    .filter((item) => {
      if (typeof item === 'object' && item !== null && 'type' in item) {
        return (item as { type: unknown }).type !== 'inlineItem';
      }
      return true;
    });
}

/**
 * Handles a structured-text block node that carries an id directly.
 */
function processStructuredTextBlockImmutable(
  typedObj: Record<string, unknown>,
): Record<string, unknown> {
  const { id: _id, ...blockWithoutId } = typedObj;
  const result: Record<string, unknown> = {};
  for (const [key, val] of Object.entries(blockWithoutId)) {
    result[key] = removeBlockItemIdsImmutable(val);
  }
  return result;
}

/**
 * Handles a modular-content block node that wraps an item object.
 */
function processModularBlockImmutable(
  typedObj: Record<string, unknown>,
): Record<string, unknown> {
  const itemObj = typedObj.item as Record<string, unknown>;
  const { id: _id, ...itemWithoutId } = itemObj;
  const result: Record<string, unknown> = {
    type: typedObj.type,
    item: removeBlockItemIdsImmutable(itemWithoutId),
  };
  for (const [key, val] of Object.entries(typedObj)) {
    if (key !== 'type' && key !== 'item') {
      result[key] = removeBlockItemIdsImmutable(val);
    }
  }
  return result;
}

/**
 * Handles a plain object, stripping IDs only when modular-content markers are present.
 */
function processPlainObjectImmutable(
  typedObj: Record<string, unknown>,
): Record<string, unknown> {
  const hasItemId = 'itemId' in typedObj;
  const hasItemTypeId = 'itemTypeId' in typedObj;
  const shouldRemoveId = hasItemId || hasItemTypeId;

  const result: Record<string, unknown> = {};
  for (const [key, val] of Object.entries(typedObj)) {
    if (key === 'id' && shouldRemoveId) {
      continue;
    }
    if (key === 'itemId') {
      continue;
    }
    result[key] = removeBlockItemIdsImmutable(val);
  }
  return result;
}

/**
 * Removes block item IDs - version for field extension (creates new objects).
 * This version creates new objects without ID fields, suitable for field-level copying.
 */
export function removeBlockItemIdsImmutable(value: unknown): unknown {
  if (typeof value !== 'object' || value === null) {
    return value;
  }

  if (Array.isArray(value)) {
    return processArrayImmutable(value);
  }

  const typedObj = value as Record<string, unknown>;

  if (typedObj.type === 'block' && 'id' in typedObj) {
    return processStructuredTextBlockImmutable(typedObj);
  }

  if (
    typedObj.type === 'block' &&
    typedObj.item !== null &&
    typedObj.item !== undefined &&
    typeof typedObj.item === 'object'
  ) {
    return processModularBlockImmutable(typedObj);
  }

  if (typedObj.type === 'item' && 'id' in typedObj) {
    const { id: _id, ...itemWithoutId } = typedObj;
    return removeBlockItemIdsImmutable(itemWithoutId);
  }

  return processPlainObjectImmutable(typedObj);
}

// ─── removeBlockItemIdsMutable helpers ────────────────────────────────────────

/**
 * Removes IDs from a structured-text block node in place.
 */
function clearStructuredTextBlockId(typedObj: Record<string, unknown>): void {
  if (typedObj.type === 'block' && 'id' in typedObj) {
    (typedObj as { id?: unknown }).id = undefined;
  }
}

/**
 * Removes IDs from a nested modular-content item in place.
 */
function clearModularBlockItemId(typedObj: Record<string, unknown>): void {
  if (
    typedObj.type === 'block' &&
    typedObj.item !== null &&
    typedObj.item !== undefined &&
    typeof typedObj.item === 'object'
  ) {
    const itemObj = typedObj.item as { id?: unknown };
    if ('id' in itemObj) {
      itemObj.id = undefined;
    }
  }
}

/**
 * Nullifies the item reference on inlineItem nodes so DatoCMS keeps the property.
 */
function clearInlineItemReference(typedObj: Record<string, unknown>): void {
  if (typedObj.type === 'inlineItem' && 'item' in typedObj) {
    (typedObj as { item: unknown }).item = null;
  }
}

/**
 * Removes IDs from item-type objects in place.
 */
function clearItemTypeId(typedObj: Record<string, unknown>): void {
  if (typedObj.type === 'item' && 'id' in typedObj) {
    (typedObj as { id?: unknown }).id = undefined;
  }
}

/**
 * Removes itemId and, when appropriate, id from modular-content blocks in place.
 */
function clearModularContentIds(typedObj: Record<string, unknown>): void {
  if ('itemId' in typedObj) {
    (typedObj as { itemId?: unknown }).itemId = undefined;
  }

  const hasItemId = 'itemId' in typedObj;
  const hasItemTypeId = 'itemTypeId' in typedObj;
  const shouldRemoveId = hasItemId || hasItemTypeId;

  if (shouldRemoveId && 'id' in typedObj) {
    (typedObj as { id?: unknown }).id = undefined;
  }
}

/**
 * Removes block item IDs - version for settings area (mutates objects).
 * This version mutates objects in place, suitable for bulk operations.
 */
export function removeBlockItemIdsMutable(obj: unknown): unknown {
  if (Array.isArray(obj)) {
    for (const item of obj) {
      removeBlockItemIdsMutable(item);
    }
  } else if (obj !== null && obj !== undefined && typeof obj === 'object') {
    const typedObj = obj as Record<string, unknown>;

    clearStructuredTextBlockId(typedObj);
    clearModularBlockItemId(typedObj);
    clearInlineItemReference(typedObj);
    clearItemTypeId(typedObj);
    clearModularContentIds(typedObj);

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
