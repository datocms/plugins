import { describe, expect, it } from 'vitest';
import { checkSegmentAlignment } from './segmentAlignment';

describe('checkSegmentAlignment', () => {
  it('passes when counts and anchors line up', () => {
    expect(checkSegmentAlignment({
      sentCount: 3, received: ['a', 'b', 'c'],
      expectedAnchors: ['h1', 'h2', 'h3'], receivedAnchors: ['h1', 'h2', 'h3'],
    })).toBeNull();
  });
  it('flags a count mismatch', () => {
    const flag = checkSegmentAlignment({ sentCount: 3, received: ['a', 'b'], fieldPath: 'body', locale: 'it' });
    expect(flag?.checkId).toBe('segment-alignment');
    expect(flag?.severity).toBe('error');
  });
  it('flags a positional anchor drift even when counts match', () => {
    const flag = checkSegmentAlignment({
      sentCount: 3, received: ['a', 'b', 'c'],
      expectedAnchors: ['h1', 'h2', 'h3'], receivedAnchors: ['h1', 'h3', 'h3'],
    });
    expect(flag?.severity).toBe('error');
  });
  it('passes when no anchors are provided and counts match', () => {
    expect(checkSegmentAlignment({ sentCount: 2, received: ['a', 'b'] })).toBeNull();
  });
});
