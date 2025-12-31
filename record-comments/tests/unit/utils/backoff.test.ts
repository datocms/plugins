import { describe, it, expect, vi } from 'vitest';
import { calculateBackoffDelay, delay } from '@utils/backoff';

describe('calculateBackoffDelay', () => {
  describe('exponential growth', () => {
    it('returns base delay for attempt 0', () => {
      const result = calculateBackoffDelay(0, 100, 10000);

      expect(result).toBe(100);
    });

    it('doubles delay for each attempt', () => {
      expect(calculateBackoffDelay(1, 100, 10000)).toBe(200);
      expect(calculateBackoffDelay(2, 100, 10000)).toBe(400);
      expect(calculateBackoffDelay(3, 100, 10000)).toBe(800);
    });

    it('follows exponential formula: base * 2^attempt', () => {
      const base = 50;
      const max = 100000;

      expect(calculateBackoffDelay(0, base, max)).toBe(50);   // 50 * 2^0
      expect(calculateBackoffDelay(1, base, max)).toBe(100);  // 50 * 2^1
      expect(calculateBackoffDelay(2, base, max)).toBe(200);  // 50 * 2^2
      expect(calculateBackoffDelay(3, base, max)).toBe(400);  // 50 * 2^3
      expect(calculateBackoffDelay(4, base, max)).toBe(800);  // 50 * 2^4
    });
  });

  describe('max delay capping', () => {
    it('caps delay at maxDelay', () => {
      const result = calculateBackoffDelay(10, 100, 5000);

      expect(result).toBe(5000);
    });

    it('returns maxDelay when exponential exceeds it', () => {
      // 100 * 2^10 = 102400, but max is 1000
      const result = calculateBackoffDelay(10, 100, 1000);

      expect(result).toBe(1000);
    });

    it('returns exact exponential when under max', () => {
      const result = calculateBackoffDelay(3, 100, 10000);

      expect(result).toBe(800); // 100 * 2^3 = 800
    });
  });

  describe('jitter', () => {
    it('adds no jitter when disabled', () => {
      const result = calculateBackoffDelay(0, 100, 10000, false);

      expect(result).toBe(100);
    });

    it('adds jitter when enabled', () => {
      vi.spyOn(Math, 'random').mockReturnValue(0.5);

      const result = calculateBackoffDelay(0, 100, 10000, true);

      // 100 + (0.5 * 100) = 150
      expect(result).toBe(150);

      vi.restoreAllMocks();
    });

    it('adds max jitter of 100ms', () => {
      vi.spyOn(Math, 'random').mockReturnValue(1);

      const result = calculateBackoffDelay(0, 100, 10000, true);

      // 100 + (1 * 100) = 200
      expect(result).toBe(200);

      vi.restoreAllMocks();
    });

    it('jitter does not exceed maxDelay', () => {
      vi.spyOn(Math, 'random').mockReturnValue(1);

      const result = calculateBackoffDelay(0, 100, 150, true);

      // 100 + 100 = 200, but capped at 150
      expect(result).toBe(150);

      vi.restoreAllMocks();
    });
  });

  describe('edge cases', () => {
    it('handles zero base delay', () => {
      const result = calculateBackoffDelay(5, 0, 1000);

      expect(result).toBe(0);
    });

    it('handles very large attempt numbers', () => {
      const result = calculateBackoffDelay(100, 100, 5000);

      expect(result).toBe(5000); // Should be capped at max
    });

    it('handles max delay of zero', () => {
      const result = calculateBackoffDelay(0, 100, 0);

      expect(result).toBe(0);
    });
  });
});

describe('delay', () => {
  it('resolves after specified time', async () => {
    vi.useFakeTimers();

    const promise = delay(100);
    vi.advanceTimersByTime(100);

    await expect(promise).resolves.toBeUndefined();

    vi.useRealTimers();
  });

  it('does not resolve before specified time', async () => {
    vi.useFakeTimers();

    let resolved = false;
    delay(100).then(() => { resolved = true; });

    vi.advanceTimersByTime(50);
    expect(resolved).toBe(false);

    vi.advanceTimersByTime(50);
    await Promise.resolve();
    expect(resolved).toBe(true);

    vi.useRealTimers();
  });
});
