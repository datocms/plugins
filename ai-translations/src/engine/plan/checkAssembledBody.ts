/**
 * The assembly-time gate (integration spec §5): runs the body-level invariants
 * over the FINAL items.update body — locale-preservation (per field; a drop
 * blocks the whole record), cannot-be-blank (per field×locale), and
 * locale-completeness. Emitted flags carry fieldPath+locale; the seam keys them
 * into flagsByUnit before conform.
 */
import type { QcFlag } from '../../utils/translation/qc/types';
import { checkCannotBeBlank } from './checks/cannotBeBlank';
import { checkLocalePreservation } from './checks/localePreservation';
import { checkLocaleCompleteness } from './checks/localeCompleteness';
import type { CellPlan, RecordPlan } from './types';

export function checkAssembledBody(args: {
  body: Record<string, Record<string, unknown>>;
  recordPlan: RecordPlan;
}): QcFlag[] {
  const { body, recordPlan } = args;
  const targetLocales = recordPlan.units.map((u) => u.toLocale);
  const flags: QcFlag[] = [];

  // preservedLocales is a per-field fact (same across units); pick any cell.
  const cellByField = new Map<string, CellPlan>();
  for (const unit of recordPlan.units) for (const cell of unit.cells) cellByField.set(cell.fieldPath, cell);

  for (const [fieldPath, cell] of cellByField) {
    const drop = checkLocalePreservation({
      outgoing: body[fieldPath],
      preservedLocales: cell.expected.preservedLocales,
      fieldPath,
    });
    // A dropped locale poisons the single per-record write — block every target locale.
    if (drop) for (const locale of targetLocales) flags.push({ ...drop, locale });
  }

  for (const unit of recordPlan.units) {
    for (const cell of unit.cells) {
      if (!cell.cannotBeBlank) continue;
      const blank = checkCannotBeBlank({
        value: body[cell.fieldPath]?.[unit.toLocale],
        cannotBeBlank: true,
        fieldPath: cell.fieldPath,
        locale: unit.toLocale,
      });
      if (blank) flags.push(blank);
    }
  }

  flags.push(...checkLocaleCompleteness({ body, recordPlan }));
  return flags;
}
