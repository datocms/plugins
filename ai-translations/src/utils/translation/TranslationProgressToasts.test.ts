import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  startTranslationProgressToasts,
  TRANSLATION_PROGRESS_TOAST_DURATION_MS,
} from './TranslationProgressToasts';

describe('startTranslationProgressToasts', () => {
  beforeEach(() => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2026-01-01T00:00:00Z'));
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it('keeps progress feedback continuous using the toast lifetime as its interval', () => {
    expect(TRANSLATION_PROGRESS_TOAST_DURATION_MS).toBe(5_000);

    const dispatchToast = vi.fn();
    const stop = startTranslationProgressToasts(
      dispatchToast,
      (elapsedSeconds) => `Still translating (${elapsedSeconds}s elapsed)`,
    );

    expect(dispatchToast).toHaveBeenCalledTimes(1);
    expect(dispatchToast).toHaveBeenLastCalledWith({
      type: 'warning',
      message: 'Still translating (0s elapsed)',
      dismissOnPageChange: true,
      dismissAfterTimeout: TRANSLATION_PROGRESS_TOAST_DURATION_MS,
    });

    vi.advanceTimersByTime(TRANSLATION_PROGRESS_TOAST_DURATION_MS);

    expect(dispatchToast).toHaveBeenCalledTimes(2);
    expect(dispatchToast).toHaveBeenLastCalledWith(
      expect.objectContaining({ message: 'Still translating (5s elapsed)' }),
    );

    stop();
    vi.advanceTimersByTime(TRANSLATION_PROGRESS_TOAST_DURATION_MS * 3);

    expect(dispatchToast).toHaveBeenCalledTimes(2);
  });

  it('does not let toast failures interrupt or stop later progress updates', async () => {
    const dispatchToast = vi
      .fn()
      .mockRejectedValueOnce(new Error('Toast unavailable'));
    const stop = startTranslationProgressToasts(
      dispatchToast,
      () => 'Translating…',
    );

    await vi.advanceTimersByTimeAsync(TRANSLATION_PROGRESS_TOAST_DURATION_MS);

    expect(dispatchToast).toHaveBeenCalledTimes(2);
    stop();
  });
});
