/**
 * Inputs to {@link buildPlan}: the schema, source records, and locked policy it
 * turns into a TranslationPlan. All pure data — the caller reads these from
 * `ctx` and hands them in. See docs/superpowers/specs/2026-07-16-translation-plan-design.md §5.
 */
import type { FieldValidators } from '../../utils/translation/SharedFieldUtils';

/** A field's plan-relevant schema metadata. */
export interface PlanField {
  id: string;
  apiKey: string;
  fieldType: string;
  isLocalized: boolean;
  validators: FieldValidators;
}

/**
 * A source record as fetched from the CMA: field values keyed by api key
 * (localized fields hold a `{ locale: value }` object), plus optional meta.
 */
export interface PlanRecord {
  id: string;
  itemTypeId: string;
  meta?: { current_version?: string };
  [apiKey: string]: unknown;
}

/** The locked admin policy (spec §5) — the two field lists the tree writes. */
export interface PlanPolicy {
  excludedTokens: string[];
  copyTokens: string[];
}

/** Everything {@link buildPlan} needs to produce a TranslationPlan. */
export interface BuildPlanInput {
  records: PlanRecord[];
  fieldsByItemType: Map<string, PlanField[]>;
  allLocalesRequiredByItemType: Map<string, boolean>;
  policy: PlanPolicy;
  fromLocale: string;
  toLocales: string[];
  policyDigest: string;
}
