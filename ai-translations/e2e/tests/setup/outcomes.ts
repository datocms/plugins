import { appendFileSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { RUN_ID } from './constants';

/**
 * Per-test outcome ledger. The JSON reporter's `results.json` is written *after*
 * `globalTeardown` runs, so the result-gated teardown can't read it. Instead each
 * test appends its outcome here from `afterEach` (which runs during the test
 * phase), and `globalTeardown` reads the completed ledger.
 *
 * The path is RUN_ID-namespaced: two concurrent runs from the same checkout
 * would otherwise truncate/interleave one shared file, and a teardown reading a
 * mixed ledger could destroy an env whose lane actually failed (or keep ones
 * that passed). RUN_ID is stamped once per invocation and inherited by every
 * worker + the teardown process (see constants.ts).
 */
const OUTCOMES_FILE = `e2e/test-results/outcomes-${RUN_ID}.jsonl`;

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
