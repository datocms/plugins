// src/utils/translation/utils.ts

/**
 * Extracts the top-level children array from a structured text value.
 *
 * @param input - A structured text value (array or document object).
 * @returns The children array if found, or null.
 */
function extractStructuredTextChildren(input: unknown): unknown[] | null {
  if (Array.isArray(input)) return input;
  if (input && typeof input === 'object') {
    const document = (input as Record<string, unknown>).document;
    if (document && typeof document === 'object') {
      const children = (document as Record<string, unknown>).children;
      if (Array.isArray(children)) return children;
    }
  }
  return null;
}

/**
 * Checks whether a single structured text node contains visible text.
 *
 * @param typedNode - The node object to inspect.
 * @returns True if the node itself carries non-empty text content.
 */
function nodeHasVisibleText(typedNode: Record<string, unknown>): boolean {
  const nodeType =
    typeof typedNode.type === 'string' ? typedNode.type : undefined;

  if (typeof typedNode.text === 'string' && typedNode.text.trim().length > 0) {
    return true;
  }
  if (
    nodeType === 'span' &&
    typeof typedNode.value === 'string' &&
    typedNode.value.trim().length > 0
  ) {
    return true;
  }
  return false;
}

/**
 * Visits a structured text node tree and sets flags for visible text or blocks.
 * Modifies the shared state object in place to signal early exit.
 *
 * @param node - The current node (may be array, object, or primitive).
 * @param state - Shared mutable flags updated during traversal.
 */
function visitStructuredTextNode(
  node: unknown,
  state: { hasVisibleText: boolean; hasBlocks: boolean },
): void {
  if (state.hasVisibleText || state.hasBlocks) return;

  if (Array.isArray(node)) {
    for (const child of node) {
      visitStructuredTextNode(child, state);
    }
    return;
  }

  if (!node || typeof node !== 'object') return;

  const typedNode = node as Record<string, unknown>;
  const nodeType =
    typeof typedNode.type === 'string' ? typedNode.type : undefined;

  if (nodeType === 'block') {
    state.hasBlocks = true;
    return;
  }

  if (nodeHasVisibleText(typedNode)) {
    state.hasVisibleText = true;
    return;
  }

  if (Array.isArray(typedNode.children)) {
    for (const child of typedNode.children) {
      visitStructuredTextNode(child, state);
    }
  }
}

/**
 * Checks if a structured text field value is effectively empty.
 * A structured text is considered empty when it has no visible text content
 * and no embedded block nodes.
 *
 * @param value - The structured text value to check.
 * @returns True if the value represents an empty structured text field.
 */
export function isEmptyStructuredText(value: unknown): boolean {
  const children = extractStructuredTextChildren(value);
  if (!children) return false;
  if (children.length === 0) return true;

  const state = { hasVisibleText: false, hasBlocks: false };
  visitStructuredTextNode(children, state);
  return !state.hasVisibleText && !state.hasBlocks;
}

/**
 * Visits a single node when extracting text values, collecting string content
 * from `text` and string `value` properties.
 *
 * @param obj - The node to inspect.
 * @param textValues - Accumulator array to push text into.
 * @param visited - WeakSet of already-visited objects to prevent circular loops.
 */
function collectTextFromNode(
  obj: unknown,
  textValues: string[],
  visited: WeakSet<object>,
): void {
  if (Array.isArray(obj)) {
    if (visited.has(obj)) return;
    visited.add(obj);
    for (const item of obj) {
      collectTextFromNode(item, textValues, visited);
    }
    return;
  }

  if (typeof obj !== 'object' || obj === null) return;

  if (visited.has(obj)) return;
  visited.add(obj);

  const item = obj as { text?: string; value?: string; [key: string]: unknown };

  if (item.text !== undefined) {
    textValues.push(item.text);
  } else if (item.value !== undefined && typeof item.value === 'string') {
    textValues.push(item.value);
  }

  for (const child of Object.values(item)) {
    collectTextFromNode(child, textValues, visited);
  }
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
  collectTextFromNode(data, textValues, visited);
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
      if (key === 'data') {
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
 * State container for the object reconstruction traversal.
 */
type ReconstructState = {
  index: number;
  visited: Map<object, unknown>;
  textValues: string[];
};

/**
 * Reconstructs an array node by cloning each element with translated text substituted in.
 *
 * @param arr - Source array to reconstruct.
 * @param state - Shared traversal state (index cursor, visited map, text values).
 * @returns A new array with translated text values substituted.
 */
function reconstructArray(arr: unknown[], state: ReconstructState): unknown[] {
  if (state.visited.has(arr)) {
    return state.visited.get(arr) as unknown[];
  }
  const clone: unknown[] = [];
  state.visited.set(arr, clone);
  for (const item of arr) {
    clone.push(reconstructNode(item, state));
  }
  return clone;
}

/**
 * Reconstructs an object node by substituting text/value fields with translated strings.
 *
 * @param obj - Source object to reconstruct.
 * @param state - Shared traversal state (index cursor, visited map, text values).
 * @returns A new object with translated text values substituted.
 */
function reconstructObjectNode(
  obj: Record<string, unknown>,
  state: ReconstructState,
): Record<string, unknown> {
  if (state.visited.has(obj)) {
    return state.visited.get(obj) as Record<string, unknown>;
  }
  const newObj: Record<string, unknown> = {};
  state.visited.set(obj, newObj);

  for (const key in obj) {
    const isTextKey = key === 'text';
    const isStringValueKey = key === 'value' && typeof obj[key] === 'string';
    const hasRemainingText = state.index < state.textValues.length;

    if ((isTextKey || isStringValueKey) && hasRemainingText) {
      newObj[key] = state.textValues[state.index++];
    } else {
      newObj[key] = reconstructNode(obj[key], state);
    }
  }
  return newObj;
}

/**
 * Routes a single node through the appropriate reconstruction handler.
 *
 * @param obj - The node to reconstruct.
 * @param state - Shared traversal state.
 * @returns The reconstructed node with translated text inserted.
 */
function reconstructNode(obj: unknown, state: ReconstructState): unknown {
  if (Array.isArray(obj)) {
    return reconstructArray(obj, state);
  }
  if (typeof obj === 'object' && obj !== null) {
    return reconstructObjectNode(obj as Record<string, unknown>, state);
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
  textValues: string[],
): unknown {
  // BUGFIX: Track visited objects to prevent infinite loops from circular references
  // We use Map to store original->clone mapping so circular refs point to the same clone
  const state: ReconstructState = {
    index: 0,
    visited: new Map<object, unknown>(),
    textValues,
  };
  return reconstructNode(originalObject, state);
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
  index: number,
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
      if (key === 'data') {
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
