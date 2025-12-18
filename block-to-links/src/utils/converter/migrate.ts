/**
 * Data Migration Utilities
 * 
 * Functions for migrating block data to new records and updating field values.
 * Handles both standard and nested block scenarios, as well as localized contexts.
 * 
 * @module utils/converter/migrate
 */

import type {
  CMAClient,
  BlockMigrationMapping,
  NestedBlockPath,
  GroupedBlockInstance,
  StructuredTextValue,
} from '../../types';
import { getBlockTypeId, getBlockId } from '../blocks';
import { wrapFieldsInLocalizedHash, mergeLocaleData, completeLocalizedUpdate } from '../locale';
import {
  sanitizeFieldValuesForCreation,
  sanitizeLocalizedFieldValuesForCreation,
} from './sanitize';
import {
  traverseAndUpdateNestedBlocks,
  traverseAndUpdateNestedBlocksAtLevel,
  getNestedFieldValueFromBlock,
  setNestedFieldValueInBlock,
} from './traverse';
import {
  isStructuredTextValue,
  transformDastBlocksToLinks,
  extractLinksFromStructuredText,
  addInlineItemsAlongsideBlocks,
} from '../dast';
import { findBlocksAtPath } from '../analyzer';

// =============================================================================
// Types
// =============================================================================

/** Options for migration operations */
export interface MigrationOptions {
  /** Track records that need publishing after changes */
  recordsToPublish?: Set<string>;
  /** Force fields to be wrapped in localized hashes */
  forceLocalizedFields?: boolean;
  /** Available locales in the project */
  availableLocales?: string[];
}

// =============================================================================
// Block Instance Migration
// =============================================================================

/**
 * Migrates block instances to new records using nested paths.
 * Creates a new record for each unique block instance found.
 * 
 * @param client - DatoCMS CMA client
 * @param nestedPath - Path from root model to target blocks
 * @param blockId - ID of the block type being converted
 * @param newModelId - ID of the new model to create records in
 * @param existingMapping - Existing block ID to record ID mapping
 * @param onMigrated - Callback with current count of migrated records
 * @param options - Additional migration options
 * @returns Mapping of block instance IDs to new record IDs
 */
export async function migrateBlocksToRecordsNested(
  client: CMAClient,
  nestedPath: NestedBlockPath,
  blockId: string,
  newModelId: string,
  existingMapping: BlockMigrationMapping,
  onMigrated: (count: number) => void,
  options: MigrationOptions = {}
): Promise<BlockMigrationMapping> {
  const { forceLocalizedFields = false, availableLocales = [] } = options;
  const mapping: BlockMigrationMapping = {};
  let migratedCount = Object.keys(existingMapping).length;

  // Get all block instances following the nested path
  const blockInstances = await getAllBlockInstancesNested(client, nestedPath, blockId);

  // Filter out blocks that were already migrated
  const uniqueBlocks = new Map<string, (typeof blockInstances)[0]>();
  for (const instance of blockInstances) {
    if (!uniqueBlocks.has(instance.blockId) && !existingMapping[instance.blockId]) {
      uniqueBlocks.set(instance.blockId, instance);
    }
  }

  const blocksArray = Array.from(uniqueBlocks.values());

  for (const instance of blocksArray) {
    // Sanitize the block data
    const sanitizedData = sanitizeFieldValuesForCreation(instance.blockData);
    
    // Wrap in localized hash if needed
    let recordData: Record<string, unknown>;
    if (forceLocalizedFields && availableLocales.length > 0) {
      recordData = wrapFieldsInLocalizedHash(sanitizedData, availableLocales);
    } else {
      recordData = sanitizedData;
    }

    const newRecord = await client.items.create({
      item_type: { type: 'item_type', id: newModelId },
      ...recordData,
    });

    mapping[instance.blockId] = newRecord.id;
    migratedCount++;
    onMigrated(migratedCount);
  }

  return mapping;
}

/**
 * Migrates grouped block instances (from localized contexts) to records.
 * Creates ONE record per block position, merging locale data into localized fields.
 * 
 * @param client - DatoCMS CMA client
 * @param groupedInstances - Block instances grouped by position
 * @param newModelId - ID of the new model to create records in
 * @param availableLocales - Available locales in the project
 * @param existingMapping - Existing block ID to record ID mapping
 * @param onMigrated - Callback with current count of migrated records
 * @returns Mapping of block instance IDs to new record IDs
 */
export async function migrateGroupedBlocksToRecords(
  client: CMAClient,
  groupedInstances: GroupedBlockInstance[],
  newModelId: string,
  availableLocales: string[],
  existingMapping: BlockMigrationMapping,
  onMigrated: (count: number) => void
): Promise<BlockMigrationMapping> {
  const mapping: BlockMigrationMapping = {};
  let migratedCount = Object.keys(existingMapping).length;

  // Filter out groups where all block IDs were already migrated
  const groupsToMigrate = groupedInstances.filter(group => {
    return !group.allBlockIds.every(id => existingMapping[id]);
  });

  for (const group of groupsToMigrate) {
    // Get all field keys from all locales
    const allFieldKeys = new Set<string>();
    for (const localeKey of Object.keys(group.localeData)) {
      for (const fieldKey of Object.keys(group.localeData[localeKey])) {
        allFieldKeys.add(fieldKey);
      }
    }

    // Build localized field values from the group's locale data
    const localizedFieldData = mergeLocaleData(
      group.localeData,
      allFieldKeys,
      availableLocales
    );

    // Sanitize the localized field data
    const sanitizedData = sanitizeLocalizedFieldValuesForCreation(localizedFieldData);

    const newRecord = await client.items.create({
      item_type: { type: 'item_type', id: newModelId },
      ...sanitizedData,
    });

    // Map ALL original block IDs from all locales to this single new record
    for (const blockInstanceId of group.allBlockIds) {
      mapping[blockInstanceId] = newRecord.id;
    }
    
    // Also map the group key for easy reference
    mapping[group.groupKey] = newRecord.id;
    
    migratedCount++;
    onMigrated(migratedCount);
  }

  return mapping;
}

// =============================================================================
// Field Data Migration
// =============================================================================

/**
 * Migrates data from an old modular content field to a new links field.
 * Reads blocks from the old field, maps them to new record IDs, and writes to the new field.
 * 
 * @param client - DatoCMS CMA client
 * @param modelId - ID of the model containing the fields
 * @param oldFieldApiKey - API key of the source field
 * @param newFieldApiKey - API key of the target links field
 * @param isLocalized - Whether the field is localized
 * @param targetBlockId - ID of the block type being converted
 * @param mapping - Block ID to record ID mapping
 * @param isSingleValue - Whether the target is a single link (not links array)
 * @param recordsToPublish - Optional set to track records for publishing
 */
export async function migrateFieldData(
  client: CMAClient,
  modelId: string,
  oldFieldApiKey: string,
  newFieldApiKey: string,
  isLocalized: boolean,
  targetBlockId: string,
  mapping: BlockMigrationMapping,
  isSingleValue: boolean,
  recordsToPublish?: Set<string>
): Promise<void> {
  for await (const record of client.items.listPagedIterator({
    filter: { type: modelId },
    nested: true,
    version: 'current',
  })) {
    const oldValue = record[oldFieldApiKey];
    if (!oldValue) continue;

    let newValue: unknown;

    if (isLocalized && typeof oldValue === 'object' && !Array.isArray(oldValue)) {
      // Localized field - process each locale
      const localizedValue: Record<string, unknown> = {};
      for (const [locale, localeValue] of Object.entries(oldValue as Record<string, unknown>)) {
        localizedValue[locale] = extractLinksFromValue(
          localeValue,
          targetBlockId,
          mapping,
          isSingleValue
        );
      }
      newValue = localizedValue;
    } else {
      // Non-localized field
      newValue = extractLinksFromValue(oldValue, targetBlockId, mapping, isSingleValue);
    }

    try {
      await client.items.update(record.id, {
        [newFieldApiKey]: newValue,
      });
      recordsToPublish?.add(record.id);
    } catch (error) {
      console.error(`Failed to migrate data for record ${record.id}:`, error);
    }
  }
}

/**
 * Appends links from a new block conversion to an existing links field.
 * Unlike migrateFieldData which replaces, this preserves existing links.
 * 
 * @param client - DatoCMS CMA client
 * @param modelId - ID of the model containing the fields
 * @param oldFieldApiKey - API key of the source modular content field
 * @param linksFieldApiKey - API key of the existing links field
 * @param isLocalized - Whether the field is localized
 * @param targetBlockId - ID of the block type being converted
 * @param mapping - Block ID to record ID mapping
 * @param recordsToPublish - Optional set to track records for publishing
 */
export async function migrateFieldDataAppend(
  client: CMAClient,
  modelId: string,
  oldFieldApiKey: string,
  linksFieldApiKey: string,
  isLocalized: boolean,
  targetBlockId: string,
  mapping: BlockMigrationMapping,
  recordsToPublish?: Set<string>
): Promise<void> {
  // Read WITHOUT nested to get raw field values for existing links
  for await (const record of client.items.listPagedIterator({
    filter: { type: modelId },
    version: 'current',
  })) {
    // Fetch same record with nested: true for block data
    const nestedRecord = await client.items.find(record.id, { nested: true, version: 'current' });
    const oldValue = nestedRecord[oldFieldApiKey];
    const existingLinksValue = record[linksFieldApiKey];
    
    if (!oldValue) continue;

    let newValue: unknown;

    if (isLocalized && typeof oldValue === 'object' && !Array.isArray(oldValue)) {
      const localizedValue: Record<string, unknown> = {};
      const existingLocalized = (existingLinksValue || {}) as Record<string, unknown>;
      const oldValueLocalized = oldValue as Record<string, unknown>;
      
      const allLocales = new Set([
        ...Object.keys(oldValueLocalized),
        ...Object.keys(existingLocalized),
      ]);
      
      for (const locale of allLocales) {
        const localeValue = oldValueLocalized[locale];
        const newLinks = localeValue 
          ? extractLinksFromValue(localeValue, targetBlockId, mapping, false) as string[]
          : [];
        const existingLinks = normalizeLinksArray(existingLocalized[locale]);
        localizedValue[locale] = combineLinks(existingLinks, newLinks);
      }
      newValue = localizedValue;
    } else {
      const newLinks = extractLinksFromValue(oldValue, targetBlockId, mapping, false) as string[];
      const existingLinks = normalizeLinksArray(existingLinksValue);
      newValue = combineLinks(existingLinks, newLinks);
    }

    try {
      await client.items.update(record.id, {
        [linksFieldApiKey]: newValue,
      });
      recordsToPublish?.add(record.id);
    } catch (error) {
      console.error(`Failed to append data for record ${record.id}:`, error);
    }
  }
}

// =============================================================================
// Nested Field Data Migration
// =============================================================================

/**
 * Migrates data for fields inside nested blocks.
 * Queries records from the root model and navigates into nested block structures.
 * 
 * @param client - DatoCMS CMA client
 * @param nestedPath - Path from root model to the field
 * @param oldFieldApiKey - API key of the source field in the block
 * @param newFieldApiKey - API key of the target links field in the block
 * @param targetBlockId - ID of the block type being converted
 * @param mapping - Block ID to record ID mapping
 * @param isSingleValue - Whether the target is a single link
 * @param availableLocales - Available locales in the project
 * @param recordsToPublish - Optional set to track records for publishing
 */
export async function migrateNestedBlockFieldData(
  client: CMAClient,
  nestedPath: NestedBlockPath,
  oldFieldApiKey: string,
  newFieldApiKey: string,
  targetBlockId: string,
  mapping: BlockMigrationMapping,
  isSingleValue: boolean,
  availableLocales: string[],
  recordsToPublish?: Set<string>
): Promise<void> {
  // Path to parent block (stop one level before the final block)
  const pathToParentBlock = nestedPath.path.slice(0, -1);

  for await (const record of client.items.listPagedIterator({
    filter: { type: nestedPath.rootModelId },
    nested: true,
    version: 'current',
  })) {
    const rootFieldApiKey = nestedPath.path[0].fieldApiKey;
    const rootFieldValue = record[rootFieldApiKey];

    if (!rootFieldValue) continue;

    // Update function for parent blocks
    const updateBlockFn = (blockData: Record<string, unknown>): Record<string, unknown> => {
      const oldValue = getNestedFieldValueFromBlock(blockData, oldFieldApiKey);
      if (!oldValue) return blockData;

      const newValue = extractLinksFromValue(oldValue, targetBlockId, mapping, isSingleValue);
      return setNestedFieldValueInBlock(blockData, newFieldApiKey, newValue);
    };

    let result: { updated: boolean; newValue: unknown };

    if (pathToParentBlock.length === 0) {
      result = traverseAndUpdateNestedBlocksAtLevel(
        rootFieldValue,
        nestedPath.path[0],
        updateBlockFn
      );
    } else {
      result = traverseAndUpdateNestedBlocks(
        rootFieldValue,
        pathToParentBlock,
        0,
        updateBlockFn
      );
    }

    if (result.updated) {
      // Ensure all locales are present
      let updateValue = result.newValue;
      
      if (nestedPath.path[0].localized && typeof result.newValue === 'object' && !Array.isArray(result.newValue)) {
        updateValue = completeLocalizedUpdate(
          result.newValue as Record<string, unknown>,
          rootFieldValue as Record<string, unknown>,
          availableLocales
        );
      }
      
      await client.items.update(record.id, {
        [rootFieldApiKey]: updateValue,
      });
      recordsToPublish?.add(record.id);
    }
  }
}

/**
 * Appends links for fields inside nested blocks.
 * Similar to migrateNestedBlockFieldData but preserves existing links.
 */
export async function migrateNestedBlockFieldDataAppend(
  client: CMAClient,
  nestedPath: NestedBlockPath,
  oldFieldApiKey: string,
  linksFieldApiKey: string,
  targetBlockId: string,
  mapping: BlockMigrationMapping,
  availableLocales: string[],
  recordsToPublish?: Set<string>
): Promise<void> {
  const pathToParentBlock = nestedPath.path.slice(0, -1);

  const updateBlockFn = (blockData: Record<string, unknown>): Record<string, unknown> => {
    const oldValue = getNestedFieldValueFromBlock(blockData, oldFieldApiKey);
    const existingLinksValue = getNestedFieldValueFromBlock(blockData, linksFieldApiKey);
    
    if (!oldValue) return blockData;

    const newLinks = extractLinksFromValue(oldValue, targetBlockId, mapping, false) as string[];
    const existingLinks = (existingLinksValue || []) as string[];
    const combinedLinks = combineLinks(existingLinks, newLinks);

    return setNestedFieldValueInBlock(blockData, linksFieldApiKey, combinedLinks);
  };

  for await (const record of client.items.listPagedIterator({
    filter: { type: nestedPath.rootModelId },
    nested: true,
    version: 'current',
  })) {
    const rootFieldApiKey = nestedPath.path[0].fieldApiKey;
    const rootFieldValue = record[rootFieldApiKey];

    if (!rootFieldValue) continue;

    let result: { updated: boolean; newValue: unknown };

    if (pathToParentBlock.length === 0) {
      result = traverseAndUpdateNestedBlocksAtLevel(
        rootFieldValue,
        nestedPath.path[0],
        updateBlockFn
      );
    } else {
      result = traverseAndUpdateNestedBlocks(
        rootFieldValue,
        pathToParentBlock,
        0,
        updateBlockFn
      );
    }

    if (result.updated) {
      let updateValue = result.newValue;
      
      if (nestedPath.path[0].localized && typeof result.newValue === 'object' && !Array.isArray(result.newValue)) {
        updateValue = completeLocalizedUpdate(
          result.newValue as Record<string, unknown>,
          rootFieldValue as Record<string, unknown>,
          availableLocales
        );
      }
      
      await client.items.update(record.id, {
        [rootFieldApiKey]: updateValue,
      });
      recordsToPublish?.add(record.id);
    }
  }
}

// =============================================================================
// Structured Text Migration
// =============================================================================

/**
 * Migrates structured text field data by transforming the DAST document.
 * Replaces block/inlineBlock nodes with inlineItem nodes pointing to new records.
 * 
 * @param client - DatoCMS CMA client
 * @param modelId - ID of the model containing the field
 * @param fieldApiKey - API key of the structured text field
 * @param isLocalized - Whether the field is localized
 * @param targetBlockId - ID of the block type being converted
 * @param mapping - Block ID to record ID mapping
 * @param availableLocales - Available locales in the project
 * @param recordsToPublish - Optional set to track records for publishing
 */
export async function migrateStructuredTextFieldData(
  client: CMAClient,
  modelId: string,
  fieldApiKey: string,
  isLocalized: boolean,
  targetBlockId: string,
  mapping: BlockMigrationMapping,
  availableLocales: string[],
  recordsToPublish?: Set<string>
): Promise<void> {
  for await (const record of client.items.listPagedIterator({
    filter: { type: modelId },
    nested: true,
    version: 'current',
  })) {
    const fieldValue = record[fieldApiKey];
    if (!fieldValue) continue;

    let newValue: unknown = null;
    let hasChanges = false;

    if (isLocalized && typeof fieldValue === 'object' && !Array.isArray(fieldValue)) {
      // Localized field
      const localizedValue: Record<string, unknown> = {};
      const sourceLocaleValues = fieldValue as Record<string, unknown>;
      
      for (const locale of availableLocales) {
        const localeValue = sourceLocaleValues[locale];
        
        if (localeValue !== undefined) {
          if (isStructuredTextValue(localeValue)) {
            const transformed = transformDastBlocksToLinks(
              localeValue as StructuredTextValue,
              targetBlockId,
              mapping
            );
            if (transformed) {
              localizedValue[locale] = transformed;
              hasChanges = true;
            } else {
              localizedValue[locale] = localeValue;
            }
          } else {
            localizedValue[locale] = localeValue;
          }
        } else {
          localizedValue[locale] = null;
        }
      }
      
      newValue = localizedValue;
    } else if (isStructuredTextValue(fieldValue)) {
      const transformed = transformDastBlocksToLinks(
        fieldValue as StructuredTextValue,
        targetBlockId,
        mapping
      );
      if (transformed) {
        newValue = transformed;
        hasChanges = true;
      }
    }

    if (hasChanges && newValue) {
      await client.items.update(record.id, {
        [fieldApiKey]: newValue,
      });
      recordsToPublish?.add(record.id);
    }
  }
}

/**
 * Migrates structured text field data for PARTIAL mode.
 * Adds inlineItem nodes alongside existing blocks (keeps blocks in place).
 */
export async function migrateStructuredTextFieldDataPartial(
  client: CMAClient,
  modelId: string,
  fieldApiKey: string,
  isLocalized: boolean,
  targetBlockId: string,
  mapping: BlockMigrationMapping,
  availableLocales: string[],
  recordsToPublish?: Set<string>
): Promise<void> {
  for await (const record of client.items.listPagedIterator({
    filter: { type: modelId },
    nested: true,
    version: 'current',
  })) {
    const fieldValue = record[fieldApiKey];
    if (!fieldValue) continue;

    let newValue: unknown = null;
    let hasChanges = false;

    if (isLocalized && typeof fieldValue === 'object' && !Array.isArray(fieldValue)) {
      const localizedValue: Record<string, unknown> = {};
      const sourceLocaleValues = fieldValue as Record<string, unknown>;
      
      for (const locale of availableLocales) {
        const localeValue = sourceLocaleValues[locale];
        
        if (localeValue !== undefined) {
          if (isStructuredTextValue(localeValue)) {
            const transformed = addInlineItemsAlongsideBlocks(
              localeValue as StructuredTextValue,
              targetBlockId,
              mapping
            );
            if (transformed) {
              localizedValue[locale] = transformed;
              hasChanges = true;
            } else {
              localizedValue[locale] = localeValue;
            }
          } else {
            localizedValue[locale] = localeValue;
          }
        } else {
          localizedValue[locale] = null;
        }
      }
      
      newValue = localizedValue;
    } else if (isStructuredTextValue(fieldValue)) {
      const transformed = addInlineItemsAlongsideBlocks(
        fieldValue as StructuredTextValue,
        targetBlockId,
        mapping
      );
      if (transformed) {
        newValue = transformed;
        hasChanges = true;
      }
    }

    if (hasChanges && newValue) {
      await client.items.update(record.id, {
        [fieldApiKey]: newValue,
      });
      recordsToPublish?.add(record.id);
    }
  }
}

/**
 * Migrates nested structured text field data for PARTIAL mode.
 */
export async function migrateNestedStructuredTextFieldDataPartial(
  client: CMAClient,
  nestedPath: NestedBlockPath,
  fieldApiKey: string,
  targetBlockId: string,
  mapping: BlockMigrationMapping,
  recordsToPublish?: Set<string>
): Promise<void> {
  for await (const record of client.items.listPagedIterator({
    filter: { type: nestedPath.rootModelId },
    nested: true,
    version: 'current',
  })) {
    const rootFieldApiKey = nestedPath.path[0].fieldApiKey;
    const rootFieldValue = record[rootFieldApiKey];

    if (!rootFieldValue) continue;

    const updateBlockFn = (blockData: Record<string, unknown>): Record<string, unknown> => {
      const stValue = getNestedFieldValueFromBlock(blockData, fieldApiKey);
      
      if (!stValue || !isStructuredTextValue(stValue)) {
        return blockData;
      }

      const transformed = addInlineItemsAlongsideBlocks(
        stValue as StructuredTextValue,
        targetBlockId,
        mapping
      );
      if (transformed) {
        return setNestedFieldValueInBlock(blockData, fieldApiKey, transformed);
      }

      return blockData;
    };

    const pathToParentBlock = nestedPath.path.slice(0, -1);
    
    let result: { updated: boolean; newValue: unknown };

    if (pathToParentBlock.length === 0) {
      result = traverseAndUpdateNestedBlocksAtLevel(
        rootFieldValue,
        nestedPath.path[0],
        updateBlockFn
      );
    } else {
      result = traverseAndUpdateNestedBlocks(
        rootFieldValue,
        pathToParentBlock,
        0,
        updateBlockFn
      );
    }

    if (result.updated) {
      await client.items.update(record.id, {
        [rootFieldApiKey]: result.newValue,
      });
      recordsToPublish?.add(record.id);
    }
  }
}

/**
 * Migrates nested structured text field data (full replacement mode).
 */
export async function migrateNestedStructuredTextFieldData(
  client: CMAClient,
  nestedPath: NestedBlockPath,
  fieldApiKey: string,
  targetBlockId: string,
  mapping: BlockMigrationMapping,
  recordsToPublish?: Set<string>
): Promise<void> {
  for await (const record of client.items.listPagedIterator({
    filter: { type: nestedPath.rootModelId },
    nested: true,
    version: 'current',
  })) {
    const rootFieldApiKey = nestedPath.path[0].fieldApiKey;
    const rootFieldValue = record[rootFieldApiKey];

    if (!rootFieldValue) continue;

    const updateBlockFn = (blockData: Record<string, unknown>): Record<string, unknown> => {
      const stValue = getNestedFieldValueFromBlock(blockData, fieldApiKey);
      
      if (!stValue || !isStructuredTextValue(stValue)) {
        return blockData;
      }

      const transformed = transformDastBlocksToLinks(
        stValue as StructuredTextValue,
        targetBlockId,
        mapping
      );
      if (transformed) {
        return setNestedFieldValueInBlock(blockData, fieldApiKey, transformed);
      }

      return blockData;
    };

    const pathToParentBlock = nestedPath.path.slice(0, -1);
    
    let result: { updated: boolean; newValue: unknown };

    if (pathToParentBlock.length === 0) {
      result = traverseAndUpdateNestedBlocksAtLevel(
        rootFieldValue,
        nestedPath.path[0],
        updateBlockFn
      );
    } else {
      result = traverseAndUpdateNestedBlocks(
        rootFieldValue,
        pathToParentBlock,
        0,
        updateBlockFn
      );
    }

    if (result.updated) {
      await client.items.update(record.id, {
        [rootFieldApiKey]: result.newValue,
      });
      recordsToPublish?.add(record.id);
    }
  }
}

// =============================================================================
// Helper Functions
// =============================================================================

/**
 * Gets all block instances of a specific type from records following a nested path.
 */
async function getAllBlockInstancesNested(
  client: CMAClient,
  nestedPath: NestedBlockPath,
  targetBlockId: string
): Promise<
  Array<{
    rootRecordId: string;
    locale: string | null;
    blockData: Record<string, unknown>;
    blockId: string;
    pathIndices: number[];
  }>
> {
  const instances: Array<{
    rootRecordId: string;
    locale: string | null;
    blockData: Record<string, unknown>;
    blockId: string;
    pathIndices: number[];
  }> = [];

  for await (const record of client.items.listPagedIterator({
    filter: { type: nestedPath.rootModelId },
    nested: true,
    version: 'current',
  })) {
    const blocks = findBlocksAtPath(record, nestedPath.path, targetBlockId);

    for (const { block, pathIndices, locale } of blocks) {
      const attributes = block.attributes as Record<string, unknown> | undefined;
      const blockData = attributes || {};
      const id = getBlockId(block);

      instances.push({
        rootRecordId: record.id,
        locale,
        blockData,
        blockId: id || `${record.id}_${pathIndices.join('_')}`,
        pathIndices,
      });
    }
  }

  return instances;
}

/**
 * Extracts link IDs from a field value based on the target block type.
 */
export function extractLinksFromValue(
  value: unknown,
  targetBlockId: string,
  mapping: BlockMigrationMapping,
  isSingleValue: boolean
): unknown {
  if (!value) {
    return isSingleValue ? null : [];
  }

  // Handle structured text fields
  if (isStructuredTextValue(value)) {
    const linkIds = extractLinksFromStructuredText(
      value as StructuredTextValue,
      targetBlockId,
      mapping
    );
    return isSingleValue ? (linkIds[0] || null) : linkIds;
  }

  // Handle single block
  if (isSingleValue && typeof value === 'object' && !Array.isArray(value)) {
    const blockObj = value as Record<string, unknown>;
    const blockTypeId = getBlockTypeId(blockObj);
    const blockId = getBlockId(blockObj);
    
    if (blockTypeId === targetBlockId && blockId && mapping[blockId]) {
      return mapping[blockId];
    }
    return null;
  }

  // Handle array of blocks
  if (!Array.isArray(value)) {
    return isSingleValue ? null : [];
  }

  const linkIds: string[] = [];
  for (const block of value) {
    if (!block || typeof block !== 'object') continue;

    const blockObj = block as Record<string, unknown>;
    const blockTypeId = getBlockTypeId(blockObj);
    const blockId = getBlockId(blockObj);

    if (blockTypeId === targetBlockId && blockId && mapping[blockId]) {
      linkIds.push(mapping[blockId]);
    }
  }

  return isSingleValue ? (linkIds[0] || null) : linkIds;
}

/**
 * Normalizes a links array value to an array of string IDs.
 */
function normalizeLinksArray(value: unknown): string[] {
  if (!value) return [];
  if (!Array.isArray(value)) return [];
  
  const result: string[] = [];
  for (const link of value) {
    if (typeof link === 'string') {
      result.push(link);
    } else if (link && typeof link === 'object' && 'id' in link) {
      result.push((link as { id: string }).id);
    }
  }
  return result;
}

/**
 * Combines existing and new links, avoiding duplicates.
 */
function combineLinks(existing: string[], newLinks: string[]): string[] {
  const combined = [...existing];
  for (const link of newLinks) {
    if (!combined.includes(link)) {
      combined.push(link);
    }
  }
  return combined;
}


