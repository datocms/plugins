import { useCallback, useEffect, useState } from 'react';
import type { ExportSchema } from '@/entrypoints/ExportPage/ExportSchema';
import buildConflicts, {
  type Conflicts,
} from '@/entrypoints/ImportPage/ConflictsManager/buildConflicts';
import type { LongTaskController } from '@/shared/tasks/useLongTask';
import type { ProjectSchema } from '@/utils/ProjectSchema';

/**
 * Builds the import conflict summary in the background while providing a
 * reusable `refresh` helper and progress reporting via `LongTask`.
 */
export function useConflictsBuilder({
  exportSchema,
  projectSchema,
  task,
}: {
  exportSchema: ExportSchema | undefined;
  projectSchema: ProjectSchema;
  task: LongTaskController;
}) {
  const [conflicts, setConflicts] = useState<Conflicts | undefined>();
  const [refreshKey, setRefreshKey] = useState(0);

  // Rebuild conflicts whenever the export document, schema, or refresh key changes.
  useEffect(() => {
    let cancelled = false;
    async function run() {
      if (!exportSchema) {
        setConflicts(undefined);
        return;
      }
      try {
        task.start({ done: 0, total: 1, label: 'Preparing import…' });
        const result = await buildConflicts(
          exportSchema,
          projectSchema,
          (p) => {
            if (!cancelled) {
              task.setProgress(p);
            }
          },
        );
        if (cancelled) return;
        setConflicts(result);
      } finally {
        if (!cancelled) {
          task.complete({ label: 'Conflicts ready' });
          task.reset();
        }
      }
    }
    run();
    return () => {
      cancelled = true;
    };
  }, [exportSchema, projectSchema, task, refreshKey]);

  const refresh = useCallback(() => setRefreshKey((key) => key + 1), []);

  return { conflicts, setConflicts, refresh };
}
