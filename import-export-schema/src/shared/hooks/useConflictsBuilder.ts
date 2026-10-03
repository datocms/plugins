import { useCallback, useEffect, useState } from 'react';
import type { ExportSchema } from '@/entrypoints/ExportPage/ExportSchema';
import buildConflicts, {
  type Conflicts,
} from '@/entrypoints/ImportPage/ConflictsManager/buildConflicts';
import type { LongTaskController } from '@/shared/tasks/useLongTask';
import type { ProjectSchema } from '@/utils/ProjectSchema';

function preparationError(error: unknown): Error {
  return error instanceof Error
    ? error
    : new Error('Could not prepare the import.');
}

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
  const [error, setError] = useState<Error | undefined>();
  const [refreshKey, setRefreshKey] = useState(0);

  // Rebuild conflicts whenever the export document, schema, or refresh key changes.
  // biome-ignore lint/correctness/useExhaustiveDependencies: refreshKey explicitly requests a new scan.
  useEffect(() => {
    if (!exportSchema) {
      setConflicts(undefined);
      setError(undefined);
      task.reset();
      return;
    }
    let cancelled = false;
    async function run() {
      let failed = false;
      try {
        setConflicts(undefined);
        setError(undefined);
        task.start({ done: 0, total: 1, label: 'Preparing import…' });
        const result = await buildConflicts(
          exportSchema as ExportSchema,
          projectSchema,
          (p) => {
            if (!cancelled) {
              task.setProgress(p);
            }
          },
          { shouldCancel: () => cancelled },
        );
        if (cancelled) return;
        setConflicts(result);
      } catch (error) {
        failed = true;
        if (cancelled) return;
        task.fail(error);
        setError(preparationError(error));
        setConflicts(undefined);
      } finally {
        if (!cancelled && !failed) {
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

  return { conflicts, setConflicts, refresh, error };
}
