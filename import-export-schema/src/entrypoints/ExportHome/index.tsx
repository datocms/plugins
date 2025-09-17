import { ReactFlowProvider } from '@xyflow/react';
import type { RenderPageCtx } from 'datocms-plugin-sdk';
import { Canvas } from 'datocms-react-ui';
import { useId, useState } from 'react';
import { ExportStartPanel } from '@/components/ExportStartPanel';
import { TaskProgressOverlay } from '@/components/TaskProgressOverlay';
import { useExportSelection } from '@/shared/hooks/useExportSelection';
import { useProjectSchema } from '@/shared/hooks/useProjectSchema';
import { useExportAllHandler } from '@/shared/hooks/useExportAllHandler';
import { useLongTask } from '@/shared/tasks/useLongTask';
import { downloadJSON } from '@/utils/downloadJson';
import buildExportDoc from '../ExportPage/buildExportDoc';
import ExportInner from '../ExportPage/Inner';

type Props = {
  ctx: RenderPageCtx;
};

export default function ExportHome({ ctx }: Props) {
  const exportInitialSelectId = useId();
  const projectSchema = useProjectSchema(ctx);

  // adminDomain and post-export overview removed; we download and toast only

  const {
    allItemTypes,
    selectedIds: exportInitialItemTypeIds,
    selectedItemTypes: exportInitialItemTypes,
    setSelectedIds: setExportInitialItemTypeIds,
    selectAllModels: handleSelectAllModels,
    selectAllBlocks: handleSelectAllBlocks,
  } = useExportSelection({ schema: projectSchema });

  const [exportStarted, setExportStarted] = useState(false);

  const exportAllTask = useLongTask();
  const exportPreparingTask = useLongTask();
  const exportSelectionTask = useLongTask();

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
                  onSelectAllModels={handleSelectAllModels}
                  onSelectAllBlocks={handleSelectAllBlocks}
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
                  onExport={async (itemTypeIds, pluginIds) => {
                    try {
                      const total = pluginIds.length + itemTypeIds.length * 2;
                      exportSelectionTask.controller.start({
                        done: 0,
                        total,
                        label: 'Preparing export…',
                      });
                      let done = 0;

                      const exportDoc = await buildExportDoc(
                        projectSchema,
                        exportInitialItemTypeIds[0],
                        itemTypeIds,
                        pluginIds,
                        {
                          onProgress: (label: string) => {
                            done += 1;
                            exportSelectionTask.controller.setProgress({
                              done,
                              total,
                              label,
                            });
                          },
                          shouldCancel: () =>
                            exportSelectionTask.controller.isCancelRequested(),
                        },
                      );

                      if (exportSelectionTask.controller.isCancelRequested()) {
                        throw new Error('Export cancelled');
                      }

                      downloadJSON(exportDoc, {
                        fileName: 'export.json',
                        prettify: true,
                      });
                      exportSelectionTask.controller.complete({
                        done: total,
                        total,
                        label: 'Export completed',
                      });
                      ctx.notice('Export completed successfully.');
                    } catch (e) {
                      console.error('Selection export failed', e);
                      if (
                        e instanceof Error &&
                        e.message === 'Export cancelled'
                      ) {
                        exportSelectionTask.controller.complete({
                          label: 'Export cancelled',
                        });
                        ctx.notice('Export canceled');
                      } else {
                        exportSelectionTask.controller.fail(e);
                        ctx.alert(
                          'Could not complete the export. Please try again.',
                        );
                      }
                    } finally {
                      exportSelectionTask.controller.reset();
                    }
                  }}
                />
              )}
            </div>
          </div>
        </div>
      </ReactFlowProvider>

      {/* Blocking overlay while exporting all */}
      <TaskProgressOverlay
        task={exportAllTask}
        title="Exporting entire schema"
        subtitle="Sit tight, we’re gathering models, blocks, and plugins…"
        ariaLabel="Export in progress"
        progressLabel={(progress) =>
          progress.label ?? 'Loading project schema…'
        }
        cancel={() => ({
          label: 'Cancel export',
          intent: exportAllTask.state.cancelRequested ? 'muted' : 'negative',
          disabled: exportAllTask.state.cancelRequested,
          onCancel: () => exportAllTask.controller.requestCancel(),
        })}
      />

      <TaskProgressOverlay
        task={exportPreparingTask}
        title="Preparing export"
        subtitle="Sit tight, we’re setting up your models, blocks, and plugins…"
        ariaLabel="Preparing export"
        progressLabel={(progress) => progress.label ?? 'Preparing export…'}
        percentOverride={exportPreparingPercent}
      />

      <TaskProgressOverlay
        task={exportSelectionTask}
        title="Exporting selection"
        subtitle="Sit tight, we’re gathering models, blocks, and plugins…"
        ariaLabel="Export in progress"
        progressLabel={(progress) => progress.label ?? 'Preparing export…'}
        cancel={() => ({
          label: 'Cancel export',
          intent: exportSelectionTask.state.cancelRequested ? 'muted' : 'negative',
          disabled: exportSelectionTask.state.cancelRequested,
          onCancel: () => exportSelectionTask.controller.requestCancel(),
        })}
      />
    </Canvas>
  );
}
