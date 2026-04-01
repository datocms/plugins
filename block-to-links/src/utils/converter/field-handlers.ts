/**
 * Field Conversion Handlers
 *
 * Functions for converting modular content and structured text fields
 * to links fields during block-to-model conversion.
 *
 * @module utils/converter/field-handlers
 */

import type {
  BlockMigrationMapping,
  CMAClient,
  ModularContentFieldInfo,
  NestedBlockPath,
} from '../../types';
import {
  migrateFieldData,
  migrateFieldDataAppend,
  migrateNestedBlockFieldData,
  migrateNestedBlockFieldDataAppend,
  migrateNestedStructuredTextFieldData,
  migrateNestedStructuredTextFieldDataPartial,
  migrateStructuredTextFieldData,
  migrateStructuredTextFieldDataPartial,
} from './migrate';
import { traverseAndRemoveBlocks } from './traverse';

// =============================================================================
// Types
// =============================================================================

/** Context for field conversion operations */
export interface FieldConversionContext {
  /** DatoCMS CMA client */
  client: CMAClient;
  /** The modular content field being converted */
  mcField: ModularContentFieldInfo;
  /** ID of the new model created from the block */
  newModelId: string;
  /** ID of the block being converted */
  blockIdToRemove: string;
  /** Block ID to record ID mapping */
  mapping: BlockMigrationMapping;
  /** All nested paths for this conversion */
  nestedPaths: NestedBlockPath[];
  /** Available locales in the project */
  availableLocales: string[];
  /** Whether to fully replace (delete) the original block */
  fullyReplace: boolean;
  /** Set to track records for publishing */
  recordsToPublish?: Set<string>;
}

// =============================================================================
// Main Field Conversion
// =============================================================================

/**
 * Converts a modular content field to a links field, including data migration.
 * Handles both top-level fields and nested fields inside blocks.
 *
 * For structured_text fields, transforms the DAST in-place and updates validators
 * rather than creating a separate links field.
 *
 * @param ctx - Field conversion context
 */
export async function convertModularContentToLinksField(
  ctx: FieldConversionContext,
): Promise<void> {
  const { client, mcField, blockIdToRemove } = ctx;

  const currentField = await client.fields.find(mcField.id);
  const originalLabel = currentField.label;
  const originalApiKey = mcField.apiKey;
  const originalPosition = currentField.position;
  const originalHint = currentField.hint || undefined;
  const originalFieldset = currentField.fieldset;

  const remainingBlockIds = mcField.allowedBlockIds.filter(
    (id) => id !== blockIdToRemove,
  );
  const isSingleBlock = mcField.fieldType === 'single_block';

  // Handle structured text fields differently
  if (mcField.fieldType === 'structured_text') {
    await handleStructuredTextFieldConversion(
      ctx,
      currentField,
      remainingBlockIds,
    );
    return;
  }

  // Clean up any existing TEMP fields (only if we're doing full replacement)
  if (ctx.fullyReplace) {
    await cleanupTempFields(client, mcField.parentModelId, originalApiKey);
  }

  // Determine conversion mode based on fullyReplace flag and remaining blocks
  if (!ctx.fullyReplace) {
    // Non-destructive mode: Create links field alongside, keep original intact
    await handleNonDestructiveConversion(
      ctx,
      originalLabel,
      originalApiKey,
      originalPosition,
      originalFieldset,
      isSingleBlock,
    );
  } else if (remainingBlockIds.length > 0 && !isSingleBlock) {
    // Partial replacement: Other block types remain, update validators
    await handlePartialModularContentConversion(
      ctx,
      currentField,
      originalLabel,
      originalApiKey,
      originalPosition,
      originalFieldset,
      remainingBlockIds,
    );
  } else {
    // Full replacement: Delete original and replace with links field
    await handleFullModularContentReplacement(
      ctx,
      currentField,
      originalLabel,
      originalApiKey,
      originalPosition,
      originalHint,
      originalFieldset,
      isSingleBlock,
    );
  }
}

// =============================================================================
// Structured Text Field Handling
// =============================================================================

/**
 * Handles conversion of structured text fields.
 *
 * Unlike modular content fields, structured text fields:
 * 1. Keep the same field type (structured_text)
 * 2. Transform the DAST document in-place
 * 3. Update validators to add/remove block and link types
 */
/**
 * Migrates structured text data for either partial or full replacement mode.
 */
async function migrateStructuredTextData(
  ctx: FieldConversionContext,
  isPartialMode: boolean,
): Promise<void> {
  const {
    client,
    mcField,
    blockIdToRemove,
    mapping,
    nestedPaths,
    availableLocales,
    recordsToPublish,
  } = ctx;

  if (mcField.parentIsBlock) {
    const nestedPath = findNestedPathForField(nestedPaths, mcField);
    if (!nestedPath) return;

    if (isPartialMode) {
      await migrateNestedStructuredTextFieldDataPartial(
        client,
        nestedPath,
        mcField.apiKey,
        blockIdToRemove,
        mapping,
        recordsToPublish,
      );
    } else {
      await migrateNestedStructuredTextFieldData(
        client,
        nestedPath,
        mcField.apiKey,
        blockIdToRemove,
        mapping,
        recordsToPublish,
      );
    }
  } else if (isPartialMode) {
    await migrateStructuredTextFieldDataPartial(
      client,
      mcField.parentModelId,
      mcField.apiKey,
      mcField.localized,
      blockIdToRemove,
      mapping,
      availableLocales,
      recordsToPublish,
    );
  } else {
    await migrateStructuredTextFieldData(
      client,
      mcField.parentModelId,
      mcField.apiKey,
      mcField.localized,
      blockIdToRemove,
      mapping,
      availableLocales,
      recordsToPublish,
    );
  }
}

async function handleStructuredTextFieldConversion(
  ctx: FieldConversionContext,
  currentField: {
    id: string;
    validators: Record<string, unknown>;
    [key: string]: unknown;
  },
  remainingBlockIds: string[],
): Promise<void> {
  const { client, mcField, newModelId, fullyReplace } = ctx;

  const validators = currentField.validators as Record<string, unknown>;
  const currentBlocksValidator = validators.structured_text_blocks as
    | { item_types?: string[] }
    | undefined;
  const currentLinksValidator = validators.structured_text_links as
    | { item_types?: string[] }
    | undefined;

  // PHASE 1: Add the new model to allowed links (keep block type for now)
  const phase1Validators: Record<string, unknown> = { ...validators };
  const existingLinkTypes = currentLinksValidator?.item_types ?? [];
  if (!existingLinkTypes.includes(newModelId)) {
    phase1Validators.structured_text_links = {
      ...currentLinksValidator,
      item_types: [...existingLinkTypes, newModelId],
    };
  }
  if (currentBlocksValidator) {
    phase1Validators.structured_text_blocks = currentBlocksValidator;
  }

  await client.fields.update(mcField.id, { validators: phase1Validators });

  // PHASE 2: Migrate DAST data
  await migrateStructuredTextData(ctx, !fullyReplace);

  if (!fullyReplace) return;

  // PHASE 3: Remove block type from validators
  const updatedBlockItemTypes =
    remainingBlockIds.length > 0 ? remainingBlockIds : [];
  await client.fields.update(mcField.id, {
    validators: {
      ...phase1Validators,
      structured_text_blocks: {
        ...currentBlocksValidator,
        item_types: updatedBlockItemTypes,
      },
    },
  });
}

// =============================================================================
// Modular Content Field Handling
// =============================================================================

/**
 * Handles non-destructive conversion when fullyReplace is false.
 * Creates a new links field alongside the original modular content field
 * WITHOUT modifying or deleting the original field.
 */
/**
 * Creates a links field (single link or multi-links) alongside the original field.
 */
async function createLinksFieldAlongsideOriginal(
  ctx: FieldConversionContext,
  originalLabel: string,
  originalApiKey: string,
  originalPosition: number,
  originalFieldset: { id: string; type: 'fieldset' } | null,
  isSingleBlock: boolean,
): Promise<{ api_key: string }> {
  const { client, mcField, newModelId } = ctx;
  const expectedLinksApiKey = `${originalApiKey}_links`;

  const sharedBase = {
    label: `${originalLabel} (Links)`,
    api_key: expectedLinksApiKey,
    localized: mcField.localized,
    appearance: { parameters: {}, addons: [] } as Record<string, unknown>,
    position: originalPosition + 1,
    fieldset: originalFieldset ?? undefined,
  };

  if (isSingleBlock) {
    return client.fields.create(mcField.parentModelId, {
      ...sharedBase,
      field_type: 'link' as const,
      validators: { item_item_type: { item_types: [newModelId] } },
      appearance: { editor: 'link_embed' as const, parameters: {}, addons: [] },
    });
  }

  return client.fields.create(mcField.parentModelId, {
    ...sharedBase,
    field_type: 'links' as const,
    validators: { items_item_type: { item_types: [newModelId] } },
    appearance: { editor: 'links_embed' as const, parameters: {}, addons: [] },
  });
}

/**
 * Migrates block field data (either nested or flat) to the target links field API key.
 */
async function migrateBlockFieldDataToTarget(
  ctx: FieldConversionContext,
  originalApiKey: string,
  targetLinksApiKey: string,
  isSingleBlock: boolean,
): Promise<void> {
  const {
    client,
    mcField,
    blockIdToRemove,
    mapping,
    nestedPaths,
    availableLocales,
    recordsToPublish,
  } = ctx;

  if (mcField.parentIsBlock) {
    const nestedPath = findNestedPathForField(nestedPaths, mcField);
    if (nestedPath) {
      await migrateNestedBlockFieldData(
        client,
        nestedPath,
        originalApiKey,
        targetLinksApiKey,
        blockIdToRemove,
        mapping,
        isSingleBlock,
        availableLocales,
        recordsToPublish,
      );
    }
  } else {
    await migrateFieldData(
      client,
      mcField.parentModelId,
      originalApiKey,
      targetLinksApiKey,
      mcField.localized,
      blockIdToRemove,
      mapping,
      isSingleBlock,
      recordsToPublish,
    );
  }
}

async function handleNonDestructiveConversion(
  ctx: FieldConversionContext,
  originalLabel: string,
  originalApiKey: string,
  originalPosition: number,
  originalFieldset: { id: string; type: 'fieldset' } | null,
  isSingleBlock: boolean,
): Promise<void> {
  const {
    client,
    mcField,
    newModelId,
    blockIdToRemove,
    mapping,
    nestedPaths,
    availableLocales,
    recordsToPublish,
  } = ctx;

  const existingFields = await client.fields.list(mcField.parentModelId);
  const expectedLinksApiKey = `${originalApiKey}_links`;
  const existingLinksField = existingFields.find(
    (f) => f.api_key === expectedLinksApiKey,
  );

  if (existingLinksField) {
    // APPEND MODE: Links field already exists — update validators and append data
    const currentValidators = existingLinksField.validators as Record<
      string,
      unknown
    >;
    const currentItemsValidator = currentValidators.items_item_type as
      | { item_types?: string[] }
      | undefined;
    const currentItemTypes = currentItemsValidator?.item_types ?? [];

    if (!currentItemTypes.includes(newModelId)) {
      await client.fields.update(existingLinksField.id, {
        validators: {
          ...currentValidators,
          items_item_type: { item_types: [...currentItemTypes, newModelId] },
        },
      });
    }

    if (mcField.parentIsBlock) {
      const nestedPath = findNestedPathForField(nestedPaths, mcField);
      if (nestedPath) {
        await migrateNestedBlockFieldDataAppend(
          client,
          nestedPath,
          originalApiKey,
          existingLinksField.api_key,
          blockIdToRemove,
          mapping,
          availableLocales,
          recordsToPublish,
        );
      }
    } else {
      await migrateFieldDataAppend(
        client,
        mcField.parentModelId,
        originalApiKey,
        existingLinksField.api_key,
        mcField.localized,
        blockIdToRemove,
        mapping,
        recordsToPublish,
      );
    }
  } else {
    // CREATE MODE: Create new links field alongside original
    const newLinksField = await createLinksFieldAlongsideOriginal(
      ctx,
      originalLabel,
      originalApiKey,
      originalPosition,
      originalFieldset,
      isSingleBlock,
    );
    await migrateBlockFieldDataToTarget(
      ctx,
      originalApiKey,
      newLinksField.api_key,
      isSingleBlock,
    );
  }

  // NOTE: The original modular content field is intentionally left intact
}

/**
 * Handles partial conversion when other block types remain in the field.
 * Creates a new links field alongside the existing modular content field.
 */
async function handlePartialModularContentConversion(
  ctx: FieldConversionContext,
  currentField: {
    id: string;
    validators: Record<string, unknown>;
    [key: string]: unknown;
  },
  originalLabel: string,
  originalApiKey: string,
  originalPosition: number,
  originalFieldset: { id: string; type: 'fieldset' } | null,
  remainingBlockIds: string[],
): Promise<void> {
  const { client, mcField, blockIdToRemove, mapping } = ctx;

  const existingFields = await client.fields.list(mcField.parentModelId);
  const expectedLinksApiKey = `${originalApiKey}_links`;
  const existingLinksField = existingFields.find(
    (f) => f.api_key === expectedLinksApiKey,
  );

  if (existingLinksField) {
    // APPEND MODE: Links field already exists
    await appendToExistingLinksField(
      ctx,
      existingLinksField,
      originalApiKey,
      blockIdToRemove,
      mapping,
    );
  } else {
    // CREATE MODE: Create new links field
    await createNewLinksField(
      ctx,
      originalLabel,
      originalApiKey,
      originalPosition,
      originalFieldset,
      blockIdToRemove,
    );
  }

  // Update original field to remove converted block type
  await client.fields.update(mcField.id, {
    validators: {
      ...currentField.validators,
      rich_text_blocks: {
        item_types: remainingBlockIds,
      },
    },
  });
}

/**
 * Handles full replacement when this is the last/only block type.
 * Either appends to existing links field or creates a temp field and replaces.
 */
/**
 * Creates a temp links field, migrates data to it, deletes the old field, then renames the temp.
 */
async function replaceSingleBlockFieldWithTempRename(
  ctx: FieldConversionContext,
  originalLabel: string,
  originalApiKey: string,
  originalPosition: number,
  originalHint: string | undefined,
  originalFieldset: { id: string; type: 'fieldset' } | null,
  isSingleBlock: boolean,
): Promise<void> {
  const { client, mcField, newModelId } = ctx;
  const tempApiKey = `${originalApiKey}_temp_links`;

  const tempFieldData = {
    label: `${originalLabel} (Temp)`,
    api_key: tempApiKey,
    field_type: isSingleBlock ? 'link' : 'links',
    localized: mcField.localized,
    validators: isSingleBlock
      ? { item_item_type: { item_types: [newModelId] } }
      : { items_item_type: { item_types: [newModelId] } },
    appearance: {
      editor: isSingleBlock ? 'link_embed' : 'links_embed',
      parameters: {},
      addons: [],
    },
    position: originalPosition + 1,
    fieldset: originalFieldset ?? undefined,
  } as Parameters<typeof client.fields.create>[1];

  await client.fields.create(mcField.parentModelId, tempFieldData);
  await migrateBlockFieldDataToTarget(
    ctx,
    originalApiKey,
    tempApiKey,
    isSingleBlock,
  );
  await client.fields.destroy(mcField.id);

  const fieldsAfterDelete = await client.fields.list(mcField.parentModelId);
  const tempField = fieldsAfterDelete.find((f) => f.api_key === tempApiKey);
  if (tempField) {
    const updateData: Parameters<typeof client.fields.update>[1] = {
      label: originalLabel,
      api_key: originalApiKey,
      position: originalPosition,
      hint: originalHint,
    };
    if (originalFieldset) {
      updateData.fieldset = originalFieldset;
    }
    await client.fields.update(tempField.id, updateData);
  }
}

async function handleFullModularContentReplacement(
  ctx: FieldConversionContext,
  _currentField: {
    id: string;
    validators: Record<string, unknown>;
    [key: string]: unknown;
  },
  originalLabel: string,
  originalApiKey: string,
  originalPosition: number,
  originalHint: string | undefined,
  originalFieldset: { id: string; type: 'fieldset' } | null,
  isSingleBlock: boolean,
): Promise<void> {
  const { client, mcField, blockIdToRemove, mapping } = ctx;

  const existingFields = await client.fields.list(mcField.parentModelId);
  const expectedLinksApiKey = `${originalApiKey}_links`;
  const existingLinksField = existingFields.find(
    (f) => f.api_key === expectedLinksApiKey,
  );

  if (existingLinksField) {
    // Append to existing links field, delete original, move links field to original position
    await appendToExistingLinksField(
      ctx,
      existingLinksField,
      originalApiKey,
      blockIdToRemove,
      mapping,
    );
    await client.fields.destroy(mcField.id);
    await client.fields.update(existingLinksField.id, {
      position: originalPosition,
    });
  } else {
    // Create temp field, migrate, delete old, rename temp to original
    await replaceSingleBlockFieldWithTempRename(
      ctx,
      originalLabel,
      originalApiKey,
      originalPosition,
      originalHint,
      originalFieldset,
      isSingleBlock,
    );
  }
}

// =============================================================================
// Helper Functions
// =============================================================================

/**
 * Appends new links to an existing links field.
 */
async function appendToExistingLinksField(
  ctx: FieldConversionContext,
  existingLinksField: {
    id: string;
    validators: Record<string, unknown>;
    api_key: string;
  },
  originalApiKey: string,
  blockIdToRemove: string,
  mapping: BlockMigrationMapping,
): Promise<void> {
  const {
    client,
    mcField,
    newModelId,
    nestedPaths,
    availableLocales,
    recordsToPublish,
  } = ctx;

  // Update validators to include new model
  const currentValidators = existingLinksField.validators as Record<
    string,
    unknown
  >;
  const currentItemsValidator = currentValidators.items_item_type as
    | { item_types?: string[] }
    | undefined;
  const currentItemTypes = currentItemsValidator?.item_types || [];

  if (!currentItemTypes.includes(newModelId)) {
    await client.fields.update(existingLinksField.id, {
      validators: {
        ...currentValidators,
        items_item_type: {
          item_types: [...currentItemTypes, newModelId],
        },
      },
    });
  }

  // Append data
  if (mcField.parentIsBlock) {
    const nestedPath = findNestedPathForField(nestedPaths, mcField);
    if (nestedPath) {
      await migrateNestedBlockFieldDataAppend(
        client,
        nestedPath,
        originalApiKey,
        existingLinksField.api_key,
        blockIdToRemove,
        mapping,
        availableLocales,
        recordsToPublish,
      );
    }
  } else {
    await migrateFieldDataAppend(
      client,
      mcField.parentModelId,
      originalApiKey,
      existingLinksField.api_key,
      mcField.localized,
      blockIdToRemove,
      mapping,
      recordsToPublish,
    );
  }
}

/**
 * Creates a new links field alongside the modular content field.
 */
async function createNewLinksField(
  ctx: FieldConversionContext,
  originalLabel: string,
  originalApiKey: string,
  originalPosition: number,
  originalFieldset: { id: string; type: 'fieldset' } | null,
  blockIdToRemove: string,
): Promise<void> {
  const {
    client,
    mcField,
    newModelId,
    mapping,
    nestedPaths,
    availableLocales,
    recordsToPublish,
  } = ctx;

  const newLinksFieldData: Parameters<typeof client.fields.create>[1] = {
    label: `${originalLabel} (Links)`,
    api_key: `${originalApiKey}_links`,
    field_type: 'links',
    localized: mcField.localized,
    validators: {
      items_item_type: {
        item_types: [newModelId],
      },
    },
    appearance: {
      editor: 'links_embed',
      parameters: {},
      addons: [],
    },
    position: originalPosition + 1,
  };

  if (originalFieldset) {
    newLinksFieldData.fieldset = originalFieldset;
  }

  const newLinksField = await client.fields.create(
    mcField.parentModelId,
    newLinksFieldData,
  );

  // Migrate data
  if (mcField.parentIsBlock) {
    const nestedPath = findNestedPathForField(nestedPaths, mcField);
    if (nestedPath) {
      await migrateNestedBlockFieldData(
        client,
        nestedPath,
        originalApiKey,
        newLinksField.api_key,
        blockIdToRemove,
        mapping,
        false,
        availableLocales,
        recordsToPublish,
      );
    }
  } else {
    await migrateFieldData(
      client,
      mcField.parentModelId,
      originalApiKey,
      newLinksField.api_key,
      mcField.localized,
      blockIdToRemove,
      mapping,
      false,
      recordsToPublish,
    );
  }
}

/**
 * Finds the nested path that corresponds to a specific modular content field.
 */
export function findNestedPathForField(
  nestedPaths: NestedBlockPath[],
  mcField: ModularContentFieldInfo,
): NestedBlockPath | undefined {
  return nestedPaths.find((path) => {
    const lastStep = path.path[path.path.length - 1];
    return (
      lastStep.fieldApiKey === mcField.apiKey &&
      path.fieldInfo.parentModelId === mcField.parentModelId
    );
  });
}

/**
 * Cleans up temporary fields from previous failed conversions.
 */
async function cleanupTempFields(
  client: CMAClient,
  parentModelId: string,
  originalApiKey: string,
): Promise<void> {
  const existingFields = await client.fields.list(parentModelId);
  const tempFields = existingFields.filter(
    (field) => field.api_key === `${originalApiKey}_temp_links`,
  );

  await Promise.all(
    tempFields.map(async (field) => {
      try {
        await client.fields.destroy(field.id);
      } catch (e) {
        console.warn(`Could not clean up existing field ${field.api_key}:`, e);
      }
    }),
  );
}

// =============================================================================
// Block Cleanup
// =============================================================================

/**
 * Cleans up nested blocks from the original modular content field.
 * Used when doing partial replacement (keeping both fields).
 *
 * @param client - DatoCMS CMA client
 * @param rootModelId - ID of the root model
 * @param paths - Nested paths for cleanup
 * @param targetBlockId - ID of the block type to remove
 * @param recordsToPublish - Optional set to track records for publishing
 */
export async function cleanupNestedBlocksFromOriginalField(
  client: CMAClient,
  rootModelId: string,
  paths: NestedBlockPath[],
  targetBlockId: string,
  recordsToPublish?: Set<string>,
): Promise<void> {
  for await (const record of client.items.listPagedIterator({
    filter: { type: rootModelId },
    nested: true,
    version: 'current',
  })) {
    let needsUpdate = false;
    const updates: Record<string, unknown> = {};

    for (const path of paths) {
      const rootFieldApiKey = path.path[0].fieldApiKey;
      const rootFieldValue = record[rootFieldApiKey];

      if (!rootFieldValue) continue;

      const result = traverseAndRemoveBlocks(
        rootFieldValue,
        path.path,
        0,
        targetBlockId,
      );

      if (result.updated) {
        needsUpdate = true;
        updates[rootFieldApiKey] = result.newValue;
      }
    }

    if (needsUpdate) {
      await client.items.update(record.id, updates);
      recordsToPublish?.add(record.id);
    }
  }
}
