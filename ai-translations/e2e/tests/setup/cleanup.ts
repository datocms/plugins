import { cmaClient } from './cma';
import { ENV_MAX_AGE_DAYS, ENV_NAME_PREFIX, TIMESTAMP } from './constants';
import { destroyEnv } from './fork-environments';

const MS_PER_DAY = 86_400_000;

/**
 * Parse the `YYMMDDHHmmss` run id out of an env name like
 * `e2e-260624112233-openai` into epoch ms; `NaN` if it doesn't match.
 */
const runTimestampMs = (envId: string): number => {
  const match = envId.match(/^e2e-(\d{2})(\d{2})(\d{2})(\d{2})(\d{2})(\d{2})-/);
  if (!match) return Number.NaN;
  const [, yy, mo, dd, hh, mi, ss] = match;
  return Date.parse(`20${yy}-${mo}-${dd}T${hh}:${mi}:${ss}Z`);
};

/**
 * Destroy stale `e2e-*` environments older than {@link ENV_MAX_AGE_DAYS},
 * skipping the current run's (matched by {@link TIMESTAMP}). Best-effort: a
 * failed delete is logged, not thrown, so it can never redden a run.
 */
export const sweepStaleEnvs = async (): Promise<void> => {
  const envs = await cmaClient().environments.list();
  const cutoff = Date.now() - ENV_MAX_AGE_DAYS * MS_PER_DAY;

  for (const env of envs) {
    if (!env.id.startsWith(ENV_NAME_PREFIX)) continue;
    if (env.id.includes(`-${TIMESTAMP}-`)) continue; // never this run's
    const ts = runTimestampMs(env.id);
    if (!Number.isFinite(ts) || ts >= cutoff) continue;
    try {
      await destroyEnv(env.id);
      console.log(`swept stale env ${env.id}`);
    } catch (error) {
      console.warn(`could not sweep ${env.id}: ${(error as Error).message}`);
    }
  }
};

/**
 * Best-effort drop of same-named leftovers before a fork (e.g. a prior run in
 * the same second that aborted after forking). Missing envs and delete errors
 * are ignored — this only clears the way for {@link forkAll}.
 */
export const dropEnvsIfPresent = async (envNames: string[]): Promise<void> => {
  const existing = new Set((await cmaClient().environments.list()).map((e) => e.id));
  for (const name of envNames) {
    if (!existing.has(name)) continue;
    try {
      await destroyEnv(name);
    } catch {
      // ignore — fork will surface a real collision if the delete truly failed
    }
  }
};

/**
 * Destroy the given environments, attempting all and throwing an aggregate on
 * failure — a green run that can't clean up after itself must fail loud.
 */
export const destroyRunEnvs = async (envNames: string[]): Promise<void> => {
  const failures: string[] = [];
  for (const name of envNames) {
    try {
      await destroyEnv(name);
    } catch (error) {
      failures.push(`${name}: ${(error as Error).message}`);
    }
  }
  if (failures.length > 0) {
    throw new Error(`Environment teardown failed:\n  ${failures.join('\n  ')}`);
  }
};
