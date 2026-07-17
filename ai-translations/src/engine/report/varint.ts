/**
 * Unsigned LEB128 varint codec for the report wire format (persistence spec §6).
 * Each byte carries 7 payload bits; the high bit (0x80) marks continuation. Used
 * for length-prefixing the self-delimiting fields of the machine column.
 */

/** Appends the uLEB128 encoding of a non-negative integer to `out`. */
export function writeVarint(value: number, out: number[]): void {
  if (!Number.isInteger(value) || value < 0) {
    throw new Error(`writeVarint expects a non-negative integer, got ${value}`);
  }
  let remaining = value;
  do {
    let byte = remaining & 0x7f;
    remaining = Math.floor(remaining / 128);
    if (remaining > 0) byte |= 0x80;
    out.push(byte);
  } while (remaining > 0);
}

/**
 * Reads a uLEB128 varint from `bytes` starting at `offset`.
 *
 * @returns The decoded value and the offset just past the varint.
 * @throws If the varint runs past the buffer or exceeds the safe-integer range
 * (a corrupt/oversized length must fail loudly, never silently overflow).
 */
export function readVarint(
  bytes: Uint8Array,
  offset: number,
): { value: number; next: number } {
  let result = 0;
  let shift = 1; // multiplier: 128 ** byteIndex
  let pos = offset;
  for (;;) {
    if (pos >= bytes.length) throw new Error('readVarint: truncated varint');
    const byte = bytes[pos];
    result += (byte & 0x7f) * shift;
    pos += 1;
    if ((byte & 0x80) === 0) break;
    shift *= 128;
    if (result > Number.MAX_SAFE_INTEGER) {
      throw new Error('readVarint: varint exceeds safe integer range');
    }
  }
  return { value: result, next: pos };
}
