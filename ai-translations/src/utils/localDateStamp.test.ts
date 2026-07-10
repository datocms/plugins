import { describe, expect, it } from 'vitest';
import { formatLocalDateStamp } from './localDateStamp';

describe('formatLocalDateStamp', () => {
  it('formats a date from its local calendar fields', () => {
    // `new Date(y, mIndex, d)` uses local fields, so the stamp is deterministic
    // regardless of the machine timezone.
    expect(formatLocalDateStamp(new Date(2026, 0, 5))).toBe('2026-01-05');
  });

  it('zero-pads single-digit months and days', () => {
    expect(formatLocalDateStamp(new Date(2026, 8, 9))).toBe('2026-09-09');
  });

  it('uses the local day, never the UTC slice', () => {
    // An instant at 00:30 UTC is the previous local day west of UTC and the same
    // day at/east of it; the stamp must track the local calendar fields, which
    // is exactly what a UTC `toISOString().slice(0,10)` would get wrong.
    const instant = new Date('2026-03-01T00:30:00Z');
    const expected = `${instant.getFullYear()}-${String(
      instant.getMonth() + 1,
    ).padStart(2, '0')}-${String(instant.getDate()).padStart(2, '0')}`;
    expect(formatLocalDateStamp(instant)).toBe(expected);
  });
});
