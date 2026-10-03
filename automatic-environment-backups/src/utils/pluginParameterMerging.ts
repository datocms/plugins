import { readAuthSecret, readDeploymentUrl } from '../config/pluginParams';

const isObject = (value: unknown): value is Record<string, unknown> =>
  typeof value === 'object' && value !== null && !Array.isArray(value);

export const toPluginParameterRecord = (
  value: unknown,
): Record<string, unknown> => {
  return isObject(value) ? { ...value } : {};
};

export const mergePluginParameterUpdates = (
  latestParameters: unknown,
  updates: Record<string, unknown>,
): Record<string, unknown> => {
  return {
    ...toPluginParameterRecord(latestParameters),
    ...updates,
  };
};

type ExpectedConnection = { secret: string; url: string };

type PluginParameterPersisterOptions = {
  initialParameters: unknown;
  /** Return undefined only when no token is available for an authoritative read. */
  readLatest: () => Promise<Record<string, unknown> | undefined>;
  write: (parameters: Record<string, unknown>) => Promise<void>;
};

/**
 * Serialize parameter writes and merge each update against a fresh read. Read
 * failures reject without writing: falling back after an error could overwrite
 * newer state written by the scheduled function. Without read credentials, only
 * successfully persisted values may become the fallback merge base.
 */
export const createPluginParameterPersister = ({
  initialParameters,
  readLatest,
  write,
}: PluginParameterPersisterOptions) => {
  let successfulParameters = toPluginParameterRecord(initialParameters);
  let queue: Promise<void> = Promise.resolve();

  return (
    updates: Record<string, unknown>,
    expectedConnection?: ExpectedConnection,
  ): Promise<Record<string, unknown> | undefined> => {
    const pendingUpdates = { ...updates };
    const connection = expectedConnection && { ...expectedConnection };
    const persistTask = async () => {
      const latestParameters = (await readLatest()) ?? successfulParameters;

      // A health request may finish after the user changed credentials. Do not
      // attach that result to the newly saved connection.
      if (
        connection &&
        (readAuthSecret(latestParameters) !== connection.secret ||
          readDeploymentUrl(latestParameters) !== connection.url)
      ) {
        return undefined;
      }

      const merged = mergePluginParameterUpdates(
        latestParameters,
        pendingUpdates,
      );
      // Credential saves invalidate the connection against authoritative
      // values. Guarded health results may also normalize the saved URL.
      if (
        ('lambdaAuthSecret' in pendingUpdates &&
          readAuthSecret(merged) !== readAuthSecret(latestParameters)) ||
        (!connection &&
          ['deploymentURL', 'netlifyURL', 'vercelURL'].some(
            (key) => key in pendingUpdates,
          ) &&
          readDeploymentUrl(merged) !== readDeploymentUrl(latestParameters))
      ) {
        merged.lambdaConnection = null;
        merged.connectionValidationMode = null;
      }
      await write(merged);
      successfulParameters = merged;
      return merged;
    };

    const pendingPersist = queue.then(persistTask);
    // A failed operation rejects its caller, while later queued saves can still
    // run. Their authoritative read is attempted independently.
    queue = pendingPersist.then(
      () => undefined,
      () => undefined,
    );
    return pendingPersist;
  };
};
