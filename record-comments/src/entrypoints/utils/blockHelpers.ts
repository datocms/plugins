/**
 * Block handling utilities for modular content and structured text fields.
 * These helpers provide type-safe operations on DatoCMS block values.
 */

/**
 * Represents a block value from modular content or structured text fields.
 */
export type BlockValue = {
  id?: string;
  type?: string;
  itemTypeId?: string;
  attributes?: Record<string, unknown>;
  /** For structured text, blocks reference by item ID */
  item?: string;
  /** Original DAST index for structured text blocks */
  __dastIndex?: number;
  /** Marker for structured text blocks */
  __isStructuredTextBlock?: boolean;
  /** Block model ID from structured text format */
  blockModelId?: string;
};

export type FieldValue = BlockValue[] | BlockValue | unknown;

// ============================================================================
// Type Guards
// ============================================================================

/**
 * Checks if a value is a BlockValue object.
 * BlockValue has optional id, type, itemTypeId, and attributes.
 */
export function isBlockValue(value: unknown): value is BlockValue {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    return false;
  }

  const obj = value as Record<string, unknown>;

  // A block value should have at least one of these identifying properties
  const hasIdentifier =
    typeof obj.id === 'string' ||
    typeof obj.type === 'string' ||
    typeof obj.itemTypeId === 'string';

  // Attributes, if present, should be an object
  const hasValidAttributes =
    obj.attributes === undefined ||
    (typeof obj.attributes === 'object' && obj.attributes !== null);

  return hasIdentifier && hasValidAttributes;
}

/**
 * Checks if a value is a plain object (not a block, not an array).
 * Used for localized field values.
 */
export function isPlainObject(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
}

/**
 * Checks if a value is a FieldValue-compatible record (object with string keys).
 * More permissive than isPlainObject - accepts any object that can serve as FieldValue container.
 */
export function isFieldValueRecord(value: unknown): value is Record<string, FieldValue> {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
}

/**
 * Checks if a fieldType is a valid block container type.
 * Returns a type guard narrowing the string to the specific union type.
 */
export function isBlockContainerType(
  fieldType: string
): fieldType is 'modular_content' | 'structured_text' | 'single_block' | 'rich_text' {
  return (
    fieldType === 'modular_content' ||
    fieldType === 'structured_text' ||
    fieldType === 'single_block' ||
    fieldType === 'rich_text'
  );
}

/**
 * Type guard for checking if a block has attributes property as a record.
 */
export function hasBlockAttributes(
  block: BlockValue
): block is BlockValue & { attributes: Record<string, unknown> } {
  return block.attributes !== undefined && typeof block.attributes === 'object' && block.attributes !== null;
}

/**
 * Type guard for checking if a block has __dastIndex (structured text block).
 */
export function isStructuredTextBlock(
  block: BlockValue
): block is BlockValue & { __isStructuredTextBlock: true; __dastIndex: number } {
  return block.__isStructuredTextBlock === true && typeof block.__dastIndex === 'number';
}

// ============================================================================
// SDK Type Guards (for DatoCMS SDK structures)
// ============================================================================

/**
 * ================================================================================
 * SDK STRUCTURE TYPE GUARDS
 * ================================================================================
 *
 * The DatoCMS SDK types `validators` and `appearance` as `unknown` on field attributes.
 * These type guards provide safe runtime validation of SDK structures.
 *
 * WHY TYPE GUARDS INSTEAD OF ASSERTIONS:
 * - `as SomeType` silently assumes the structure is correct
 * - Type guards verify at runtime, providing safety against SDK changes
 * - Guards document the expected structure explicitly
 *
 * ================================================================================
 */

/**
 * Validator structure containing block model IDs.
 * Used for modular_content, single_block, and structured_text fields.
 */
export type FieldValidators = {
  item_item_type?: { item_types: string[] };
  rich_text_blocks?: { item_types: string[] };
  structured_text_blocks?: { item_types: string[] };
};

/**
 * Appearance structure containing editor type.
 */
export type FieldAppearance = {
  editor?: string;
};

/**
 * Type guard for SDK field validators structure.
 * Returns true if the value matches the FieldValidators shape.
 */
export function isFieldValidators(value: unknown): value is FieldValidators {
  if (!value || typeof value !== 'object') return false;

  const obj = value as Record<string, unknown>;

  // Check item_item_type if present
  if (obj.item_item_type !== undefined) {
    if (!isPlainObject(obj.item_item_type)) return false;
    const itemType = obj.item_item_type as Record<string, unknown>;
    if (!Array.isArray(itemType.item_types)) return false;
    if (!itemType.item_types.every((t) => typeof t === 'string')) return false;
  }

  // Check rich_text_blocks if present
  if (obj.rich_text_blocks !== undefined) {
    if (!isPlainObject(obj.rich_text_blocks)) return false;
    const richText = obj.rich_text_blocks as Record<string, unknown>;
    if (!Array.isArray(richText.item_types)) return false;
    if (!richText.item_types.every((t) => typeof t === 'string')) return false;
  }

  // Check structured_text_blocks if present
  if (obj.structured_text_blocks !== undefined) {
    if (!isPlainObject(obj.structured_text_blocks)) return false;
    const structText = obj.structured_text_blocks as Record<string, unknown>;
    if (!Array.isArray(structText.item_types)) return false;
    if (!structText.item_types.every((t) => typeof t === 'string')) return false;
  }

  return true;
}

/**
 * Type guard for SDK field appearance structure.
 * Returns true if the value has an optional editor property.
 */
export function isFieldAppearance(value: unknown): value is FieldAppearance {
  if (!value || typeof value !== 'object') return false;

  const obj = value as Record<string, unknown>;

  // Editor is optional but if present must be a string
  if (obj.editor !== undefined && typeof obj.editor !== 'string') {
    return false;
  }

  return true;
}

/**
 * Safely extracts editor type from SDK appearance.
 * Returns undefined if appearance is invalid or editor is not set.
 */
export function getEditorType(appearance: unknown): string | undefined {
  if (!isFieldAppearance(appearance)) return undefined;
  return appearance.editor;
}

/**
 * Safely extracts validators from SDK field attributes.
 * Returns undefined if validators are invalid.
 */
export function getValidators(validators: unknown): FieldValidators | undefined {
  if (!isFieldValidators(validators)) return undefined;
  return validators;
}

// ============================================================================
// Block Property Extractors
// ============================================================================

/**
 * Extracts block model ID from a BlockValue safely.
 * Returns undefined if the block doesn't have a valid model ID.
 */
export function getBlockModelId(block: BlockValue): string | undefined {
  const modelId = block.itemTypeId ?? block.type;
  return typeof modelId === 'string' ? modelId : undefined;
}

/**
 * Known block metadata properties that should NOT be treated as field values.
 * These are structural properties of BlockValue, not user-defined field data.
 */
const BLOCK_METADATA_KEYS = new Set([
  'id',
  'type',
  'itemTypeId',
  'attributes',
  'item',
  '__dastIndex',
  '__isStructuredTextBlock',
  'blockModelId',
]);

/**
 * Extracts block attributes safely.
 * Returns the attributes object, or filters the block to exclude metadata properties.
 *
 * This ensures only actual field values are returned, not block structural properties
 * like `id`, `type`, `itemTypeId`, etc.
 */
export function safeGetBlockAttributes(block: BlockValue): Record<string, FieldValue> {
  // If block has explicit attributes property, use it directly
  if (block.attributes && typeof block.attributes === 'object') {
    return block.attributes as Record<string, FieldValue>;
  }

  // Otherwise, filter out known metadata keys to get only field values.
  // This handles cases where block data is inline (e.g., from form values).
  const fieldValues: Record<string, FieldValue> = {};

  for (const key of Object.keys(block)) {
    if (!BLOCK_METADATA_KEYS.has(key)) {
      fieldValues[key] = (block as Record<string, FieldValue>)[key];
    }
  }

  return fieldValues;
}

// ============================================================================
// Block Extraction
// ============================================================================

/**
 * Extracts blocks from a field value, handling both modular content and structured text formats.
 *
 * For modular content: Returns the array of blocks directly.
 * For structured text: Parses the DAST format and extracts block nodes.
 */
export function extractBlocksFromFieldValue(
  fieldValue: FieldValue,
  fieldType: string
): BlockValue[] {
  if (!fieldValue) return [];

  // Structured text (rich_text in API) stores blocks in a DAST (document) format
  if (fieldType === 'structured_text' || fieldType === 'rich_text') {
    return extractBlocksFromStructuredText(fieldValue);
  }

  // Modular content is just an array of blocks
  if (Array.isArray(fieldValue)) {
    return fieldValue as BlockValue[];
  }

  return [];
}

/**
 * Extracts blocks from structured text DAST format.
 * Handles multiple DAST format variations (document, value, or raw array).
 */
function extractBlocksFromStructuredText(fieldValue: FieldValue): BlockValue[] {
  // Check for 'document' key (standard DAST format)
  if (isPlainObject(fieldValue) && 'document' in fieldValue) {
    const doc = fieldValue as { document: unknown; schema: string; blocks?: BlockValue[] };
    return doc.blocks ?? [];
  }

  // Check for 'value' key (alternative DAST format)
  if (isPlainObject(fieldValue) && 'value' in fieldValue) {
    const doc = fieldValue as { value: unknown; schema?: string; blocks?: BlockValue[] };
    return doc.blocks ?? [];
  }

  // Array format (form values) - could be DAST nodes or modular content
  if (Array.isArray(fieldValue)) {
    return extractBlocksFromDastArray(fieldValue);
  }

  return [];
}

/**
 * Extracts blocks from a DAST array format (used in form values).
 * Distinguishes between modular content arrays and structured text DAST nodes.
 */
function extractBlocksFromDastArray(fieldValue: unknown[]): BlockValue[] {
  const firstItem = fieldValue[0] as Record<string, unknown> | undefined;

  // Check if this looks like a modular content array (items have itemTypeId directly)
  const isModularContentArray =
    firstItem &&
    typeof firstItem.itemTypeId === 'string' &&
    !firstItem.blockModelId;

  if (isModularContentArray) {
    // Modular content - return as-is, these are already BlockValues
    return fieldValue as BlockValue[];
  }

  // Structured text DAST - extract block nodes, preserving their ORIGINAL index
  const blockNodesWithIndex: { node: Record<string, unknown>; originalIndex: number }[] = [];

  fieldValue.forEach((node: unknown, index: number) => {
    const n = node as Record<string, unknown>;
    // A block node has blockModelId (the block model type ID)
    if (typeof n.blockModelId === 'string') {
      blockNodesWithIndex.push({ node: n, originalIndex: index });
    }
  });

  // Convert to BlockValue format - blockModelId maps to itemTypeId/type
  return blockNodesWithIndex.map(({ node, originalIndex }) => ({
    ...node,
    itemTypeId: node.blockModelId as string,
    type: node.blockModelId as string,
    __dastIndex: originalIndex,
    __isStructuredTextBlock: true,
  } as BlockValue));
}

// ============================================================================
// Block Index Helpers
// ============================================================================

/**
 * Gets the effective index for a block, handling structured text's DAST index.
 */
export function getBlockIndex(block: BlockValue, arrayIndex: number): number {
  if (block.__isStructuredTextBlock && block.__dastIndex !== undefined) {
    return block.__dastIndex;
  }
  return arrayIndex;
}
