import type { ComponentProps } from 'react';
import type { SchemaTypes } from '@datocms/cma-client';
import { ExportStartPanel } from '@/components/ExportStartPanel';
import ExportInner from '../ExportPage/Inner';
import type { ProjectSchema } from '@/utils/ProjectSchema';

export type ExportWorkflowPrepareProgress = Parameters<
  NonNullable<ComponentProps<typeof ExportInner>['onPrepareProgress']>
>[0];

type Props = {
  projectSchema: ProjectSchema;
  exportStarted: boolean;
  exportInitialSelectId: string;
  allItemTypes?: SchemaTypes.ItemType[];
  exportInitialItemTypeIds: string[];
  exportInitialItemTypes: SchemaTypes.ItemType[];
  setSelectedIds: (ids: string[]) => void;
  onStart: () => void;
  onExportAll: () => void;
  exportAllDisabled: boolean;
  onGraphPrepared: () => void;
  onPrepareProgress: (update: ExportWorkflowPrepareProgress) => void;
  onClose: () => void;
  onExportSelection: (itemTypeIds: string[], pluginIds: string[]) => void;
};

/**
 * Renders the export tab experience inside the unified Import page.
 */
export function ExportWorkflow({
  projectSchema,
  exportStarted,
  exportInitialSelectId,
  allItemTypes,
  exportInitialItemTypeIds,
  exportInitialItemTypes,
  setSelectedIds,
  onStart,
  onExportAll,
  exportAllDisabled,
  onGraphPrepared,
  onPrepareProgress,
  onClose,
  onExportSelection,
}: Props) {
  if (!exportStarted) {
    return (
      <div className="blank-slate">
        <ExportStartPanel
          selectId={exportInitialSelectId}
          itemTypes={allItemTypes}
          selectedIds={exportInitialItemTypeIds}
          onSelectedIdsChange={setSelectedIds}
          onStart={onStart}
          startDisabled={exportInitialItemTypeIds.length === 0}
          onExportAll={onExportAll}
          exportAllDisabled={exportAllDisabled}
        />
      </div>
    );
  }

  return (
    <div className="blank-slate">
      <ExportInner
        initialItemTypes={exportInitialItemTypes}
        schema={projectSchema}
        onGraphPrepared={onGraphPrepared}
        onPrepareProgress={onPrepareProgress}
        onClose={onClose}
        onExport={onExportSelection}
      />
    </div>
  );
}
