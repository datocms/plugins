import type { ComponentProps } from 'react';
import type { SchemaTypes } from '@datocms/cma-client';
import { ExportLandingPanel } from '@/components/ExportLandingPanel';
import { ExportSelectionPanel } from '@/components/ExportSelectionPanel';
import ExportInner from '../ExportPage/Inner';
import type { ProjectSchema } from '@/utils/ProjectSchema';

export type ExportWorkflowPrepareProgress = Parameters<
  NonNullable<ComponentProps<typeof ExportInner>['onPrepareProgress']>
>[0];

export type ExportWorkflowView = 'landing' | 'selection' | 'graph';

type Props = {
  projectSchema: ProjectSchema;
  view: ExportWorkflowView;
  exportInitialSelectId: string;
  allItemTypes?: SchemaTypes.ItemType[];
  exportInitialItemTypeIds: string[];
  exportInitialItemTypes: SchemaTypes.ItemType[];
  setSelectedIds: (ids: string[]) => void;
  onShowSelection: () => void;
  onBackToLanding: () => void;
  onStartSelection: () => void;
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
  view,
  exportInitialSelectId,
  allItemTypes,
  exportInitialItemTypeIds,
  exportInitialItemTypes,
  setSelectedIds,
  onShowSelection,
  onBackToLanding,
  onStartSelection,
  onExportAll,
  exportAllDisabled,
  onGraphPrepared,
  onPrepareProgress,
  onClose,
  onExportSelection,
}: Props) {
  if (view === 'graph') {
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

  if (view === 'selection') {
    return (
      <div className="blank-slate">
        <ExportSelectionPanel
          selectId={exportInitialSelectId}
          itemTypes={allItemTypes}
          selectedIds={exportInitialItemTypeIds}
          onSelectedIdsChange={setSelectedIds}
          onStart={onStartSelection}
          onBack={onBackToLanding}
          startDisabled={exportInitialItemTypeIds.length === 0}
        />
      </div>
    );
  }

  return (
    <div className="blank-slate">
      <ExportLandingPanel
        onSelectModels={onShowSelection}
        onExportAll={onExportAll}
        exportAllDisabled={exportAllDisabled}
      />
    </div>
  );
}
