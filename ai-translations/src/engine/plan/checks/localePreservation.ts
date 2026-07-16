/**
 * Invariant: the field value about to be sent must still carry every locale it
 * had before. DatoCMS localized fields are replace-not-merge on `items.update` —
 * a previously-present locale omitted from the outgoing value is DELETED (spec
 * §3). This is the last-line guard against silent data loss: a violation blocks
 * the write for that (record,locale). (spec §5/§9)
 */
import type { QcFlag } from '../../../utils/translation/qc/types';

/** Locale keys present on a field value (lowercased), or empty for a non-object. */
function presentLocales(value: unknown): Set<string> {
  if (value === null || typeof value !== 'object' || Array.isArray(value)) {
    return new Set();
  }
  return new Set(Object.keys(value as Record<string, unknown>).map((k) => k.toLowerCase()));
}

export function checkLocalePreservation(args: {
  outgoing: unknown;
  preservedLocales: string[];
  fieldPath?: string;
  locale?: string;
}): QcFlag | null {
  const { outgoing, preservedLocales, fieldPath, locale } = args;
  if (preservedLocales.length === 0) return null;
  const present = presentLocales(outgoing);
  const missing = preservedLocales.filter((l) => !present.has(l.toLowerCase()));
  if (missing.length === 0) return null;
  return {
    checkId: 'locale-preservation',
    severity: 'error',
    fieldPath,
    locale,
    message: `Outgoing value would drop existing locale(s): ${missing.join(', ')}; DatoCMS deletes omitted locales, so the write is blocked.`,
  };
}
