/**
 * Renders human-facing text from machine reason codes at display time
 * (persistence spec §2: messages are derived from codes, never stored — the
 * artifact stays small and stable when copy changes). One entry per
 * {@link ReasonCode}; the exhaustive map is enforced by the `Record` type.
 */
import type { ReasonCode } from '../plan/types';

const REASON_MESSAGES: Record<ReasonCode, string> = {
  'locale-would-drop':
    'Writing this record would delete an existing locale — blocked to protect your data.',
  'locales-incomplete':
    'A new locale was missing on some fields, which the CMS would reject — blocked.',
  'required-blank': 'A required field came back empty — the CMS would reject the save.',
  'length-validator': 'A field is over or under its character limit — the CMS would reject it.',
  'block-count-mismatch': 'The translated block structure differs from the source — a block was dropped or added.',
  'block-id-leak': 'A source block reference leaked into the target locale — blocked to avoid shared blocks.',
  'placeholder-lost': 'A placeholder or variable was lost in translation.',
  'html-block-lost': 'The translated HTML is missing a heading, list, table, or other structural block.',
  'md-block-lost': 'The translated Markdown is missing a heading, list, code block, or link.',
  'segment-misalignment': 'Translated segments came back out of order or count — content may be shifted.',
  truncated: 'The provider cut the response off at its output limit — the translation is incomplete.',
  'source-drifted': 'The record changed while translating — re-run it to pick up the latest version.',
};

/** Human-facing message for a blocked-cell reason code. */
export function describeReasonCode(code: ReasonCode): string {
  return REASON_MESSAGES[code];
}
