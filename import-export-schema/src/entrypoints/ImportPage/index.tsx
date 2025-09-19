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
import type { ProjectSchema } from '@/utils/ProjectSchema';
import type { ExportDoc } from '@/utils/types';
import { ExportSchema } from '../ExportPage/ExportSchema';
import { ExportWorkflow, type ExportWorkflowPrepareProgress, type ExportWorkflowView } from './ExportWorkflow';
import { ImportWorkflow } from './ImportWorkflow';
import { buildImportDoc } from './buildImportDoc';
import type { Resolutions } from './ResolutionsForm';
import { useRecipeLoader } from './useRecipeLoader';
import importSchema from './importSchema';

type Mode = 'import' | 'export';

type Props = {
  ctx: RenderPageCtx;
  initialMode?: Mode;
};

type ImportModeState = {
  exportSchema: [string, ExportSchema] | undefined;
  conflicts: ReturnType<typeof useConflictsBuilder>['conflicts'];
  loadingRecipe: boolean;
  handleDrop: (filename: string, doc: ExportDoc) => Promise<void>;
  handleImport: (resolutions: Resolutions) => Promise<void>;
  importTask: UseLongTaskResult;
  conflictsTask: UseLongTaskResult;
};

/**
 * Encapsulates the import tab lifecycle: loading shared recipes, reacting to file drops,
 * resolving conflicts, and driving the long-running CMA import task.
 */
function useImportMode({
  ctx,
  projectSchema,
  setMode,
}: {
  ctx: RenderPageCtx;
  projectSchema: ProjectSchema;
  setMode: (mode: Mode) => void;
}): ImportModeState {
  const importTask = useLongTask();
  const conflictsTask = useLongTask();
  const [exportSchema, setExportSchema] = useState<
    [string, ExportSchema] | undefined
  >();

  const { conflicts, setConflicts } = useConflictsBuilder({
    exportSchema: exportSchema?.[1],
    projectSchema,
    task: conflictsTask.controller,
  });

  const client = projectSchema.client;

  const handleRecipeLoaded = useCallback(
    ({ label, schema }: { label: string; schema: ExportSchema }) => {
      setExportSchema([label, schema]);
      setMode('import');
    },
    [setMode],
  );

  const handleRecipeError = useCallback(
    (error: unknown) => {
      console.error('Failed to load shared export recipe', error);
      ctx.alert('Could not load the shared export recipe.');
    },
    [ctx],
  );

  const { loading: loadingRecipe } = useRecipeLoader(
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
    [ctx, setMode],
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
    [client, conflicts, ctx, exportSchema, importTask, setConflicts, setExportSchema],
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
  }, [ctx, exportSchema, setExportSchema]);

  return {
    exportSchema,
    conflicts,
    loadingRecipe,
    handleDrop,
    handleImport,
    importTask,
    conflictsTask,
  };
}

type ExportModeState = {
  exportInitialSelectId: string;
  exportView: ExportWorkflowView;
  allItemTypes: ReturnType<typeof useExportSelection>['allItemTypes'];
  exportInitialItemTypeIds: string[];
  exportInitialItemTypes: ReturnType<typeof useExportSelection>['selectedItemTypes'];
  setSelectedIds: (ids: string[]) => void;
  runExportAll: () => void;
  exportAllTask: UseLongTaskResult;
  exportPreparingTask: UseLongTaskResult;
  exportSelectionTask: UseLongTaskResult;
  handleShowExportSelection: () => void;
  handleBackToLanding: () => void;
  handleStartExportSelection: () => void;
  handleExportGraphPrepared: () => void;
  handleExportPrepareProgress: (progress: ExportWorkflowPrepareProgress) => void;
  handleExportClose: () => void;
  handleExportSelection: (itemTypeIds: string[], pluginIds: string[]) => void;
};

/**
 * Bundles export-specific state so the main component only forwards data to `ExportWorkflow`.
 * This hook manages the selection flow, long tasks, and status transitions required to render
 * landing/selection/graph screens.
 */
function useExportMode({
  ctx,
  projectSchema,
  mode,
}: {
  ctx: RenderPageCtx;
  projectSchema: ProjectSchema;
  mode: Mode;
}): ExportModeState {
  const exportInitialSelectId = useId();
  const [exportView, setExportView] = useState<ExportWorkflowView>('landing');

  const exportAllTask = useLongTask();
  const exportPreparingTask = useLongTask();
  const { task: exportSelectionTask, runExport: runSelectionExport } =
    useSchemaExportTask({
      schema: projectSchema,
      ctx,
    });

  const {
    allItemTypes,
    selectedIds: exportInitialItemTypeIds,
    selectedItemTypes: exportInitialItemTypes,
    setSelectedIds,
  } = useExportSelection({ schema: projectSchema, enabled: mode === 'export' });

  const runExportAll = useExportAllHandler({
    ctx,
    schema: projectSchema,
    task: exportAllTask.controller,
  });

  useEffect(() => {
    setExportView('landing');
    exportPreparingTask.controller.reset();
  }, [mode, exportPreparingTask.controller]);

  const handleShowExportSelection = useCallback(() => {
    setExportView('selection');
  }, []);

  const handleStartExportSelection = useCallback(() => {
    if (exportInitialItemTypeIds.length === 0) {
      return;
    }
    exportPreparingTask.controller.start({
      label: 'Preparing export…',
    });
    setExportView('graph');
  }, [exportInitialItemTypeIds, exportPreparingTask.controller]);

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
    setExportView('selection');
    exportPreparingTask.controller.reset();
  }, [exportPreparingTask.controller]);

  const handleBackToLanding = useCallback(() => {
    setExportView('landing');
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

  return {
    exportInitialSelectId,
    exportView,
    allItemTypes,
    exportInitialItemTypeIds,
    exportInitialItemTypes,
    setSelectedIds,
    runExportAll,
    exportAllTask,
    exportPreparingTask,
    exportSelectionTask,
    handleShowExportSelection,
    handleBackToLanding,
    handleStartExportSelection,
    handleExportGraphPrepared,
    handleExportPrepareProgress,
    handleExportClose,
    handleExportSelection,
  };
}

type OverlayItemsArgs = {
  ctx: RenderPageCtx;
  exportSchema: [string, ExportSchema] | undefined;
  importTask: UseLongTaskResult;
  exportAllTask: UseLongTaskResult;
  conflictsTask: UseLongTaskResult;
  exportPreparingTask: UseLongTaskResult;
  exportSelectionTask: UseLongTaskResult;
};

/**
 * Coalesces the overlay stack configuration used by `TaskOverlayStack`. Keeping the builder
 * in one place clarifies which long tasks participate in the UI at any moment.
 */
function useOverlayItems({
  ctx,
  exportSchema,
  importTask,
  exportAllTask,
  conflictsTask,
  exportPreparingTask,
  exportSelectionTask,
}: OverlayItemsArgs) {
  return useMemo(
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
}

/**
 * Unified Import/Export entrypoint rendered inside the Schema sidebar page. Handles
 * file drops, conflict resolution, and still supports the legacy export view when
 * the page is instantiated in export mode.
 */
export function ImportPage({
  ctx,
  initialMode = 'import',
}: Props) {
  const projectSchema = useProjectSchema(ctx);
  const [mode, setMode] = useState<Mode>(initialMode);

  const importMode = useImportMode({ ctx, projectSchema, setMode });
  const exportMode = useExportMode({ ctx, projectSchema, mode });

  const overlayItems = useOverlayItems({
    ctx,
    exportSchema: importMode.exportSchema,
    importTask: importMode.importTask,
    exportAllTask: exportMode.exportAllTask,
    conflictsTask: importMode.conflictsTask,
    exportPreparingTask: exportMode.exportPreparingTask,
    exportSelectionTask: exportMode.exportSelectionTask,
  });

  return (
    <Canvas ctx={ctx}>
      <ReactFlowProvider>
        <div className="page">
          <div className="page__content">
            {mode === 'import' ? (
              <ImportWorkflow
                ctx={ctx}
                projectSchema={projectSchema}
                exportSchema={importMode.exportSchema}
                loadingRecipe={importMode.loadingRecipe}
                conflicts={importMode.conflicts}
                onDrop={importMode.handleDrop}
                onImport={importMode.handleImport}
              />
            ) : (
              <ExportWorkflow
                projectSchema={projectSchema}
                view={exportMode.exportView}
                exportInitialSelectId={exportMode.exportInitialSelectId}
                allItemTypes={exportMode.allItemTypes}
                exportInitialItemTypeIds={exportMode.exportInitialItemTypeIds}
                exportInitialItemTypes={exportMode.exportInitialItemTypes}
                setSelectedIds={exportMode.setSelectedIds}
                onShowSelection={exportMode.handleShowExportSelection}
                onBackToLanding={exportMode.handleBackToLanding}
                onStartSelection={exportMode.handleStartExportSelection}
                onExportAll={exportMode.runExportAll}
                exportAllDisabled={
                  exportMode.exportAllTask.state.status === 'running'
                }
                onGraphPrepared={exportMode.handleExportGraphPrepared}
                onPrepareProgress={exportMode.handleExportPrepareProgress}
                onClose={exportMode.handleExportClose}
                onExportSelection={exportMode.handleExportSelection}
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

/**
 * Overlay shown while the CMA import runs. Allows cancelling with a confirmation when an
 * export recipe is currently loaded.
 */
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

/**
 * Overlay displayed when the "export everything" action is running.
 */
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

/**
 * Overlay used while conflicts between project and recipe are resolved.
 */
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

/**
 * Overlay surfaced as the graph view prepares the export content for preview.
 */
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

/**
 * Overlay tied to the selection-based export task started from the graph view.
 */
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
