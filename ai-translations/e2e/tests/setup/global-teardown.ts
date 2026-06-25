import { PROVIDERS } from '../fixtures/providers';
import { destroyEnv } from './fork-environments';
import { note, phase, warn } from './log';
import { readPassedProjects } from './outcomes';

/**
 * Destroy a provider's environment only if every test in its project passed (or
 * was skipped); leave failed projects' envs in place for debugging (the
 * stale-env sweep reaps them on the next run). Reads the per-test outcome ledger
 * (`outcomes.jsonl`) rather than the JSON report, which Playwright writes only
 * *after* globalTeardown runs.
 */
const globalTeardown = async (): Promise<void> => {
  const passedByProject = readPassedProjects();
  if (passedByProject.size === 0) {
    phase('empty outcome ledger — leaving all envs for the sweep', 'teardown');
    return;
  }

  phase('destroying envs of passed projects; keeping failed ones for debugging', 'teardown');
  for (const provider of PROVIDERS) {
    if (passedByProject.get(provider.vendor)) {
      try {
        await destroyEnv(provider.envName);
        note(provider.vendor, `destroyed ${provider.envName} (project passed)`);
      } catch (error) {
        warn(provider.vendor, `could not destroy ${provider.envName}: ${(error as Error).message}`);
      }
    } else {
      note(provider.vendor, `keeping ${provider.envName} (project failed) for debugging`);
    }
  }
};

export default globalTeardown;
