import { Button } from 'datocms-react-ui';
import { useContext } from 'react';
import { useFormState } from 'react-final-form';
import { type ExportDoc, ExportSchema } from '../../ExportPage/buildExportDoc';
import { ConflictsContext } from '../ConflictsContext';
import { ItemTypeConflict } from './ItemTypeConflict';
import { PluginConflict } from './PluginConflict';

type Props = {
  exportDoc: ExportDoc;
};

export default function ConflictsManager({ exportDoc }: Props) {
  const exportSchema = new ExportSchema(exportDoc);
  const conflicts = useContext(ConflictsContext);
  const { submitting, dirty } = useFormState();

  if (!conflicts) {
    return null;
  }

  return (
    <div className="page">
      <div className="page__toolbar">
        <div className="page__toolbar__title">Import conflicts</div>
      </div>
      <div className="page__content">
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

        <Button
          type="submit"
          fullWidth
          buttonSize="m"
          buttonType="primary"
          disabled={submitting || !dirty}
        >
          Save settings
        </Button>
      </div>
    </div>
  );
}
