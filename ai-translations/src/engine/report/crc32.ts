/**
 * CRC-32 (ISO 3309 / zlib / PNG polynomial 0xEDB88320) for the machine-column
 * integrity check (persistence spec §6). Detects accidental corruption of a CSV
 * cell — NOT an adversarial threat, so this is intentionally a checksum, not a
 * cryptographic hash. Dependency-free, table-based.
 */

/** Precomputed CRC-32 lookup table (256 entries), built once at module load. */
const CRC_TABLE = (() => {
  const table = new Uint32Array(256);
  for (let n = 0; n < 256; n += 1) {
    let c = n;
    for (let k = 0; k < 8; k += 1) {
      c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    }
    table[n] = c >>> 0;
  }
  return table;
})();

/** Computes the CRC-32 of `bytes` as an unsigned 32-bit integer. */
export function crc32(bytes: Uint8Array): number {
  let crc = 0xffffffff;
  for (let i = 0; i < bytes.length; i += 1) {
    crc = CRC_TABLE[(crc ^ bytes[i]) & 0xff] ^ (crc >>> 8);
  }
  return (crc ^ 0xffffffff) >>> 0;
}
