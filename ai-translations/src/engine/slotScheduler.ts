/**
 * AIMD slot scheduler (spec §2.3-3): runs a batch of jobs with adaptive
 * concurrency, giving the engine field-level parallelism within a single
 * `(record, locale)` unit.
 *
 * The control loop is a straight port of the additive-increase /
 * multiplicative-decrease scheduler that used to live inline in
 * `translateRecordFields.ts` — same counters, same halving arithmetic — but
 * deliberately THINNER: it only *reorders* work. On a rate-limit error it halves
 * concurrency and requeues that job at the tail; it does NOT own backoff timing,
 * a retry budget, or a retry cap. Those stay in `translateWithSystemicRetry`,
 * which the job function itself wraps. The scheduler asks its caller whether an
 * error is a rate limit via the `isRateLimitError` hook rather than importing
 * any vendor logic.
 *
 * One scheduler instance is created per run (next to the run's `Pacer`) and
 * shared across every `(record, locale)` unit, so `currentConcurrency` and
 * `successStreak` are hoisted into the instance closure and survive between
 * `run()` calls — a unit inherits the concurrency the previous unit adapted to,
 * and bulk translation can never multiply the cap by the record count.
 */

/** Result of one scheduled batch, in input-job order (holes for jobs never launched). */
export type SlotScheduler = {
  /**
   * Runs `jobs` under the shared adaptive concurrency, resolving once every
   * launched job has settled (or, on cancellation, once the in-flight jobs
   * settle and no further jobs are launched).
   *
   * @param jobs - Thunks producing the work; each is invoked at most once per
   *   launch (a rate-limited job is re-invoked when it reruns at the tail).
   * @param hooks.isRateLimitError - Classifies a rejection as a rate limit
   *   (→ halve + requeue) versus a terminal failure (→ recorded as rejected).
   * @param hooks.checkCancellation - Polled before filling slots; once true, no
   *   further jobs launch and the run resolves when the active ones settle.
   * @returns The settled results aligned to input order; jobs never launched
   *   (e.g. after a cancellation) are omitted, so the array holds exactly the
   *   jobs that ran.
   */
  run<T>(
    jobs: Array<() => Promise<T>>,
    hooks: {
      isRateLimitError(error: unknown): boolean;
      checkCancellation(): boolean;
    },
  ): Promise<Array<PromiseSettledResult<T>>>;
};

/** Consecutive successes that earn one extra concurrency slot. */
const SUCCESS_STREAK_FOR_INCREASE = 3;

const defaultSleep = (ms: number): Promise<void> =>
  new Promise((resolve) => setTimeout(resolve, ms));

/**
 * Creates a slot scheduler.
 *
 * @param opts.maxConcurrency - Upper bound on in-flight jobs; concurrency starts
 *   here and additive-increase never exceeds it.
 * @param opts.spacingMs - Minimum wall-clock gap between successive launches.
 * @param opts.sleep - Injectable delay (fake-timer friendly); defaults to `setTimeout`.
 */
export const createSlotScheduler = (opts: {
  maxConcurrency: number;
  spacingMs: number;
  sleep?: (ms: number) => Promise<void>;
}): SlotScheduler => {
  const { maxConcurrency, spacingMs, sleep = defaultSleep } = opts;

  // Hoisted per-instance state: adapted concurrency and the success streak
  // survive across run() calls so each (record, locale) unit inherits them.
  let currentConcurrency = maxConcurrency;
  let successStreak = 0;

  const run = <T>(
    jobs: Array<() => Promise<T>>,
    hooks: {
      isRateLimitError(error: unknown): boolean;
      checkCancellation(): boolean;
    },
  ): Promise<Array<PromiseSettledResult<T>>> => {
    // Queue entries retain their input index so results stay aligned even after
    // a rate-limited job is requeued at the tail and reruns out of order.
    const queue: Array<{ index: number; job: () => Promise<T> }> = jobs.map(
      (job, index) => ({ index, job }),
    );
    const results: Array<PromiseSettledResult<T>> = new Array(jobs.length);
    let active = 0;
    // Virtual timestamp of the earliest permissible next launch; reserved
    // synchronously as each job is dispatched so concurrent launches stagger by
    // exactly `spacingMs`. Per-run (launch spacing does not carry across runs).
    let nextLaunchAt = 0;

    let settle!: () => void;
    const done = new Promise<void>((resolve) => {
      settle = resolve;
    });

    type Entry = { index: number; job: () => Promise<T> };

    /** Additive increase: three clean successes earn one slot, up to the cap. */
    const recordSuccess = (index: number, value: T): void => {
      results[index] = { status: 'fulfilled', value };
      successStreak += 1;
      if (
        successStreak >= SUCCESS_STREAK_FOR_INCREASE &&
        currentConcurrency < maxConcurrency
      ) {
        currentConcurrency += 1;
        successStreak = 0;
      }
    };

    /**
     * A rate-limit rejection triggers multiplicative decrease + requeue at the
     * tail (backoff/budget/retry caps stay in the job); any other rejection is a
     * terminal, recorded settlement.
     */
    const recordFailure = (entry: Entry, error: unknown): void => {
      successStreak = 0;
      if (hooks.isRateLimitError(error)) {
        currentConcurrency = Math.max(1, Math.ceil(currentConcurrency / 2));
        queue.push(entry);
        return;
      }
      results[entry.index] = { status: 'rejected', reason: error };
    };

    /**
     * Applies launch spacing, then runs one job and folds its settlement into
     * the AIMD counters. `active` was already incremented by `schedule` before
     * this fired, so it is only decremented once the job settles.
     */
    const launch = async (entry: Entry): Promise<void> => {
      const now = Date.now();
      const wait = Math.max(0, nextLaunchAt - now);
      nextLaunchAt = now + wait + spacingMs;
      if (wait > 0) await sleep(wait);

      try {
        recordSuccess(entry.index, await entry.job());
      } catch (error) {
        recordFailure(entry, error);
      } finally {
        active -= 1;
        schedule();
      }
    };

    /**
     * Fills every free slot up to the current concurrency, or resolves the run
     * when work is exhausted / cancelled and nothing is in flight. Each
     * `launch` is fire-and-forget: it increments `active` here before dispatch,
     * so counting free slots is enough to avoid over-committing.
     */
    const schedule = (): void => {
      if (hooks.checkCancellation() || queue.length === 0) {
        if (active === 0) settle();
        return;
      }
      const slots = Math.min(currentConcurrency - active, queue.length);
      for (let i = 0; i < slots; i += 1) {
        active += 1;
        // biome-ignore lint/style/noNonNullAssertion: guarded by the slot count above.
        void launch(queue.shift()!);
      }
    };

    schedule();
    return done.then(() =>
      results.filter((r): r is PromiseSettledResult<T> => r !== undefined),
    );
  };

  return { run };
};
