/**
 * Tests for devConverterRoundtrip.ts's `diffValues` — the deep-compare used by
 * the debug-gated converter round-trip probe (spec §9.4 test 6). Pins the
 * legitimate-normalization exclusions (§2.1) so a real regression in the
 * round-trip still surfaces as exactly one diff naming its path.
 */
import { describe, expect, it } from 'vitest';
import { diffValues } from './devConverterRoundtrip';

describe('diffValues', () => {
  it('reports no diffs for identical objects', () => {
    const original = {
      title: { en: 'Hello', it: 'Ciao' },
      count: 3,
      nested: { a: [1, 2, 3] },
    };
    const roundTripped = {
      title: { en: 'Hello', it: 'Ciao' },
      count: 3,
      nested: { a: [1, 2, 3] },
    };

    const diffs: string[] = [];
    diffValues(original, roundTripped, '$', diffs);

    expect(diffs).toEqual([]);
  });

  it('treats undefined and null leaves as equivalent', () => {
    const original = { title: { en: 'Hello', it: undefined } };
    const roundTripped = { title: { en: 'Hello', it: null } };

    const diffs: string[] = [];
    diffValues(original, roundTripped, '$', diffs);

    expect(diffs).toEqual([]);
  });

  it('ignores internalLocales entirely, even when it differs', () => {
    const original = { internalLocales: ['en', 'it'], title: { en: 'Hello' } };
    const roundTripped = { internalLocales: ['en'], title: { en: 'Hello' } };

    const diffs: string[] = [];
    diffValues(original, roundTripped, '$', diffs);

    expect(diffs).toEqual([]);
  });

  it('reports exactly one diff naming the path of a changed nested value', () => {
    const original = {
      title: { en: 'Hello', it: 'Ciao' },
      block: { attributes: { body: { en: 'Original body' } } },
    };
    const roundTripped = {
      title: { en: 'Hello', it: 'Ciao' },
      block: { attributes: { body: { en: 'Changed body' } } },
    };

    const diffs: string[] = [];
    diffValues(original, roundTripped, '$', diffs);

    expect(diffs).toEqual([
      '$.block.attributes.body.en: "Original body" → "Changed body"',
    ]);
  });

  it('reports exactly one diff on an array length mismatch, without descending into elements', () => {
    const original = { items: [{ id: 1 }, { id: 2 }, { id: 3 }] };
    const roundTripped = { items: [{ id: 1 }, { id: 2 }] };

    const diffs: string[] = [];
    diffValues(original, roundTripped, '$', diffs);

    expect(diffs).toEqual(['$.items: array length 3 → 2']);
  });
});
