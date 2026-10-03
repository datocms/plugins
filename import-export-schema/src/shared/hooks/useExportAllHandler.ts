import type { RenderPageCtx } from 'datocms-plugin-sdk';
import { useCallback, useRef } from 'react';
import {
  buildExportBlob,
  calculateExportProgressTotal,
} from '@/entrypoints/ExportPage/buildExportDoc';
import type { LongTaskController } from '@/shared/tasks/useLongTask';
import { downloadBlob } from '@/utils/downloadJson';
import type { ProjectSchema } from '@/utils/ProjectSchema';

type Options = {
  ctx: RenderPageCtx;
  schema: ProjectSchema;
  task: LongTaskController;
};

function throwIfExportCancelled(task: LongTaskController): void {
  if (task.isCancelRequested()) throw new Error('Export cancelled');
}

/**
 * Returns a memoized handler that exports the entire schema with confirmation + progress.
 */
export function useExportAllHandler({ ctx, schema, task }: Options) {
  const runningRef = useRef(false);
  return useCallback(async () => {
    if (runningRef.current) return;
    runningRef.current = true;
    try {
      const confirmation = await ctx.openConfirm({
        title: 'Export entire schema?',
        content:
          'This will export all models, block models, and plugins in the current environment as a single JSON file.',
        choices: [
          {
            label: 'Export everything',
            value: 'export',
            intent: 'positive',
          },
        ],
        cancel: { label: 'Cancel', value: false },
      });
      if (confirmation !== 'export') {
        return;
      }

      task.start({ label: 'Preparing export…' });
      const allTypes = await schema.getAllItemTypes();
      throwIfExportCancelled(task);
      const allPlugins = await schema.getAllPlugins();
      throwIfExportCancelled(task);
      if (!allTypes.length) {
        task.reset();
        ctx.alert('No item types found in this environment.');
        return;
      }
      // Use the first regular model as root to match older exports; fall back to any.
      const preferredRoot =
        allTypes.find((t) => !t.attributes.modular_block) || allTypes[0];
      const total = calculateExportProgressTotal(
        allTypes.length,
        allPlugins.length,
      );
      task.setProgress({ done: 0, total, label: 'Preparing export…' });
      const exportBlob = await buildExportBlob(
        schema,
        preferredRoot.id,
        allTypes.map((t) => t.id),
        allPlugins.map((p) => p.id),
        {
          onProgress: (progress) => task.setProgress(progress),
          shouldCancel: () => task.isCancelRequested(),
        },
      );
      throwIfExportCancelled(task);
      downloadBlob(exportBlob, {
        fileName: 'export.json',
      });
      task.complete({ done: total, total, label: 'Export completed' });
      ctx.notice('Export completed successfully.');
    } catch (error) {
      console.error('Export-all failed', error);
      if (error instanceof Error && error.message === 'Export cancelled') {
        task.complete({ label: 'Export cancelled' });
        ctx.notice('Export canceled');
      } else {
        task.fail(error);
        ctx.alert('Could not export the current schema. Please try again.');
      }
    } finally {
      runningRef.current = false;
      task.reset();
    }
  }, [ctx, schema, task]);
}
