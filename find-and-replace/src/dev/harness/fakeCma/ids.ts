/**
 * Deterministic ids that look like the ones DatoCMS generates (22 characters of
 * URL-safe base64, as `generateId()` produces), so a reload keeps every model,
 * field, record and block id stable and screenshots stay comparable.
 */

function hash32(seed: string, salt: number): number {
  let h = 0x811c9dc5 ^ salt;
  for (let index = 0; index < seed.length; index += 1) {
    h ^= seed.charCodeAt(index);
    h = Math.imul(h, 0x01000193);
  }
  h ^= h >>> 15;
  h = Math.imul(h, 0x2c1b3c6d);
  h ^= h >>> 12;
  h = Math.imul(h, 0x297a2d39);
  h ^= h >>> 15;
  return h >>> 0;
}

export function stableId(seed: string): string {
  const bytes: number[] = [];
  for (let word = 0; word < 4; word += 1) {
    const value = hash32(seed, word * 0x9e3779b1);
    bytes.push(
      value >>> 24,
      (value >>> 16) & 0xff,
      (value >>> 8) & 0xff,
      value & 0xff,
    );
  }
  return btoa(String.fromCharCode(...bytes))
    .replace(/\+/g, '-')
    .replace(/\//g, '_')
    .replace(/=+$/, '');
}

/** A small seeded PRNG (mulberry32) for generated content. */
export function seededRandom(seed: number): () => number {
  let state = seed >>> 0;
  return () => {
    state = (state + 0x6d2b79f5) >>> 0;
    let t = state;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/** Ids for things the fake server creates at runtime (versions, new blocks, error entities). */
export function createIdSequence(prefix: string): () => string {
  let counter = 0;
  return () => {
    counter += 1;
    return stableId(`${prefix}:${counter}`);
  };
}
