/**
 * The record-level write orchestration (integration spec §3): turns the engine's
 * per-locale results into the single items.update body + per-(record,locale)
 * outcomes, via the two-tier conform gate. Pure — the caller supplies the engine
 * results and does the actual CMA write.
 *
 * Two passes (spec §3 step 5-6): (1) per-cell flags = the engine's own qcFlags
 * (truncated/length/placeholder/structural/copied) merged with the net-new
 * invariants (block-structure/block-id-provenance) over genuinely-translated
 * cells; conform → provisional Written set → provisional body. (2) the body-pass
 * (locale-preservation/cannot-be-blank/completeness) runs on that body and can
 * demote more units; re-conform → final Written set → final body. A Blocked
 * locale contributes nothing to the body.
 */
import type { QcFlag } from '../../utils/translation/qc/types';
import { assembleRecordPayload, type WrittenLocalePayload } from './assemblePayload';
import { checkAssembledBody } from './checkAssembledBody';
import { collectNetNewFlags } from './collectNetNewFlags';
import { conform, unitKey } from './conform';
import { reconstructTranslatedCells } from './reconstructTranslatedCells';
import type { PlanRecord } from './buildPlanTypes';
import type { TranslationPlan, UnitOutcome } from './types';

/** Structural subset of the engine's per-locale result the orchestration needs. */
export interface EngineLocaleResult {
  payload: Record<string, Record<string, unknown>>;
  qcFlags: QcFlag[];
  translatedFields: string[];
}

export function orchestrateRecordOutcome(args: {
  plan: TranslationPlan;
  record: PlanRecord;
  fromLocale: string;
  localeResults: Map<string, EngineLocaleResult>;
}): { body: Record<string, Record<string, unknown>>; outcomes: UnitOutcome[] } {
  const { plan, record, fromLocale, localeResults } = args;
  const recordPlan = plan.records[0];
  const recordId = recordPlan.recordId;

  // Per-cell flags: engine qcFlags (per locale) + net-new invariants.
  const perCell = new Map<string, QcFlag[]>();
  const add = (key: string, flags: QcFlag[]): void => {
    if (flags.length === 0) return;
    const existing = perCell.get(key);
    if (existing) existing.push(...flags);
    else perCell.set(key, [...flags]);
  };
  for (const [toLocale, lr] of localeResults) add(unitKey(recordId, toLocale), lr.qcFlags);
  const netNew = collectNetNewFlags(plan, (rid, fieldPath, toLocale) => {
    const lr = localeResults.get(toLocale);
    if (!lr) return undefined;
    return reconstructTranslatedCells({
      payload: lr.payload,
      translatedFields: lr.translatedFields,
      record,
      fromLocale,
      toLocale,
    })(rid, fieldPath, toLocale);
  });
  for (const [key, flags] of netNew) add(key, flags);

  const assembleFor = (writtenLocales: Set<string>) => {
    const payloads: WrittenLocalePayload[] = [];
    for (const [toLocale, lr] of localeResults) {
      if (!writtenLocales.has(toLocale)) continue;
      const fields: Record<string, unknown> = {};
      for (const field of Object.keys(lr.payload)) {
        if (toLocale in lr.payload[field]) fields[field] = lr.payload[field][toLocale];
      }
      payloads.push({ toLocale, fields });
    }
    return assembleRecordPayload(record, payloads);
  };

  const writtenOf = (outcomes: UnitOutcome[]): Set<string> =>
    new Set(outcomes.filter((o) => o.bucket === 'written').map((o) => o.toLocale));

  // Pass 1: per-cell verdicts → provisional body.
  const provisionalBody = assembleFor(writtenOf(conform(plan, perCell)));

  // Pass 2: body-pass flags merged in → final verdicts → final body.
  const withBody = new Map<string, QcFlag[]>();
  for (const [k, v] of perCell) withBody.set(k, [...v]);
  for (const flag of checkAssembledBody({ body: provisionalBody, recordPlan })) {
    if (!flag.locale) continue;
    const key = unitKey(recordId, flag.locale);
    const arr = withBody.get(key);
    if (arr) arr.push(flag);
    else withBody.set(key, [flag]);
  }
  const outcomes = conform(plan, withBody);
  const body = assembleFor(writtenOf(outcomes));

  return { body, outcomes };
}
