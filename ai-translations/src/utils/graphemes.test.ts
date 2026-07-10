/**
 * Tests for the grapheme-aware text helpers used by every truncation path that
 * touches user-facing labels or persisted content.
 */

import { describe, expect, it } from 'vitest';
import { segmentGraphemes, truncateToGraphemes } from './graphemes';

describe('segmentGraphemes', () => {
  it('counts an emoji as one segment (not two UTF-16 units)', () => {
    expect(segmentGraphemes('a😀b')).toEqual(['a', '😀', 'b']);
  });

  it('groups a regional-indicator flag into a single grapheme', () => {
    expect(segmentGraphemes('🇺🇸')).toEqual(['🇺🇸']);
  });

  it('groups a base letter and its combining mark into one grapheme', () => {
    // "e" + combining acute accent → one perceived character.
    expect(segmentGraphemes('é')).toEqual(['é']);
  });
});

describe('truncateToGraphemes', () => {
  it('returns the text unchanged when within the limit', () => {
    expect(truncateToGraphemes('hello', 10, '…')).toBe('hello');
  });

  it('truncates and appends the ellipsis when over the limit', () => {
    expect(truncateToGraphemes('hello world', 5, '…')).toBe('hello…');
  });

  it('never splits a surrogate pair at the boundary', () => {
    const result = truncateToGraphemes(`${'a'.repeat(4)}😀tail`, 5, '…');
    expect(result).toBe('aaaa😀…');
    expect(/[\uD800-\uDBFF](?![\uDC00-\uDFFF])/.test(result)).toBe(false);
  });

  it('never splits a multi-code-point flag cluster at the boundary', () => {
    // Cutting after 4 graphemes lands on the flag, which must stay whole.
    expect(truncateToGraphemes(`${'a'.repeat(4)}🇺🇸tail`, 5, '…')).toBe(
      'aaaa🇺🇸…',
    );
  });
});
