/**
 * Walks a {@link TranslationPlan}, runs the per-cell invariants against each
 * cell's reconstructed value, and groups the resulting QC flags by
 * (record,locale) unit key — producing exactly the map {@link conform} consumes.
 * The pure seam between reconstruct and conform: the orchestration layer supplies
 * `resultFor` (a lookup into the reconstructed output); everything here is pure.
 */
import type { QcFlag } from '../../utils/translation/qc/types';
import { checkReconstructedCell } from './checkCell';
import { unitKey } from './conform';
import type { TranslationPlan } from './types';

/** The reconstructed value for one cell, plus context the invariants need. */
export interface ReconstructedCell {
  translatedValue: unknown;
  sourceValue?: unknown;
  finishReason?: string;
}

export function collectUnitFlags(
  plan: TranslationPlan,
  resultFor: (
    recordId: string,
    fieldPath: string,
    toLocale: string,
  ) => ReconstructedCell | undefined,
): Map<string, QcFlag[]> {
  const byUnit = new Map<string, QcFlag[]>();
  for (const record of plan.records) {
    for (const unit of record.units) {
      const key = unitKey(record.recordId, unit.toLocale);
      for (const cell of unit.cells) {
        const result = resultFor(record.recordId, cell.fieldPath, unit.toLocale);
        if (!result) continue;
        const flags = checkReconstructedCell({
          cell,
          translatedValue: result.translatedValue,
          sourceValue: result.sourceValue,
          finishReason: result.finishReason,
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
