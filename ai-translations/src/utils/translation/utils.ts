// src/utils/translation/utils.ts

/**
 * Checks if a structured text field value is effectively empty.
 * A structured text is considered empty if it contains only a single paragraph
 * node with an empty text child.
 *
 * @param value - The structured text value to check.
 * @returns True if the value represents an empty structured text field.
 */
export function isEmptyStructuredText(value: unknown): boolean {
  if (!Array.isArray(value) || value.length !== 1) return false;
  const node = value[0] as Record<string, unknown> | null;
  if (typeof node !== 'object' || node === null) return false;
  if (!('type' in node) || node.type !== 'paragraph') return false;
  const children = node.children as Array<{ text?: string }> | undefined;
  return children?.length === 1 && children[0]?.text === '';
}

/**
 * Recursively extracts all text values from a nested structure,
 * commonly used with structured text fields.
 *
 * @param data - Any structured text document or node tree.
 * @returns An array of string values discovered in `text` or string `value` keys.
 */
export function extractTextValues(data: unknown): string[] {
  const textValues: string[] = [];

  // Define a recursive type for structured text nodes
  type StructuredTextItem = {
    text?: string;
    value?: string;
    [key: string]: unknown;
  };

  function traverse(obj: unknown) {
    if (Array.isArray(obj)) {
      obj.forEach(traverse);
    } else if (typeof obj === 'object' && obj !== null) {
      const item = obj as StructuredTextItem;
      if (item.text !== undefined) {
        textValues.push(item.text);
      } else if (item.value !== undefined && typeof item.value === 'string') {
        textValues.push(item.value);
      }
      Object.values(item).forEach(traverse);
    }
  }

  traverse(data);
  return textValues;
}

/**
 * Recursively removes 'id' keys from objects (except in special cases),
 * useful for cleaning API responses before re-uploading/patching.
 *
 * @param obj - Any JSON-like structure.
 * @returns A deep-cloned structure without 'id' keys (with safe exceptions).
 */
export function removeIds(obj: unknown): unknown {
  if (Array.isArray(obj)) {
    return obj.map(removeIds);
  }
  
  if (typeof obj === 'object' && obj !== null) {
    const newObj: Record<string, unknown> = {};
    for (const [key, value] of Object.entries(obj)) {
      // Keep id if it's in a meta array item with a value property
      if(key === "data"){
        newObj[key] = value;
        continue;
      }
      if (
        key === 'id' &&
        (obj as Record<string, unknown>).value !== undefined &&
        Object.keys(obj).length === 2
      ) {
        newObj[key] = value;
      } else if (key !== 'id') {
        newObj[key] = removeIds(value);
      }
    }
    return newObj;
  }
  
  return obj;
}

/**
 * Reconstructs an object by replacing 'text' (or string 'value') fields with
 * values from a translated array, preserving overall structure.
 *
 * @param originalObject - The original object with text fields.
 * @param textValues - Array of translated text strings.
 * @returns The reconstructed object with translated text inserted back in.
 */
export function reconstructObject(
  originalObject: unknown,
  textValues: string[]
): unknown {
  let index = 0;
  
  type StructuredTextNode = {
    text?: string;
    value?: string;
    [key: string]: unknown;
  };

  function traverse(obj: unknown): unknown {
    if (Array.isArray(obj)) {
      return obj.map((item) => traverse(item));
    }
    
    if (typeof obj === 'object' && obj !== null) {
      const typedObj = obj as StructuredTextNode;
      const newObj: Record<string, unknown> = {};
      for (const key in typedObj) {
        if ((key === 'text' || (key === 'value' && typeof typedObj[key] === 'string')) && index < textValues.length) {
          newObj[key] = textValues[index++];
        } else {
          newObj[key] = traverse(typedObj[key]);
        }
      }
      return newObj;
    }
    return obj;
  }
  return traverse(originalObject);
}

/**
 * Inserts an object into an array at a specified index and returns a new array.
 * Useful when re-injecting block nodes into structured text.
 *
 * @param array - Source array.
 * @param object - Object to insert.
 * @param index - Zero-based position where the object should be inserted.
 * @returns A new array with the object inserted.
 */
export function insertObjectAtIndex<T>(
  array: T[],
  object: T,
  index: number
): T[] {
  return [...array.slice(0, index), object, ...array.slice(index)];
}

/**
 * Deletes 'itemId' keys (and raw 'id' keys) from an object recursively,
 * similar to removeIds but specifically targeting itemId.
 *
 * @param obj - The object to clean.
 * @returns A deep-cloned object without 'itemId' keys.
 */
export function deleteItemIdKeys(obj: unknown): unknown {
  if (Array.isArray(obj)) {
    return obj.map(deleteItemIdKeys);
  }
  
  if (typeof obj === 'object' && obj !== null) {
    const newObj: Record<string, unknown> = {};
    for (const [key, value] of Object.entries(obj as Record<string, unknown>)) {
      if(key === 'data') {
        newObj[key] = value;
        continue;
      }
      if (key !== 'itemId' && key !== 'id') {
        newObj[key] = deleteItemIdKeys(value);
      }
    }
    return newObj;
  }
  return obj;
}
