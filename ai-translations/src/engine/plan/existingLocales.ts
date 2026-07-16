/**
 * Determines which locales a source record already carries, by unioning the
 * locale keys present across its localized field values. Drives the new-locale
 * completeness fill (spec §5): a target locale absent from this set is "new" to
 * the record and requires every localized field to be written (Locale Sync Rule).
 */
import type { PlanField, PlanRecord } from './buildPlanTypes';

/** Union (lowercased) of locale keys present on the record's localized fields. */
export function existingLocalesOf(
  record: PlanRecord,
  fields: PlanField[],
): Set<string> {
  const locales = new Set<string>();
  for (const field of fields) {
    if (!field.isLocalized) continue;
    const value = record[field.apiKey];
    if (value && typeof value === 'object' && !Array.isArray(value)) {
      for (const key of Object.keys(value as Record<string, unknown>)) {
        locales.add(key.toLowerCase());
      }
    }
  }
  return locales;
}
