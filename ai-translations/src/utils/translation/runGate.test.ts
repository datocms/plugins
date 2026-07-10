import { describe, expect, it, vi } from 'vitest';
import { translateWithSystemicRetry } from './ItemsDropdownUtils';
import type { NormalizedProviderError } from './ProviderErrors';
import { createPacer } from './TranslationCore';

const rateLimit: NormalizedProviderError = {
  code: 'rate_limit',
  source: 'provider',
  message: 'Rate limit reached.',
};
const modelError: NormalizedProviderError = {
  code: 'model',
  source: 'provider',
  message: 'Context length exceeded.',
};

describe('translateWithSystemicRetry', () => {
  it('returns the value on first success', async () => {
    const attempt = vi.fn().mockResolvedValue('Bonjour');
    const onSystemic = vi.fn();
    await expect(
      translateWithSystemicRetry(attempt, { onSystemic }),
    ).resolves.toBe('Bonjour');
    expect(onSystemic).not.toHaveBeenCalled();
  });

  it('pauses on a systemic error, then retries and succeeds', async () => {
    const attempt = vi
      .fn()
      .mockRejectedValueOnce(rateLimit)
      .mockResolvedValueOnce('Bonjour');
    const onSystemic = vi.fn().mockResolvedValue('retry');
    await expect(
      translateWithSystemicRetry(attempt, { onSystemic }),
    ).resolves.toBe('Bonjour');
    expect(onSystemic).toHaveBeenCalledOnce();
    expect(attempt).toHaveBeenCalledTimes(2);
  });

  it('aborts when the pause handler says cancelled', async () => {
    const attempt = vi.fn().mockRejectedValue(rateLimit);
    const onSystemic = vi.fn().mockResolvedValue('cancelled');
    await expect(
      translateWithSystemicRetry(attempt, { onSystemic }),
    ).rejects.toMatchObject({
      cancelled: true,
    });
  });

  it('retries a content error twice without pausing, then rethrows', async () => {
    const attempt = vi.fn().mockRejectedValue(modelError);
    const onSystemic = vi.fn();
    await expect(
      translateWithSystemicRetry(attempt, { onSystemic }),
    ).rejects.toMatchObject({
      code: 'model',
    });
    expect(attempt).toHaveBeenCalledTimes(3); // 1 initial + 2 retries
    expect(onSystemic).not.toHaveBeenCalled();
  });

  it('paces each provider call through the adaptive pacer, widening the gap after a rate limit', async () => {
    const sleeps: number[] = [];
    const sleep = vi.fn(async (ms: number) => {
      sleeps.push(ms);
    });
    const pacer = createPacer(100);
    const attempt = vi
      .fn()
      .mockRejectedValueOnce(rateLimit)
      .mockResolvedValueOnce('Bonjour');
    const onSystemic = vi.fn().mockResolvedValue('retry');

    await expect(
      translateWithSystemicRetry(attempt, { onSystemic, pacer, sleep }),
    ).resolves.toBe('Bonjour');

    // A gap precedes every provider call, and the pacer doubles it once the
    // provider 429s — the proactive §3 throttle, not just the reactive pause.
    expect(sleeps).toEqual([100, 200]);
  });

  it('relaxes the pacer gap after a streak of healthy calls', async () => {
    const sleeps: number[] = [];
    const sleep = vi.fn(async (ms: number) => {
      sleeps.push(ms);
    });
    const pacer = createPacer(100);
    pacer.onRateLimit(); // widen to 200 up front
    const attempt = vi.fn().mockResolvedValue('Bonjour');
    const onSystemic = vi.fn();

    // Five consecutive successes decay the gap back toward its baseline.
    for (let i = 0; i < 5; i += 1) {
      // biome-ignore lint/performance/noAwaitInLoops: the pacer's decay is stateful across calls — they must run in sequence to build the success streak.
      await translateWithSystemicRetry(attempt, { onSystemic, pacer, sleep });
    }

    expect(sleeps).toEqual([200, 200, 200, 200, 200]);
    expect(pacer.gapMs()).toBe(100);
  });
});
