import { appendFileSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';

/**
 * Per-test outcome ledger. The JSON reporter's `results.json` is written *after*
 * `globalTeardown` runs, so the result-gated teardown can't read it. Instead each
 * test appends its outcome here from `afterEach` (which runs during the test
 * phase), and `globalTeardown` reads the completed ledger.
 */
const OUTCOMES_FILE = 'e2e/test-results/outcomes.jsonl';

/** Truncate the ledger at the start of a run (called from global-setup). */
export const resetOutcomes = (): void => {
  mkdirSync('e2e/test-results', { recursive: true });
  writeFileSync(OUTCOMES_FILE, '');
};

/** Append one test's outcome, keyed by its Playwright project name (the vendor). */
export const recordOutcome = (project: string, ok: boolean): void => {
  appendFileSync(OUTCOMES_FILE, `${JSON.stringify({ project, ok })}\n`);
};

/** Reduce the ledger to a per-project "every test passed (or skipped)" map. */
export const readPassedProjects = (): Map<string, boolean> => {
  const out = new Map<string, boolean>();
  let text = '';
  try {
    text = readFileSync(OUTCOMES_FILE, 'utf8');
  } catch {
    return out;
  }
  for (const line of text.split('\n').filter(Boolean)) {
    const { project, ok } = JSON.parse(line) as { project: string; ok: boolean };
    out.set(project, (out.get(project) ?? true) && ok);
  }
  return out;
};
