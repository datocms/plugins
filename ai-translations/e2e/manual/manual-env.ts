/**
 * manual-env.ts
 * -------------
 * Naming rules shared by the two manual-sandbox scripts (`fork.ts`, `cleanup.ts`).
 */

/**
 * Prefix for every manually-forked sandbox.
 *
 * Deliberately NOT `e2e-`: the suite's stale sweep (`tests/setup/cleanup.ts`)
 * destroys any `e2e-*` environment older than a day that isn't the current run's.
 * A manual sandbox is meant to outlive a test run, so it must fall outside that
 * filter — hence `manual-e2e-` rather than `e2e-manual-`. It is reclaimed only by
 * `npm run test:e2e:manual:cleanup`.
 */
export const MANUAL_ENV_PREFIX = 'manual-e2e-';

/**
 * Name for a fresh sandbox: `manual-e2e-<unix-seconds>`.
 *
 * The stamp is computed here rather than reusing the suite's `RUN_ID`, which is
 * pinnable via `E2E_RUN_ID` — inheriting a pinned value would make two manual
 * runs collide on one environment name.
 */
export const manualEnvName = (): string =>
  `${MANUAL_ENV_PREFIX}${Math.floor(Date.now() / 1000)}`;

/**
 * True for environments `cleanup.ts` is allowed to destroy. The length guard
 * keeps a bare `manual-e2e` (no stamp) — which this script never creates — out of
 * the blast radius.
 */
export const isManualEnv = (envId: string): boolean =>
  envId.startsWith(MANUAL_ENV_PREFIX) && envId.length > MANUAL_ENV_PREFIX.length;
