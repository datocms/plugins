import {
  ApiError,
  buildClient,
  type SchemaTypes,
  TimeoutError,
} from '@datocms/cma-client-browser';

export type Environment = SchemaTypes.Environment;
export type EnvironmentFailure = { envId: string; message: string };
export type Progress = { completed: number; total: number };

const CONCURRENCY = 4;

function checkCanceled(signal: AbortSignal) {
  if (signal.aborted)
    throw new DOMException('Operation canceled', 'AbortError');
}

function isUploadMissing(error: unknown): boolean {
  return (
    error instanceof ApiError &&
    error.response.status === 404 &&
    error.errors.length > 0 &&
    error.errors.every((entry) => entry.attributes.code === 'NOT_FOUND')
  );
}

export function describeError(error: unknown): string {
  if (error instanceof ApiError) {
    const code = error.errors[0]?.attributes.code;
    if (code === 'UPLOAD_IS_CURRENTLY_IN_USE') {
      return 'Asset is used by records in this environment and cannot be deleted.';
    }
    return code
      ? `${code} (HTTP ${error.response.status})`
      : `HTTP ${error.response.status}`;
  }
  if (error instanceof TimeoutError) {
    return 'Request timed out. Check this environment.';
  }
  return 'Could not complete the request. Check your connection and access permissions.';
}

/** Allocate promises only for active workers; never queue every environment. */
export async function runEnvironmentTasks<T>(
  environments: Environment[],
  signal: AbortSignal,
  task: (environment: Environment) => Promise<T>,
  onProgress?: (progress: Progress) => void,
): Promise<{ results: T[]; failures: EnvironmentFailure[] }> {
  const results: T[] = [];
  const failures: EnvironmentFailure[] = [];
  let cursor = 0;
  let completed = 0;
  onProgress?.({ completed, total: environments.length });
  const worker = async () => {
    while (cursor < environments.length) {
      checkCanceled(signal);
      const environment = environments[cursor++];
      try {
        // biome-ignore lint/performance/noAwaitInLoops: Each of the four workers must wait before taking another environment.
        const result = await task(environment);
        checkCanceled(signal);
        results.push(result);
      } catch (error) {
        checkCanceled(signal);
        failures.push({ envId: environment.id, message: describeError(error) });
      }
      completed += 1;
      onProgress?.({ completed, total: environments.length });
    }
  };
  await Promise.all(
    Array.from({ length: Math.min(CONCURRENCY, environments.length) }, worker),
  );
  checkCanceled(signal);
  return { results, failures };
}

type Options = {
  apiToken: string;
  baseUrl: string;
  signal: AbortSignal;
};

export function createAssetEnvironmentOperations({
  apiToken,
  baseUrl,
  signal,
}: Options) {
  const clientFor = (environment?: string) =>
    buildClient({ apiToken, baseUrl, environment });

  const otherEnvironments = (environments: Environment[], currentEnv: string) =>
    Array.from(
      new Map(
        environments
          .filter((env) => env.id !== currentEnv)
          .map((env) => [env.id, env]),
      ).values(),
    );

  return {
    // The CMA environment endpoint returns all environments; it is not paginated.
    listEnvironments: () => clientFor().environments.list(),

    async checkEnvironments(
      environments: Environment[],
      uploadId: string,
      currentEnv: string,
      onProgress?: (progress: Progress) => void,
    ) {
      const { results, failures } = await runEnvironmentTasks(
        otherEnvironments(environments, currentEnv),
        signal,
        async (env) => {
          try {
            await clientFor(env.id).uploads.find(uploadId);
            return env;
          } catch (error) {
            if (isUploadMissing(error)) return null;
            throw error;
          }
        },
        onProgress,
      );
      return {
        matches: results.filter((env): env is Environment => env !== null),
        failures,
      };
    },

    async deleteCopies(
      environments: Environment[],
      uploadId: string,
      currentEnv: string,
      onProgress?: (progress: Progress) => void,
    ) {
      const { results, failures } = await runEnvironmentTasks(
        otherEnvironments(environments, currentEnv),
        signal,
        async (env) => {
          try {
            await clientFor(env.id).uploads.destroy(uploadId);
            return { envId: env.id, deleted: true };
          } catch (error) {
            if (isUploadMissing(error))
              return { envId: env.id, deleted: false };
            throw error;
          }
        },
        onProgress,
      );
      return {
        deletedEnvIds: results
          .filter((result) => result.deleted)
          .map((result) => result.envId),
        absentEnvIds: results
          .filter((result) => !result.deleted)
          .map((result) => result.envId),
        failures,
      };
    },
  };
}
