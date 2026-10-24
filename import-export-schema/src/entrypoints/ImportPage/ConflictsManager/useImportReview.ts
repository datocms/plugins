import type { SchemaTypes } from '@datocms/cma-client';
import get from 'lodash-es/get';
import { useCallback, useContext, useMemo } from 'react';
import { useFormState } from 'react-final-form';
import type { ExportSchema } from '@/entrypoints/ExportPage/ExportSchema';
import { isDefined } from '@/utils/isDefined';
import {
  getPendingIdReplacementKeys,
  idCollisionFieldPrefix,
} from '../ResolutionsForm';
import type {
  Conflicts,
  FieldIdCollision,
  FieldLegacyIdIssue,
  FieldsetIdCollision,
  FieldsetLegacyIdIssue,
  IdCollisionEntityType,
  ItemTypeIdCollision,
  ItemTypeLegacyIdIssue,
  PluginIdCollision,
  PluginLegacyIdIssue,
} from './buildConflicts';
import { ConflictsContext } from './ConflictsContext';
import { sortConflictEntries } from './index';

export type ItemTypeEntry = {
  exportItemType: SchemaTypes.ItemType;
  /** The fields and fieldsets of the file, for the overview to list them */
  fields: SchemaTypes.Field[];
  fieldsets: SchemaTypes.Fieldset[];
  projectItemType?: SchemaTypes.ItemType;
  idCollision?: ItemTypeIdCollision;
  legacyIdIssue?: ItemTypeLegacyIdIssue;
  fieldIdCollisions: FieldIdCollision[];
  fieldLegacyIdIssues: FieldLegacyIdIssue[];
  fieldsetIdCollisions: FieldsetIdCollision[];
  fieldsetLegacyIdIssues: FieldsetLegacyIdIssue[];
};

export type PluginEntry = {
  exportPlugin: SchemaTypes.Plugin;
  projectPlugin?: SchemaTypes.Plugin;
  idCollision?: PluginIdCollision;
  legacyIdIssue?: PluginLegacyIdIssue;
};

export type SectionKey = 'models' | 'blocks' | 'plugins';

const baseSectionOrder: SectionKey[] = ['models', 'blocks', 'plugins'];

export function itemTypeEntryHasConflict(entry: ItemTypeEntry) {
  return Boolean(
    entry.projectItemType ||
      entry.idCollision ||
      entry.legacyIdIssue ||
      entry.fieldIdCollisions.length > 0 ||
      entry.fieldLegacyIdIssues.length > 0 ||
      entry.fieldsetIdCollisions.length > 0 ||
      entry.fieldsetLegacyIdIssues.length > 0,
  );
}

export function pluginEntryHasConflict(entry: PluginEntry) {
  return Boolean(
    entry.projectPlugin || entry.idCollision || entry.legacyIdIssue,
  );
}

function sortItemTypesByUnresolvedThenName(
  items: ItemTypeEntry[],
  isUnresolved: (entry: ItemTypeEntry) => boolean,
): ItemTypeEntry[] {
  return sortConflictEntries(
    items,
    isUnresolved,
    itemTypeEntryHasConflict,
    (entry) => entry.exportItemType.attributes.name,
  );
}

function sortPluginsByUnresolvedThenName(
  entries: PluginEntry[],
  isUnresolved: (entry: PluginEntry) => boolean,
): PluginEntry[] {
  return sortConflictEntries(
    entries,
    isUnresolved,
    pluginEntryHasConflict,
    (entry) => entry.exportPlugin.attributes.name,
  );
}

/** The sections with unresolved conflicts first, else models, blocks, plugins */
function getSectionOrder(unresolvedByKey: Record<SectionKey, boolean>) {
  return [...baseSectionOrder].sort((a, b) => {
    if (unresolvedByKey[a] !== unresolvedByKey[b]) {
      return unresolvedByKey[a] ? -1 : 1;
    }
    return baseSectionOrder.indexOf(a) - baseSectionOrder.indexOf(b);
  });
}

/** Why the Import button does nothing, when it does nothing */
function getProceedDisabledReason({
  submitting,
  hasConflicts,
  validating,
  valid,
  hasUnresolvedConflicts,
}: {
  submitting: boolean;
  hasConflicts: boolean;
  validating: boolean;
  valid: boolean;
  hasUnresolvedConflicts: boolean;
}) {
  // While the form submits, the button is busy: it needs no reason
  if (submitting || !hasConflicts) {
    return undefined;
  }
  if (hasUnresolvedConflicts || (!validating && !valid)) {
    return 'Resolve every conflict in the overview first.';
  }
  if (validating) {
    return 'The new names and API keys are being checked.';
  }
  return undefined;
}

function buildItemTypeEntries(
  exportSchema: ExportSchema,
  conflicts: Conflicts,
) {
  const entries: ItemTypeEntry[] = exportSchema.itemTypes.map(
    (exportItemType) => {
      const fields = exportSchema.getItemTypeFields(exportItemType);
      const fieldsets = exportSchema.getItemTypeFieldsets(exportItemType);

      return {
        exportItemType,
        fields,
        fieldsets,
        projectItemType:
          conflicts.itemTypes[String(exportItemType.id)] ?? undefined,
        idCollision:
          conflicts.ids.itemTypes[String(exportItemType.id)] ?? undefined,
        legacyIdIssue:
          conflicts.legacyIds.itemTypes[String(exportItemType.id)] ?? undefined,
        fieldIdCollisions: fields
          .map((field) => conflicts.ids.fields[String(field.id)])
          .filter(isDefined),
        fieldLegacyIdIssues: fields
          .map((field) => conflicts.legacyIds.fields[String(field.id)])
          .filter(isDefined),
        fieldsetIdCollisions: fieldsets
          .map((fieldset) => conflicts.ids.fieldsets[String(fieldset.id)])
          .filter(isDefined),
        fieldsetLegacyIdIssues: fieldsets
          .map((fieldset) => conflicts.legacyIds.fieldsets[String(fieldset.id)])
          .filter(isDefined),
      };
    },
  );

  return entries.reduce<Record<'blocks' | 'models', ItemTypeEntry[]>>(
    (accumulator, entry) => {
      const key: 'blocks' | 'models' = entry.exportItemType.attributes
        .modular_block
        ? 'blocks'
        : 'models';
      accumulator[key].push(entry);
      return accumulator;
    },
    { blocks: [], models: [] },
  );
}

/**
 * The state of the review of an import, shared by the toolbar of the graph
 * and by the overview: the entries of the file by kind, whether each conflict
 * is still unresolved, the sorted groups and their order, the counts, the IDs
 * that still need a replacement, and whether the import can start.
 *
 * Call it once, inside the resolutions form, and pass the result down.
 */
export function useImportReview(exportSchema: ExportSchema) {
  const conflicts = useContext(ConflictsContext);
  const formState = useFormState({
    subscription: {
      submitting: true,
      valid: true,
      validating: true,
      values: true,
      errors: true,
    },
  });
  const {
    submitting,
    valid,
    validating,
    values: formValues = {},
    errors: formErrors = {},
  } = formState as {
    submitting: boolean;
    valid: boolean;
    validating: boolean;
    values: Record<string, unknown>;
    errors: Record<string, unknown>;
  };
  const pendingIdReplacementKeys = useMemo(
    () => getPendingIdReplacementKeys(conflicts, formValues),
    [conflicts, formValues],
  );

  const isIdCollisionUnresolved = useCallback(
    (entityType: IdCollisionEntityType, id: string) => {
      const fieldPrefix = idCollisionFieldPrefix(entityType, id);
      const strategy = get(formValues, [fieldPrefix, 'strategy']);
      const hasErrors = Boolean(get(formErrors, [fieldPrefix]));

      return strategy !== 'generateReplacement' || hasErrors;
    },
    [formValues, formErrors],
  );

  const hasUnresolvedItemTypeIdCollision = useCallback(
    (entry: ItemTypeEntry) => {
      const fieldPrefix = `itemType-${entry.exportItemType.id}`;
      const strategy = get(formValues, [fieldPrefix, 'strategy']);
      if (strategy === 'reuseExisting') {
        return false;
      }

      const issueGroups = [
        [entry.idCollision, entry.legacyIdIssue].filter(isDefined),
        entry.fieldIdCollisions,
        entry.fieldLegacyIdIssues,
        entry.fieldsetIdCollisions,
        entry.fieldsetLegacyIdIssues,
      ];
      for (const issues of issueGroups) {
        if (
          issues.some((issue) =>
            isIdCollisionUnresolved(issue.entityType, issue.exportId),
          )
        )
          return true;
      }

      return false;
    },
    [formValues, isIdCollisionUnresolved],
  );

  // Returns true while an item-type conflict still needs user input.
  const isItemTypeConflictUnresolved = useCallback(
    (entry: ItemTypeEntry) => {
      const { exportItemType, projectItemType } = entry;
      const idCollisionUnresolved = hasUnresolvedItemTypeIdCollision(entry);

      if (!projectItemType) {
        return idCollisionUnresolved;
      }

      const fieldPrefix = `itemType-${exportItemType.id}`;
      const strategy = get(formValues, [fieldPrefix, 'strategy']);
      const hasErrors = Boolean(get(formErrors, [fieldPrefix]));

      if (!strategy) {
        return true;
      }

      if (hasErrors) {
        return true;
      }

      if (strategy === 'rename') {
        const name = get(formValues, [fieldPrefix, 'name']);
        const apiKey = get(formValues, [fieldPrefix, 'apiKey']);
        return !(name && apiKey) || idCollisionUnresolved;
      }

      if (strategy === 'reuseExisting') {
        return idCollisionUnresolved;
      }

      return true;
    },
    [formValues, formErrors, hasUnresolvedItemTypeIdCollision],
  );

  const hasUnresolvedPluginIdCollision = useCallback(
    (entry: PluginEntry) => {
      const fieldPrefix = `plugin-${entry.exportPlugin.id}`;
      const strategy = get(formValues, [fieldPrefix, 'strategy']);
      if (
        strategy === 'reuseExisting' ||
        strategy === 'skip' ||
        (!entry.idCollision && !entry.legacyIdIssue)
      ) {
        return false;
      }

      if (
        entry.idCollision &&
        isIdCollisionUnresolved('plugin', entry.idCollision.exportId)
      ) {
        return true;
      }

      return entry.legacyIdIssue
        ? isIdCollisionUnresolved('plugin', entry.legacyIdIssue.exportId)
        : false;
    },
    [formValues, isIdCollisionUnresolved],
  );

  const isPluginConflictUnresolved = useCallback(
    (entry: PluginEntry) => {
      const { exportPlugin, projectPlugin } = entry;
      const idCollisionUnresolved = hasUnresolvedPluginIdCollision(entry);

      if (!projectPlugin) {
        return idCollisionUnresolved;
      }

      const fieldPrefix = `plugin-${exportPlugin.id}`;
      const strategy = get(formValues, [fieldPrefix, 'strategy']);
      const hasErrors = Boolean(get(formErrors, [fieldPrefix]));

      if (!strategy) {
        return true;
      }

      if (hasErrors) {
        return true;
      }

      return idCollisionUnresolved;
    },
    [formValues, formErrors, hasUnresolvedPluginIdCollision],
  );

  const itemTypeEntriesByCategory = useMemo(
    () => buildItemTypeEntries(exportSchema, conflicts),
    [conflicts, exportSchema],
  );

  const itemTypesByCategory = useMemo(
    () => ({
      blocks: sortItemTypesByUnresolvedThenName(
        itemTypeEntriesByCategory.blocks,
        isItemTypeConflictUnresolved,
      ),
      models: sortItemTypesByUnresolvedThenName(
        itemTypeEntriesByCategory.models,
        isItemTypeConflictUnresolved,
      ),
    }),
    [itemTypeEntriesByCategory, isItemTypeConflictUnresolved],
  );

  // Deterministic sorting keeps plugin ordering stable between renders.
  const unsortedPluginEntries = useMemo<PluginEntry[]>(
    () =>
      exportSchema.plugins.map((exportPlugin) => ({
        exportPlugin,
        projectPlugin: conflicts.plugins[String(exportPlugin.id)] ?? undefined,
        idCollision:
          conflicts.ids.plugins[String(exportPlugin.id)] ?? undefined,
        legacyIdIssue:
          conflicts.legacyIds.plugins[String(exportPlugin.id)] ?? undefined,
      })),
    [conflicts, exportSchema],
  );
  const pluginEntries = useMemo(
    () =>
      sortPluginsByUnresolvedThenName(
        unsortedPluginEntries,
        isPluginConflictUnresolved,
      ),
    [unsortedPluginEntries, isPluginConflictUnresolved],
  );

  // Always count every conflict, also when the overview is filtered.
  const itemTypeConflictCount =
    itemTypesByCategory.blocks.filter(itemTypeEntryHasConflict).length +
    itemTypesByCategory.models.filter(itemTypeEntryHasConflict).length;
  const pluginConflictCount = pluginEntries.filter(
    pluginEntryHasConflict,
  ).length;

  const hasConflicts = itemTypeConflictCount > 0 || pluginConflictCount > 0;

  const unresolvedModelCount = itemTypesByCategory.models.filter(
    isItemTypeConflictUnresolved,
  ).length;
  const unresolvedBlockCount = itemTypesByCategory.blocks.filter(
    isItemTypeConflictUnresolved,
  ).length;
  const unresolvedPluginCount = pluginEntries.filter(
    isPluginConflictUnresolved,
  ).length;

  const unresolvedCount =
    unresolvedModelCount + unresolvedBlockCount + unresolvedPluginCount;
  const hasUnresolvedConflicts = unresolvedCount > 0;

  const sectionOrder = getSectionOrder({
    models: unresolvedModelCount > 0,
    blocks: unresolvedBlockCount > 0,
    plugins: unresolvedPluginCount > 0,
  });

  // When there are no conflicts at all, do not block the import on form
  // validation state: there is nothing to validate. Only gate on form
  // validity/validation when actual conflicts exist.
  const proceedDisabled =
    submitting ||
    (hasConflicts && (validating || !valid || hasUnresolvedConflicts));
  const proceedDisabledReason = getProceedDisabledReason({
    submitting,
    hasConflicts,
    validating,
    valid,
    hasUnresolvedConflicts,
  });

  return {
    itemTypesByCategory,
    pluginEntries,
    sectionOrder,
    isItemTypeConflictUnresolved,
    isPluginConflictUnresolved,
    hasUnresolvedItemTypeIdCollision,
    hasUnresolvedPluginIdCollision,
    itemTypeConflictCount,
    pluginConflictCount,
    hasConflicts,
    unresolvedCount,
    hasUnresolvedConflicts,
    pendingIdReplacementKeys,
    submitting,
    proceedDisabled,
    proceedDisabledReason,
  };
}

export type ImportReview = ReturnType<typeof useImportReview>;
