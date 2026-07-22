/**
 * Translation Plan intermediate representation (IR) and the conformance outcome
 * model. See docs/superpowers/specs/2026-07-16-translation-plan-design.md §5, §7.
 * All types here are pure data; no behavior beyond {@link tierOf}.
 */
import type { QcCheckId, QcSeverity } from '../../utils/translation/qc/types';

/** Per-field disposition from the locked policy. UI labels `exclude` as "Skip". */
export type Fate = 'translate' | 'copy' | 'exclude';

/** Recursive block-count signature: blocks at this level plus each child's shape. */
export interface BlockSignature {
  count: number;
  children: BlockSignature[];
}

/** The contract a cell's reconstructed value is verified against (spec §5). */
export interface CellExpectation {
  /** Locales that must survive on this field (replace-not-merge guard). */
  preservedLocales: string[];
  blockSignature?: BlockSignature;
  /** Structural HTML block-tag multiset — `<p>` EXCLUDED (it is a heuristic). */
  htmlBlocks?: Record<string, number>;
  /** Structural Markdown block multiset — paragraphs EXCLUDED. */
  mdBlocks?: Record<string, number>;
  placeholders?: string[];
  lengthBounds?: { min?: number; eq?: number; max?: number };
  /** For array/multi-block fields: elements sent (== expected received). */
  segmentCount?: number;
  /** Per-segment source id/hash, to detect positional drift. */
  segmentAnchors?: string[];
}

/** One field, one target locale — the leaf of the plan. */
export interface CellPlan {
  fieldPath: string;
  fieldType: string;
  toLocale: string;
  fate: Fate;
  /** `cannotBeBlank(validators)` — NOT the `required` validator (spec §5). */
  cannotBeBlank: boolean;
  expected: CellExpectation;
}

/** All cells for one target locale of a record — the decision/report unit. */
export interface RecordLocaleUnit {
  toLocale: string;
  isNewLocale: boolean;
  cells: CellPlan[];
}

/** One record — the WRITE unit (one items.update, one version). */
export interface RecordPlan {
  recordId: string;
  itemTypeId: string;
  fromLocale: string;
  /** `meta.current_version` at plan time; undefined for a record with no version (write omits meta). */
  sourceVersion?: string;
  allLocalesRequired: boolean;
  units: RecordLocaleUnit[];
}

export interface TranslationPlan {
  records: RecordPlan[];
  policyDigest: string;
}

/** Which report bucket a (record,locale) unit lands in (spec §7). */
export type Bucket = 'written' | 'blocked' | 'not-attempted' | 'written-unverified';

/** Machine-readable cause of a Blocked cell (spec §7). */
export type ReasonCode =
  | 'locale-would-drop'
  | 'locales-incomplete'
  | 'required-blank'
  | 'length-validator'
  | 'block-count-mismatch'
  | 'block-id-leak'
  | 'placeholder-lost'
  | 'html-block-lost'
  | 'md-block-lost'
  | 'segment-misalignment'
  | 'truncated'
  | 'source-drifted';

export interface CellReason {
  fieldPath: string;
  code: ReasonCode;
  message: string;
}

/** A heuristic finding attached to a Written unit. */
export interface CellFlag {
  checkId: QcCheckId;
  message: string;
}

/** The verdict for one (record, target-locale) unit. */
export interface UnitOutcome {
  recordId: string;
  toLocale: string;
  bucket: Bucket;
  reasons: CellReason[];
  flags: CellFlag[];
  preVersion?: string;
  postVersion?: string;
  /** The record's model id — folded onto the record for the per-model resume summary. */
  itemTypeId?: string;
}

export type Tier = 'invariant' | 'heuristic';

/**
 * Maps a QC severity to its conformance tier. `error` corrupts the stored value
 * or guarantees a CMA rejection → invariant (block); everything else is a
 * fallible signal → heuristic (write + flag). (spec §2/§9)
 */
export function tierOf(severity: QcSeverity): Tier {
  return severity === 'error' ? 'invariant' : 'heuristic';
}
