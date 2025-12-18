/**
 * Block Analysis Utilities
 * 
 * Functions for analyzing DatoCMS block models, finding their usage
 * across the schema, and extracting block instances from records.
 * 
 * @module utils/analyzer
 */

import type {
  CMAClient,
  BlockAnalysis,
  FieldInfo,
  ModularContentFieldInfo,
  NestedBlockPath,
  GroupedBlockInstance,
} from '../types';
import {
  getBlockTypeId,
  getBlockId,
  getBlockAttributes,
  extractBlocksFromFieldValue,
} from './blocks';

// =============================================================================
// Types
// =============================================================================

/** Cached item type information */
type ItemTypeInfo = {
  id: string;
  name: string;
  api_key: string;
  modular_block: boolean;
};

type FieldCacheEntry = {
  id: string;
  label: string;
  api_key: string;
  field_type: string;
  localized: boolean;
  validators: Record<string, unknown>;
  position: number;
  hint: string | null;
};

// =============================================================================
// Caching
// =============================================================================

/** Cache for item types by ID */
const itemTypesCache: Map<string, ItemTypeInfo> = new Map();

/**
 * Clears all caches.
 * Call this before starting a new analysis to ensure fresh data.
 */
export function clearCaches(): void {
  itemTypesCache.clear();
}

/**
 * Gets item type info with caching.
 * 
 * @param client - DatoCMS CMA client
 * @param itemTypeId - ID of the item type to fetch
 * @returns Item type information
 */
async function getItemTypeInfo(client: CMAClient, itemTypeId: string): Promise<ItemTypeInfo> {
  const cached = itemTypesCache.get(itemTypeId);
  if (cached) {
    return cached;
  }
  
  const itemType = await client.itemTypes.find(itemTypeId);
  const info: ItemTypeInfo = {
    id: itemType.id,
    name: itemType.name,
    api_key: itemType.api_key,
    modular_block: itemType.modular_block,
  };
  itemTypesCache.set(itemTypeId, info);
  return info;
}

/** Extended field info with parent item type ID */
type ReferencingFieldInfo = FieldCacheEntry & {
  item_type_id: string;
};

/**
 * Gets all fields that reference a specific block using the fields.referencing() API.
 * This is more efficient than fetching all models and their fields.
 * 
 * @param client - DatoCMS CMA client
 * @param blockId - ID of the block to find referencing fields for
 * @returns Array of fields that reference this block with their parent item type ID
 */
async function getReferencingFields(
  client: CMAClient,
  blockId: string
): Promise<ReferencingFieldInfo[]> {
  const fields = await client.fields.referencing(blockId);
  return fields.map(f => ({
    id: f.id,
    label: f.label,
    api_key: f.api_key,
    field_type: f.field_type,
    localized: f.localized,
    validators: f.validators as Record<string, unknown>,
    position: f.position,
    hint: f.hint,
    item_type_id: f.item_type.id,
  }));
}

// =============================================================================
// Block Analysis
// =============================================================================

/**
 * Analyzes a block model to understand its structure and usage.
 * 
 * This function:
 * 1. Fetches the block's field definitions
 * 2. Finds all modular content fields that use this block
 * 3. Builds nested paths from root models to this block
 * 4. Counts affected records
 * 
 * @param client - DatoCMS CMA client
 * @param blockId - ID of the block model to analyze
 * @param onProgress - Optional callback for progress updates
 * @returns Analysis results including block info, fields, and usage data
 */
export async function analyzeBlock(
  client: CMAClient,
  blockId: string,
  onProgress?: (message: string, percentage: number) => void
): Promise<BlockAnalysis> {
  clearCaches(); // Start fresh for each analysis

  onProgress?.('Fetching block details...', 5);
  // Get the block model
  const block = await client.itemTypes.find(blockId);

  if (!block.modular_block) {
    throw new Error(`Item type ${block.api_key} is not a block model`);
  }

  // Get all fields of the block
  const blockFields = await client.fields.list(blockId);
  const fields: FieldInfo[] = blockFields.map((field) => ({
    id: field.id,
    label: field.label,
    apiKey: field.api_key,
    fieldType: field.field_type,
    localized: field.localized,
    validators: field.validators as Record<string, unknown>,
    appearance: field.appearance as FieldInfo['appearance'],
    position: field.position,
    hint: field.hint || undefined,
    defaultValue: field.default_value,
  }));

  onProgress?.('Scanning content models for block usage...', 15);
  // Find all modular content fields that reference this block (including nested in other blocks)
  const modularContentFields = await findModularContentFieldsUsingBlock(
    client,
    blockId
  );

  onProgress?.(`Found ${modularContentFields.length} fields using this block. Analyzing nested paths...`, 25);
  // Build nested paths to root models for each field
  const nestedPaths = await buildNestedPathsToRootModels(client, modularContentFields, blockId);

  // Group paths by root model for efficient counting (one scan per root model)
  const pathsByRootModel = groupPathsByRootModelId(nestedPaths);

  // Count affected records - scan each root model once and check all paths
  let totalAffectedRecords = 0;
  let groupIndex = 0;
  const groupCount = pathsByRootModel.size;

  for (const [rootModelId, paths] of pathsByRootModel) {
    const rootModelName = paths[0].rootModelName;
    // Calculate percentage from 30% to 100% based on loop progress
    const loopPercentage = Math.round(30 + ((groupIndex / groupCount) * 70));
    onProgress?.(`Counting records in model "${rootModelName}" (${groupIndex + 1}/${groupCount})...`, loopPercentage);
    
    const count = await countRecordsWithBlockAcrossPaths(client, rootModelId, paths, blockId);
    totalAffectedRecords += count;
    groupIndex++;
  }
  
  onProgress?.('Analysis complete!', 100);

  return {
    block: {
      id: block.id,
      name: block.name,
      apiKey: block.api_key,
    },
    fields,
    modularContentFields,
    totalAffectedRecords,
  };
}

/**
 * Finds all modular content fields (rich_text, structured_text, or single_block) that use the specified block.
 * This includes fields in other blocks (for nested block scenarios).
 * 
 * Uses the fields.referencing() API to efficiently get only fields that
 * reference this block, rather than fetching all fields from all models.
 */
async function findModularContentFieldsUsingBlock(
  client: CMAClient,
  blockId: string
): Promise<ModularContentFieldInfo[]> {
  // Use fields.referencing() to get only fields that reference this block
  const referencingFields = await getReferencingFields(client, blockId);
  
  // Filter for modular content field types and collect unique item type IDs
  const relevantFieldTypes = ['rich_text', 'structured_text', 'single_block'];
  const relevantFields = referencingFields.filter(f => relevantFieldTypes.includes(f.field_type));
  
  // Batch fetch item type info for all unique parent models
  const uniqueItemTypeIds = [...new Set(relevantFields.map(f => f.item_type_id))];
  const itemTypesMap = new Map<string, ItemTypeInfo>();
  
  await Promise.all(
    uniqueItemTypeIds.map(async (id) => {
      const info = await getItemTypeInfo(client, id);
      itemTypesMap.set(id, info);
    })
  );
  
  // Build the result array
  const result: ModularContentFieldInfo[] = [];
  
  for (const field of relevantFields) {
    const itemType = itemTypesMap.get(field.item_type_id);
    if (!itemType) continue; // Skip if item type not found (shouldn't happen)
    
    // Validate that the block ID is actually in the validators
    // (fields.referencing may return stale references)
    let allowedBlockIds: string[] | undefined;
    let fieldType: 'rich_text' | 'structured_text' | 'single_block' | undefined;
    
    if (field.field_type === 'rich_text') {
      const richTextBlocks = field.validators.rich_text_blocks as
        | { item_types: string[] }
        | undefined;
      if (richTextBlocks?.item_types?.includes(blockId)) {
        allowedBlockIds = richTextBlocks.item_types;
        fieldType = 'rich_text';
      }
    } else if (field.field_type === 'structured_text') {
      const structuredTextBlocks = field.validators.structured_text_blocks as
        | { item_types: string[] }
        | undefined;
      if (structuredTextBlocks?.item_types?.includes(blockId)) {
        allowedBlockIds = structuredTextBlocks.item_types;
        fieldType = 'structured_text';
      }
    } else if (field.field_type === 'single_block') {
      const singleBlockBlocks = field.validators.single_block_blocks as
        | { item_types: string[] }
        | undefined;
      if (singleBlockBlocks?.item_types?.includes(blockId)) {
        allowedBlockIds = singleBlockBlocks.item_types;
        fieldType = 'single_block';
      }
    }
    
    if (allowedBlockIds && fieldType) {
      result.push({
        id: field.id,
        label: field.label,
        apiKey: field.api_key,
        parentModelId: itemType.id,
        parentModelName: itemType.name,
        parentModelApiKey: itemType.api_key,
        parentIsBlock: itemType.modular_block,
        localized: field.localized,
        allowedBlockIds,
        position: field.position,
        hint: field.hint || undefined,
        fieldType,
      });
    }
  }

  return result;
}

// =============================================================================
// Nested Path Building
// =============================================================================

/**
 * Recursively finds all paths from root models (non-blocks) to modular content fields.
 * Handles arbitrarily deep nesting of blocks within blocks.
 * 
 * For example, if a target block is used inside another block which is used in a page,
 * this function will build the full path: Page → Parent Block Field → Target Block Field
 * 
 * @param client - DatoCMS CMA client
 * @param modularContentFields - Fields that use the target block
 * @param targetBlockId - ID of the block being analyzed
 * @returns Array of paths from root models to the target block's fields
 */
export async function buildNestedPathsToRootModels(
  client: CMAClient,
  modularContentFields: ModularContentFieldInfo[],
  targetBlockId: string
): Promise<NestedBlockPath[]> {
  const result: NestedBlockPath[] = [];

  for (const mcField of modularContentFields) {
    if (!mcField.parentIsBlock) {
      // Parent is a regular model - simple path
      const path = [{
        fieldApiKey: mcField.apiKey,
        expectedBlockTypeId: targetBlockId,
        localized: mcField.localized,
        fieldType: mcField.fieldType,
      }];
      result.push({
        rootModelId: mcField.parentModelId,
        rootModelName: mcField.parentModelName,
        rootModelApiKey: mcField.parentModelApiKey,
        path,
        fieldInfo: mcField,
        isInLocalizedContext: path.some(step => step.localized),
      });
    } else {
      // Parent is a block - need to recursively find paths to root models
      // Use the referencing API to find models that reference this parent block
      const pathsToParent = await findPathsToBlock(client, mcField.parentModelId, new Set());
      
      for (const pathToParent of pathsToParent) {
        // Append the current field to the path
        const fullPath = [
          ...pathToParent.path,
          {
            fieldApiKey: mcField.apiKey,
            expectedBlockTypeId: targetBlockId,
            localized: mcField.localized,
            fieldType: mcField.fieldType,
          },
        ];
        result.push({
          rootModelId: pathToParent.rootModelId,
          rootModelName: pathToParent.rootModelName,
          rootModelApiKey: pathToParent.rootModelApiKey,
          path: fullPath,
          fieldInfo: mcField,
          isInLocalizedContext: fullPath.some(step => step.localized),
        });
      }
    }
  }

  return result;
}

/**
 * Groups nested paths by their root model ID.
 * This enables efficient record scanning by processing all paths
 * for a given root model in a single pass.
 * 
 * @param nestedPaths - Array of nested paths to group
 * @returns Map of root model ID to array of paths for that model
 */
function groupPathsByRootModelId(
  nestedPaths: NestedBlockPath[]
): Map<string, NestedBlockPath[]> {
  const grouped = new Map<string, NestedBlockPath[]>();
  for (const path of nestedPaths) {
    const existing = grouped.get(path.rootModelId) || [];
    existing.push(path);
    grouped.set(path.rootModelId, existing);
  }
  return grouped;
}

/**
 * Recursively finds all paths from root models to a specific block type.
 * Returns paths that lead to the block, not including the fields within the block.
 * 
 * Uses the fields.referencing() API to efficiently find only fields that
 * reference this block at each recursion level.
 */
async function findPathsToBlock(
  client: CMAClient,
  blockId: string,
  visitedBlocks: Set<string> // Prevent infinite loops with circular references
): Promise<Array<{
  rootModelId: string;
  rootModelName: string;
  rootModelApiKey: string;
  path: NestedBlockPath['path'];
}>> {
  // Prevent infinite loops
  if (visitedBlocks.has(blockId)) {
    return [];
  }
  visitedBlocks.add(blockId);

  const result: Array<{
    rootModelId: string;
    rootModelName: string;
    rootModelApiKey: string;
    path: NestedBlockPath['path'];
  }> = [];

  // Use fields.referencing() to get only fields that reference this block
  const referencingFields = await getReferencingFields(client, blockId);
  
  // Filter for modular content field types
  const relevantFieldTypes = ['rich_text', 'structured_text', 'single_block'];
  const relevantFields = referencingFields.filter(f => relevantFieldTypes.includes(f.field_type));
  
  // Batch fetch item type info for all unique parent models
  const uniqueItemTypeIds = [...new Set(relevantFields.map(f => f.item_type_id))];
  const itemTypesMap = new Map<string, ItemTypeInfo>();
  
  await Promise.all(
    uniqueItemTypeIds.map(async (id) => {
      const info = await getItemTypeInfo(client, id);
      itemTypesMap.set(id, info);
    })
  );

  // Process each field
  for (const field of relevantFields) {
    const itemType = itemTypesMap.get(field.item_type_id);
    if (!itemType) continue; // Skip if item type not found (shouldn't happen)
    
    // Validate and determine field type
    let containsBlock = false;
    let fieldType: 'rich_text' | 'structured_text' | 'single_block' = 'rich_text';
    
    if (field.field_type === 'rich_text') {
      const richTextBlocks = field.validators.rich_text_blocks as
        | { item_types: string[] }
        | undefined;
      containsBlock = richTextBlocks?.item_types?.includes(blockId) ?? false;
      fieldType = 'rich_text';
    } else if (field.field_type === 'structured_text') {
      const structuredTextBlocks = field.validators.structured_text_blocks as
        | { item_types: string[] }
        | undefined;
      containsBlock = structuredTextBlocks?.item_types?.includes(blockId) ?? false;
      fieldType = 'structured_text';
    } else if (field.field_type === 'single_block') {
      const singleBlockBlocks = field.validators.single_block_blocks as
        | { item_types: string[] }
        | undefined;
      containsBlock = singleBlockBlocks?.item_types?.includes(blockId) ?? false;
      fieldType = 'single_block';
    }

    if (containsBlock) {
      if (!itemType.modular_block) {
        // Found a root model - this is a complete path
        result.push({
          rootModelId: itemType.id,
          rootModelName: itemType.name,
          rootModelApiKey: itemType.api_key,
          path: [{
            fieldApiKey: field.api_key,
            expectedBlockTypeId: blockId,
            localized: field.localized,
            fieldType,
          }],
        });
      } else {
        // Parent is also a block - recurse upward
        const pathsToParent = await findPathsToBlock(client, itemType.id, visitedBlocks);
        
        for (const pathToParent of pathsToParent) {
          result.push({
            rootModelId: pathToParent.rootModelId,
            rootModelName: pathToParent.rootModelName,
            rootModelApiKey: pathToParent.rootModelApiKey,
            path: [
              ...pathToParent.path,
              {
                fieldApiKey: field.api_key,
                expectedBlockTypeId: blockId,
                localized: field.localized,
                fieldType,
              },
            ],
          });
        }
      }
    }
  }

  return result;
}

// =============================================================================
// Record Counting
// =============================================================================

/**
 * Counts records that contain the target block across multiple paths in a single scan.
 * This is more efficient than scanning once per path, and correctly counts unique
 * records (a record with the block in multiple fields counts as 1, not N).
 * 
 * @param client - DatoCMS CMA client
 * @param rootModelId - ID of the root model to scan
 * @param paths - All nested paths for this root model
 * @param targetBlockId - ID of the block type to find
 * @returns Count of unique records containing the block
 */
async function countRecordsWithBlockAcrossPaths(
  client: CMAClient,
  rootModelId: string,
  paths: NestedBlockPath[],
  targetBlockId: string
): Promise<number> {
  let count = 0;

  for await (const record of client.items.listPagedIterator({
    filter: { type: rootModelId },
    nested: true,
    version: 'current', // Fetch draft version to get latest changes
  })) {
    // Check if record contains block in ANY of the paths
    for (const path of paths) {
      if (recordContainsBlockAtPath(record, path.path, targetBlockId)) {
        count++;
        break; // Found in at least one path, count once and move to next record
      }
    }
  }

  return count;
}

/**
 * Checks if a record contains the target block following the given path.
 */
function recordContainsBlockAtPath(
  record: Record<string, unknown>,
  path: NestedBlockPath['path'],
  targetBlockId: string
): boolean {
  return findBlocksAtPath(record, path, targetBlockId).length > 0;
}

// extractBlocksFromFieldValue is now imported from ./blocks.ts

// =============================================================================
// Block Finding
// =============================================================================

/**
 * Finds all target block instances in a record following the given path.
 * Returns array of { block, pathIndices } where pathIndices tracks the position at each level.
 */
export function findBlocksAtPath(
  record: Record<string, unknown>,
  path: NestedBlockPath['path'],
  targetBlockId: string
): Array<{
  block: Record<string, unknown>;
  pathIndices: number[]; // Index at each path level
  locale: string | null;
}> {
  const results: Array<{
    block: Record<string, unknown>;
    pathIndices: number[];
    locale: string | null;
  }> = [];

  function traverse(
    currentData: Record<string, unknown>,
    pathIndex: number,
    currentIndices: number[],
    locale: string | null
  ): void {
    if (pathIndex >= path.length) {
      return;
    }

    const step = path[pathIndex];
    const fieldValue = currentData[step.fieldApiKey];

    if (!fieldValue) return;

    const processBlocks = (blocks: unknown[], loc: string | null) => {
      if (!Array.isArray(blocks)) return;

      blocks.forEach((block, index) => {
        if (!block || typeof block !== 'object') return;
        const blockObj = block as Record<string, unknown>;
        const blockTypeId = getBlockTypeId(blockObj);

        if (pathIndex === path.length - 1) {
          // This is the final step - look for target blocks
          if (blockTypeId === targetBlockId) {
            results.push({
              block: blockObj,
              pathIndices: [...currentIndices, index],
              locale: loc,
            });
          }
        } else {
          // Intermediate step - check if this block matches expected type and recurse
          if (blockTypeId === step.expectedBlockTypeId) {
            // Get the block's attributes which contain its fields
            const blockData = getBlockAttributes(blockObj);
            traverse(
              { ...blockData, ...blockObj }, // Merge attributes with block for nested field access
              pathIndex + 1,
              [...currentIndices, index],
              loc
            );
          }
        }
      });
    };

    if (step.localized && typeof fieldValue === 'object' && !Array.isArray(fieldValue)) {
      // Localized field - iterate over locales
      for (const loc of Object.keys(fieldValue as Record<string, unknown>)) {
        const localeValue = (fieldValue as Record<string, unknown>)[loc];
        const blocks = extractBlocksFromFieldValue(localeValue, step.fieldType);
        processBlocks(blocks, loc);
      }
    } else {
      // Non-localized field
      const blocks = extractBlocksFromFieldValue(fieldValue, step.fieldType);
      processBlocks(blocks, locale);
    }
  }

  traverse(record, 0, [], null);
  return results;
}

// =============================================================================
// Block Instance Extraction
// =============================================================================

/**
 * Gets block instances grouped by position across locales.
 * This is used for localized contexts where blocks at the same position
 * in different locales should be merged into a single record.
 */
export async function getGroupedBlockInstances(
  client: CMAClient,
  nestedPath: NestedBlockPath,
  targetBlockId: string
): Promise<GroupedBlockInstance[]> {
  // Map to collect blocks by group key (rootRecordId + pathIndices)
  const groupMap = new Map<string, {
    rootRecordId: string;
    pathIndices: number[];
    localeData: Record<string, Record<string, unknown>>;
    allBlockIds: string[];
  }>();

  for await (const record of client.items.listPagedIterator({
    filter: { type: nestedPath.rootModelId },
    nested: true,
    version: 'current', // Fetch draft version to get latest changes
  })) {
    const blocks = findBlocksAtPath(record, nestedPath.path, targetBlockId);

    for (const { block, pathIndices, locale } of blocks) {
      const blockData = getBlockAttributes(block);
      const blockId = getBlockId(block);
      
      // Create group key from record ID and position indices
      const groupKey = `${record.id}_${pathIndices.join('_')}`;
      
      // Get or create the group entry
      let group = groupMap.get(groupKey);
      if (!group) {
        group = {
          rootRecordId: record.id,
          pathIndices,
          localeData: {},
          allBlockIds: [],
        };
        groupMap.set(groupKey, group);
      }
      
      // Store the block data for this locale
      // Use '__default__' for non-localized contexts
      const localeKey = locale || '__default__';
      group.localeData[localeKey] = blockData;
      
      // Track all block IDs for mapping
      if (blockId) {
        group.allBlockIds.push(blockId);
      } else {
        // Generate synthetic ID if none exists
        group.allBlockIds.push(`${record.id}_${pathIndices.join('_')}_${localeKey}`);
      }
    }
  }

  // Convert map to array of GroupedBlockInstance
  const result: GroupedBlockInstance[] = [];
  for (const [groupKey, group] of groupMap) {
    result.push({
      groupKey,
      rootRecordId: group.rootRecordId,
      pathIndices: group.pathIndices,
      localeData: group.localeData,
      allBlockIds: group.allBlockIds,
      referenceBlockId: group.allBlockIds[0] || groupKey,
    });
  }

  return result;
}
