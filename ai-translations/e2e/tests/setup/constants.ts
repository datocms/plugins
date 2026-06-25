import { requireEnv } from './env';

/**
 * One per-run id shared by EVERY process of a single `playwright test`
 * invocation: the unix time in seconds at which the run started.
 *
 * Why route it through an env var instead of just calling `Date.now()` at import?
 * Playwright re-imports this module in each worker process — and again for global
 * setup/teardown — each a separate Node process that starts seconds apart.
 * Computing the id per process would diverge: `global-setup` would fork
 * `e2e-openai-<t1>` while a worker, spawned seconds later, would navigate to
 * `e2e-openai-<t2>`. So the FIRST process to load this module (the main runner,
 * during config evaluation, before any worker is forked) stamps the id into
 * `process.env.E2E_RUN_ID`; the workers Playwright forks afterwards inherit that
 * env and reuse the same value. Set `E2E_RUN_ID` yourself (shell or `.env.testing`)
 * to pin a run — e.g. in CI, or to re-attach cleanup to a crashed run's envs.
 *
 * Unix-seconds granularity keeps concurrent developers' runs apart: two runs
 * would have to start within the same wall-clock second to collide. Orphaned envs
 * from a crashed run are reaped by the next run's age-based sweep, which reads
 * each env's server-side `meta.created_at` rather than parsing the name — so the
 * suffix's shape never affects cleanup (see {@link ENV_MAX_AGE_DAYS} and
 * `cleanup.ts`).
 */
const resolveRunId = (): string => {
  const pinned = process.env.E2E_RUN_ID?.trim();
  if (pinned) return pinned;
  const id = String(Math.floor(Date.now() / 1000));
  process.env.E2E_RUN_ID = id; // propagate to the worker processes forked later
  return id;
};

export const RUN_ID = resolveRunId();

/** Shared prefix for every environment this suite creates. */
export const ENV_NAME_PREFIX = 'e2e-';

/** Source environment that forks are taken from. */
export const PRIMARY_ENV = 'main';

/** Age cutoff (days) for the stale-environment sweep. */
export const ENV_MAX_AGE_DAYS = 1;

/** Named timeouts shared across setup waits and test steps. */
export const TIMEOUTS = {
  thirty_sec: 30_000,
  one_min: 60_000,
  three_min: 180_000,
  five_min: 300_000,
  ten_min: 600_000,
  // Generous budget for a whole-record translation on a slow / rate-limited
  // provider (e.g. Gemini free tier backing off across a kitchen-sink record).
  twelve_min: 720_000,
} as const;

/** Numeric project id (account-API/site id) of the E2E project. */
export const PROJECT_ID = (): string => requireEnv().E2E_PROJECT_ID;

/** Dashboard subdomain, e.g. `ai-translation-e2e` → `<sub>.admin.datocms.com`. */
export const PROJECT_SUBDOMAIN = (): string => requireEnv().E2E_PROJECT_SUBDOMAIN;
