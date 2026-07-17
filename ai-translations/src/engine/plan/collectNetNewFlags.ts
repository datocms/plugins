/**
 * The seam's net-new flag collector (integration spec §4.1/§5): runs ONLY the
 * invariants the engine does NOT already emit — block-structure and
 * block-id-provenance — over genuinely-translated cells. Disjoint by checkId from
 * the engine's qcFlags (truncated/length/placeholder/structural/copied) and from
 * the assembly-time body pass (cannot-be-blank/locale-preservation/completeness).
 */
import type { QcCheckId, QcFlag } from '../../utils/translation/qc/types';
import { checkBlockStructure } from './checks/blockStructure';
import { checkBlockIdProvenance } from './checks/blockIdProvenance';
import { unitKey } from './conform';
import type { ReconstructedCell } from './collectUnitFlags';
import type { CellPlan, TranslationPlan } from './types';

export const SEAM_NET_NEW_CHECK_IDS: readonly QcCheckId[] = [
  'block-structure',
  'block-id-provenance',
];

export function checkNetNewCell(args: {
  cell: CellPlan;
  translatedValue: unknown;
  sourceValue?: unknown;
}): QcFlag[] {
  const { cell, translatedValue, sourceValue } = args;
  const { fieldPath, toLocale: locale, expected } = cell;
  const flags: QcFlag[] = [];
  if (expected.blockSignature) {
    const flag = checkBlockStructure({
      value: translatedValue,
      expected: expected.blockSignature,
      fieldPath,
      locale,
    });
    if (flag) flags.push(flag);
  }
  if (sourceValue !== undefined) {
    const flag = checkBlockIdProvenance({ sourceValue, targetValue: translatedValue, fieldPath, locale });
    if (flag) flags.push(flag);
  }
  return flags;
}

export function collectNetNewFlags(
  plan: TranslationPlan,
  resultFor: (recordId: string, fieldPath: string, toLocale: string) => ReconstructedCell | undefined,
): Map<string, QcFlag[]> {
  const byUnit = new Map<string, QcFlag[]>();
  for (const record of plan.records) {
    for (const unit of record.units) {
      const key = unitKey(record.recordId, unit.toLocale);
      for (const cell of unit.cells) {
        const result = resultFor(record.recordId, cell.fieldPath, unit.toLocale);
        if (!result) continue;
        const flags = checkNetNewCell({
          cell,
          translatedValue: result.translatedValue,
          sourceValue: result.sourceValue,
        });
        if (flags.length === 0) continue;
        const existing = byUnit.get(key);
        if (existing) existing.push(...flags);
        else byUnit.set(key, [...flags]);
      }
    }
  }
  return byUnit;
}
