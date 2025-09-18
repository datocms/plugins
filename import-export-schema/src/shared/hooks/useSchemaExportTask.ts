import type { RenderPageCtx } from 'datocms-plugin-sdk';
import { useCallback } from 'react';
import buildExportDoc from '@/entrypoints/ExportPage/buildExportDoc';
import { useLongTask } from '@/shared/tasks/useLongTask';
import { downloadJSON } from '@/utils/downloadJson';
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

  const runExport = useCallback(
    async ({
      rootItemTypeId,
      itemTypeIds,
      pluginIds,
      fileName,
    }: RunExportArgs) => {
      try {
        const total = pluginIds.length + itemTypeIds.length * 2;
        task.controller.start({
          done: 0,
          total,
          label: 'Preparing export…',
        });
        let done = 0;

        const exportDoc = await buildExportDoc(
          schema,
          rootItemTypeId,
          itemTypeIds,
          pluginIds,
          {
            onProgress: (label: string) => {
              done += 1;
              task.controller.setProgress({ done, total, label });
            },
            shouldCancel: () => task.controller.isCancelRequested(),
          },
        );

        if (task.controller.isCancelRequested()) {
          throw new Error('Export cancelled');
        }

        downloadJSON(exportDoc, {
          fileName: fileName ?? defaultFileName,
          prettify: true,
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
        task.controller.reset();
      }
    },
    [ctx, defaultFileName, schema, task.controller],
  );

  return { runExport, task };
}
