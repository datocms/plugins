import { describe, expect, it } from 'vitest';
import { describeReasonCode } from './messages';
import type { ReasonCode } from '../plan/types';

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
