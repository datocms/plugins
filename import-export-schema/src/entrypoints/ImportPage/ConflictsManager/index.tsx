import type { SchemaTypes } from '@datocms/cma-client';
import type { RenderPageCtx } from 'datocms-plugin-sdk';
import { Button, SwitchInput } from 'datocms-react-ui';
import get from 'lodash-es/get';
import { useContext, useId, useMemo, useState } from 'react';
import { useFormState } from 'react-final-form';
import type { ExportSchema } from '@/entrypoints/ExportPage/ExportSchema';
import { getTextWithoutRepresentativeEmojiAndPadding } from '@/utils/emojiAgnosticSorter';
import type { ProjectSchema } from '@/utils/ProjectSchema';
import { ConflictsContext } from './ConflictsContext';
import { ItemTypeConflict } from './ItemTypeConflict';
import { PluginConflict } from './PluginConflict';

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

  type ItemTypeEntry = {
    exportItemType: SchemaTypes.ItemType;
    projectItemType?: SchemaTypes.ItemType;
  };

  type PluginEntry = {
    exportPlugin: SchemaTypes.Plugin;
    projectPlugin?: SchemaTypes.Plugin;
  };

  const itemTypesByCategory = useMemo(() => {
    const empty: Record<'blocks' | 'models', ItemTypeEntry[]> = {
      blocks: [],
      models: [],
    };

    if (!conflicts) {
      return empty;
    }

    const entries: ItemTypeEntry[] = exportSchema.itemTypes.map(
      (exportItemType) => ({
        exportItemType,
        projectItemType:
          conflicts.itemTypes[String(exportItemType.id)] ?? undefined,
      }),
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

    const sortByUnresolvedThenName = (items: ItemTypeEntry[]) =>
      sortEntriesByDisplayName(
        [...items].sort((a, b) => {
          // Unresolved first
          const aUnresolved = isItemTypeConflictUnresolved(
            a.exportItemType,
            a.projectItemType,
          );
          const bUnresolved = isItemTypeConflictUnresolved(
            b.exportItemType,
            b.projectItemType,
          );
          if (aUnresolved !== bUnresolved) {
            return aUnresolved ? -1 : 1;
          }
          // Then any remaining conflicts (already resolved) before non-conflicts
          const aHasConflict = Boolean(a.projectItemType);
          const bHasConflict = Boolean(b.projectItemType);
          if (aHasConflict !== bHasConflict) {
            return aHasConflict ? -1 : 1;
          }
          return 0;
        }),
        (entry) =>
          getTextWithoutRepresentativeEmojiAndPadding(
            entry.exportItemType.attributes.name,
          ),
      );

    return {
      blocks: sortByUnresolvedThenName(grouped.blocks),
      models: sortByUnresolvedThenName(grouped.models),
    };
  }, [conflicts, exportSchema, formValues, formErrors]);

  // Deterministic sorting keeps plugin ordering stable between renders.
  const pluginEntries = useMemo<PluginEntry[]>(() => {
    if (!conflicts) {
      return [];
    }

    const entries: PluginEntry[] = exportSchema.plugins.map((exportPlugin) => ({
      exportPlugin,
      projectPlugin: conflicts.plugins[String(exportPlugin.id)] ?? undefined,
    }));

    const unresolvedFirst = [...entries].sort((a, b) => {
      const aUnresolved = isPluginConflictUnresolved(
        a.exportPlugin,
        a.projectPlugin,
      );
      const bUnresolved = isPluginConflictUnresolved(
        b.exportPlugin,
        b.projectPlugin,
      );
      if (aUnresolved !== bUnresolved) {
        return aUnresolved ? -1 : 1;
      }
      const aHasConflict = Boolean(a.projectPlugin);
      const bHasConflict = Boolean(b.projectPlugin);
      if (aHasConflict !== bHasConflict) {
        return aHasConflict ? -1 : 1;
      }
      return 0;
    });

    return sortEntriesByDisplayName(unresolvedFirst, (entry) =>
      getTextWithoutRepresentativeEmojiAndPadding(
        entry.exportPlugin.attributes.name,
      ),
    );
  }, [conflicts, exportSchema, formValues, formErrors]);

  // Returns true while an item-type conflict still needs user input.
  function isItemTypeConflictUnresolved(
    exportItemType: SchemaTypes.ItemType,
    projectItemType?: SchemaTypes.ItemType,
  ) {
    if (!projectItemType) {
      return false;
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
      return !(name && apiKey);
    }

    if (strategy === 'reuseExisting') {
      return false;
    }

    return true;
  }

  // Plugins require no extra inputs beyond strategy selection.
  function isPluginConflictUnresolved(
    exportPlugin: SchemaTypes.Plugin,
    projectPlugin?: SchemaTypes.Plugin,
  ) {
    if (!projectPlugin) {
      return false;
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

    return false;
  }

  // Toggle in place filters the list down to unresolved conflicts when requested.
  const visibleModels = itemTypesByCategory.models.filter(
    ({ exportItemType, projectItemType }) =>
      showOnlyConflicts
        ? isItemTypeConflictUnresolved(exportItemType, projectItemType)
        : true,
  );

  const visibleBlocks = itemTypesByCategory.blocks.filter(
    ({ exportItemType, projectItemType }) =>
      showOnlyConflicts
        ? isItemTypeConflictUnresolved(exportItemType, projectItemType)
        : true,
  );

  const visiblePlugins = pluginEntries.filter(
    ({ exportPlugin, projectPlugin }) =>
      showOnlyConflicts
        ? isPluginConflictUnresolved(exportPlugin, projectPlugin)
        : true,
  );

  if (!conflicts) {
    return null;
  }

  // Always count every conflict to show accurate totals even when filtered.
  const itemTypeConflictCount =
    itemTypesByCategory.blocks.filter(({ projectItemType }) => projectItemType)
      .length +
    itemTypesByCategory.models.filter(({ projectItemType }) => projectItemType)
      .length;
  const pluginConflictCount = pluginEntries.filter(
    ({ projectPlugin }) => projectPlugin,
  ).length;

  const hasConflicts = itemTypeConflictCount > 0 || pluginConflictCount > 0;

  const unresolvedModelConflicts = itemTypesByCategory.models.some(
    ({ exportItemType, projectItemType }) =>
      isItemTypeConflictUnresolved(exportItemType, projectItemType),
  );

  const unresolvedBlockConflicts = itemTypesByCategory.blocks.some(
    ({ exportItemType, projectItemType }) =>
      isItemTypeConflictUnresolved(exportItemType, projectItemType),
  );

  const unresolvedPluginConflicts = pluginEntries.some(
    ({ exportPlugin, projectPlugin }) =>
      isPluginConflictUnresolved(exportPlugin, projectPlugin),
  );

  const hasUnresolvedConflicts =
    unresolvedModelConflicts ||
    unresolvedBlockConflicts ||
    unresolvedPluginConflicts;

  const proceedDisabled =
    submitting || validating || !valid || hasUnresolvedConflicts;
  const proceedTooltip =
    hasUnresolvedConflicts || !valid
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
                    {visibleModels.map(({ exportItemType, projectItemType }) => (
                      <ItemTypeConflict
                        key={exportItemType.id}
                        exportItemType={exportItemType}
                        projectItemType={projectItemType}
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
                    {visibleBlocks.map(({ exportItemType, projectItemType }) => (
                      <ItemTypeConflict
                        key={exportItemType.id}
                        exportItemType={exportItemType}
                        projectItemType={projectItemType}
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
                    {visiblePlugins.map(({ exportPlugin, projectPlugin }) => (
                      <PluginConflict
                        key={exportPlugin.id}
                        exportPlugin={exportPlugin}
                        projectPlugin={projectPlugin}
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
