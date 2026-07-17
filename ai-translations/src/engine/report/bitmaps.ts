/**
 * Append-only bit-index maps for the machine-column bitfields (persistence spec
 * §6). REASON_BIT covers the 12 blocked reason codes (uint16, 4 spare); FLAG_BIT
 * covers the 9 heuristic check ids that can land on a Written unit (uint16).
 *
 * These are NOT a partition of QcCheckId: the split is per-flag SEVERITY, so a
 * check id can straddle both maps — `markdown-structure` is a blocked reason
 * (`md-block-lost`) on a dropped heading AND a heuristic flag on paragraph drift.
 *
 * Indices are APPEND-ONLY (never renumber; append within the 16-bit width is a
 * no-version-bump change, widening the field is a wire-version bump). The keyed
 * `Record` types below are the compile-time exhaustiveness guard: a new reason
 * code or heuristic flag fails the build until it is assigned a bit.
 */
import type { ReasonCode } from '../plan/types';
import type { QcCheckId } from '../../utils/translation/qc/types';

/** The QcCheckIds that can appear as heuristic (warning/info) flags on a Written unit. */
export type HeuristicFlagId =
  | 'length-mismatch'
  | 'source-fallback'
  | 'no-op'
  | 'length-ratio'
  | 'paragraph-count'
  | 'seo-truncated'
  | 'json-validity'
  | 'copied-from-source'
  | 'markdown-structure';

// Compile-time proof that every HeuristicFlagId is a real QcCheckId.
type _FlagIdsAreCheckIds = HeuristicFlagId extends QcCheckId ? true : never;
const _flagIdsAreCheckIds: _FlagIdsAreCheckIds = true;
void _flagIdsAreCheckIds;

const REASON_BIT: Record<ReasonCode, number> = {
  'locale-would-drop': 0,
  'locales-incomplete': 1,
  'required-blank': 2,
  'length-validator': 3,
  'block-count-mismatch': 4,
  'block-id-leak': 5,
  'placeholder-lost': 6,
  'html-block-lost': 7,
  'md-block-lost': 8,
  'segment-misalignment': 9,
  truncated: 10,
  'source-drifted': 11,
};

const FLAG_BIT: Record<HeuristicFlagId, number> = {
  'length-mismatch': 0,
  'source-fallback': 1,
  'no-op': 2,
  'length-ratio': 3,
  'paragraph-count': 4,
  'seo-truncated': 5,
  'json-validity': 6,
  'copied-from-source': 7,
  'markdown-structure': 8,
};

const REASON_BY_BIT = new Map<number, ReasonCode>(
  (Object.entries(REASON_BIT) as [ReasonCode, number][]).map(([code, bit]) => [bit, code]),
);
const FLAG_BY_BIT = new Map<number, HeuristicFlagId>(
  (Object.entries(FLAG_BIT) as [HeuristicFlagId, number][]).map(([id, bit]) => [bit, id]),
);

/** Packs blocked reason codes into a uint16 bitfield. */
export function reasonCodesToBits(codes: readonly ReasonCode[]): number {
  let bits = 0;
  for (const code of codes) bits |= 1 << REASON_BIT[code];
  return bits & 0xffff;
}

/** Unpacks a uint16 reason bitfield into codes (ascending bit order). */
export function bitsToReasonCodes(bits: number): ReasonCode[] {
  const codes: ReasonCode[] = [];
  for (let bit = 0; bit < 16; bit += 1) {
    if (bits & (1 << bit)) {
      const code = REASON_BY_BIT.get(bit);
      if (code) codes.push(code);
    }
  }
  return codes;
}

/** True for a check id that has a heuristic-flag bit. */
export function isHeuristicFlagId(checkId: QcCheckId): checkId is HeuristicFlagId {
  return checkId in FLAG_BIT;
}

/**
 * Packs heuristic flag ids into a uint16 bitfield.
 * @throws If a non-heuristic check id is passed (a categorization bug — invariant
 * ids belong in the reason field, not here).
 */
export function flagIdsToBits(ids: readonly QcCheckId[]): number {
  let bits = 0;
  for (const id of ids) {
    if (!isHeuristicFlagId(id)) throw new Error(`"${id}" is not a heuristic flag id`);
    bits |= 1 << FLAG_BIT[id];
  }
  return bits & 0xffff;
}

/** Unpacks a uint16 flag bitfield into heuristic check ids (ascending bit order). */
export function bitsToFlagIds(bits: number): HeuristicFlagId[] {
  const ids: HeuristicFlagId[] = [];
  for (let bit = 0; bit < 16; bit += 1) {
    if (bits & (1 << bit)) {
      const id = FLAG_BY_BIT.get(bit);
      if (id) ids.push(id);
    }
  }
  return ids;
}
