import { mkdirSync } from 'node:fs';
import { loginAndSaveState } from '../steps/dato-auth';
import { PROVIDERS } from '../fixtures/providers';
import { configureEnvForProvider, resolvePluginId } from './plugin-params';
import { dropEnvsIfPresent, sweepStaleEnvs } from './cleanup';
import { forkAll } from './fork-environments';
import { requireEnv } from './env';

/** Where the shared authenticated session is persisted (gitignored). */
export const STORAGE_STATE = 'e2e/.auth/state.json';

/**
 * One-time provisioning before the suite runs:
 *   1. validate env (fail fast),
 *   2. ensure the dev-URL plugin is installed in `main`,
 *   3. reap stale `e2e-*` envs from earlier runs,
 *   4. fast-fork one sandbox env per provider,
 *   5. pin each env's plugin to its provider (env-scoped params),
 *   6. log in once and persist the session for all three projects.
 */
const globalSetup = async (): Promise<void> => {
  requireEnv();
  await resolvePluginId(); // installs the dev-URL plugin in `main` if absent
  await sweepStaleEnvs();

  const envNames = PROVIDERS.map((p) => p.envName);
  await dropEnvsIfPresent(envNames); // clear any same-named leftovers from an aborted run
  await forkAll(envNames);
  await Promise.all(PROVIDERS.map((p) => configureEnvForProvider(p.envName, p)));

  mkdirSync('e2e/.auth', { recursive: true });
  await loginAndSaveState(STORAGE_STATE);
};

export default globalSetup;
