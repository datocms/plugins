import { ReactFlowProvider } from '@xyflow/react';
import type { RenderPageCtx } from 'datocms-plugin-sdk';
import { Canvas } from 'datocms-react-ui';
import { useCallback, useEffect, useMemo, useState } from 'react';
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
}: {
  ctx: RenderPageCtx;
  projectSchema: ProjectSchema;
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
          error instanceof Error ? error.message : 'Invalid export file!',
        );
      }
    },
    [ctx],
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
    [
      client,
      conflicts,
      ctx,
      exportSchema,
      importTask,
      setConflicts,
      setExportSchema,
    ],
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

type OverlayItemsArgs = {
  ctx: RenderPageCtx;
  exportSchema: [string, ExportSchema] | undefined;
  importTask: UseLongTaskResult;
  conflictsTask: UseLongTaskResult;
};

/**
 * Coalesces the overlay stack configuration used by `TaskOverlayStack`. Keeping the builder
 * in one place clarifies which long tasks participate in the UI at any moment.
 */
function useOverlayItems({
  ctx,
  exportSchema,
  importTask,
  conflictsTask,
}: OverlayItemsArgs) {
  return useMemo(
    () => [
      buildImportOverlay(ctx, importTask, exportSchema),
      buildConflictsOverlay(conflictsTask),
    ],
    [ctx, exportSchema, importTask, conflictsTask],
  );
}

/**
 * Unified import entrypoint rendered inside the Schema sidebar page. Handles file drops
 * and conflict resolution for schema imports.
 */
export function ImportPage({ ctx }: Props) {
  const projectSchema = useProjectSchema(ctx);
  const importMode = useImportMode({ ctx, projectSchema });

  const overlayItems = useOverlayItems({
    ctx,
    exportSchema: importMode.exportSchema,
    importTask: importMode.importTask,
    conflictsTask: importMode.conflictsTask,
  });

  return (
    <Canvas ctx={ctx}>
      <ReactFlowProvider>
        <div className="page">
          <div className="page__content">
            <ImportWorkflow
              ctx={ctx}
              projectSchema={projectSchema}
              exportSchema={importMode.exportSchema}
              loadingRecipe={importMode.loadingRecipe}
              conflicts={importMode.conflicts}
              onDrop={importMode.handleDrop}
              onImport={importMode.handleImport}
            />
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
      state.cancelRequested
        ? 'Stopping at next safe point…'
        : (progress.label ?? ''),
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
 * Overlay used while conflicts between project and recipe are resolved.
 */
function buildConflictsOverlay(
  conflictsTask: UseLongTaskResult,
): OverlayConfig {
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
