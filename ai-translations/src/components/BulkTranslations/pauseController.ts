import type { NormalizedProviderError } from '../../utils/translation/ProviderErrors';
import { computeRetryDelay } from '../../utils/translation/TranslationCore';
import type { RunGate, SystemicHandler } from '../../utils/translation/types';

/**
 * How many times a rate limit is auto-retried (with backoff + countdown) before
 * the pause persists and hands control to the user.
 */
export const RATE_LIMIT_AUTO_RETRY_BUDGET = 3;

/**
 * The bulk run's lifecycle state, surfaced to the progress modal so it can show
 * a pause screen, a countdown, and gate the Export button.
 */
export type RunStatus =
  | { kind: 'running' }
  | {
      kind: 'paused';
      reason: NormalizedProviderError;
      /** Epoch ms the auto-retry will fire; absent when the pause is manual. */
      resumeAt?: number;
      /** 1-based auto-retry attempt so far (0 when the pause is manual). */
      attempt: number;
    }
  | { kind: 'cancelled' }
  | { kind: 'completed' };

/**
 * Imperative surface the modal drives. It is also the run's `SystemicHandler`
 * (`handleSystemic`) and `RunGate` (`gate`), so the same instance both governs
 * the between-unit cancel checks and pauses on systemic errors.
 */
export type PauseController = {
  /** Pauses the run on a systemic error; resolves once it may resume, or cancels. */
  handleSystemic: SystemicHandler;
  /** Between-unit gate: resolves `'cancelled'` once `cancel()` has been called. */
  gate: RunGate;
  /** Releases a manual pause, continuing the run. */
  resume: () => void;
  /** Stops the run: unwinds any pending pause and marks the run cancelled. */
  cancel: () => void;
  /** Signals a healthy record, resetting the rate-limit auto-retry budget. */
  onSuccess: () => void;
};

/** Options for {@link createPauseController}. */
export type PauseControllerOptions = {
  /** Receives every status transition so the UI can react. */
  onStatus: (status: RunStatus) => void;
  /** Waits `ms` milliseconds. Injected so tests never wait on real time. */
  sleep?: (ms: number) => Promise<void>;
  /** Current epoch ms. Injected for deterministic `resumeAt` in tests. */
  nowMs?: () => number;
};

const defaultSleep = (ms: number): Promise<void> =>
  new Promise((resolve) => {
    setTimeout(resolve, ms);
  });

/**
 * Creates the run's pause machine.
 *
 * A `rate_limit` is auto-retried up to {@link RATE_LIMIT_AUTO_RETRY_BUDGET}
 * times, each behind a `computeRetryDelay` countdown, before the pause persists
 * and waits for the user. Every other systemic error (`auth`, `quota`,
 * `network`) pauses immediately and only resumes on an explicit `resume()`.
 * A successful record resets the budget, so a healthy stretch relaxes the
 * auto-retry counter rather than leaving it primed by an early 429.
 *
 * @param options - Status sink plus injectable `sleep`/`nowMs`.
 * @returns The controller: a `SystemicHandler`, a `RunGate`, and manual controls.
 */
export const createPauseController = ({
  onStatus,
  sleep = defaultSleep,
  nowMs = () => Date.now(),
}: PauseControllerOptions): PauseController => {
  let rateLimitRetries = 0;
  let isCancelled = false;
  let resolveManual: ((outcome: 'retry' | 'cancelled') => void) | undefined;

  // Resolves once `cancel()` is called, so an in-flight auto-retry countdown
  // can be interrupted instead of waiting out the full backoff.
  let releaseCancelSignal: (() => void) | undefined;
  const cancelSignal = new Promise<void>((resolve) => {
    releaseCancelSignal = resolve;
  });

  const settleManual = (outcome: 'retry' | 'cancelled'): void => {
    resolveManual?.(outcome);
    resolveManual = undefined;
  };

  const handleSystemic: SystemicHandler = async (err) => {
    if (isCancelled) return 'cancelled';

    const canAutoRetry =
      err.code === 'rate_limit' &&
      rateLimitRetries < RATE_LIMIT_AUTO_RETRY_BUDGET;

    if (canAutoRetry) {
      rateLimitRetries += 1;
      const attempt = rateLimitRetries;
      const delay = computeRetryDelay(err.retryAfterMs, attempt);
      onStatus({
        kind: 'paused',
        reason: err,
        resumeAt: nowMs() + delay,
        attempt,
      });
      await Promise.race([sleep(delay), cancelSignal]);
      if (isCancelled) return 'cancelled';
      onStatus({ kind: 'running' });
      return 'retry';
    }

    // Manual pause: a non-rate-limit systemic error, or an exhausted budget.
    onStatus({ kind: 'paused', reason: err, attempt: rateLimitRetries });
    const outcome = await new Promise<'retry' | 'cancelled'>((resolve) => {
      resolveManual = resolve;
    });
    if (outcome === 'retry') onStatus({ kind: 'running' });
    return outcome;
  };

  return {
    handleSystemic,
    gate: async () => (isCancelled ? 'cancelled' : 'continue'),
    resume: () => settleManual('retry'),
    cancel: () => {
      isCancelled = true;
      releaseCancelSignal?.();
      settleManual('cancelled');
      onStatus({ kind: 'cancelled' });
    },
    onSuccess: () => {
      rateLimitRetries = 0;
    },
  };
};
