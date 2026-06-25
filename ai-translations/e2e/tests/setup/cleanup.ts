import { cmaClient } from './cma';
import { ENV_MAX_AGE_DAYS, ENV_NAME_PREFIX, RUN_ID } from './constants';
import { destroyEnv } from './fork-environments';
import { note, warn } from './log';

const MS_PER_DAY = 86_400_000;

/**
 * Destroy stale `e2e-*` environments older than {@link ENV_MAX_AGE_DAYS},
 * skipping the current run's (matched by {@link RUN_ID}). This is the safety net
 * that reaps orphaned envs left by a crashed run — with per-run (random) env
 * names those never collide with a later run, so age is the only thing that can
 * reclaim them. Age comes from the environment's server-side `meta.created_at`
 * (the random name encodes no time), so a concurrent run's envs — created within
 * the last minutes, far newer than the cutoff — are never swept. Best-effort: a
 * failed delete is logged, not thrown, so it can never redden a run.
 */
export const sweepStaleEnvs = async (): Promise<void> => {
  const envs = await cmaClient().environments.list();
  const cutoff = Date.now() - ENV_MAX_AGE_DAYS * MS_PER_DAY;

  for (const env of envs) {
    if (!env.id.startsWith(ENV_NAME_PREFIX)) continue;
    if (env.id.endsWith(`-${RUN_ID}`)) continue; // never this run's
    const createdMs = Date.parse(env.meta.created_at ?? '');
    if (!Number.isFinite(createdMs) || createdMs >= cutoff) continue;
    try {
      await destroyEnv(env.id);
      note(env.id, 'swept (stale)');
    } catch (error) {
      warn(env.id, `could not sweep: ${(error as Error).message}`);
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
