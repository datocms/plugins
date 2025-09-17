// Removed unused icons
import { ReactFlowProvider } from '@xyflow/react';
import type { RenderPageCtx } from 'datocms-plugin-sdk';
import { Canvas, Spinner } from 'datocms-react-ui';
import { useEffect, useId, useState } from 'react';
import { ExportStartPanel } from '@/components/ExportStartPanel';
import { TaskProgressOverlay } from '@/components/TaskProgressOverlay';
import { useExportSelection } from '@/shared/hooks/useExportSelection';
import { useProjectSchema } from '@/shared/hooks/useProjectSchema';
import { useExportAllHandler } from '@/shared/hooks/useExportAllHandler';
import { useConflictsBuilder } from '@/shared/hooks/useConflictsBuilder';
import { useLongTask } from '@/shared/tasks/useLongTask';
import { downloadJSON } from '@/utils/downloadJson';
import type { ExportDoc } from '@/utils/types';
import buildExportDoc from '../ExportPage/buildExportDoc';
import { ExportSchema } from '../ExportPage/ExportSchema';
import ExportInner from '../ExportPage/Inner';
// PostExportSummary removed: exports now download directly with a toast
import { buildImportDoc } from './buildImportDoc';
import { ConflictsContext } from './ConflictsManager/ConflictsContext';
import FileDropZone from './FileDropZone';
import { Inner } from './Inner';
import importSchema from './importSchema';
// PostImportSummary removed: after import we just show a toast and reset
import ResolutionsForm, { type Resolutions } from './ResolutionsForm';

type Props = {
  ctx: RenderPageCtx;
  initialMode?: 'import' | 'export';
  hideModeToggle?: boolean;
};

export function ImportPage({
  ctx,
  initialMode = 'import',
  hideModeToggle = false,
}: Props) {
  const exportInitialSelectId = useId();
  const params = new URLSearchParams(ctx.location.search);
  const recipeUrl = params.get('recipe_url');
  const recipeTitle = params.get('recipe_title');
  const [loadingRecipeByUrl, setLoadingRecipeByUrl] = useState(false);

  useEffect(() => {
    async function run() {
      if (!recipeUrl) {
        return;
      }

      try {
        setLoadingRecipeByUrl(true);
        const uri = new URL(recipeUrl);

        const response = await fetch(recipeUrl);
        const body = await response.json();

        const schema = new ExportSchema(body as ExportDoc);
        const fallbackName = uri.pathname.split('/').pop() || 'Imported schema';
        setExportSchema([recipeTitle || fallbackName, schema]);
      } finally {
        setLoadingRecipeByUrl(false);
      }
    }

    run();
  }, [recipeUrl]);

  const [exportSchema, setExportSchema] = useState<
    [string, ExportSchema] | undefined
  >();

  // Local tab to switch between importing a file and exporting from selection
  const [mode, setMode] = useState<'import' | 'export'>(initialMode);

  // Removed postImportSummary: no post-import overview screen

  async function handleDrop(filename: string, doc: ExportDoc) {
    try {
      const schema = new ExportSchema(doc);
      setExportSchema([filename, schema]);
    } catch (e) {
      console.error(e);
      ctx.alert(e instanceof Error ? e.message : 'Invalid export file!');
    }
  }

  const projectSchema = useProjectSchema(ctx);
  const client = projectSchema.client;

  const importTask = useLongTask();
  const exportAllTask = useLongTask();
  const exportPreparingTask = useLongTask();
  const exportSelectionTask = useLongTask();
  const conflictsTask = useLongTask();

  // Removed adminDomain lookup; no post-import summary links needed

  const [exportStarted, setExportStarted] = useState(false);
  const {
    allItemTypes,
    selectedIds: exportInitialItemTypeIds,
    selectedItemTypes: exportInitialItemTypes,
    setSelectedIds: setExportInitialItemTypeIds,
    selectAllModels: handleSelectAllModels,
    selectAllBlocks: handleSelectAllBlocks,
  } = useExportSelection({ schema: projectSchema, enabled: mode === 'export' });

  const {
    conflicts,
    setConflicts,
  } = useConflictsBuilder({
    exportSchema: exportSchema?.[1],
    projectSchema,
    task: conflictsTask.controller,
  });

  const runExportAll = useExportAllHandler({
    ctx,
    schema: projectSchema,
    task: exportAllTask.controller,
  });

  const handleStartExportSelection = () => {
    exportPreparingTask.controller.start({
      label: 'Preparing export…',
    });
    setExportStarted(true);
  };


  // Listen for bottom Cancel action from ConflictsManager
  useEffect(() => {
    const onRequestCancel = async () => {
      if (!exportSchema) return;
      const result = await ctx.openConfirm({
        title: 'Cancel the import?',
        content: `Do you really want to cancel the import process of "${exportSchema[0]}"?`,
        choices: [
          {
            label: 'Yes, cancel the import',
            value: 'yes',
            intent: 'negative',
          },
        ],
        cancel: {
          label: 'Nevermind',
          value: false,
          intent: 'positive',
        },
      });

      if (result === 'yes') {
        setExportSchema(undefined);
      }
    };

    window.addEventListener(
      'import:request-cancel',
      onRequestCancel as unknown as EventListener,
    );
    return () => {
      window.removeEventListener(
        'import:request-cancel',
        onRequestCancel as unknown as EventListener,
      );
    };
  }, [exportSchema, ctx]);

  async function handleImport(resolutions: Resolutions) {
    if (!exportSchema || !conflicts) {
      throw new Error('Invariant');
    }

    try {
      importTask.controller.start({
        done: 0,
        total: 1,
        label: 'Preparing import…',
      });

      const importDoc = await buildImportDoc(
        exportSchema[1],
        conflicts,
        resolutions,
      );

      await importSchema(
        importDoc,
        client,
        (p) => {
          if (!importTask.controller.isCancelRequested()) {
            importTask.controller.setProgress({
              done: p.finished,
              total: p.total,
              label: p.label,
            });
          }
        },
        {
          shouldCancel: () => importTask.controller.isCancelRequested(),
        },
      );

      if (importTask.controller.isCancelRequested()) {
        throw new Error('Import cancelled');
      }

      // Success: notify and reset to initial idle state
      importTask.controller.complete({
        done: importTask.state.progress.total,
        total: importTask.state.progress.total,
        label: 'Import completed',
      });
      ctx.notice('Import completed successfully.');
      setExportSchema(undefined);
      setConflicts(undefined);
    } catch (e) {
      console.error(e);
      if (e instanceof Error && e.message === 'Import cancelled') {
        importTask.controller.complete({ label: 'Import cancelled' });
        ctx.notice('Import canceled');
      } else {
        importTask.controller.fail(e);
        ctx.alert('Import could not be completed successfully.');
      }
    } finally {
      importTask.controller.reset();
    }
  }

  return (
    <Canvas ctx={ctx}>
      <ReactFlowProvider>
        <div className="page">
          {exportSchema
            ? null
            : !hideModeToggle && (
                <div
                  style={{
                    padding: '8px var(--spacing-l)',
                    display: 'flex',
                    alignItems: 'center',
                  }}
                >
                  <div style={{ flex: 1 }} />
                  <div
                    className="mode-toggle"
                    role="tablist"
                    aria-label="Import or Export toggle"
                    data-mode={mode}
                  >
                    <button
                      type="button"
                      role="tab"
                      aria-selected={mode === 'import'}
                      className={`mode-toggle__button ${mode === 'import' ? 'is-active' : ''}`}
                      onClick={() => setMode('import')}
                    >
                      Import
                    </button>
                    <button
                      type="button"
                      role="tab"
                      aria-selected={mode === 'export'}
                      className={`mode-toggle__button ${mode === 'export' ? 'is-active' : ''}`}
                      onClick={() => setMode('export')}
                    >
                      Export
                    </button>
                  </div>
                  <div style={{ flex: 1 }} />
                </div>
              )}
          <div className="page__content">
            {mode === 'import' ? (
              <FileDropZone onJsonDrop={handleDrop}>
                  {(button) =>
                    exportSchema ? (
                      conflicts ? (
                        <ConflictsContext.Provider value={conflicts}>
                          <ResolutionsForm
                            schema={projectSchema}
                            onSubmit={handleImport}
                          >
                            <Inner
                              exportSchema={exportSchema[1]}
                              schema={projectSchema}
                              ctx={ctx}
                            />
                          </ResolutionsForm>
                        </ConflictsContext.Provider>
                      ) : (
                        <Spinner placement="centered" size={60} />
                      )
                    ) : loadingRecipeByUrl ? (
                      <Spinner placement="centered" size={60} />
                    ) : (
                      <div className="blank-slate">
                        <div className="blank-slate__body">
                          <div className="blank-slate__body__title">
                            Upload your schema export file
                          </div>

                          <div className="blank-slate__body__content">
                            <p>
                              Drag and drop your exported JSON file here, or
                              click the button to select one from your computer.
                            </p>
                            {button}
                          </div>
                        </div>
                        <div className="blank-slate__body__outside">
                          {hideModeToggle
                            ? '💡 Need to bulk export your schema? Go to the Export page under Schema.'
                            : '💡 Need to bulk export your schema? Switch to the Export tab above.'}
                        </div>
                      </div>
                    )
                  }
                </FileDropZone>
            ) : (
              <div className="blank-slate">
                {!exportStarted ? (
                  <ExportStartPanel
                    selectId={exportInitialSelectId}
                    itemTypes={allItemTypes}
                    selectedIds={exportInitialItemTypeIds}
                    onSelectedIdsChange={setExportInitialItemTypeIds}
                    onSelectAllModels={handleSelectAllModels}
                    onSelectAllBlocks={handleSelectAllBlocks}
                    onStart={handleStartExportSelection}
                    startDisabled={exportInitialItemTypeIds.length === 0}
                    onExportAll={runExportAll}
                    exportAllDisabled={exportAllTask.state.status === 'running'}
                    footerHint={
                      hideModeToggle
                        ? '💡 Need to bulk export your schema? Go to the Export page under Schema.'
                        : '💡 Need to bulk export your schema? Switch to the Export tab above.'
                    }
                  />
                ) : (
                  <ExportInner
                    initialItemTypes={exportInitialItemTypes}
                    schema={projectSchema}
                    onGraphPrepared={() => {
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
                {/* Fallback note removed per UX request */}
              </div>
            )}
          </div>
        </div>
      </ReactFlowProvider>

      <TaskProgressOverlay
        task={importTask}
        title="Import in progress"
        subtitle={(state) =>
          state.cancelRequested
            ? 'Cancelling import…'
            : 'Sit tight, we’re applying models, fields, and plugins…'
        }
        ariaLabel="Import in progress"
        progressLabel={(progress, state) =>
          state.cancelRequested
            ? 'Stopping at next safe point…'
            : progress.label ?? ''
        }
        cancel={() => ({
          label: 'Cancel import',
          intent: importTask.state.cancelRequested ? 'muted' : 'negative',
          disabled: importTask.state.cancelRequested,
          onCancel: async () => {
            if (!exportSchema) return;
            const result = await ctx.openConfirm({
              title: 'Cancel import in progress?',
              content:
                'Stopping now can leave partial changes in your project. Some models or blocks may be created without relationships, some fields or fieldsets may already exist, and plugin installations or editor settings may be incomplete. You can run the import again to finish or manually clean up. Are you sure you want to cancel?',
              choices: [
                {
                  label: 'Yes, cancel the import',
                  value: 'yes',
                  intent: 'negative',
                },
              ],
              cancel: {
                label: 'Nevermind',
                value: false,
                intent: 'positive',
              },
            });

            if (result === 'yes') {
              importTask.controller.requestCancel();
            }
          },
        })}
      />

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
        task={conflictsTask}
        title="Preparing import"
        subtitle="Sit tight, we’re scanning your export against the project…"
        ariaLabel="Preparing import"
        progressLabel={(progress) => progress.label ?? 'Preparing import…'}
        overlayZIndex={9998}
      />

      <TaskProgressOverlay
        task={exportPreparingTask}
        title="Preparing export"
        subtitle="Sit tight, we’re setting up your models, blocks, and plugins…"
        ariaLabel="Preparing export"
        progressLabel={(progress) => progress.label ?? 'Preparing export…'}
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
