import type { Client } from '@datocms/cma-client-browser';
import type { Root } from 'datocms-structured-text-utils';

// =============================================================================
// App-specific types
// =============================================================================

export interface BlockAnalysis {
  block: {
    id: string;
    name: string;
    apiKey: string;
  };
  fields: FieldInfo[];
  modularContentFields: ModularContentFieldInfo[];
  totalAffectedRecords: number;
}

export interface FieldInfo {
  id: string;
  label: string;
  apiKey: string;
  fieldType: string;
  localized: boolean;
  validators: Record<string, unknown>;
  appearance: {
    editor: string;
    parameters: Record<string, unknown>;
    addons: Array<{
      id: string;
      parameters: Record<string, unknown>;
    }>;
  };
  position: number;
  hint?: string;
  defaultValue?: unknown;
}

export interface ModularContentFieldInfo {
  id: string;
  label: string;
  apiKey: string;
  parentModelId: string;
  parentModelName: string;
  parentModelApiKey: string;
  parentIsBlock: boolean;
  localized: boolean;
  allowedBlockIds: string[];
  position?: number;
  hint?: string;
  fieldType: 'rich_text' | 'structured_text' | 'single_block';
}

/**
 * Represents a path from a root model to a nested block's field.
 * Each step in the path represents navigating into a modular content field.
 */
export interface NestedBlockPath {
  rootModelId: string;
  rootModelName: string;
  rootModelApiKey: string;
  path: Array<{
    fieldApiKey: string;
    expectedBlockTypeId: string;
    localized: boolean;
    fieldType: 'rich_text' | 'structured_text' | 'single_block';
  }>;
  fieldInfo: ModularContentFieldInfo;
  /** True if ANY step in the path is localized (meaning block data varies by locale) */
  isInLocalizedContext: boolean;
}

/**
 * Represents a group of block instances from different locales at the same position.
 * Used for merging locale-specific block data into a single record with localized fields.
 */
export interface GroupedBlockInstance {
  /** Unique key: rootRecordId + pathIndices */
  groupKey: string;
  /** The root record containing these blocks */
  rootRecordId: string;
  /** Position indices in the nested structure */
  pathIndices: number[];
  /** Map of locale -> block data. For non-localized contexts: { __default__: data } */
  localeData: Record<string, Record<string, unknown>>;
  /** All block IDs from all locales (for mapping) */
  allBlockIds: string[];
  /** Reference block ID (from first locale found) for primary mapping */
  referenceBlockId: string;
}

export interface ConversionProgress {
  currentStep: number;
  totalSteps: number;
  stepDescription: string;
  percentage: number;
  details?: string;
}

export interface ConversionResult {
  success: boolean;
  newModelId?: string;
  newModelApiKey?: string;
  migratedRecordsCount: number;
  convertedFieldsCount: number;
  error?: string;
  /** Original block model name (for renaming after deletion) */
  originalBlockName?: string;
  /** Original block model api_key (for renaming after deletion) */
  originalBlockApiKey?: string;
}

export interface BlockMigrationMapping {
  [blockInstanceId: string]: string;
}

export type ProgressCallback = (progress: ConversionProgress) => void;

export type CMAClient = Client;

// =============================================================================
// CMA-specific DAST types (different from CDA format)
// =============================================================================

/**
 * The complete structured text field value as stored in DatoCMS CMA.
 * Note: This differs from the CDA format - CMA uses 'document' while CDA uses 'value'.
 * When using `nested: true`, blocks and links are expanded inline.
 */
export interface StructuredTextValue {
  /** The schema identifier, always "dast" for DatoCMS */
  schema: 'dast';
  /** The DAST document tree */
  document: Root;
  /** Array of block instances embedded in this structured text */
  blocks?: DastBlockRecord[];
  /** Array of linked records referenced in this structured text */
  links?: DastLinkRecord[];
}

/**
 * A block record embedded in structured text (from the blocks array).
 * This is the CMA format which includes relationships and attributes.
 */
export interface DastBlockRecord {
  id: string;
  /** Block type relationships */
  relationships?: {
    item_type?: {
      data?: {
        type: 'item_type';
        id: string;
      };
    };
  };
  /** Block attributes/field values */
  attributes?: Record<string, unknown>;
  /** Convenience property for item type ID */
  __itemTypeId?: string;
  /** Direct item_type reference (alternative format) */
  item_type?: string | { id: string };
  [key: string]: unknown;
}

/**
 * A linked record referenced in structured text (from the links array)
 */
export interface DastLinkRecord {
  id: string;
  [key: string]: unknown;
}

/**
 * Result of finding block nodes in a DAST document
 */
export interface DastBlockNodeInfo {
  /** The node type (block or inlineBlock) */
  nodeType: 'block' | 'inlineBlock';
  /** The item ID referencing the blocks array */
  itemId: string;
  /** The block type ID (from blocks array lookup) */
  blockTypeId: string | undefined;
  /** Path to this node in the tree for later replacement */
  path: (string | number)[];
}
