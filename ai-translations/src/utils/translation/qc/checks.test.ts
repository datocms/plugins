import { describe, expect, it } from 'vitest';
import {
  checkLengthMismatch,
  checkPlaceholderSurvival,
  checkTruncated,
} from './checks';

describe('checkLengthMismatch', () => {
  it('returns null when lengths match', () => {
    expect(checkLengthMismatch({ expected: 3, received: 3 })).toBeNull();
  });

  it('flags an error when the model returned a different element count', () => {
    const flag = checkLengthMismatch({
      expected: 1,
      received: 2,
      fieldPath: 'body',
      locale: 'nl',
    });
    expect(flag).toMatchObject({
      checkId: 'length-mismatch',
      severity: 'error',
      fieldPath: 'body',
      locale: 'nl',
    });
    expect(flag?.message).toContain('2');
    expect(flag?.message).toContain('1');
  });
});

describe('checkPlaceholderSurvival', () => {
  it('returns null when all tokens survive', () => {
    expect(
      checkPlaceholderSurvival({
        tokens: ['⟦PH_0⟧'],
        output: 'Hallo ⟦PH_0⟧',
        segmentIndex: 0,
      }),
    ).toBeNull();
  });

  it('returns null when there are no tokens', () => {
    expect(
      checkPlaceholderSurvival({ tokens: [], output: 'Hallo', segmentIndex: 0 }),
    ).toBeNull();
  });

  it('flags an error when a token is dropped', () => {
    const flag = checkPlaceholderSurvival({
      tokens: ['⟦PH_0⟧', '⟦PH_1⟧'],
      output: 'Hallo ⟦PH_0⟧',
      segmentIndex: 2,
      fieldPath: 'body',
    });
    expect(flag).toMatchObject({
      checkId: 'placeholder-loss',
      severity: 'error',
      segmentIndex: 2,
      fieldPath: 'body',
    });
  });
});

describe('checkTruncated', () => {
  it.each(['length', 'max_tokens', 'MAX_TOKENS'])(
    'flags truncation marker %s',
    (finishReason) => {
      expect(checkTruncated({ finishReason })?.checkId).toBe('truncated');
    },
  );

  it('returns null for a normal stop or missing reason', () => {
    expect(checkTruncated({ finishReason: 'stop' })).toBeNull();
    expect(checkTruncated({})).toBeNull();
  });
});
