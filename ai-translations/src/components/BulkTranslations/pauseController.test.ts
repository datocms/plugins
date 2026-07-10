import { describe, expect, it, vi } from 'vitest';
import type { NormalizedProviderError } from '../../utils/translation/ProviderErrors';
import { createPauseController } from './pauseController';

const rateLimit: NormalizedProviderError = {
  code: 'rate_limit',
  source: 'provider',
  message: 'x',
};
const authErr: NormalizedProviderError = {
  code: 'auth',
  source: 'provider',
  message: 'x',
};

describe('createPauseController', () => {
  it('auto-resumes a rate limit after the computed delay', async () => {
    const sleep = vi.fn().mockResolvedValue(undefined);
    const onStatus = vi.fn();
    const c = createPauseController({ sleep, onStatus });
    await expect(c.handleSystemic(rateLimit)).resolves.toBe('retry');
    expect(sleep).toHaveBeenCalledOnce();
    expect(onStatus).toHaveBeenCalledWith(
      expect.objectContaining({ kind: 'paused' }),
    );
  });

  it('exhausts the rate-limit budget after 3 auto-retries, then waits for the user', async () => {
    const sleep = vi.fn().mockResolvedValue(undefined);
    const c = createPauseController({ sleep, onStatus: vi.fn() });
    await c.handleSystemic(rateLimit);
    await c.handleSystemic(rateLimit);
    await c.handleSystemic(rateLimit);
    const fourth = c.handleSystemic(rateLimit);
    expect(sleep).toHaveBeenCalledTimes(3);
    c.resume();
    await expect(fourth).resolves.toBe('retry');
  });

  it('never auto-retries an auth error; waits for a manual resume', async () => {
    const sleep = vi.fn();
    const c = createPauseController({ sleep, onStatus: vi.fn() });
    const pending = c.handleSystemic(authErr);
    expect(sleep).not.toHaveBeenCalled();
    c.resume();
    await expect(pending).resolves.toBe('retry');
  });

  it('resolves cancelled when the user stops', async () => {
    const c = createPauseController({ sleep: vi.fn(), onStatus: vi.fn() });
    const pending = c.handleSystemic(authErr);
    c.cancel();
    await expect(pending).resolves.toBe('cancelled');
  });

  it('resets the rate-limit budget after a success', async () => {
    const sleep = vi.fn().mockResolvedValue(undefined);
    const c = createPauseController({ sleep, onStatus: vi.fn() });
    await c.handleSystemic(rateLimit);
    c.onSuccess();
    await c.handleSystemic(rateLimit);
    await c.handleSystemic(rateLimit);
    expect(sleep).toHaveBeenCalledTimes(3); // budget was reset, none exhausted
  });
});
