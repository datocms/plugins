import type { RenderPageCtx } from 'datocms-plugin-sdk';
import { useCallback, useRef } from 'react';
import {
  buildExportBlob,
  calculateExportProgressTotal,
} from '@/entrypoints/ExportPage/buildExportDoc';
import type { LongTaskController } from '@/shared/tasks/useLongTask';
import { describeSchemaReadError } from '@/utils/apiError';
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
 * Returns a memoized handler that exports the entire schema with progress.
 * It starts at once: the download changes nothing, and the Cancel of its
 * dialog stops it.
 */
export function useExportAllHandler({ ctx, schema, task }: Options) {
  const runningRef = useRef(false);
  return useCallback(async () => {
    if (runningRef.current) return;
    runningRef.current = true;
    try {
      task.start({ label: 'Loading the project schema…' });
      const allTypes = await schema.getAllItemTypes();
      throwIfExportCancelled(task);
      const allPlugins = await schema.getAllPlugins();
      throwIfExportCancelled(task);
      if (!allTypes.length) {
        task.reset();
        ctx.alert('This environment has no models or blocks to export.');
        return;
      }
      // Use the first regular model as root to match older exports; fall back to any.
      const preferredRoot =
        allTypes.find((t) => !t.attributes.modular_block) || allTypes[0];
      const total = calculateExportProgressTotal(
        allTypes.length,
        allPlugins.length,
      );
      task.setProgress({ done: 0, total, label: 'Preparing the export…' });
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
      const fileName = 'export.json';
      downloadBlob(exportBlob, { fileName });
      task.complete({ done: total, total, label: 'Export completed' });
      ctx.notice(`Schema downloaded as ${fileName}.`);
    } catch (error) {
      console.error('Export-all failed', error);
      if (error instanceof Error && error.message === 'Export cancelled') {
        task.complete({ label: 'Export cancelled' });
        ctx.notice('Export cancelled.');
      } else {
        task.fail(error);
        ctx.alert(
          `The schema could not be exported. ${describeSchemaReadError(error)}`,
        );
      }
    } finally {
      runningRef.current = false;
      task.reset();
    }
  }, [ctx, schema, task]);
}
