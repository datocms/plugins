import type { SchemaTypes } from '@datocms/cma-client';
import type { RenderPageCtx } from 'datocms-plugin-sdk';
import { Button, SwitchInput } from 'datocms-react-ui';
import get from 'lodash-es/get';
import { useCallback, useContext, useId, useMemo, useState } from 'react';
import { useFormState } from 'react-final-form';
import type { ExportSchema } from '@/entrypoints/ExportPage/ExportSchema';
import { getTextWithoutRepresentativeEmojiAndPadding } from '@/utils/emojiAgnosticSorter';
import { isDefined } from '@/utils/isDefined';
import type { ProjectSchema } from '@/utils/ProjectSchema';
import { idCollisionFieldPrefix } from '../ResolutionsForm';
import { ConflictsContext } from './ConflictsContext';
import { ItemTypeConflict } from './ItemTypeConflict';
import { PluginConflict } from './PluginConflict';
import type {
  FieldIdCollision,
  FieldsetIdCollision,
  IdCollisionEntityType,
  ItemTypeIdCollision,
  FieldLegacyIdIssue,
  FieldsetLegacyIdIssue,
  ItemTypeLegacyIdIssue,
  PluginLegacyIdIssue,
  PluginIdCollision,
} from './buildConflicts';

// Collator keeps alphabetical/numeric ordering stable regardless of locale accents.
const localeAwareCollator = new Intl.Collator(undefined, {
  sensitivity: 'base',
  numeric: true,
});

function sortEntriesByDisplayName<T>(items: T[], getName: (item: T) => string) {
  // Clone to avoid mutating callers and sort using the locale-aware collator.
  return [...items].sort((a, b) =>
    localeAwareCollator.compare(getName(a), getName(b)),
  );
}

type Props = {
  exportSchema: ExportSchema;
  schema: ProjectSchema;
  // ctx is currently unused; keep for future enhancements
  ctx?: RenderPageCtx;
};

type ItemTypeEntry = {
  exportItemType: SchemaTypes.ItemType;
  projectItemType?: SchemaTypes.ItemType;
  idCollision?: ItemTypeIdCollision;
  legacyIdIssue?: ItemTypeLegacyIdIssue;
  fieldIdCollisions: FieldIdCollision[];
  fieldLegacyIdIssues: FieldLegacyIdIssue[];
  fieldsetIdCollisions: FieldsetIdCollision[];
  fieldsetLegacyIdIssues: FieldsetLegacyIdIssue[];
};

type PluginEntry = {
  exportPlugin: SchemaTypes.Plugin;
  projectPlugin?: SchemaTypes.Plugin;
  idCollision?: PluginIdCollision;
  legacyIdIssue?: PluginLegacyIdIssue;
};

function itemTypeEntryHasConflict(entry: ItemTypeEntry) {
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

function pluginEntryHasConflict(entry: PluginEntry) {
  return Boolean(
    entry.projectPlugin || entry.idCollision || entry.legacyIdIssue,
  );
}

function sortItemTypesByUnresolvedThenName(
  items: ItemTypeEntry[],
  isUnresolved: (entry: ItemTypeEntry) => boolean,
): ItemTypeEntry[] {
  const sorted = [...items].sort((a, b) => {
    const aUnresolved = isUnresolved(a);
    const bUnresolved = isUnresolved(b);
    if (aUnresolved !== bUnresolved) {
      return aUnresolved ? -1 : 1;
    }
    const aHasConflict = itemTypeEntryHasConflict(a);
    const bHasConflict = itemTypeEntryHasConflict(b);
    if (aHasConflict !== bHasConflict) {
      return aHasConflict ? -1 : 1;
    }
    return 0;
  });

  return sortEntriesByDisplayName(sorted, (entry) =>
    getTextWithoutRepresentativeEmojiAndPadding(
      entry.exportItemType.attributes.name,
    ),
  );
}

function sortPluginsByUnresolvedThenName(
  entries: PluginEntry[],
  isUnresolved: (entry: PluginEntry) => boolean,
): PluginEntry[] {
  const sorted = [...entries].sort((a, b) => {
    const aUnresolved = isUnresolved(a);
    const bUnresolved = isUnresolved(b);
    if (aUnresolved !== bUnresolved) {
      return aUnresolved ? -1 : 1;
    }
    const aHasConflict = pluginEntryHasConflict(a);
    const bHasConflict = pluginEntryHasConflict(b);
    if (aHasConflict !== bHasConflict) {
      return aHasConflict ? -1 : 1;
    }
    return 0;
  });

  return sortEntriesByDisplayName(sorted, (entry) =>
    getTextWithoutRepresentativeEmojiAndPadding(
      entry.exportPlugin.attributes.name,
    ),
  );
}

/**
 * Organizes detected conflicts by type, wiring them into the resolutions form.
 */
export default function ConflictsManager({
  exportSchema,
  schema: _schema,
}: Props) {
  const conflicts = useContext(ConflictsContext);
  const [showOnlyConflicts, setShowOnlyConflicts] = useState(false);
  const toggleId = useId();
  // Track submission state for enabling/disabling the final CTA.
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

      if (
        entry.idCollision &&
        isIdCollisionUnresolved('itemType', entry.idCollision.exportId)
      ) {
        return true;
      }

      if (
        entry.legacyIdIssue &&
        isIdCollisionUnresolved('itemType', entry.legacyIdIssue.exportId)
      ) {
        return true;
      }

      for (const collision of entry.fieldIdCollisions) {
        if (isIdCollisionUnresolved('field', collision.exportId)) {
          return true;
        }
      }

      for (const issue of entry.fieldLegacyIdIssues) {
        if (isIdCollisionUnresolved('field', issue.exportId)) {
          return true;
        }
      }

      for (const collision of entry.fieldsetIdCollisions) {
        if (isIdCollisionUnresolved('fieldset', collision.exportId)) {
          return true;
        }
      }

      for (const issue of entry.fieldsetLegacyIdIssues) {
        if (isIdCollisionUnresolved('fieldset', issue.exportId)) {
          return true;
        }
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

  const itemTypesByCategory = useMemo(() => {
    const empty: Record<'blocks' | 'models', ItemTypeEntry[]> = {
      blocks: [],
      models: [],
    };

    if (!conflicts) {
      return empty;
    }

    const entries: ItemTypeEntry[] = exportSchema.itemTypes.map(
      (exportItemType) => {
        const fields = exportSchema.getItemTypeFields(exportItemType);
        const fieldsets = exportSchema.getItemTypeFieldsets(exportItemType);

        return {
          exportItemType,
          projectItemType:
            conflicts.itemTypes[String(exportItemType.id)] ?? undefined,
          idCollision:
            conflicts.ids.itemTypes[String(exportItemType.id)] ?? undefined,
          legacyIdIssue:
            conflicts.legacyIds.itemTypes[String(exportItemType.id)] ??
            undefined,
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
            .map(
              (fieldset) => conflicts.legacyIds.fieldsets[String(fieldset.id)],
            )
            .filter(isDefined),
        };
      },
    );

    const grouped = entries.reduce<
      Record<'blocks' | 'models', ItemTypeEntry[]>
    >(
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

    const isItemTypeEntryUnresolved = (entry: ItemTypeEntry) =>
      isItemTypeConflictUnresolved(entry);

    return {
      blocks: sortItemTypesByUnresolvedThenName(
        grouped.blocks,
        isItemTypeEntryUnresolved,
      ),
      models: sortItemTypesByUnresolvedThenName(
        grouped.models,
        isItemTypeEntryUnresolved,
      ),
    };
  }, [conflicts, exportSchema, isItemTypeConflictUnresolved]);

  // Deterministic sorting keeps plugin ordering stable between renders.
  const pluginEntries = useMemo<PluginEntry[]>(() => {
    if (!conflicts) {
      return [];
    }

    const entries: PluginEntry[] = exportSchema.plugins.map((exportPlugin) => ({
      exportPlugin,
      projectPlugin: conflicts.plugins[String(exportPlugin.id)] ?? undefined,
      idCollision: conflicts.ids.plugins[String(exportPlugin.id)] ?? undefined,
      legacyIdIssue:
        conflicts.legacyIds.plugins[String(exportPlugin.id)] ?? undefined,
    }));

    const isPluginEntryUnresolved = (entry: PluginEntry) =>
      isPluginConflictUnresolved(entry);

    return sortPluginsByUnresolvedThenName(entries, isPluginEntryUnresolved);
  }, [conflicts, exportSchema, isPluginConflictUnresolved]);

  // Toggle in place filters the list down to unresolved conflicts when requested.
  const visibleModels = itemTypesByCategory.models.filter((entry) =>
    showOnlyConflicts ? isItemTypeConflictUnresolved(entry) : true,
  );

  const visibleBlocks = itemTypesByCategory.blocks.filter((entry) =>
    showOnlyConflicts ? isItemTypeConflictUnresolved(entry) : true,
  );

  const visiblePlugins = pluginEntries.filter((entry) =>
    showOnlyConflicts ? isPluginConflictUnresolved(entry) : true,
  );

  if (!conflicts) {
    return null;
  }

  // Always count every conflict to show accurate totals even when filtered.
  const itemTypeConflictCount =
    itemTypesByCategory.blocks.filter(itemTypeEntryHasConflict).length +
    itemTypesByCategory.models.filter(itemTypeEntryHasConflict).length;
  const pluginConflictCount = pluginEntries.filter(
    pluginEntryHasConflict,
  ).length;

  const hasConflicts = itemTypeConflictCount > 0 || pluginConflictCount > 0;

  const unresolvedModelConflicts = itemTypesByCategory.models.some((entry) =>
    isItemTypeConflictUnresolved(entry),
  );

  const unresolvedBlockConflicts = itemTypesByCategory.blocks.some((entry) =>
    isItemTypeConflictUnresolved(entry),
  );

  const unresolvedPluginConflicts = pluginEntries.some((entry) =>
    isPluginConflictUnresolved(entry),
  );

  const hasUnresolvedConflicts =
    unresolvedModelConflicts ||
    unresolvedBlockConflicts ||
    unresolvedPluginConflicts;

  // When there are no conflicts at all, do not block the CTA on form
  // validation state — there is nothing to validate and the button should
  // be immediately clickable. Only gate on form validity/validation when
  // actual conflicts exist.
  const proceedDisabled =
    submitting ||
    (hasConflicts && (validating || !valid || hasUnresolvedConflicts));
  const proceedTooltip =
    hasConflicts && (hasUnresolvedConflicts || !valid)
      ? 'Select how to resolve the conflicts before proceeding'
      : undefined;

  return (
    <div className="page">
      <div className="conflicts-manager__actions">
        <div style={{ fontWeight: 700, fontSize: '16px' }}>Schema overview</div>
        <label
          htmlFor={toggleId}
          style={{
            display: 'inline-flex',
            alignItems: 'center',
            gap: '8px',
            marginTop: '10px',
            fontSize: '12px',
            color: 'var(--light-body-color)',
            cursor: 'pointer',
          }}
        >
          <SwitchInput
            id={toggleId}
            name="schema-overview-only-conflicts"
            value={showOnlyConflicts}
            onChange={(nextValue) => setShowOnlyConflicts(nextValue)}
            aria-label="Show only unresolved conflicts"
          />
          <span>Show only unresolved conflicts</span>
        </label>
      </div>
      <div className="page__content">
        {!hasConflicts && (
          <div className="surface" style={{ padding: '24px' }}>
            <p style={{ margin: 0 }}>
              All set — no conflicting models, blocks, or plugins were found in
              this import.
            </p>
          </div>
        )}

        {(() => {
          type SectionKey = 'models' | 'blocks' | 'plugins';
          const baseOrder: SectionKey[] = ['models', 'blocks', 'plugins'];
          const unresolvedByKey: Record<SectionKey, boolean> = {
            models: unresolvedModelConflicts,
            blocks: unresolvedBlockConflicts,
            plugins: unresolvedPluginConflicts,
          };
          const sectionOrder = [...baseOrder].sort((a, b) => {
            if (unresolvedByKey[a] !== unresolvedByKey[b]) {
              return unresolvedByKey[a] ? -1 : 1;
            }
            return baseOrder.indexOf(a) - baseOrder.indexOf(b);
          });

          return sectionOrder.map((section) => {
            if (section === 'models' && visibleModels.length > 0) {
              return (
                <div className="conflicts-manager__group" key="models">
                  <div className="conflicts-manager__group__title">
                    Models ({visibleModels.length})
                  </div>
                  <div className="conflicts-manager__group__content">
                    {visibleModels.map((entry) => (
                      <ItemTypeConflict
                        key={entry.exportItemType.id}
                        exportItemType={entry.exportItemType}
                        projectItemType={entry.projectItemType}
                        idCollision={entry.idCollision}
                        legacyIdIssue={entry.legacyIdIssue}
                        fieldIdCollisions={entry.fieldIdCollisions}
                        fieldLegacyIdIssues={entry.fieldLegacyIdIssues}
                        fieldsetIdCollisions={entry.fieldsetIdCollisions}
                        fieldsetLegacyIdIssues={entry.fieldsetLegacyIdIssues}
                        hasUnresolvedIdCollision={hasUnresolvedItemTypeIdCollision(
                          entry,
                        )}
                      />
                    ))}
                  </div>
                </div>
              );
            }

            if (section === 'blocks' && visibleBlocks.length > 0) {
              return (
                <div className="conflicts-manager__group" key="blocks">
                  <div className="conflicts-manager__group__title">
                    Block models ({visibleBlocks.length})
                  </div>
                  <div className="conflicts-manager__group__content">
                    {visibleBlocks.map((entry) => (
                      <ItemTypeConflict
                        key={entry.exportItemType.id}
                        exportItemType={entry.exportItemType}
                        projectItemType={entry.projectItemType}
                        idCollision={entry.idCollision}
                        legacyIdIssue={entry.legacyIdIssue}
                        fieldIdCollisions={entry.fieldIdCollisions}
                        fieldLegacyIdIssues={entry.fieldLegacyIdIssues}
                        fieldsetIdCollisions={entry.fieldsetIdCollisions}
                        fieldsetLegacyIdIssues={entry.fieldsetLegacyIdIssues}
                        hasUnresolvedIdCollision={hasUnresolvedItemTypeIdCollision(
                          entry,
                        )}
                      />
                    ))}
                  </div>
                </div>
              );
            }

            if (section === 'plugins' && visiblePlugins.length > 0) {
              return (
                <div className="conflicts-manager__group" key="plugins">
                  <div className="conflicts-manager__group__title">
                    Plugins ({visiblePlugins.length})
                  </div>
                  <div className="conflicts-manager__group__content">
                    {visiblePlugins.map((entry) => (
                      <PluginConflict
                        key={entry.exportPlugin.id}
                        exportPlugin={entry.exportPlugin}
                        projectPlugin={entry.projectPlugin}
                        idCollision={entry.idCollision}
                        legacyIdIssue={entry.legacyIdIssue}
                        hasUnresolvedIdCollision={hasUnresolvedPluginIdCollision(
                          entry,
                        )}
                      />
                    ))}
                  </div>
                </div>
              );
            }
            return null;
          });
        })()}
      </div>
      <div className="page__actions">
        {/* Left slot intentionally empty for layout parity with Export flow */}
        <div aria-hidden />
        <div title={proceedTooltip} style={{ width: '100%' }}>
          <Button
            type="submit"
            fullWidth
            buttonSize="l"
            buttonType="primary"
            disabled={proceedDisabled}
            style={proceedDisabled ? { pointerEvents: 'none' } : undefined}
          >
            Proceed with the import
          </Button>
        </div>
        <p className="conflicts-manager__actions__reassurance">
          The import will never alter any existing elements in the schema.
        </p>
      </div>
    </div>
  );
}
