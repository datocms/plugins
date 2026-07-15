/**
 * Per-call timeout guard tied to an `AbortController`.
 *
 * Replaces the record path's former `Promise.race` timeout, which raced a
 * translation promise against an unrelated timeout promise but never aborted
 * the in-flight call — the underlying fetch kept running (and kept a scheduler
 * slot or rate-limit budget occupied) even after the race had already
 * "timed out". This guard aborts its own controller on timeout so the
 * call actually dies.
 */

/** Rejection reason thrown by {@link withStallGuard} when `run` stalls. */
export class StallError extends Error {
  constructor(public readonly timeoutMs: number) {
    super(`Provider call stalled after ${timeoutMs}ms`);
    this.name = 'StallError';
  }
}

/**
 * Runs `run` against a fresh {@link AbortSignal}, rejecting with a
 * {@link StallError} — and aborting that signal, so `run`'s underlying fetch
 * actually dies instead of being orphaned — if it hasn't settled within
 * `opts.timeoutMs`. When `opts.parentSignal` aborts, the guard's own signal
 * aborts and the returned promise rejects with the parent's abort reason
 * immediately, before the timeout.
 *
 * @param run - Performs the guarded call, given the guard's own signal.
 * @param opts.timeoutMs - Milliseconds to wait before stalling out.
 * @param opts.parentSignal - Outer signal whose abort wins immediately.
 * @returns Whatever `run` resolves to.
 * @throws {StallError} When `run` does not settle within `timeoutMs`.
 */
export const withStallGuard = <T>(
  run: (signal: AbortSignal) => Promise<T>,
  opts: { timeoutMs: number; parentSignal?: AbortSignal },
): Promise<T> => {
  const controller = new AbortController();
  const { timeoutMs, parentSignal } = opts;
  let timer: ReturnType<typeof setTimeout>;
  // Captured at function scope so `finally` can detach it: bulk threads ONE
  // run-scoped `parentSignal` through every field attempt, so a listener left
  // attached on each normal resolve would accumulate O(attempts) on that single
  // signal (and eventually trip Node's MaxListeners warning) until the run ends.
  let onParentAbort: (() => void) | undefined;

  const stallTimeout = new Promise<never>((_, reject) => {
    timer = setTimeout(() => {
      const err = new StallError(timeoutMs);
      controller.abort(err);
      reject(err);
    }, timeoutMs);
  });

  const parentAbort = new Promise<never>((_, reject) => {
    onParentAbort = () => {
      controller.abort(parentSignal?.reason);
      reject(parentSignal?.reason);
    };
    if (parentSignal?.aborted) onParentAbort();
    else parentSignal?.addEventListener('abort', onParentAbort, { once: true });
  });

  return Promise.race([run(controller.signal), stallTimeout, parentAbort]).finally(
    () => {
      clearTimeout(timer);
      // `once: true` self-removes a listener that already fired; removing again
      // (or when it never fired) is a harmless no-op that prevents the leak.
      if (onParentAbort) parentSignal?.removeEventListener('abort', onParentAbort);
    },
  );
};
