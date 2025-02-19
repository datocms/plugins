import type { ExportSchema } from '@/entrypoints/ExportPage/ExportSchema';
import { Button, Toolbar, ToolbarStack, ToolbarTitle } from 'datocms-react-ui';
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
          {Object.entries(conflicts.itemTypes).map(
            ([exportItemTypeId, projectItemType]) => {
              const exportItemType =
                exportSchema.getItemTypeById(exportItemTypeId);

              return (
                <ItemTypeConflict
                  key={exportItemTypeId}
                  exportItemType={exportItemType}
                  projectItemType={projectItemType}
                />
              );
            },
          )}
          {Object.entries(conflicts.plugins).map(
            ([exportPluginId, projectPlugin]) => {
              const exportPlugin = exportSchema.getPluginById(exportPluginId);

              return (
                <PluginConflict
                  key={exportPluginId}
                  exportPlugin={exportPlugin}
                  projectPlugin={projectPlugin}
                />
              );
            },
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
