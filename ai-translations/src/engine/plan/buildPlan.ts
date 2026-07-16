/**
 * buildPlan (Stage A of the plan/apply architecture): turns the schema, source
 * records, and locked policy into a {@link TranslationPlan} — the producer half
 * that feeds `conform`. Pure and pre-flight: no CMA, no providers. See
 * docs/superpowers/specs/2026-07-16-translation-plan-design.md §5.
 */
import { buildRecordLocaleUnit } from './buildUnit';
import { existingLocalesOf } from './existingLocales';
import type { BuildPlanInput } from './buildPlanTypes';
import type { RecordPlan, TranslationPlan } from './types';

export function buildPlan(input: BuildPlanInput): TranslationPlan {
  const {
    records,
    fieldsByItemType,
    allLocalesRequiredByItemType,
    policy,
    fromLocale,
    toLocales,
    policyDigest,
  } = input;

  const recordPlans: RecordPlan[] = records.map((record) => {
    const fields = fieldsByItemType.get(record.itemTypeId) ?? [];
    const allLocalesRequired = allLocalesRequiredByItemType.get(record.itemTypeId) ?? false;
    const existingLocales = existingLocalesOf(record, fields);
    const units = toLocales.map((toLocale) =>
      buildRecordLocaleUnit({
        record,
        fields,
        toLocale,
        fromLocale,
        policy,
        allLocalesRequired,
        existingLocales,
      }),
    );
    return {
      recordId: record.id,
      itemTypeId: record.itemTypeId,
      fromLocale,
      sourceVersion: record.meta?.current_version ?? '',
      allLocalesRequired,
      units,
    };
  });

  return { records: recordPlans, policyDigest };
}
