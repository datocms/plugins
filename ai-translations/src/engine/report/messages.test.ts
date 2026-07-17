import { describe, expect, it } from 'vitest';
import { describeBucket, describeReasonCode } from './messages';
import type { Bucket, ReasonCode } from '../plan/types';

const ALL_CODES: ReasonCode[] = [
  'locale-would-drop',
  'locales-incomplete',
  'required-blank',
  'length-validator',
  'block-count-mismatch',
  'block-id-leak',
  'placeholder-lost',
  'html-block-lost',
  'md-block-lost',
  'segment-misalignment',
  'truncated',
  'source-drifted',
];

describe('describeReasonCode', () => {
  it('returns a non-empty message for every reason code', () => {
    for (const code of ALL_CODES) {
      const message = describeReasonCode(code);
      expect(message.length).toBeGreaterThan(0);
      expect(message).not.toContain(code); // human text, not the raw code
    }
  });

  it('gives distinct messages per code', () => {
    const messages = new Set(ALL_CODES.map(describeReasonCode));
    expect(messages.size).toBe(ALL_CODES.length);
  });
});

describe('describeBucket', () => {
  it('labels every bucket', () => {
    const buckets: Bucket[] = ['written', 'blocked', 'not-attempted', 'written-unverified'];
    for (const bucket of buckets) expect(describeBucket(bucket).length).toBeGreaterThan(0);
    expect(describeBucket('not-attempted')).toBe('Not attempted');
  });
});
