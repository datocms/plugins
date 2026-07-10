/**
 * Phase 1 deterministic QC checks. Each is a pure function returning a
 * {@link QcFlag} when the translation is suspect, or `null` when it passes.
 */

import type { QcFlag } from './types';

/** Provider finish/stop reasons that mean the response was cut off mid-output. */
const TRUNCATION_MARKERS = new Set(['length', 'max_tokens', 'MAX_TOKENS']);

/**
 * Flags when the model returned a different number of array elements than were
 * sent. The output is still repaired positionally upstream, but a mismatch
 * means content may have been padded with source text or dropped.
 *
 * This is `warning`-tier: the repair produces a schema-valid value and the
 * mismatch is a *suspicion* of incompleteness (routine for multi-leaf inline
 * content), not a certain corruption. Escalating it to a record failure
 * misreported correctly-saved records as failed. A segment that actually
 * reverted to its untranslated source is reported separately by the
 * `source-fallback` check.
 */
export function checkLengthMismatch(args: {
  expected: number;
  received: number;
  fieldPath?: string;
  locale?: string;
}): QcFlag | null {
  const { expected, received, fieldPath, locale } = args;
  if (received === expected) return null;
  return {
    checkId: 'length-mismatch',
    severity: 'warning',
    fieldPath,
    locale,
    message: `Model returned ${received} segment(s) for ${expected} sent; output was repaired and may be incomplete.`,
  };
}

/**
 * Flags when a protected placeholder token (e.g. `⟦PH_0⟧`) injected before
 * translation is missing from the model output, which corrupts the
 * ICU/printf/`{{var}}` it masked.
 */
export function checkPlaceholderSurvival(args: {
  tokens: string[];
  output: string;
  segmentIndex: number;
  fieldPath?: string;
  locale?: string;
}): QcFlag | null {
  const { tokens, output, segmentIndex, fieldPath, locale } = args;
  const missing = tokens.filter((token) => !output.includes(token));
  if (missing.length === 0) return null;
  return {
    checkId: 'placeholder-loss',
    severity: 'error',
    segmentIndex,
    fieldPath,
    locale,
    message: `${missing.length} placeholder(s) lost in translation of segment ${segmentIndex}.`,
  };
}

/**
 * Flags when the provider signalled it cut the response off at the
 * output-token limit — the authoritative, script-independent truncation signal.
 */
export function checkTruncated(args: {
  finishReason?: string;
  fieldPath?: string;
  locale?: string;
}): QcFlag | null {
  const { finishReason, fieldPath, locale } = args;
  if (!finishReason || !TRUNCATION_MARKERS.has(finishReason)) return null;
  return {
    checkId: 'truncated',
    severity: 'error',
    fieldPath,
    locale,
    message:
      'Provider cut the response off at the output-token limit; translation is incomplete.',
  };
}
