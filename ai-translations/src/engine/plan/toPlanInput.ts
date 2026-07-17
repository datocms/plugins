/**
 * Adapters from the live CMA/plugin shapes to the pure `buildPlan` input
 * (integration spec §4). Pure: `all_locales_required` and the policy are passed
 * in (the live caller reads them via SchemaRepository / plugin params), so this
 * stays testable and side-effect-free.
 *
 * Shape drift is the risk the review flagged: `preservedLocales` must end up
 * equal to the record's actual locale keys, so the record's field values pass
 * through untouched (localized fields stay `{ locale: value }`).
 */
import type { FieldTypeDictionary } from '../../utils/translation/SharedFieldUtils';
import type { BuildPlanInput, PlanField, PlanPolicy, PlanRecord } from './buildPlanTypes';

/** A CMA record: id + item_type.id + meta + field values keyed by api key. */
export interface ApiRecord {
  id: string;
  item_type: { id: string };
  meta?: { current_version?: string };
  [apiKey: string]: unknown;
}

/** Maps a CMA record to a PlanRecord (field values pass through untouched). */
export function toPlanRecord(record: ApiRecord): PlanRecord {
  const { item_type, ...rest } = record;
  return { ...rest, id: record.id, itemTypeId: item_type.id } as PlanRecord;
}

/** Maps a FieldTypeDictionary (keyed by api key) to PlanField[]. */
export function toPlanFields(dictionary: FieldTypeDictionary): PlanField[] {
  return Object.entries(dictionary).map(([apiKey, meta]) => ({
    id: meta.id,
    apiKey,
    fieldType: meta.editor,
    isLocalized: meta.isLocalized,
    validators: meta.validators ?? {},
  }));
}

/**
 * Assembles a single-record BuildPlanInput for the bulk seam. The caller supplies
 * the fetched `allLocalesRequired`, the locked `policy`, and its `policyDigest`.
 */
export function toPlanInput(args: {
  record: ApiRecord;
  dictionary: FieldTypeDictionary;
  allLocalesRequired: boolean;
  policy: PlanPolicy;
  policyDigest: string;
  fromLocale: string;
  toLocales: string[];
}): BuildPlanInput {
  const itemTypeId = args.record.item_type.id;
  return {
    records: [toPlanRecord(args.record)],
    fieldsByItemType: new Map([[itemTypeId, toPlanFields(args.dictionary)]]),
    allLocalesRequiredByItemType: new Map([[itemTypeId, args.allLocalesRequired]]),
    policy: args.policy,
    fromLocale: args.fromLocale,
    toLocales: args.toLocales,
    policyDigest: args.policyDigest,
  };
}
