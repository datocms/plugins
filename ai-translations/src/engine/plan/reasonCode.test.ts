import { describe, expect, it } from 'vitest';
import { reasonCodeFor } from './reasonCode';

describe('reasonCodeFor', () => {
  it('maps invariant check ids to their blocked reason codes', () => {
    expect(reasonCodeFor('truncated')).toBe('truncated');
    expect(reasonCodeFor('length-validator')).toBe('length-validator');
    expect(reasonCodeFor('placeholder-loss')).toBe('placeholder-lost');
    expect(reasonCodeFor('html-structure')).toBe('html-block-lost');
    expect(reasonCodeFor('markdown-structure')).toBe('md-block-lost');
    expect(reasonCodeFor('block-structure')).toBe('block-count-mismatch');
    expect(reasonCodeFor('segment-alignment')).toBe('segment-misalignment');
    expect(reasonCodeFor('cannot-be-blank')).toBe('required-blank');
    expect(reasonCodeFor('locale-preservation')).toBe('locale-would-drop');
    expect(reasonCodeFor('locale-completeness')).toBe('locales-incomplete');
    expect(reasonCodeFor('block-id-provenance')).toBe('block-id-leak');
  });
});
