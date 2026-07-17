/**
 * base64url codec over raw bytes for the machine column (persistence spec §6).
 * Alphabet `A–Za-z0-9-_`, no padding — every character is CSV-safe (no comma,
 * quote, or newline), so the encoded body needs no RFC-4180 escaping. Portable
 * (no `btoa`/`Buffer` dependency) so it runs identically in the browser and tests.
 */
const ALPHABET = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789-_';

const LOOKUP: Record<string, number> = {};
for (let i = 0; i < ALPHABET.length; i += 1) LOOKUP[ALPHABET[i]] = i;

/** Encodes bytes as an unpadded base64url string. */
export function base64urlEncode(bytes: Uint8Array): string {
  let out = '';
  for (let i = 0; i < bytes.length; i += 3) {
    const b0 = bytes[i];
    const hasB1 = i + 1 < bytes.length;
    const hasB2 = i + 2 < bytes.length;
    const b1 = hasB1 ? bytes[i + 1] : 0;
    const b2 = hasB2 ? bytes[i + 2] : 0;
    out += ALPHABET[b0 >> 2];
    out += ALPHABET[((b0 & 0x03) << 4) | (b1 >> 4)];
    if (!hasB1) break;
    out += ALPHABET[((b1 & 0x0f) << 2) | (b2 >> 6)];
    if (!hasB2) break;
    out += ALPHABET[b2 & 0x3f];
  }
  return out;
}

/**
 * Decodes an unpadded base64url string to bytes.
 *
 * @throws If the string contains a character outside the base64url alphabet — a
 * mangled cell must fail loudly so the CRC check is never reached with garbage.
 */
export function base64urlDecode(str: string): Uint8Array {
  const out: number[] = [];
  let buffer = 0;
  let bits = 0;
  for (const ch of str) {
    const val = LOOKUP[ch];
    if (val === undefined) throw new Error(`base64urlDecode: invalid character "${ch}"`);
    buffer = (buffer << 6) | val;
    bits += 6;
    if (bits >= 8) {
      bits -= 8;
      out.push((buffer >> bits) & 0xff);
    }
  }
  return Uint8Array.from(out);
}
