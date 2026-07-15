import { mkdirSync } from 'node:fs';
import { loginAndSaveState } from '../steps/dato-auth';
import { PROVIDERS } from '../fixtures/providers';
import { configureEnvForProvider, resolvePluginId } from './plugin-params';
import { dropEnvsIfPresent, sweepStaleEnvs } from './cleanup';
import { resetOutcomes } from './outcomes';
import { forkAll } from './fork-environments';
import { requireEnv } from './env';
import { RESTRICTED_STORAGE_STATE, RUN_ID } from './constants';
import { phase } from './log';

/** Where the shared authenticated session is persisted (gitignored). */
export const STORAGE_STATE = 'e2e/.auth/state.json';

/**
 * One-time provisioning before the suite runs:
 *   1. validate env (fail fast),
 *   2. ensure the dev-URL plugin is installed in `main`,
 *   3. reap stale `e2e-*` envs from earlier runs,
 *   4. fast-fork one sandbox env per active provider (those with a key set),
 *   5. pin each env's plugin to its provider (env-scoped params),
 *   6. log in once and persist the session for every project,
 *   7. (optional) log in as the restricted-role user, when configured.
 */
const globalSetup = async (): Promise<void> => {
  const lanes = PROVIDERS.map((p) => p.vendor).join(', ') || '(none)';
  phase(`run ${RUN_ID} — ${PROVIDERS.length} provider lane(s): ${lanes}`);

  phase('validating .env.testing…');
  requireEnv();
  resetOutcomes(); // clear the per-test outcome ledger the teardown reads

  phase('ensuring the dev-URL plugin is installed in main…');
  await resolvePluginId(); // installs the dev-URL plugin in `main` if absent

  phase('sweeping stale e2e-* environments from earlier runs…');
  await sweepStaleEnvs();

  const envNames = PROVIDERS.map((p) => p.envName);
  phase(`dropping any same-named leftovers: ${envNames.join(', ')}`);
  await dropEnvsIfPresent(envNames); // clear any same-named leftovers from an aborted run

  phase(`fast-forking ${envNames.length} sandbox env(s) from main…`);
  await forkAll(envNames);

  phase('pinning each env to its provider (model resolved live)…');
  await Promise.all(PROVIDERS.map((p) => configureEnvForProvider(p.envName, p)));

  mkdirSync('e2e/.auth', { recursive: true });
  phase('logging in to the project admin and saving the session…');
  await loginAndSaveState(STORAGE_STATE);

  // Optional: a restricted-role dashboard user, used by the locale-scope test
  // (§9.4-5). Absent credentials are not an error — that test just skips.
  const env = requireEnv();
  if (env.E2E_RESTRICTED_EMAIL && env.E2E_RESTRICTED_PASSWORD) {
    phase('logging in as the restricted-role user and saving its session…');
    await loginAndSaveState(RESTRICTED_STORAGE_STATE, {
      email: env.E2E_RESTRICTED_EMAIL,
      password: env.E2E_RESTRICTED_PASSWORD,
    });
  } else {
    phase('no restricted-role credentials configured — skipping (locale-scope test will skip)');
  }

  phase('setup complete — handing off to the suite');
};

export default globalSetup;
