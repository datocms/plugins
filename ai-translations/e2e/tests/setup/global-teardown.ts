import { readFileSync } from 'node:fs';
import { PROVIDERS } from '../fixtures/providers';
import { destroyEnv } from './fork-environments';

/** Recursively collect every test's `(projectName, ok)` from the JSON report. */
type JsonSuite = {
  specs?: Array<{
    tests?: Array<{ projectName?: string; results?: Array<{ status?: string }> }>;
  }>;
  suites?: JsonSuite[];
};

const collectProjectStatus = (suite: JsonSuite, out: Map<string, boolean>): void => {
  for (const spec of suite.specs ?? []) {
    for (const t of spec.tests ?? []) {
      const project = t.projectName ?? '';
      const ok = (t.results ?? []).every((r) => r.status === 'expected' || r.status === 'skipped');
      out.set(project, (out.get(project) ?? true) && ok);
    }
  }
  for (const child of suite.suites ?? []) collectProjectStatus(child, out);
};

/**
 * Destroy a provider's environment only if that provider's project had zero
 * failures; leave failed projects' envs in place for debugging (the stale-env
 * age-sweep reaps them later). If the JSON report is unreadable, destroy
 * nothing — never blindly tear down after an unknown outcome.
 */
const globalTeardown = async (): Promise<void> => {
  let report: JsonSuite;
  try {
    report = JSON.parse(readFileSync('e2e/test-results/results.json', 'utf8')) as JsonSuite;
  } catch {
    console.warn('global-teardown: no results.json — leaving all envs for the age-sweep.');
    return;
  }

  const passedByProject = new Map<string, boolean>();
  collectProjectStatus(report, passedByProject);

  for (const provider of PROVIDERS) {
    const passed = passedByProject.get(provider.vendor);
    if (passed) {
      try {
        await destroyEnv(provider.envName);
        console.log(`global-teardown: destroyed ${provider.envName} (project passed)`);
      } catch (error) {
        console.warn(`global-teardown: could not destroy ${provider.envName}: ${(error as Error).message}`);
      }
    } else {
      console.log(`global-teardown: keeping ${provider.envName} (project failed or unknown) for debugging`);
    }
  }
};

export default globalTeardown;
