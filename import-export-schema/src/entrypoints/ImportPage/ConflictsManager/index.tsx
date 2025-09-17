import type { SchemaTypes } from '@datocms/cma-client';
import type { RenderPageCtx } from 'datocms-plugin-sdk';
import { Button } from 'datocms-react-ui';
import { defaults, groupBy, map, mapValues, sortBy } from 'lodash-es';
import { useContext, useMemo } from 'react';
import { useFormState } from 'react-final-form';
import type { ExportSchema } from '@/entrypoints/ExportPage/ExportSchema';
import { getTextWithoutRepresentativeEmojiAndPadding } from '@/utils/emojiAgnosticSorter';
import type { ProjectSchema } from '@/utils/ProjectSchema';
import { ConflictsContext } from './ConflictsContext';
import { ItemTypeConflict } from './ItemTypeConflict';
import { PluginConflict } from './PluginConflict';

type Props = {
  exportSchema: ExportSchema;
  schema: ProjectSchema;
  // ctx is currently unused; keep for future enhancements
  ctx?: RenderPageCtx;
};


export default function ConflictsManager({
  exportSchema,
  schema: _schema,
}: Props) {
  const conflicts = useContext(ConflictsContext);
  const { submitting, valid, validating } = useFormState({
    subscription: {
      submitting: true,
      valid: true,
      validating: true,
    },
  });

  const groupedItemTypes = useMemo(() => {
    if (!conflicts) {
      return { blocks: [], models: [] };
    }

    return defaults(
      mapValues(
        groupBy(
          map(
            conflicts.itemTypes,
            (
              projectItemType: SchemaTypes.ItemType,
              exportItemTypeId: string,
            ) => {
              const exportItemType =
                exportSchema.getItemTypeById(exportItemTypeId);
              return { exportItemTypeId, exportItemType, projectItemType };
            },
          ),
          ({ exportItemType }: { exportItemType: SchemaTypes.ItemType }) =>
            exportItemType?.attributes.modular_block ? 'blocks' : 'models',
        ),
        (group: Array<{ exportItemType: SchemaTypes.ItemType }>) =>
          sortBy(
            group,
            ({ exportItemType }: { exportItemType: SchemaTypes.ItemType }) =>
              getTextWithoutRepresentativeEmojiAndPadding(
                exportItemType.attributes.name,
              ),
          ),
      ),
      { blocks: [], models: [] },
    );
  }, [conflicts, exportSchema]);

  const sortedPlugins = useMemo(() => {
    if (!conflicts) {
      return [] as Array<{
        exportPluginId: string;
        exportPlugin: SchemaTypes.Plugin;
        projectPlugin: SchemaTypes.Plugin;
      }>;
    }

    return sortBy(
      map(
        conflicts.plugins,
        (projectPlugin: SchemaTypes.Plugin, exportPluginId: string) => {
          const exportPlugin = exportSchema.getPluginById(exportPluginId);
          return { exportPluginId, exportPlugin, projectPlugin };
        },
      ),
      ({ exportPlugin }: { exportPlugin: SchemaTypes.Plugin }) =>
        exportPlugin.attributes.name,
    );
  }, [conflicts, exportSchema]);

  if (!conflicts) {
    return null;
  }

  const itemTypeConflictCount =
    groupedItemTypes.blocks.length + groupedItemTypes.models.length;
  const pluginConflictCount = sortedPlugins.length;

  const noPotentialConflicts =
    itemTypeConflictCount === 0 && pluginConflictCount === 0;

  return (
    <div className="page">
      <div className="conflicts-manager__actions">
        <div style={{ fontWeight: 700, fontSize: '16px' }}>
          Import conflicts
        </div>
      </div>
      <div className="page__content">
        {noPotentialConflicts ? (
          <div className="surface" style={{ padding: '24px' }}>
            <p style={{ margin: 0 }}>
              All set — no conflicting models, blocks, or plugins were found in
              this import.
            </p>
          </div>
        ) : (
          <div>
            {groupedItemTypes.models.length > 0 && (
              <div className="conflicts-manager__group">
                <div className="conflicts-manager__group__title">
                  Models ({groupedItemTypes.models.length})
                </div>
                <div className="conflicts-manager__group__content">
                  {groupedItemTypes.models.map(
                    ({
                      exportItemTypeId,
                      exportItemType,
                      projectItemType,
                    }: {
                      exportItemTypeId: string;
                      exportItemType: SchemaTypes.ItemType;
                      projectItemType: SchemaTypes.ItemType;
                    }) => (
                      <ItemTypeConflict
                        key={exportItemTypeId}
                        exportItemType={exportItemType}
                        projectItemType={projectItemType}
                      />
                    ),
                  )}
                </div>
              </div>
            )}

            {groupedItemTypes.blocks.length > 0 && (
              <div className="conflicts-manager__group">
                <div className="conflicts-manager__group__title">
                  Block models ({groupedItemTypes.blocks.length})
                </div>
                <div className="conflicts-manager__group__content">
                  {groupedItemTypes.blocks.map(
                    ({
                      exportItemTypeId,
                      exportItemType,
                      projectItemType,
                    }: {
                      exportItemTypeId: string;
                      exportItemType: SchemaTypes.ItemType;
                      projectItemType: SchemaTypes.ItemType;
                    }) => (
                      <ItemTypeConflict
                        key={exportItemTypeId}
                        exportItemType={exportItemType}
                        projectItemType={projectItemType}
                      />
                    ),
                  )}
                </div>
              </div>
            )}

            {sortedPlugins.length > 0 && (
              <div className="conflicts-manager__group">
                <div className="conflicts-manager__group__title">
                  Plugins ({sortedPlugins.length})
                </div>
                <div className="conflicts-manager__group__content">
                  {sortedPlugins.map(
                    ({
                      exportPluginId,
                      exportPlugin,
                      projectPlugin,
                    }: {
                      exportPluginId: string;
                      exportPlugin: SchemaTypes.Plugin;
                      projectPlugin: SchemaTypes.Plugin;
                    }) => (
                      <PluginConflict
                        key={exportPluginId}
                        exportPlugin={exportPlugin}
                        projectPlugin={projectPlugin}
                      />
                    ),
                  )}
                </div>
              </div>
            )}
          </div>
        )}
      </div>
      <div className="page__actions">
        {/** Precompute disabled state to attach tooltip when needed */}
        {(() => {
          return null;
        })()}
        <Button
          type="button"
          fullWidth
          buttonSize="l"
          buttonType="negative"
          onClick={() => {
            // Let parent handle confirmation and state reset
            window.dispatchEvent(new CustomEvent('import:request-cancel'));
          }}
        >
          Cancel
        </Button>
        {(() => {
          const proceedDisabled = submitting || !valid || validating;
          return (
            <div
              title={
                proceedDisabled
                  ? 'Select how to resolve the conflicts before proceeding'
                  : undefined
              }
              style={{ width: '100%' }}
            >
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
          );
        })()}
        <p className="conflicts-manager__actions__reassurance">
          The import will never alter any existing elements in the schema.
        </p>
      </div>
    </div>
  );
}
