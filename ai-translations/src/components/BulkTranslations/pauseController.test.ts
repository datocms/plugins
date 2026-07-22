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
  it('manual pause blocks the between-unit gate until resume', async () => {
    const onStatus = vi.fn();
    const c = createPauseController({ sleep: vi.fn(), onStatus });

    c.pause();
    expect(onStatus).toHaveBeenCalledWith(
      expect.objectContaining({ kind: 'paused', trigger: 'manual' }),
    );

    const gated = c.gate();
    let settled = false;
    void gated.then(() => {
      settled = true;
    });
    await Promise.resolve();
    expect(settled).toBe(false); // still suspended at the boundary

    c.resume();
    await expect(gated).resolves.toBe('continue');
  });

  it('cancel unwinds a manual pause', async () => {
    const c = createPauseController({ sleep: vi.fn(), onStatus: vi.fn() });
    c.pause();
    const gated = c.gate();
    c.cancel();
    await expect(gated).resolves.toBe('cancelled');
  });

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

  it('re-arms the auto-retry budget after a success once it has been exhausted', async () => {
    const sleep = vi.fn().mockResolvedValue(undefined);
    const c = createPauseController({ sleep, onStatus: vi.fn() });

    // Burn the entire budget: three auto-retries, three sleeps.
    await c.handleSystemic(rateLimit);
    await c.handleSystemic(rateLimit);
    await c.handleSystemic(rateLimit);
    expect(sleep).toHaveBeenCalledTimes(3);

    // Budget exhausted: the next rate limit pauses manually — no fourth sleep.
    const exhausted = c.handleSystemic(rateLimit);
    expect(sleep).toHaveBeenCalledTimes(3);
    c.resume();
    await expect(exhausted).resolves.toBe('retry');

    // A healthy record must re-arm the budget…
    c.onSuccess();

    // …so the very next rate limit auto-retries again — a fourth sleep, invoked
    // synchronously on the auto-retry path before its first await. Without the
    // reset in onSuccess this stays a manual pause and never sleeps, so the
    // assertion below is what actually pins the re-arm behavior.
    const rearmed = c.handleSystemic(rateLimit);
    expect(sleep).toHaveBeenCalledTimes(4);
    await expect(rearmed).resolves.toBe('retry');
  });
});
