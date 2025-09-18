import { ReactFlowProvider } from '@xyflow/react';
import type { RenderPageCtx } from 'datocms-plugin-sdk';
import { Canvas } from 'datocms-react-ui';
import { useId, useState } from 'react';
import { ExportStartPanel } from '@/components/ExportStartPanel';
import { TaskOverlayStack } from '@/components/TaskOverlayStack';
import { useExportAllHandler } from '@/shared/hooks/useExportAllHandler';
import { useExportSelection } from '@/shared/hooks/useExportSelection';
import { useProjectSchema } from '@/shared/hooks/useProjectSchema';
import { useSchemaExportTask } from '@/shared/hooks/useSchemaExportTask';
import { useLongTask } from '@/shared/tasks/useLongTask';
import ExportInner from '../ExportPage/Inner';

type Props = {
  ctx: RenderPageCtx;
};

/**
 * Landing page for the export workflow. Guides the user from the initial selection
 * state into the detailed graph view while coordinating the long-running tasks.
 */
export default function ExportHome({ ctx }: Props) {
  const exportInitialSelectId = useId();
  const projectSchema = useProjectSchema(ctx);

  // adminDomain and post-export overview removed; we download and toast only

  const {
    allItemTypes,
    selectedIds: exportInitialItemTypeIds,
    selectedItemTypes: exportInitialItemTypes,
    setSelectedIds: setExportInitialItemTypeIds,
  } = useExportSelection({ schema: projectSchema });

  const [exportStarted, setExportStarted] = useState(false);

  const exportAllTask = useLongTask();
  const exportPreparingTask = useLongTask();
  const { task: exportSelectionTask, runExport: runSelectionExport } =
    useSchemaExportTask({
      schema: projectSchema,
      ctx,
    });

  // Smoothed percent for preparing overlay to avoid jitter and changing max
  const [exportPreparingPercent, setExportPreparingPercent] = useState(0.1);

  const runExportAll = useExportAllHandler({
    ctx,
    schema: projectSchema,
    task: exportAllTask.controller,
  });

  const handleStartExport = () => {
    exportPreparingTask.controller.start({
      label: 'Preparing export…',
    });
    setExportPreparingPercent(0.1);
    setExportStarted(true);
  };

  return (
    <Canvas ctx={ctx}>
      <ReactFlowProvider>
        <div className="page">
          <div className="page__content">
            <div className="blank-slate">
              {!exportStarted ? (
                <ExportStartPanel
                  selectId={exportInitialSelectId}
                  itemTypes={allItemTypes}
                  selectedIds={exportInitialItemTypeIds}
                  onSelectedIdsChange={setExportInitialItemTypeIds}
                  onStart={handleStartExport}
                  startDisabled={exportInitialItemTypeIds.length === 0}
                  onExportAll={runExportAll}
                  exportAllDisabled={exportAllTask.state.status === 'running'}
                />
              ) : (
                <ExportInner
                  initialItemTypes={exportInitialItemTypes}
                  schema={projectSchema}
                  onGraphPrepared={() => {
                    setExportPreparingPercent(1);
                    exportPreparingTask.controller.complete({
                      label: 'Graph prepared',
                    });
                  }}
                  onPrepareProgress={(p) => {
                    // ensure overlay shows determinate progress
                    if (exportPreparingTask.state.status !== 'running') {
                      exportPreparingTask.controller.start(p);
                    } else {
                      exportPreparingTask.controller.setProgress(p);
                    }
                    const hasFixedTotal = (p.total ?? 0) > 0;
                    const raw = hasFixedTotal ? p.done / p.total : 0;
                    if (!hasFixedTotal) {
                      // Indeterminate scanning: gently advance up to 25%
                      setExportPreparingPercent((prev) =>
                        Math.min(0.25, Math.max(prev, prev + 0.02)),
                      );
                    } else {
                      // Determinate build: map to [0.25, 1]
                      const mapped = 0.25 + raw * 0.75;
                      setExportPreparingPercent((prev) =>
                        Math.max(prev, Math.min(1, mapped)),
                      );
                    }
                  }}
                  onClose={() => {
                    // Return to selection screen with current picks preserved
                    setExportStarted(false);
                    exportPreparingTask.controller.reset();
                  }}
                  onExport={(itemTypeIds, pluginIds) =>
                    runSelectionExport({
                      rootItemTypeId: exportInitialItemTypeIds[0],
                      itemTypeIds,
                      pluginIds,
                    })
                  }
                />
              )}
            </div>
          </div>
        </div>
      </ReactFlowProvider>

      {/* Blocking overlay while exporting all */}
      <TaskOverlayStack
        items={[
          {
            id: 'export-all',
            task: exportAllTask,
            title: 'Exporting entire schema',
            subtitle: 'Sit tight, we’re gathering models, blocks, and plugins…',
            ariaLabel: 'Export in progress',
            progressLabel: (progress) =>
              progress.label ?? 'Loading project schema…',
            cancel: () => ({
              label: 'Cancel export',
              intent: exportAllTask.state.cancelRequested
                ? 'muted'
                : 'negative',
              disabled: exportAllTask.state.cancelRequested,
              onCancel: () => exportAllTask.controller.requestCancel(),
            }),
          },
          {
            id: 'export-preparing',
            task: exportPreparingTask,
            title: 'Preparing export',
            subtitle:
              'Sit tight, we’re setting up your models, blocks, and plugins…',
            ariaLabel: 'Preparing export',
            progressLabel: (progress) => progress.label ?? 'Preparing export…',
            percentOverride: exportPreparingPercent,
          },
          {
            id: 'export-selection',
            task: exportSelectionTask,
            title: 'Exporting selection',
            subtitle: 'Sit tight, we’re gathering models, blocks, and plugins…',
            ariaLabel: 'Export in progress',
            progressLabel: (progress) => progress.label ?? 'Preparing export…',
            cancel: () => ({
              label: 'Cancel export',
              intent: exportSelectionTask.state.cancelRequested
                ? 'muted'
                : 'negative',
              disabled: exportSelectionTask.state.cancelRequested,
              onCancel: () => exportSelectionTask.controller.requestCancel(),
            }),
          },
        ]}
      />
    </Canvas>
  );
}
