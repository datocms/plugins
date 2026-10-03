import type { RenderPageCtx } from 'datocms-plugin-sdk';
import { useCallback, useRef } from 'react';
import {
  buildExportBlob,
  calculateExportProgressTotal,
} from '@/entrypoints/ExportPage/buildExportDoc';
import { useLongTask } from '@/shared/tasks/useLongTask';
import { downloadBlob } from '@/utils/downloadJson';
import type { ProjectSchema } from '@/utils/ProjectSchema';

type RunExportArgs = {
  rootItemTypeId: string;
  itemTypeIds: string[];
  pluginIds: string[];
  fileName?: string;
};

type UseSchemaExportTaskOptions = {
  schema: ProjectSchema;
  ctx: RenderPageCtx;
  defaultFileName?: string;
};

type SchemaExportTask = {
  runExport: (args: RunExportArgs) => Promise<void>;
  task: ReturnType<typeof useLongTask>;
};

/**
 * Shared helper that wraps export doc building with progress + cancellation handling.
 */
export function useSchemaExportTask({
  schema,
  ctx,
  defaultFileName = 'export.json',
}: UseSchemaExportTaskOptions): SchemaExportTask {
  const task = useLongTask();
  const runningRef = useRef(false);

  const runExport = useCallback(
    async ({
      rootItemTypeId,
      itemTypeIds,
      pluginIds,
      fileName,
    }: RunExportArgs) => {
      if (runningRef.current) return;
      runningRef.current = true;
      try {
        const total = calculateExportProgressTotal(
          new Set(itemTypeIds).size,
          new Set(pluginIds).size,
        );
        task.controller.start({
          done: 0,
          total,
          label: 'Preparing export…',
        });

        const exportBlob = await buildExportBlob(
          schema,
          rootItemTypeId,
          itemTypeIds,
          pluginIds,
          {
            onProgress: (progress) => task.controller.setProgress(progress),
            shouldCancel: () => task.controller.isCancelRequested(),
          },
        );

        if (task.controller.isCancelRequested()) {
          throw new Error('Export cancelled');
        }

        downloadBlob(exportBlob, {
          fileName: fileName ?? defaultFileName,
        });
        task.controller.complete({
          done: total,
          total,
          label: 'Export completed',
        });
        ctx.notice('Export completed successfully.');
      } catch (error) {
        console.error('Schema export failed', error);
        if (error instanceof Error && error.message === 'Export cancelled') {
          task.controller.complete({ label: 'Export cancelled' });
          ctx.notice('Export canceled');
        } else {
          task.controller.fail(error);
          ctx.alert('Could not complete the export. Please try again.');
        }
      } finally {
        runningRef.current = false;
        task.controller.reset();
      }
    },
    [ctx, defaultFileName, schema, task.controller],
  );

  return { runExport, task };
}
