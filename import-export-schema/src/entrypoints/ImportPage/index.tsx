import { ReactFlowProvider } from '@xyflow/react';
import type { RenderPageCtx } from 'datocms-plugin-sdk';
import { useCallback, useMemo, useRef, useState } from 'react';
import { TaskOverlayStack } from '@/components/TaskOverlayStack';
import { useConflictsBuilder } from '@/shared/hooks/useConflictsBuilder';
import { useProjectSchema } from '@/shared/hooks/useProjectSchema';
import {
  type UseLongTaskResult,
  useLongTask,
} from '@/shared/tasks/useLongTask';
import type { ProjectSchema } from '@/utils/ProjectSchema';
import type { ExportDoc } from '@/utils/types';
import { ExportSchema } from '../ExportPage/ExportSchema';
import { buildImportDoc } from './buildImportDoc';
import { ImportWorkflow } from './ImportWorkflow';
import importSchema from './importSchema';
import type { Resolutions } from './ResolutionsForm';
import { useRecipeLoader } from './useRecipeLoader';

type Props = {
  ctx: RenderPageCtx;
};

function isImportCancelled(error: unknown) {
  return error instanceof Error && error.message === 'Import cancelled';
}

function importFailureMessage(error: unknown) {
  // The detail is the message of the error, without its final period
  const detail = (error instanceof Error ? error.message : '')
    .trim()
    .replace(/\.+$/, '');
  const failure = detail
    ? `The import failed: ${detail}.`
    : 'The import failed.';
  return `${failure} The changes made so far stay in the project.`;
}

type ImportModeState = {
  exportSchema: [string, ExportSchema] | undefined;
  conflicts: ReturnType<typeof useConflictsBuilder>['conflicts'];
  conflictsError: Error | undefined;
  refreshConflicts: () => void;
  loadingRecipe: boolean;
  handleDrop: (filename: string, doc: ExportDoc) => Promise<void>;
  handleImport: (resolutions: Resolutions) => Promise<void>;
  requestClose: () => void;
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
}: {
  ctx: RenderPageCtx;
  projectSchema: ProjectSchema;
}): ImportModeState {
  const importTask = useLongTask();
  const conflictsTask = useLongTask();
  const importingRef = useRef(false);
  const [exportSchema, setExportSchema] = useState<
    [string, ExportSchema] | undefined
  >();

  const {
    conflicts,
    setConflicts,
    refresh: refreshConflicts,
    error: conflictsError,
  } = useConflictsBuilder({
    exportSchema: exportSchema?.[1],
    projectSchema,
    task: conflictsTask.controller,
  });

  const client = projectSchema.client;

  const handleRecipeLoaded = useCallback(
    ({ label, schema }: { label: string; schema: ExportSchema }) => {
      setExportSchema([label, schema]);
    },
    [],
  );

  const handleRecipeError = useCallback(
    (error: unknown) => {
      console.error('Failed to load shared export recipe', error);
      ctx.alert('The shared export could not be loaded.');
    },
    [ctx],
  );

  const { loading: loadingRecipe } = useRecipeLoader(ctx, handleRecipeLoaded, {
    onError: handleRecipeError,
  });

  const handleDrop = useCallback(
    async (filename: string, doc: ExportDoc) => {
      try {
        const schema = new ExportSchema(doc);
        setExportSchema([filename, schema]);
      } catch (error) {
        console.error(error);
        ctx.alert(
          error instanceof Error
            ? error.message
            : 'This file is not a schema export.',
        );
      }
    },
    [ctx],
  );

  const handleImport = useCallback(
    async (resolutions: Resolutions) => {
      if (importingRef.current) return;
      if (!exportSchema || !conflicts) {
        throw new Error('Invariant');
      }

      importingRef.current = true;

      try {
        // The share is not known until the import counts its steps: the
        // dialog shows a spinner with the label until then
        importTask.controller.start({ label: 'Preparing the import…' });

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

        importTask.controller.complete({ label: 'Import completed' });
        ctx.notice('Schema imported.');
        setExportSchema(undefined);
        setConflicts(undefined);
      } catch (error) {
        console.error(error);
        if (isImportCancelled(error)) {
          importTask.controller.complete({ label: 'Import cancelled' });
          ctx.notice(
            'Import stopped. The changes made so far stay in the project.',
          );
        } else {
          importTask.controller.fail(error);
          ctx.alert(importFailureMessage(error));
        }
      } finally {
        importingRef.current = false;
        projectSchema.invalidate();
        refreshConflicts();
        importTask.controller.reset();
      }
    },
    [
      client,
      conflicts,
      ctx,
      exportSchema,
      importTask,
      setConflicts,
      projectSchema,
      refreshConflicts,
    ],
  );

  // The chevron of the review: the choices go with the file, thus it asks
  const requestClose = useCallback(async () => {
    if (!exportSchema) return;
    const result = await ctx.openConfirm({
      title: 'Choose another file?',
      content: `Your choices for “${exportSchema[0]}” will be lost.`,
      choices: [
        {
          label: 'Discard choices',
          value: 'yes',
          intent: 'negative',
        },
      ],
      cancel: {
        label: 'Cancel',
        value: false,
      },
    });

    if (result === 'yes') {
      setExportSchema(undefined);
    }
  }, [ctx, exportSchema]);

  return {
    exportSchema,
    conflicts,
    conflictsError,
    refreshConflicts,
    loadingRecipe,
    handleDrop,
    handleImport,
    requestClose,
    importTask,
    conflictsTask,
  };
}

type OverlayConfig = Parameters<typeof TaskOverlayStack>[0]['items'][number];

function isTaskActive(task: UseLongTaskResult) {
  return task.state.status === 'running' || task.state.status === 'cancelling';
}

/**
 * The import page of the Schema settings: the choice of the file, the
 * comparison with the project, the review of the conflicts and the import.
 */
export function ImportPage({ ctx }: Props) {
  const projectSchema = useProjectSchema(ctx);
  const importMode = useImportMode({ ctx, projectSchema });
  const { exportSchema, importTask } = importMode;

  const overlayItems = useMemo(
    () => [buildImportOverlay(ctx, importTask, exportSchema)],
    [ctx, exportSchema, importTask],
  );

  return (
    <>
      <ReactFlowProvider>
        <ImportWorkflow
          ctx={ctx}
          projectSchema={projectSchema}
          exportSchema={exportSchema}
          loadingRecipe={importMode.loadingRecipe}
          conflicts={importMode.conflicts}
          conflictsError={importMode.conflictsError}
          onRetryConflicts={importMode.refreshConflicts}
          onDrop={importMode.handleDrop}
          onImport={importMode.handleImport}
          dropDisabled={isTaskActive(importTask)}
          preparingProgress={importMode.conflictsTask.state.progress}
          onRequestClose={importMode.requestClose}
        />
      </ReactFlowProvider>

      {/* The dialog of the import: it blocks the page while it runs */}
      <TaskOverlayStack items={overlayItems} />
    </>
  );
}

/**
 * The dialog shown while the CMA import runs. Its cancel asks first, because
 * a stopped import leaves its changes in the project.
 */
function buildImportOverlay(
  ctx: RenderPageCtx,
  importTask: UseLongTaskResult,
  exportSchema: [string, ExportSchema] | undefined,
): OverlayConfig {
  return {
    id: 'import',
    task: importTask,
    title: 'Importing the schema',
    subtitle: (state) =>
      state.cancelRequested ? 'Stopping the import…' : undefined,
    progressLabel: (progress, state) =>
      state.cancelRequested
        ? 'Stopping at the next safe step…'
        : (progress.label ?? ''),
    cancel: (state) =>
      state.cancelRequested
        ? undefined
        : {
            onCancel: async () => {
              if (!exportSchema) return;
              const result = await ctx.openConfirm({
                title: 'Stop the import?',
                content:
                  'The changes made so far stay in the project: some models or blocks may lack their relationships, some fields or fieldsets may already exist, and plugins may be only partly set up.',
                choices: [
                  {
                    label: 'Stop the import',
                    value: 'yes',
                    intent: 'negative',
                  },
                ],
                cancel: {
                  label: 'Keep importing',
                  value: false,
                },
              });

              if (result === 'yes') {
                importTask.controller.requestCancel();
              }
            },
          },
  };
}
