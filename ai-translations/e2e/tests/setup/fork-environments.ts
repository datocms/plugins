import { cmaClient } from './cma';
import { PRIMARY_ENV, TIMEOUTS } from './constants';

/** Poll an environment until it reports `ready`, bounded by `TIMEOUTS.five_min`. */
export const waitForEnvReady = async (envName: string): Promise<void> => {
  const client = cmaClient();
  const deadline = Date.now() + TIMEOUTS.five_min;
  for (;;) {
    const env = await client.environments.find(envName);
    if (env.meta.status === 'ready') return;
    if (Date.now() > deadline) {
      throw new Error(
        `Environment ${envName} not ready after 5 min (status=${env.meta.status}, ` +
          `${env.meta.fork_completion_percentage ?? 0}%)`,
      );
    }
    await new Promise((resolve) => setTimeout(resolve, 3000));
  }
};

/** Destroy a single environment by id. */
export const destroyEnv = async (envName: string): Promise<void> => {
  await cmaClient().environments.destroy(envName);
};

/**
 * Fast-fork each `envName` from the primary environment.
 *
 * Fast forking requires the source to be read-only, so the project is put into
 * maintenance mode first and — critically — taken back out in a `finally`, even
 * if a fork throws, so the project can never be left locked. `immediate_return`
 * lets all three forks start before we poll them to `ready` concurrently.
 */
export const forkAll = async (envNames: string[]): Promise<void> => {
  const client = cmaClient();
  await client.maintenanceMode.activate({ force: true });
  try {
    for (const id of envNames) {
      await client.environments.fork(
        PRIMARY_ENV,
        { id },
        { fast: true, force: true, immediate_return: true },
      );
    }
    await Promise.all(envNames.map(waitForEnvReady));
  } finally {
    await client.maintenanceMode.deactivate();
  }
};
