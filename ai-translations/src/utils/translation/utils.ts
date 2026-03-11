// src/utils/translation/utils.ts

/**
 * Checks if a structured text field value is effectively empty.
 * A structured text is considered empty when it has no visible text content
 * and no embedded block nodes.
 *
 * @param value - The structured text value to check.
 * @returns True if the value represents an empty structured text field.
 */
export function isEmptyStructuredText(value: unknown): boolean {
  const extractChildren = (input: unknown): unknown[] | null => {
    if (Array.isArray(input)) return input;
    if (input && typeof input === 'object') {
      const document = (input as Record<string, unknown>).document;
      if (document && typeof document === 'object') {
        const children = (document as Record<string, unknown>).children;
        if (Array.isArray(children)) return children;
      }
    }
    return null;
  };

  const children = extractChildren(value);
  if (!children) return false;
  if (children.length === 0) return true;

  let hasVisibleText = false;
  let hasBlocks = false;

  const visit = (node: unknown): void => {
    if (hasVisibleText || hasBlocks) return;

    if (Array.isArray(node)) {
      node.forEach(visit);
      return;
    }

    if (!node || typeof node !== 'object') return;

    const typedNode = node as Record<string, unknown>;
    const nodeType = typeof typedNode.type === 'string' ? typedNode.type : undefined;

    if (nodeType === 'block') {
      hasBlocks = true;
      return;
    }

    if (typeof typedNode.text === 'string' && typedNode.text.trim().length > 0) {
      hasVisibleText = true;
      return;
    }

    if (
      nodeType === 'span' &&
      typeof typedNode.value === 'string' &&
      typedNode.value.trim().length > 0
    ) {
      hasVisibleText = true;
      return;
    }

    if (Array.isArray(typedNode.children)) {
      typedNode.children.forEach(visit);
    }
  };

  visit(children);
  return !hasVisibleText && !hasBlocks;
}

/**
 * Recursively extracts all text values from a nested structure,
 * commonly used with structured text fields.
 *
 * Uses a WeakSet to detect and prevent infinite loops from circular references.
 *
 * @param data - Any structured text document or node tree.
 * @returns An array of string values discovered in `text` or string `value` keys.
 */
export function extractTextValues(data: unknown): string[] {
  const textValues: string[] = [];
  // BUGFIX: Track visited objects to prevent infinite loops from circular references
  const visited = new WeakSet<object>();

  // Define a recursive type for structured text nodes
  type StructuredTextItem = {
    text?: string;
    value?: string;
    [key: string]: unknown;
  };

  function traverse(obj: unknown) {
    if (Array.isArray(obj)) {
      // Arrays are objects, so we need to track them too
      if (visited.has(obj)) return;
      visited.add(obj);
      obj.forEach(traverse);
    } else if (typeof obj === 'object' && obj !== null) {
      // Skip if we've already visited this object (circular reference)
      if (visited.has(obj)) return;
      visited.add(obj);

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
 * Uses a Map to track visited objects for circular reference detection.
 * Note: We use Map instead of WeakSet because we need to return the already-
 * processed clone for circular references, not just detect them.
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
  // BUGFIX: Track visited objects to prevent infinite loops from circular references
  // We use Map to store original->clone mapping so circular refs point to the same clone
  const visited = new Map<object, unknown>();

  type StructuredTextNode = {
    text?: string;
    value?: string;
    [key: string]: unknown;
  };

  function traverse(obj: unknown): unknown {
    if (Array.isArray(obj)) {
      // Check for circular reference
      if (visited.has(obj)) {
        return visited.get(obj);
      }
      const clone: unknown[] = [];
      visited.set(obj, clone);
      for (const item of obj) {
        clone.push(traverse(item));
      }
      return clone;
    }

    if (typeof obj === 'object' && obj !== null) {
      // Check for circular reference
      if (visited.has(obj)) {
        return visited.get(obj);
      }

      const typedObj = obj as StructuredTextNode;
      const newObj: Record<string, unknown> = {};
      visited.set(obj, newObj);

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
