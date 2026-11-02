import { ApiError, TimeoutError } from '@datocms/cma-client';
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
import { isPermissionError, isTakenApiKeyError } from '@/utils/apiError';
import type { ProjectSchema } from '@/utils/ProjectSchema';
import type { ExportDoc } from '@/utils/types';
import { ExportSchema, olderExportMessage } from '../ExportPage/ExportSchema';
import { buildImportDoc } from './buildImportDoc';
import { ImportWorkflow } from './ImportWorkflow';
import importSchema from './importSchema';
import type { Resolutions } from './ResolutionsForm';
import { notAnExportMessage } from './useJsonFileInput';
import { useRecipeLoader } from './useRecipeLoader';

type Props = {
  ctx: RenderPageCtx;
};

function isImportCancelled(error: unknown) {
  return error instanceof Error && error.message === 'Import cancelled';
}

// Every message about a stopped import tells what it leaves behind
const leftInProject = 'What was imported so far stays in the project.';
// The review compares the file with the project again: what was imported
// now shows as conflicts
const importAgain =
  'What was imported so far stays in the project: resolve any conflicts in the review, then import again.';

/**
 * The toast of a failed import, in plain words: the request and the body of
 * the API error go to the console only.
 */
function importFailureMessage(error: unknown) {
  if (isTakenApiKeyError(error)) {
    return `The import stopped: an API key of the file is already used in this project. ${importAgain}`;
  }
  if (isPermissionError(error)) {
    return `The import stopped: you don't have permission to change the schema. ${leftInProject} Ask an administrator for access.`;
  }
  if (error instanceof ApiError) {
    return `The import stopped: DatoCMS refused one of the changes. ${importAgain}`;
  }
  // No answer from DatoCMS: a failed fetch or a request that timed out
  if (error instanceof TypeError || error instanceof TimeoutError) {
    return `The import stopped: check your connection. ${importAgain}`;
  }
  // A check of the file or of the import itself: importing again won't help
  return `The import stopped before the end. ${leftInProject}`;
}

type ImportModeState = {
  exportSchema: [string, ExportSchema] | undefined;
  conflicts: ReturnType<typeof useConflictsBuilder>['conflicts'];
  conflictsError: Error | undefined;
  refreshConflicts: () => void;
  loadingRecipe: boolean;
  handleDrop: (filename: string, doc: ExportDoc) => Promise<void>;
  handleImport: (resolutions: Resolutions) => Promise<void>;
  requestClose: (hasChoices: boolean) => void;
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
      ctx.alert(
        'The shared export could not be loaded. The link may have expired: choose the file from your computer instead.',
      );
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
        // The reason goes to the console: the user needs another file, or a
        // new export of an old one
        console.error(error);
        ctx.alert(
          error instanceof Error && error.message === olderExportMessage
            ? olderExportMessage
            : notAnExportMessage,
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
        ctx.notice(`Schema imported from “${exportSchema[0]}”.`);
        setExportSchema(undefined);
        setConflicts(undefined);
      } catch (error) {
        console.error(error);
        if (isImportCancelled(error)) {
          importTask.controller.complete({ label: 'Import cancelled' });
          ctx.notice(`Import stopped. ${leftInProject}`);
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
  // first, when the user made some
  const requestClose = useCallback(
    async (hasChoices: boolean) => {
      if (!exportSchema) return;
      if (hasChoices) {
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
        if (result !== 'yes') return;
      }

      setExportSchema(undefined);
    },
    [ctx, exportSchema],
  );

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
    // One line tells the stop: the progress keeps the last step
    subtitle: (state) =>
      state.cancelRequested
        ? 'Stopping the import after the current step…'
        : undefined,
    progressLabel: (progress) => progress.label ?? '',
    stallMessage:
      'DatoCMS is slowing things down for a moment. The import continues on its own.',
    cancel: (state) =>
      state.cancelRequested
        ? undefined
        : {
            onCancel: async () => {
              if (!exportSchema) return;
              const result = await ctx.openConfirm({
                title: 'Stop the import?',
                content:
                  'What was imported so far stays in the project and may be incomplete.',
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
