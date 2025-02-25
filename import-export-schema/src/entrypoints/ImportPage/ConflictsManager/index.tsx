import type { ExportSchema } from '@/entrypoints/ExportPage/ExportSchema';
import { getTextWithoutRepresentativeEmojiAndPadding } from '@/utils/emojiAgnosticSorter';
import { Button, Toolbar, ToolbarStack, ToolbarTitle } from 'datocms-react-ui';
import { defaults, groupBy, map, mapValues, sortBy } from 'lodash-es';
import { useContext } from 'react';
import { useFormState } from 'react-final-form';
import { ConflictsContext } from './ConflictsContext';
import { ItemTypeConflict } from './ItemTypeConflict';
import { PluginConflict } from './PluginConflict';

type Props = {
  exportSchema: ExportSchema;
};

export default function ConflictsManager({ exportSchema }: Props) {
  const conflicts = useContext(ConflictsContext);
  const { submitting, valid } = useFormState();

  if (!conflicts) {
    return null;
  }

  const noPotentialConflicts =
    Object.keys(conflicts.itemTypes).length === 0 &&
    Object.keys(conflicts.plugins).length === 0;

  const groupedItemTypes = defaults(
    mapValues(
      groupBy(
        map(conflicts.itemTypes, (projectItemType, exportItemTypeId) => {
          const exportItemType = exportSchema.getItemTypeById(exportItemTypeId);
          return { exportItemTypeId, exportItemType, projectItemType };
        }),
        ({ exportItemType }) =>
          exportItemType?.attributes.modular_block ? 'blocks' : 'models',
      ),
      (group) =>
        sortBy(group, ({ exportItemType }) =>
          getTextWithoutRepresentativeEmojiAndPadding(
            exportItemType.attributes.name,
          ),
        ),
    ),
    { blocks: [], models: [] },
  );

  const sortedPlugins = sortBy(
    map(conflicts.plugins, (projectPlugin, exportPluginId) => {
      const exportPlugin = exportSchema.getPluginById(exportPluginId);
      return { exportPluginId, exportPlugin, projectPlugin };
    }),
    ({ exportPlugin }) => exportPlugin.attributes.name,
  );

  return (
    <div className="page">
      <Toolbar className="page__toolbar">
        <ToolbarStack>
          <ToolbarTitle>Import conflicts</ToolbarTitle>
          <div style={{ flex: '1' }} />
        </ToolbarStack>
      </Toolbar>
      <div className="page__content">
        <div className="conflicts-manager__actions">
          {noPotentialConflicts ? (
            <p>
              No conflicts have been found with existing schema of this project!
            </p>
          ) : (
            <p>
              Some conflicts exist with the current schema in this project.
              Before importing, we need to determine how to handle them.
            </p>
          )}
        </div>

        <div>
          {groupedItemTypes.models.length > 0 && (
            <div className="conflicts-manager__group">
              <div className="conflicts-manager__group__title">Models</div>
              <div className="conflicts-manager__group__content">
                {groupedItemTypes.models.map(
                  ({ exportItemTypeId, exportItemType, projectItemType }) => (
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
                Block models
              </div>
              <div className="conflicts-manager__group__content">
                {groupedItemTypes.blocks.map(
                  ({ exportItemTypeId, exportItemType, projectItemType }) => (
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
              <div className="conflicts-manager__group__title">Plugins</div>
              <div className="conflicts-manager__group__content">
                {sortedPlugins.map(
                  ({ exportPluginId, exportPlugin, projectPlugin }) => (
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

        <div className="conflicts-manager__actions">
          <Button
            type="submit"
            fullWidth
            buttonSize="l"
            buttonType="primary"
            disabled={submitting || !valid}
          >
            Proceed with the import
          </Button>
          <p className="conflicts-manager__actions__reassurance">
            The import will never alter any existing elements in the schema.
          </p>
        </div>
      </div>
    </div>
  );
}
