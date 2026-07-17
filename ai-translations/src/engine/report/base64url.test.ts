import { describe, expect, it } from 'vitest';
import { base64urlDecode, base64urlEncode } from './base64url';

describe('base64url', () => {
  it('round-trips byte arrays of every length mod 3', () => {
    for (let len = 0; len <= 12; len += 1) {
      const bytes = Uint8Array.from({ length: len }, (_, i) => (i * 37 + 11) & 0xff);
      expect(base64urlDecode(base64urlEncode(bytes))).toEqual(bytes);
    }
  });

  it('produces only CSV-safe, url-safe characters (no + / = comma quote)', () => {
    const bytes = Uint8Array.from({ length: 48 }, (_, i) => i * 5);
    const encoded = base64urlEncode(bytes);
    expect(encoded).toMatch(/^[A-Za-z0-9_-]*$/);
  });

  it('emits no padding', () => {
    expect(base64urlEncode(Uint8Array.from([1]))).not.toContain('=');
    expect(base64urlEncode(Uint8Array.from([1, 2]))).not.toContain('=');
  });

  it('rejects an invalid character', () => {
    expect(() => base64urlDecode('abc*def')).toThrow(/invalid character/);
  });

  it('preserves high bytes exactly', () => {
    const bytes = Uint8Array.from([0x00, 0xff, 0x80, 0x7f, 0xab]);
    expect(base64urlDecode(base64urlEncode(bytes))).toEqual(bytes);
  });
});
