/**
 * The conformance keystone: turns per-unit QC flags into per-(record,locale)
 * verdicts. Two-tier contract (spec §2/§9): a unit with ANY invariant (error)
 * flag is Blocked with reason codes; otherwise it is Written with any heuristic
 * (warning/info) flags attached. Pure. Payload assembly and the write live in the
 * follow-on plan. (spec §3, §7)
 */
import type { QcFlag } from '../../utils/translation/qc/types';
import { reasonCodeFor } from './reasonCode';
import type { TranslationPlan, UnitOutcome } from './types';
import { tierOf } from './types';

/** Stable key for a (record, target-locale) decision unit. */
export function unitKey(recordId: string, toLocale: string): string {
  return `${recordId}:${toLocale}`;
}

export function conform(
  plan: TranslationPlan,
  flagsByUnit: Map<string, QcFlag[]>,
): UnitOutcome[] {
  const outcomes: UnitOutcome[] = [];
  for (const record of plan.records) {
    for (const unit of record.units) {
      const flags = flagsByUnit.get(unitKey(record.recordId, unit.toLocale)) ?? [];
      const invariants = flags.filter((f) => tierOf(f.severity) === 'invariant');
      if (invariants.length > 0) {
        outcomes.push({
          recordId: record.recordId,
          toLocale: unit.toLocale,
          bucket: 'blocked',
          reasons: invariants.map((f) => ({
            fieldPath: f.fieldPath ?? unit.toLocale,
            code: reasonCodeFor(f.checkId),
            message: f.message,
          })),
          flags: [],
        });
      } else {
        outcomes.push({
          recordId: record.recordId,
          toLocale: unit.toLocale,
          bucket: 'written',
          reasons: [],
          flags: flags.map((f) => ({ checkId: f.checkId, message: f.message })),
        });
      }
    }
  }
  return outcomes;
}
