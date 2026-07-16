/**
 * Translates an invariant QC check id into the machine-readable Blocked reason
 * code surfaced in the report (spec §7). Only invariant (error-tier) checks ever
 * block, so only those need a mapping; a heuristic id falling through is a
 * programming error.
 */
import type { QcCheckId } from '../../utils/translation/qc/types';
import type { ReasonCode } from './types';

const REASON_BY_CHECK: Partial<Record<QcCheckId, ReasonCode>> = {
  truncated: 'truncated',
  'length-validator': 'length-validator',
  'placeholder-loss': 'placeholder-lost',
  'html-structure': 'html-block-lost',
  'markdown-structure': 'md-block-lost',
  'block-structure': 'block-count-mismatch',
  'segment-alignment': 'segment-misalignment',
  'cannot-be-blank': 'required-blank',
};

/**
 * Maps a QC check ID to its corresponding blocked reason code.
 *
 * Only invariant (error-tier) checks can block translation, so only those have
 * a mapping defined here. Heuristic checks that fall through indicate a
 * programming error and will throw.
 *
 * @param checkId - The QC check identifier
 * @returns The reason code to use when this check causes blocking
 * @throws Error if the check ID has no mapped reason code
 */
export function reasonCodeFor(checkId: QcCheckId): ReasonCode {
  const code = REASON_BY_CHECK[checkId];
  if (!code) throw new Error(`No blocked reason code for invariant check "${checkId}"`);
  return code;
}
