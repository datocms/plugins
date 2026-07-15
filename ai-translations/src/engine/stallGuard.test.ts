/**
 * Tests for stallGuard.ts
 * Verifies the timeout guard rejects with StallError and actually aborts the
 * inner call (rather than orphaning it), that a normal resolve clears its
 * timer, and that a parent abort propagates immediately.
 */

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  isSystemicError,
  normalizeProviderError,
} from '../utils/translation/ProviderErrors';
import { StallError, withStallGuard } from './stallGuard';

describe('stallGuard.ts', () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it('rejects with StallError and aborts the inner signal after timeoutMs', async () => {
    let innerSignal: AbortSignal | undefined;
    const hang = (signal: AbortSignal) => {
      innerSignal = signal;
      return new Promise<never>(() => {});
    };
    const p = withStallGuard(hang, { timeoutMs: 1000 });
    const assertion = expect(p).rejects.toBeInstanceOf(StallError);
    await vi.advanceTimersByTimeAsync(1001);
    await assertion;
    expect(innerSignal?.aborted).toBe(true);
  });

  it('resolves normally under the limit and clears its timer', async () => {
    const run = (_signal: AbortSignal) =>
      new Promise<string>((resolve) => {
        setTimeout(() => resolve('value'), 10);
      });
    const unhandledRejections: unknown[] = [];
    const onUnhandledRejection = (reason: unknown) => {
      unhandledRejections.push(reason);
    };
    process.on('unhandledRejection', onUnhandledRejection);

    try {
      const p = withStallGuard(run, { timeoutMs: 1000 });
      await vi.advanceTimersByTimeAsync(10);
      await expect(p).resolves.toBe('value');

      // Advance well past the timeout: the timer must have been cleared, so
      // no stray rejection (and no unhandled rejection) fires afterward.
      await vi.advanceTimersByTimeAsync(2000);
      await Promise.resolve();
      expect(unhandledRejections).toEqual([]);
    } finally {
      process.off('unhandledRejection', onUnhandledRejection);
    }
  });

  it('propagates a parent abort immediately', async () => {
    const parentController = new AbortController();
    let innerSignal: AbortSignal | undefined;
    const hang = (signal: AbortSignal) => {
      innerSignal = signal;
      return new Promise<never>(() => {});
    };
    const p = withStallGuard(hang, {
      timeoutMs: 1000,
      parentSignal: parentController.signal,
    });

    await vi.advanceTimersByTimeAsync(5);
    const reason = new Error('parent cancelled');
    parentController.abort(reason);

    await expect(p).rejects.toBe(reason);
    expect(innerSignal?.aborted).toBe(true);
  });

  it('detaches its parent-abort listener after a normal resolve (no per-attempt leak)', async () => {
    // Bulk threads one run-scoped signal through every field attempt, so a
    // listener left attached on each resolve accumulates O(attempts). Drive the
    // guard many times against a SINGLE signal and assert every 'abort' listener
    // it added was removed — net zero, whatever the underlying listener store.
    const controller = new AbortController();
    const { signal } = controller;
    const addSpy = vi.spyOn(signal, 'addEventListener');
    const removeSpy = vi.spyOn(signal, 'removeEventListener');

    const run = (_signal: AbortSignal) =>
      new Promise<number>((resolve) => {
        setTimeout(() => resolve(1), 10);
      });

    for (let i = 0; i < 50; i += 1) {
      const p = withStallGuard(run, { timeoutMs: 1000, parentSignal: signal });
      // biome-ignore lint/performance/noAwaitInLoops: each attempt must fully settle (advance timers, resolve) before the next, to observe listeners attaching and detaching one at a time.
      await vi.advanceTimersByTimeAsync(10);
      await expect(p).resolves.toBe(1);
    }

    const added = addSpy.mock.calls.filter(([type]) => type === 'abort');
    const removed = removeSpy.mock.calls.filter(([type]) => type === 'abort');
    expect(added.length).toBe(50);
    // Every added handler was passed to removeEventListener (net zero listeners).
    for (const [, handler] of added) {
      expect(removed).toContainEqual(['abort', handler]);
    }
  });

  it('classifies a normalized StallError as a content-tier (non-systemic) failure', () => {
    // Regression pin: a stall must retry under CONTENT_RETRY_LIMIT, never pause
    // the whole run. If the StallError message is ever reworded into something
    // that matches a systemic substring (rate limit / network / auth / quota),
    // this fails before the misclassification can ship.
    expect(
      isSystemicError(normalizeProviderError(new StallError(300000), 'openai')),
    ).toBe(false);
  });
});
