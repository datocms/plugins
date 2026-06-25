import { test } from '@playwright/test';

/**
 * Tiny progress logger for the E2E suite. The provider matrix runs every lane
 * concurrently, so interleaved output is only legible when each line carries its
 * lane tag and an elapsed clock. All faces share one line format:
 *
 *   `[<tag> +12.3s] message`   e.g. `[anthropic +5.1s] ▶ save the record`
 *
 * Two faces:
 *   - {@link phase}/{@link note}/{@link warn} print immediately to stdout. This is
 *     the real-time terminal feed and the *only* option inside `globalSetup` /
 *     `globalTeardown`, which run outside any test (so `test.step` is unavailable).
 *   - {@link step} additionally wraps the work in a Playwright `test.step`, so the
 *     same milestones appear named + timed in the HTML report, the trace viewer,
 *     and `--ui` mode. Because the `list` reporter only prints a step once it
 *     *completes*, `step` also emits an entry breadcrumb via {@link note} — that
 *     breadcrumb is what tells a watching tester "this is happening now" before
 *     the long (≤10 min) translation / bulk waits.
 */

const START = Date.now();

/** Seconds since the suite process started, e.g. `+12.3s`. */
const clock = (): string => `+${((Date.now() - START) / 1000).toFixed(1)}s`;

const fmt = (tag: string, message: string): string => `[${tag} ${clock()}] ${message}`;

/** A setup/teardown phase line. `tag` defaults to `setup`; teardown passes `teardown`. */
export const phase = (message: string, tag = 'setup'): void => {
  console.log(fmt(tag, message));
};

/** A lane-scoped progress line — `tag` is the vendor (or an env name). */
export const note = (tag: string, message: string): void => {
  console.log(fmt(tag, message));
};

/** A lane-scoped warning, for best-effort failures that must not redden a run. */
export const warn = (tag: string, message: string): void => {
  console.warn(fmt(tag, message));
};

/**
 * Run `body` as a vendor-tagged Playwright `test.step` (named + timed in the
 * report / trace / UI) and emit an immediate terminal breadcrumb on entry.
 * Returns whatever `body` resolves to.
 */
export const step = async <T>(
  vendor: string,
  title: string,
  body: () => Promise<T>,
): Promise<T> => {
  note(vendor, `▶ ${title}`);
  return test.step(`[${vendor}] ${title}`, body);
};
