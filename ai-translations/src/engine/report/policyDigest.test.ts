import { describe, expect, it } from 'vitest';
import { policyDigest } from './policyDigest';

describe('policyDigest', () => {
  it('is order-independent over the token lists', () => {
    expect(policyDigest({ excludedTokens: ['a', 'b'], copyTokens: ['x'] })).toBe(
      policyDigest({ excludedTokens: ['b', 'a'], copyTokens: ['x'] }),
    );
  });
  it('changes when a token changes', () => {
    expect(policyDigest({ excludedTokens: ['a'], copyTokens: [] })).not.toBe(
      policyDigest({ excludedTokens: ['a', 'c'], copyTokens: [] }),
    );
  });
  it('does not confuse the two lists', () => {
    expect(policyDigest({ excludedTokens: ['a'], copyTokens: [] })).not.toBe(
      policyDigest({ excludedTokens: [], copyTokens: ['a'] }),
    );
  });
  it('is stable (same input → same digest)', () => {
    const p = { excludedTokens: ['x', 'y'], copyTokens: ['z'] };
    expect(policyDigest(p)).toBe(policyDigest(p));
  });
});
