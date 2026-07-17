import { describe, expect, it } from 'vitest';
import {
  bitsToFlagIds,
  bitsToReasonCodes,
  flagIdsToBits,
  isHeuristicFlagId,
  reasonCodesToBits,
} from './bitmaps';
import type { ReasonCode } from '../plan/types';

const ALL_REASONS: ReasonCode[] = [
  'locale-would-drop', 'locales-incomplete', 'required-blank', 'length-validator',
  'block-count-mismatch', 'block-id-leak', 'placeholder-lost', 'html-block-lost',
  'md-block-lost', 'segment-misalignment', 'truncated', 'source-drifted',
];

describe('reason bitfield', () => {
  it('round-trips every subset boundary', () => {
    for (const codes of [[], ['truncated'], ['locale-would-drop', 'source-drifted'], ALL_REASONS] as ReasonCode[][]) {
      const bits = reasonCodesToBits(codes);
      expect(new Set(bitsToReasonCodes(bits))).toEqual(new Set(codes));
    }
  });

  it('packs all 12 codes without collision (distinct bits)', () => {
    expect(bitsToReasonCodes(reasonCodesToBits(ALL_REASONS))).toHaveLength(12);
  });

  it('is order-independent', () => {
    expect(reasonCodesToBits(['truncated', 'required-blank'])).toBe(
      reasonCodesToBits(['required-blank', 'truncated']),
    );
  });
});

describe('flag bitfield', () => {
  it('round-trips heuristic flag ids incl. the markdown-structure straddle', () => {
    const ids = ['length-ratio', 'no-op', 'markdown-structure'] as const;
    expect(new Set(bitsToFlagIds(flagIdsToBits([...ids])))).toEqual(new Set(ids));
  });

  it('packs all 9 heuristic ids in a uint16 without collision', () => {
    const all = [
      'length-mismatch', 'source-fallback', 'no-op', 'length-ratio', 'paragraph-count',
      'seo-truncated', 'json-validity', 'copied-from-source', 'markdown-structure',
    ] as const;
    const bits = flagIdsToBits([...all]);
    expect(bits).toBeLessThanOrEqual(0xffff);
    expect(bitsToFlagIds(bits)).toHaveLength(9);
  });

  it('throws when an invariant (non-heuristic) id is passed', () => {
    expect(() => flagIdsToBits(['truncated'])).toThrow(/not a heuristic/);
    expect(() => flagIdsToBits(['cannot-be-blank'])).toThrow();
  });

  it('isHeuristicFlagId narrows correctly', () => {
    expect(isHeuristicFlagId('length-ratio')).toBe(true);
    expect(isHeuristicFlagId('markdown-structure')).toBe(true); // straddles both maps
    expect(isHeuristicFlagId('placeholder-loss')).toBe(false);
  });
});
