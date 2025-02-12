import { useContext } from 'react';
import { type ExportDoc, ExportSchema } from '../ExportPage/buildExportDoc';
import { ConflictsContext } from './ConflictsContext';
import { ItemTypeConflict } from './ItemTypeConflict';

type Props = {
  exportDoc: ExportDoc;
};

export default function ConflictsManager({ exportDoc }: Props) {
  const exportSchema = new ExportSchema(exportDoc);
  const conflicts = useContext(ConflictsContext);

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
      </div>
    </div>
  );
}
