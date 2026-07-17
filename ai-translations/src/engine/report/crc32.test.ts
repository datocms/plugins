import { describe, expect, it } from 'vitest';
import { crc32 } from './crc32';

const bytesOf = (s: string): Uint8Array => new TextEncoder().encode(s);

describe('crc32', () => {
  it('matches known CRC-32 test vectors', () => {
    // Canonical vectors (zlib/PNG polynomial).
    expect(crc32(bytesOf(''))).toBe(0x00000000);
    expect(crc32(bytesOf('123456789'))).toBe(0xcbf43926);
    expect(crc32(bytesOf('The quick brown fox jumps over the lazy dog'))).toBe(0x414fa339);
  });

  it('is deterministic and returns an unsigned 32-bit value', () => {
    const value = crc32(bytesOf('hello world'));
    expect(value).toBe(crc32(bytesOf('hello world')));
    expect(value).toBeGreaterThanOrEqual(0);
    expect(value).toBeLessThanOrEqual(0xffffffff);
  });

  it('changes when any byte changes (detects corruption)', () => {
    expect(crc32(bytesOf('payload'))).not.toBe(crc32(bytesOf('payloae')));
    expect(crc32(Uint8Array.from([1, 2, 3, 4]))).not.toBe(crc32(Uint8Array.from([1, 2, 3, 5])));
  });
});
