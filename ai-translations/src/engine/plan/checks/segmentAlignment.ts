/**
 * Invariant: for array / multi-block fields, the reconstructed value must have as
 * many elements as were sent, and (when anchors are known) each element must sit
 * at its original position. Guards the Anthropic mid-array drop, which shifts
 * segment i to i+1's translation — well-formed content no other check catches.
 * (spec §5)
 */
import type { QcFlag } from '../../../utils/translation/qc/types';

/**
 * Checks that the number and position of segments align between sent and received values.
 * Detects Anthropic mid-array drops where segments get shifted or lost.
 */
export function checkSegmentAlignment(args: {
  sentCount: number;
  received: unknown[];
  expectedAnchors?: string[];
  receivedAnchors?: string[];
  fieldPath?: string;
  locale?: string;
}): QcFlag | null {
  const { sentCount, received, expectedAnchors, receivedAnchors, fieldPath, locale } = args;
  const flag = (message: string): QcFlag => ({
    checkId: 'segment-alignment', severity: 'error', fieldPath, locale, message,
  });
  if (received.length !== sentCount) {
    return flag(`Expected ${sentCount} segment(s) but reconstructed ${received.length}; content may be dropped or misaligned.`);
  }
  if (expectedAnchors && receivedAnchors) {
    const drifted = expectedAnchors.some((anchor, i) => anchor !== receivedAnchors[i]);
    if (drifted) return flag('A segment landed out of position; translations may be shifted across blocks.');
  }
  return null;
}
