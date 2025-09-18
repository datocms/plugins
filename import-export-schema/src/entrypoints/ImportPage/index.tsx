import { ReactFlowProvider } from '@xyflow/react';
import type { RenderPageCtx } from 'datocms-plugin-sdk';
import { Canvas } from 'datocms-react-ui';
import { useCallback, useEffect, useId, useMemo, useState } from 'react';
import { TaskOverlayStack } from '@/components/TaskOverlayStack';
import { useConflictsBuilder } from '@/shared/hooks/useConflictsBuilder';
import { useExportAllHandler } from '@/shared/hooks/useExportAllHandler';
import { useExportSelection } from '@/shared/hooks/useExportSelection';
import { useProjectSchema } from '@/shared/hooks/useProjectSchema';
import { useSchemaExportTask } from '@/shared/hooks/useSchemaExportTask';
import { useLongTask, type UseLongTaskResult } from '@/shared/tasks/useLongTask';
import type { ExportDoc } from '@/utils/types';
import { ExportSchema } from '../ExportPage/ExportSchema';
import { ExportWorkflow, type ExportWorkflowPrepareProgress } from './ExportWorkflow';
import { ImportWorkflow } from './ImportWorkflow';
import { buildImportDoc } from './buildImportDoc';
import type { Resolutions } from './ResolutionsForm';
import { useRecipeLoader } from './useRecipeLoader';
import importSchema from './importSchema';

type Props = {
  ctx: RenderPageCtx;
  initialMode?: 'import' | 'export';
  hideModeToggle?: boolean;
};

type ModeToggleProps = {
  mode: 'import' | 'export';
  onChange: (mode: 'import' | 'export') => void;
};

function ModeToggle({ mode, onChange }: ModeToggleProps) {
  return (
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
          onClick={() => onChange('import')}
        >
          Import
        </button>
        <button
          type="button"
          role="tab"
          aria-selected={mode === 'export'}
          className={`mode-toggle__button ${mode === 'export' ? 'is-active' : ''}`}
          onClick={() => onChange('export')}
        >
          Export
        </button>
      </div>
      <div style={{ flex: 1 }} />
    </div>
  );
}

/**
 * Unified Import/Export entrypoint rendered inside the Schema sidebar page. Handles
 * file drops, conflict resolution, and the alternate export tab.
 */
export function ImportPage({
  ctx,
  initialMode = 'import',
  hideModeToggle = false,
}: Props) {
  const exportInitialSelectId = useId();
  const [mode, setMode] = useState<'import' | 'export'>(initialMode);
  const [exportSchema, setExportSchema] = useState<
    [string, ExportSchema] | undefined
  >();
  const [exportStarted, setExportStarted] = useState(false);

  const projectSchema = useProjectSchema(ctx);
  const client = projectSchema.client;

  const importTask = useLongTask();
  const exportAllTask = useLongTask();
  const exportPreparingTask = useLongTask();
  const { task: exportSelectionTask, runExport: runSelectionExport } =
    useSchemaExportTask({
      schema: projectSchema,
      ctx,
    });
  const conflictsTask = useLongTask();

  const {
    allItemTypes,
    selectedIds: exportInitialItemTypeIds,
    selectedItemTypes: exportInitialItemTypes,
    setSelectedIds: setExportInitialItemTypeIds,
  } = useExportSelection({ schema: projectSchema, enabled: mode === 'export' });

  const { conflicts, setConflicts } = useConflictsBuilder({
    exportSchema: exportSchema?.[1],
    projectSchema,
    task: conflictsTask.controller,
  });

  const handleRecipeLoaded = useCallback(
    ({ label, schema }: { label: string; schema: ExportSchema }) => {
      setExportSchema([label, schema]);
      setMode('import');
    },
    [],
  );

  const handleRecipeError = useCallback(
    (error: unknown) => {
      console.error('Failed to load shared export recipe', error);
      ctx.alert('Could not load the shared export recipe.');
    },
    [ctx],
  );

  const { loading: loadingRecipeByUrl } = useRecipeLoader(
    ctx,
    handleRecipeLoaded,
    { onError: handleRecipeError },
  );

  const handleDrop = useCallback(
    async (filename: string, doc: ExportDoc) => {
      try {
        const schema = new ExportSchema(doc);
        setExportSchema([filename, schema]);
        setMode('import');
      } catch (error) {
        console.error(error);
        ctx.alert(error instanceof Error ? error.message : 'Invalid export file!');
      }
    },
    [ctx],
  );

  const runExportAll = useExportAllHandler({
    ctx,
    schema: projectSchema,
    task: exportAllTask.controller,
  });

  const handleStartExportSelection = useCallback(() => {
    exportPreparingTask.controller.start({
      label: 'Preparing export…',
    });
    setExportStarted(true);
  }, [exportPreparingTask.controller]);

  const handleExportGraphPrepared = useCallback(() => {
    exportPreparingTask.controller.complete({
      label: 'Graph prepared',
    });
  }, [exportPreparingTask.controller]);

  const handleExportPrepareProgress = useCallback(
    (progress: ExportWorkflowPrepareProgress) => {
      if (exportPreparingTask.state.status !== 'running') {
        exportPreparingTask.controller.start(progress);
      } else {
        exportPreparingTask.controller.setProgress(progress);
      }
    },
    [exportPreparingTask.controller, exportPreparingTask.state.status],
  );

  const handleExportClose = useCallback(() => {
    setExportStarted(false);
    exportPreparingTask.controller.reset();
  }, [exportPreparingTask.controller]);

  const handleExportSelection = useCallback(
    (itemTypeIds: string[], pluginIds: string[]) => {
      if (exportInitialItemTypeIds.length === 0) {
        return;
      }
      runSelectionExport({
        rootItemTypeId: exportInitialItemTypeIds[0],
        itemTypeIds,
        pluginIds,
      });
    },
    [exportInitialItemTypeIds, runSelectionExport],
  );

  const handleImport = useCallback(
    async (resolutions: Resolutions) => {
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
          (progress) => {
            if (!importTask.controller.isCancelRequested()) {
              importTask.controller.setProgress({
                done: progress.finished,
                total: progress.total,
                label: progress.label,
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

        importTask.controller.complete({
          done: importTask.state.progress.total,
          total: importTask.state.progress.total,
          label: 'Import completed',
        });
        ctx.notice('Import completed successfully.');
        setExportSchema(undefined);
        setConflicts(undefined);
      } catch (error) {
        console.error(error);
        if (error instanceof Error && error.message === 'Import cancelled') {
          importTask.controller.complete({ label: 'Import cancelled' });
          ctx.notice('Import canceled');
        } else {
          importTask.controller.fail(error);
          ctx.alert('Import could not be completed successfully.');
        }
      } finally {
        importTask.controller.reset();
      }
    },
    [client, conflicts, ctx, exportSchema, importTask, setConflicts],
  );

  useEffect(() => {
    const handleCancelRequest = async () => {
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
      handleCancelRequest as unknown as EventListener,
    );
    return () => {
      window.removeEventListener(
        'import:request-cancel',
        handleCancelRequest as unknown as EventListener,
      );
    };
  }, [ctx, exportSchema]);

  const overlayItems = useMemo(
    () => [
      buildImportOverlay(ctx, importTask, exportSchema),
      buildExportAllOverlay(exportAllTask),
      buildConflictsOverlay(conflictsTask),
      buildExportPrepOverlay(exportPreparingTask),
      buildExportSelectionOverlay(exportSelectionTask),
    ],
    [
      ctx,
      exportSchema,
      importTask,
      exportAllTask,
      conflictsTask,
      exportPreparingTask,
      exportSelectionTask,
    ],
  );

  return (
    <Canvas ctx={ctx}>
      <ReactFlowProvider>
        <div className="page">
          {exportSchema || hideModeToggle ? null : (
            <ModeToggle mode={mode} onChange={setMode} />
          )}
          <div className="page__content">
            {mode === 'import' ? (
              <ImportWorkflow
                ctx={ctx}
                projectSchema={projectSchema}
                exportSchema={exportSchema}
                loadingRecipe={loadingRecipeByUrl}
                conflicts={conflicts}
                onDrop={handleDrop}
                onImport={handleImport}
              />
            ) : (
              <ExportWorkflow
                projectSchema={projectSchema}
                exportStarted={exportStarted}
                exportInitialSelectId={exportInitialSelectId}
                allItemTypes={allItemTypes}
                exportInitialItemTypeIds={exportInitialItemTypeIds}
                exportInitialItemTypes={exportInitialItemTypes}
                setSelectedIds={setExportInitialItemTypeIds}
                onStart={handleStartExportSelection}
                onExportAll={runExportAll}
                exportAllDisabled={exportAllTask.state.status === 'running'}
                onGraphPrepared={handleExportGraphPrepared}
                onPrepareProgress={handleExportPrepareProgress}
                onClose={handleExportClose}
                onExportSelection={handleExportSelection}
              />
            )}
          </div>
        </div>
      </ReactFlowProvider>

      <TaskOverlayStack items={overlayItems} />
    </Canvas>
  );
}

type OverlayConfig = Parameters<typeof TaskOverlayStack>[0]['items'][number];

function buildImportOverlay(
  ctx: RenderPageCtx,
  importTask: UseLongTaskResult,
  exportSchema: [string, ExportSchema] | undefined,
): OverlayConfig {
  return {
    id: 'import',
    task: importTask,
    title: 'Import in progress',
    subtitle: (state) =>
      state.cancelRequested
        ? 'Cancelling import…'
        : 'Sit tight, we’re applying models, fields, and plugins…',
    ariaLabel: 'Import in progress',
    progressLabel: (progress, state) =>
      state.cancelRequested ? 'Stopping at next safe point…' : progress.label ?? '',
    cancel: () => ({
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
    }),
  };
}

function buildExportAllOverlay(exportAllTask: UseLongTaskResult): OverlayConfig {
  return {
    id: 'export-all',
    task: exportAllTask,
    title: 'Exporting entire schema',
    subtitle: 'Sit tight, we’re gathering models, blocks, and plugins…',
    ariaLabel: 'Export in progress',
    progressLabel: (progress) => progress.label ?? 'Loading project schema…',
    cancel: () => ({
      label: 'Cancel export',
      intent: exportAllTask.state.cancelRequested ? 'muted' : 'negative',
      disabled: exportAllTask.state.cancelRequested,
      onCancel: () => exportAllTask.controller.requestCancel(),
    }),
  };
}

function buildConflictsOverlay(conflictsTask: UseLongTaskResult): OverlayConfig {
  return {
    id: 'conflicts',
    task: conflictsTask,
    title: 'Preparing import',
    subtitle: 'Sit tight, we’re scanning your export against the project…',
    ariaLabel: 'Preparing import',
    progressLabel: (progress) => progress.label ?? 'Preparing import…',
    overlayZIndex: 9998,
  };
}

function buildExportPrepOverlay(exportPreparingTask: UseLongTaskResult): OverlayConfig {
  return {
    id: 'export-prep',
    task: exportPreparingTask,
    title: 'Preparing export',
    subtitle: 'Sit tight, we’re setting up your models, blocks, and plugins…',
    ariaLabel: 'Preparing export',
    progressLabel: (progress) => progress.label ?? 'Preparing export…',
  };
}

function buildExportSelectionOverlay(
  exportSelectionTask: UseLongTaskResult,
): OverlayConfig {
  return {
    id: 'export-selection',
    task: exportSelectionTask,
    title: 'Exporting selection',
    subtitle: 'Sit tight, we’re gathering models, blocks, and plugins…',
    ariaLabel: 'Export in progress',
    progressLabel: (progress) => progress.label ?? 'Preparing export…',
    cancel: () => ({
      label: 'Cancel export',
      intent: exportSelectionTask.state.cancelRequested ? 'muted' : 'negative',
      disabled: exportSelectionTask.state.cancelRequested,
      onCancel: () => exportSelectionTask.controller.requestCancel(),
    }),
  };
}
