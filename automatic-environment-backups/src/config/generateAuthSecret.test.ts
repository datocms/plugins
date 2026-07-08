import { describe, expect, it } from 'vitest';
import { AUTH_SECRET_HEX_LENGTH, generateAuthSecret } from './generateAuthSecret';

describe('generateAuthSecret', () => {
  it('returns a string of the documented length (128-bit → 32 hex chars)', () => {
    expect(AUTH_SECRET_HEX_LENGTH).toBe(32);
    expect(generateAuthSecret()).toHaveLength(32);
  });

  it('contains only lowercase hex characters, so it is URL-safe and portable across providers', () => {
    for (let index = 0; index < 20; index += 1) {
      expect(generateAuthSecret()).toMatch(/^[0-9a-f]{32}$/);
    }
  });

  it('produces a distinct value on each call', () => {
    const values = new Set(
      Array.from({ length: 100 }, () => generateAuthSecret()),
    );
    expect(values.size).toBe(100);
  });
});
