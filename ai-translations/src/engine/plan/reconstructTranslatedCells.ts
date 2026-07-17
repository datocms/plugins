/**
 * Builds the reconstruct lookup for the net-new invariants, restricted by
 * PROVENANCE (integration spec §4): only fields the provider genuinely translated
 * (`translatedFields`) are judged. Copied / fallback-filled / failed fields return
 * `undefined`, so block-structure/block-id-provenance never fire against a fallback
 * null. The write body, separately, uses the engine payload verbatim.
 */
import { getExactSourceValue } from '../../utils/translation/SharedFieldUtils';
import type { ReconstructedCell } from './collectUnitFlags';

export function reconstructTranslatedCells(args: {
  payload: Record<string, Record<string, unknown>>;
  translatedFields: string[];
  record: Record<string, unknown>;
  fromLocale: string;
  toLocale: string;
}): (recordId: string, fieldPath: string, locale: string) => ReconstructedCell | undefined {
  const translated = new Set(args.translatedFields);
  return (_recordId, fieldPath, locale) => {
    if (locale !== args.toLocale || !translated.has(fieldPath)) return undefined;
    return {
      translatedValue: args.payload[fieldPath]?.[args.toLocale],
      sourceValue: getExactSourceValue(
        args.record[fieldPath] as Record<string, unknown> | undefined,
        args.fromLocale,
      ),
    };
  };
}
