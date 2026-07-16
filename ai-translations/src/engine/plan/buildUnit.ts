/**
 * Builds one {@link RecordLocaleUnit}: all cells for a single target locale of a
 * record — the decision/report unit (spec §3).
 *
 * Cell inclusion enforces the DatoCMS Locale Sync Rule (spec §5): for a locale
 * ALREADY on the record, only `translate`/`copy` fields need a cell (omitting an
 * `exclude` field preserves its existing value). For a NEW locale, EVERY
 * localized field must be written or the whole update 422s with
 * VALIDATION_INVALID_LOCALES — so all localized fields get a cell (the
 * completeness fill).
 */
import { buildCell } from './buildCell';
import type { PlanField, PlanPolicy, PlanRecord } from './buildPlanTypes';
import type { RecordLocaleUnit } from './types';

export function buildRecordLocaleUnit(args: {
  record: PlanRecord;
  fields: PlanField[];
  toLocale: string;
  fromLocale: string;
  policy: PlanPolicy;
  allLocalesRequired: boolean;
  existingLocales: Set<string>;
}): RecordLocaleUnit {
  const { record, fields, toLocale, fromLocale, policy, allLocalesRequired, existingLocales } =
    args;
  const isNewLocale = !existingLocales.has(toLocale.toLowerCase());
  const cells = [];
  for (const field of fields) {
    if (!field.isLocalized) continue;
    const cell = buildCell({ field, record, toLocale, fromLocale, policy, allLocalesRequired });
    // New locale → keep every localized field (completeness). Existing locale →
    // keep only fields we actually write; an excluded field's existing value stays.
    if (isNewLocale || cell.fate !== 'exclude') cells.push(cell);
  }
  return { toLocale, isNewLocale, cells };
}
