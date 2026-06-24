import { requireEnv } from './env';

/**
 * One compact run id per process, ≤ 12 chars (`YYMMDDHHmmss`), so the full env
 * name `e2e-<ts>-openai` stays within DatoCMS's 24-char environment-id cap.
 * Computed once at import so every fork/cleanup in the run shares it.
 */
export const TIMESTAMP = new Date()
  .toISOString() // 2026-06-24T11:22:33.444Z
  .replace(/[^0-9]/g, '') // 20260624112233444
  .slice(2, 14); // 260624112233 (12 chars)

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
} as const;

/** Numeric project id (account-API/site id) of the E2E project. */
export const PROJECT_ID = (): string => requireEnv().E2E_PROJECT_ID;

/** Dashboard subdomain, e.g. `ai-translation-e2e` → `<sub>.admin.datocms.com`. */
export const PROJECT_SUBDOMAIN = (): string => requireEnv().E2E_PROJECT_SUBDOMAIN;
