import { describe, expect, it, vi } from 'vitest';
import { translateWithSystemicRetry } from './ItemsDropdownUtils';
import type { NormalizedProviderError } from './ProviderErrors';

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
});
