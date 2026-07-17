import { describe, expect, it } from 'vitest';
import { readVarint, writeVarint } from './varint';

const roundtrip = (n: number): number => {
  const out: number[] = [];
  writeVarint(n, out);
  return readVarint(Uint8Array.from(out), 0).value;
};

describe('uLEB128 varint', () => {
  it('round-trips boundary values', () => {
    for (const n of [0, 1, 127, 128, 255, 256, 16383, 16384, 1_000_000, Number.MAX_SAFE_INTEGER]) {
      expect(roundtrip(n)).toBe(n);
    }
  });

  it('encodes small values in one byte and 128 in two', () => {
    const a: number[] = [];
    writeVarint(127, a);
    expect(a).toEqual([127]);
    const b: number[] = [];
    writeVarint(128, b);
    expect(b).toEqual([0x80, 0x01]);
  });

  it('advances the offset past the varint', () => {
    const out: number[] = [];
    writeVarint(300, out);
    out.push(42); // sentinel after the varint
    const bytes = Uint8Array.from(out);
    const { value, next } = readVarint(bytes, 0);
    expect(value).toBe(300);
    expect(bytes[next]).toBe(42);
  });

  it('rejects a negative or non-integer input', () => {
    expect(() => writeVarint(-1, [])).toThrow();
    expect(() => writeVarint(1.5, [])).toThrow();
  });

  it('throws on a truncated (continuation-terminated) varint', () => {
    expect(() => readVarint(Uint8Array.from([0x80, 0x80]), 0)).toThrow(/truncated/);
  });
});
