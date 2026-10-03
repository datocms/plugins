import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { ProviderRequestControl, retryAfterMs } from './ProviderRequestControl';
import { shouldRetryRateLimitError } from './TranslationCore';
import { ProviderError } from './types';

describe('provider request control', () => {
  beforeEach(() => vi.useFakeTimers());
  afterEach(() => vi.useRealTimers());

  it('bounds concurrency and request starts across 120 queued synthetic calls', async () => {
    const control = new ProviderRequestControl('openai', 55, 4);
    let active = 0;
    let maximum = 0;
    const starts: number[] = [];
    const calls = Array.from({ length: 120 }, (_, index) =>
      control.run(async () => {
        starts.push(Date.now());
        active += 1;
        maximum = Math.max(maximum, active);
        await new Promise((resolve) => setTimeout(resolve, 500));
        active -= 1;
        return index;
      }),
    );
    await vi.runAllTimersAsync();
    expect(await Promise.all(calls)).toEqual(
      Array.from({ length: 120 }, (_, index) => index),
    );
    expect(maximum).toBe(4);
    for (let index = 1; index < starts.length; index += 1)
      expect(starts[index] - starts[index - 1]).toBeGreaterThanOrEqual(55);
  });

  it('respects Retry-After and retries only the rejected call', async () => {
    const control = new ProviderRequestControl('deepl', 0);
    const call = vi
      .fn()
      .mockRejectedValueOnce(
        new ProviderError('Rate limited', 429, 'deepl', {
          retryAfterMs: 65_000,
        }),
      )
      .mockResolvedValue('done');
    const request = control.run(call);
    await vi.advanceTimersByTimeAsync(64_999);
    expect(call).toHaveBeenCalledTimes(1);
    await vi.advanceTimersByTimeAsync(1);
    expect(await request).toBe('done');
    expect(call).toHaveBeenCalledTimes(2);
  });

  it('limits retries and marks the final error against whole-field replays', async () => {
    const control = new ProviderRequestControl('openai', 0, 4, 2);
    const call = vi
      .fn()
      .mockRejectedValue(new ProviderError('Rate limited', 429, 'openai'));
    const request = control.run(call).catch((error) => error);
    await vi.runAllTimersAsync();
    const error = await request;
    if (!(error instanceof ProviderError))
      throw new Error('Expected a provider failure');
    expect(call).toHaveBeenCalledTimes(3);
    expect(error.retryExhausted).toBe(true);
    expect(
      shouldRetryRateLimitError(
        new Error('Rate limit', { cause: error }),
        'openai',
      ),
    ).toBe(false);
  });

  it.each([
    new ProviderError('insufficient_quota', 429, 'openai'),
    new ProviderError('Monthly cap', 429, 'anthropic', {
      code: 'enforced_spend_limit_reached',
    }),
    new TypeError('Failed to fetch'),
    new DOMException('Timed out', 'TimeoutError'),
  ])(
    'does not replay quota exhaustion or ambiguous outcomes: %s',
    async (error) => {
      const control = new ProviderRequestControl('openai', 0);
      const call = vi.fn().mockRejectedValue(error);
      await expect(control.run(call)).rejects.toBe(error);
      expect(call).toHaveBeenCalledOnce();
    },
  );

  it('cancels queued backoff before another paid call', async () => {
    const controller = new AbortController();
    const control = new ProviderRequestControl('openai', 0);
    const call = vi
      .fn()
      .mockRejectedValue(new ProviderError('Rate limited', 429, 'openai'));
    const request = control
      .run(call, controller.signal)
      .catch((error) => error);
    await vi.advanceTimersByTimeAsync(50);
    controller.abort();
    expect(await request).toMatchObject({ name: 'AbortError' });
    await vi.runAllTimersAsync();
    expect(call).toHaveBeenCalledOnce();
  });

  it('honors Gemini RetryInfo for temporary exhausted resources', async () => {
    const control = new ProviderRequestControl('google', 0);
    const call = vi
      .fn()
      .mockRejectedValueOnce({
        status: 429,
        message: 'Resource has been exhausted',
        errorDetails: [{ retryDelay: '12.5s' }],
      })
      .mockResolvedValue('done');
    const request = control.run(call);
    await vi.advanceTimersByTimeAsync(12_499);
    expect(call).toHaveBeenCalledOnce();
    await vi.advanceTimersByTimeAsync(1);
    expect(await request).toBe('done');
  });

  it('does not retry a daily quota even when RetryInfo is present', async () => {
    const control = new ProviderRequestControl('google', 0);
    const error = {
      status: 429,
      message: 'Quota exceeded: requests per day',
      errorDetails: [{ retryDelay: '12s' }],
    };
    const call = vi.fn().mockRejectedValue(error);
    await expect(control.run(call)).rejects.toBe(error);
    expect(call).toHaveBeenCalledOnce();
  });

  it('parses HTTP dates and seconds without ignoring server cooldowns', () => {
    expect(retryAfterMs(new Headers({ 'retry-after': '65' }))).toBe(65_000);
    expect(
      retryAfterMs(
        new Headers({
          'retry-after': new Date(Date.now() + 60_000).toUTCString(),
        }),
      ),
    ).toBeGreaterThanOrEqual(59_000);
    expect(
      retryAfterMs(new Headers({ 'retry-after': 'invalid' })),
    ).toBeUndefined();
  });
});
