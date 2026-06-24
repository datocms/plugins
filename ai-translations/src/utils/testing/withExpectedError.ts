/**
 * Test helper that brackets a deliberately-failing code path with a clearly
 * labelled banner on stderr.
 *
 * Several tests exercise error-handling branches whose production code logs the
 * error (via `Logger.error` / `console.error`). Those logs are expected, but to
 * a human watching `vitest` run interactively they look like real failures. This
 * wrapper prints an open/close banner around the emitted error so it's obvious
 * the output is intentional.
 *
 * The wrapper is transparent: it forwards the resolved value and re-throws any
 * rejection unchanged, so it can wrap both `expect(...).rejects` assertions and
 * ordinary `await` calls without changing what the test observes.
 *
 * Banner output only surfaces in a TTY — Vitest's non-interactive reporter
 * suppresses console output from passing tests, so CI logs stay clean.
 *
 * @param label - Short description of the failure path being exercised.
 * @param run - The code that triggers the expected error.
 * @returns Whatever `run` resolves to (or rejects with).
 */
export const withExpectedError = async <T>(
  label: string,
  run: () => Promise<T> | T,
): Promise<T> => {
  const top = `┌─ EXPECTED ERROR — ${label} (deliberate, testing failure path) ─┐`;
  const bottom = `└${'─'.repeat(Math.max(0, top.length - 2))}┘`;

  console.error(top);
  try {
    return await run();
  } finally {
    console.error(bottom);
  }
};
