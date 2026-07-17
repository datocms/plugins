/**
 * Invariant: when a NEW locale is added to a record, EVERY localized field must
 * carry it in the write body, or the CMA rejects the whole update with
 * VALIDATION_INVALID_LOCALES (Locale Sync Rule). Runs at assembly time on the
 * final body (integration spec §5). Existing locales are exempt (omitting a field
 * for them preserves its value).
 */
import type { QcFlag } from '../../../utils/translation/qc/types';
import type { RecordPlan } from '../types';

export function checkLocaleCompleteness(args: {
  body: Record<string, Record<string, unknown>>;
  recordPlan: RecordPlan;
}): QcFlag[] {
  const flags: QcFlag[] = [];
  for (const unit of args.recordPlan.units) {
    if (!unit.isNewLocale) continue;
    for (const cell of unit.cells) {
      const field = args.body[cell.fieldPath];
      const present = field !== undefined && cell.toLocale in field;
      if (!present) {
        flags.push({
          checkId: 'locale-completeness',
          severity: 'error',
          fieldPath: cell.fieldPath,
          locale: unit.toLocale,
          message: `New locale "${unit.toLocale}" is missing field "${cell.fieldPath}"; the CMA would reject the whole record.`,
        });
      }
    }
  }
  return flags;
}
