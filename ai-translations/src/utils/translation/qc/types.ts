/**
 * Quality-control (QC) flag model for translation completeness checks.
 *
 * Checks are pure functions returning a {@link QcFlag} (or `null` when the
 * translation passed). Flags bubble up out of `translateArray` via the
 * non-breaking `onQcFlag` callback; the UI layer (sidebar / bulk) collects and
 * surfaces them. See docs/superpowers/specs/2026-06-23-translation-qc-design.md.
 */

/** Whether a defect corrupts the stored value (`error`) or is a suspicion (`warning`). */
export type QcSeverity = 'error' | 'warning';

/**
 * Identifier for each QC check. Phase 1 ships the deterministic three; the rest
 * are reserved for Phase 2 (structural / heuristic).
 */
export type QcCheckId =
  | 'length-mismatch'
  | 'source-fallback'
  | 'placeholder-loss'
  | 'truncated'
  | 'html-structure'
  | 'markdown-structure'
  | 'no-op'
  | 'length-ratio'
  | 'length-validator'
  | 'seo-truncated'
  | 'json-validity';

/** A single completeness finding for one field/locale (optionally one segment). */
export type QcFlag = {
  checkId: QcCheckId;
  severity: QcSeverity;
  /** DatoCMS field api key / path, when known at emit time. */
  fieldPath?: string;
  /** Target locale, when known at emit time. */
  locale?: string;
  /** Index within a multi-segment value, when applicable. */
  segmentIndex?: number;
  /**
   * How many segments a field-wide aggregate flag covers (e.g. the number of
   * reverted slots behind a `source-fallback`). Summed when per-chunk flags for
   * the same field are coalesced into one. Undefined for single-segment flags.
   */
  count?: number;
  /** Human-facing, normalized message. */
  message: string;
};

/** Sink for emitted flags; threaded through translation calls as an optional callback. */
export type OnQcFlag = (flag: QcFlag) => void;
