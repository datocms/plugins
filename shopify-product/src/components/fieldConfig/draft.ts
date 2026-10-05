/**
 * Pure state transitions for the field config screen.
 *
 * The screen keeps a draft: normalized field parameters plus the raw text of
 * the min/max inputs. Every change goes through these helpers, so the
 * parameters written with `ctx.setParameters` are always a valid combination
 * for the field type. Min and max are the exception on purpose: they are
 * written as typed (a number, or the raw text when it isn't one), so the
 * plugin's validator can flag them and the host blocks saving until they're
 * fixed.
 */

import { isRecord } from '../../lib/guards';
import {
  allowedCardinalities,
  allowedKinds,
  normalizeFieldParameters,
  normalizeScope,
} from '../../lib/parameters';
import type {
  Cardinality,
  FieldParametersV1,
  FieldScope,
  FieldType,
  ShopifyKind,
  StorageFormat,
} from '../../types';

export type LimitTexts = { min: string; max: string };

export type FieldConfigDraft = {
  params: FieldParametersV1;
  limits: LimitTexts;
};

function limitText(value: unknown): string {
  if (typeof value === 'number' && Number.isFinite(value)) return String(value);
  return typeof value === 'string' ? value : '';
}

/** The draft for whatever the host currently holds (any shape, any version). */
export function draftFromRaw(
  raw: unknown,
  fieldType: FieldType,
): FieldConfigDraft {
  const source = isRecord(raw) ? raw : {};
  return {
    params: normalizeFieldParameters(raw, fieldType),
    limits: { min: limitText(source.min), max: limitText(source.max) },
  };
}

export function draftFromParams(params: FieldParametersV1): FieldConfigDraft {
  return {
    params,
    limits: { min: limitText(params.min), max: limitText(params.max) },
  };
}

const INTEGER_PATTERN = /^-?\d+$/;

/** `''` → no limit; `'3'` → 3; anything else is kept as typed for the validator. */
export function parseLimit(text: string): number | string | undefined {
  const trimmed = text.trim();
  if (!trimmed) return undefined;
  return INTEGER_PATTERN.test(trimmed) ? Number(trimmed) : trimmed;
}

/** The exact object to pass to `ctx.setParameters`. */
export function parametersFromDraft(
  draft: FieldConfigDraft,
): Record<string, unknown> {
  const { paramsVersion, kind, cardinality, format, snapshot } = draft.params;
  const result: Record<string, unknown> = {
    paramsVersion,
    kind,
    cardinality,
    format,
    snapshot,
  };
  if (draft.params.shopDomain) result.shopDomain = draft.params.shopDomain;
  if (draft.params.scope) result.scope = draft.params.scope;
  if (cardinality !== 'multiple') return result;

  const min = parseLimit(draft.limits.min);
  const max = parseLimit(draft.limits.max);
  if (min !== undefined) result.min = min;
  if (max !== undefined) result.max = max;
  return result;
}

/** Re-normalizes a candidate; scope only applies to products and variants. */
function finalize(
  candidate: FieldParametersV1,
  fieldType: FieldType,
): FieldParametersV1 {
  const { scope, ...rest } = candidate;
  const next = rest.kind === 'collection' ? rest : { ...rest, scope };
  return normalizeFieldParameters(next, fieldType);
}

export function withKind(
  params: FieldParametersV1,
  kind: ShopifyKind,
  fieldType: FieldType,
): FieldParametersV1 {
  if (!allowedKinds(params.format).includes(kind)) return params;
  return finalize({ ...params, kind }, fieldType);
}

/** Switches the storage format and resets whatever the new format can't hold. */
export function withFormat(
  params: FieldParametersV1,
  format: StorageFormat,
  fieldType: FieldType,
): FieldParametersV1 {
  const kinds = allowedKinds(format);
  const kind = kinds.includes(params.kind) ? params.kind : 'product';
  const cardinality = allowedCardinalities(format).includes(params.cardinality)
    ? params.cardinality
    : 'single';
  const snapshot = format === 'reference' && params.snapshot;
  return finalize(
    { ...params, format, kind, cardinality, snapshot },
    fieldType,
  );
}

export function withCardinality(
  params: FieldParametersV1,
  cardinality: Cardinality,
  fieldType: FieldType,
): FieldParametersV1 {
  return finalize({ ...params, cardinality }, fieldType);
}

export function withSnapshot(
  params: FieldParametersV1,
  snapshot: boolean,
  fieldType: FieldType,
): FieldParametersV1 {
  return finalize({ ...params, snapshot }, fieldType);
}

/** Merges a scope patch; `undefined` values clear that limit. */
export function withScope(
  params: FieldParametersV1,
  patch: Partial<FieldScope>,
  fieldType: FieldType,
): FieldParametersV1 {
  const scope = normalizeScope({ ...params.scope, ...patch });
  return finalize({ ...params, scope }, fieldType);
}

/**
 * Points the field at a store. Collection IDs belong to one store, so a
 * collection limit is dropped when the store actually changes; text limits
 * (type, vendor, tags) stay. `currentDomain` is the store the field uses now,
 * which for a field without a `shopDomain` is the default (first) store:
 * choosing that one records it and keeps every limit.
 */
export function withStore(
  params: FieldParametersV1,
  shopDomain: string | undefined,
  fieldType: FieldType,
  currentDomain: string | undefined = params.shopDomain,
): FieldParametersV1 {
  if (shopDomain === params.shopDomain) return params;
  const sameStore =
    shopDomain !== undefined && sameDomain(shopDomain, currentDomain);
  const scope = sameStore
    ? params.scope
    : normalizeScope({
        ...params.scope,
        collectionId: undefined,
        collectionTitle: undefined,
      });
  return finalize({ ...params, shopDomain, scope }, fieldType);
}

/** Shop domains compare case-insensitively; two missing domains are equal. */
export function sameDomain(
  a: string | null | undefined,
  b: string | null | undefined,
): boolean {
  return (a ?? '').trim().toLowerCase() === (b ?? '').trim().toLowerCase();
}

/** "A or B" / "A, B or C". */
export function joinWithOr(values: readonly string[]): string {
  if (values.length <= 1) return values.join('');
  return `${values.slice(0, -1).join(', ')} or ${values[values.length - 1]}`;
}

/** Short labels for the active limits, for the collapsed "Limit choices" row. */
export function scopeSummary(scope: FieldScope | undefined): string[] {
  if (!scope) return [];
  const parts: string[] = [];
  if (scope.collectionId) parts.push(scope.collectionTitle ?? 'A collection');
  if (scope.productType) parts.push(scope.productType);
  if (scope.vendor) parts.push(scope.vendor);
  if (scope.tags?.length) parts.push(joinWithOr(scope.tags));
  if (scope.availableOnly) parts.push('Available for sale');
  return parts;
}

function sortedForSignature(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(sortedForSignature);
  if (!isRecord(value)) return value;
  const sorted: Record<string, unknown> = {};
  for (const key of Object.keys(value).sort()) {
    sorted[key] = sortedForSignature(value[key]);
  }
  return sorted;
}

/** Key-order independent identity of a parameters object. */
export function parametersSignature(value: unknown): string {
  return JSON.stringify(sortedForSignature(value ?? {})) ?? '{}';
}
