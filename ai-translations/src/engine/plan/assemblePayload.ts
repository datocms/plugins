/**
 * Assembles the single `items.update` field payload for one record from its
 * WRITTEN locale results (spec §3: one write per record). Each field spreads its
 * existing locale object once, then overlays each written locale — so locales
 * not touched this run are preserved (replace-not-merge safety) and Blocked
 * locales, which the caller omits from `written`, never reach the payload.
 * Pure: performs no CMA call.
 */
import type { PlanRecord } from './buildPlanTypes';

/** One target locale's reconstructed field values, keyed by field path. */
export interface WrittenLocalePayload {
  toLocale: string;
  fields: Record<string, unknown>;
}

export function assembleRecordPayload(
  record: PlanRecord,
  written: WrittenLocalePayload[],
): Record<string, Record<string, unknown>> {
  const payload: Record<string, Record<string, unknown>> = {};
  for (const { toLocale, fields } of written) {
    for (const [fieldPath, value] of Object.entries(fields)) {
      if (!payload[fieldPath]) {
        const existing = record[fieldPath];
        payload[fieldPath] =
          existing !== null && typeof existing === 'object' && !Array.isArray(existing)
            ? { ...(existing as Record<string, unknown>) }
            : {};
      }
      payload[fieldPath][toLocale] = value;
    }
  }
  return payload;
}
