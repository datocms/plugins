import type { ExactMatchRef, FieldValueRef, SelectionTarget } from './types';

function serializeNumber(value: number): string {
  if (Number.isNaN(value)) return '{"$number":"NaN"}';
  if (value === Number.POSITIVE_INFINITY) return '{"$number":"Infinity"}';
  if (value === Number.NEGATIVE_INFINITY) return '{"$number":"-Infinity"}';
  if (Object.is(value, -0)) return '{"$number":"-0"}';
  return JSON.stringify(value);
}

/** `ancestors` holds the objects on the current path (added on the way down, removed on the way up). */
function serializeStable(value: unknown, ancestors: Set<object>): string {
  if (value === null) return 'null';
  if (value === undefined) return '{"$undefined":true}';

  switch (typeof value) {
    case 'string':
      return JSON.stringify(value);
    case 'boolean':
      return value ? 'true' : 'false';
    case 'number':
      return serializeNumber(value);
    case 'bigint':
      return `{"$bigint":${JSON.stringify(value.toString())}}`;
    case 'symbol':
      return `{"$symbol":${JSON.stringify(value.description ?? '')}}`;
    case 'function':
      return '{"$function":true}';
    case 'object':
      break;
  }

  const object = value as object;
  if (ancestors.has(object)) {
    return '{"$cycle":true}';
  }

  ancestors.add(object);
  let serialized: string;
  if (Array.isArray(value)) {
    serialized = `[${value
      .map((entry) => serializeStable(entry, ancestors))
      .join(',')}]`;
  } else {
    const record = value as Record<string, unknown>;
    serialized = `{${Object.keys(record)
      .sort()
      .map(
        (key) =>
          `${JSON.stringify(key)}:${serializeStable(record[key], ancestors)}`,
      )
      .join(',')}}`;
  }
  ancestors.delete(object);
  return serialized;
}

export function stableSerialize(value: unknown): string {
  return serializeStable(value, new Set());
}

/**
 * Small deterministic digest suitable for change detection, not cryptography:
 * 64-bit FNV-1a over the UTF-16 code units. The 64-bit state is kept in four
 * 16-bit limbs so every step stays in fast integer arithmetic (the prime is
 * 2^40 + 0x1b3).
 */
export function fingerprintString(value: string): string {
  let h0 = 0x2325;
  let h1 = 0x8422;
  let h2 = 0x9ce4;
  let h3 = 0xcbf2;

  for (let index = 0; index < value.length; index += 1) {
    h0 ^= value.charCodeAt(index);
    const t0 = h0 * 0x1b3;
    const t1 = h1 * 0x1b3 + (t0 >>> 16);
    const t2 = h2 * 0x1b3 + h0 * 0x100 + (t1 >>> 16);
    const t3 = h3 * 0x1b3 + h1 * 0x100 + (t2 >>> 16);
    h0 = t0 & 0xffff;
    h1 = t1 & 0xffff;
    h2 = t2 & 0xffff;
    h3 = t3 & 0xffff;
  }

  const limb = (part: number): string => part.toString(16).padStart(4, '0');
  return `fnv1a64:${limb(h3)}${limb(h2)}${limb(h1)}${limb(h0)}`;
}

export function fingerprintValue(value: unknown, present = true): string {
  return fingerprintString(
    stableSerialize({ presence: present ? 'present' : 'missing', value }),
  );
}

function identityPart(value: string | number | null): string {
  const encoded = value === null ? '\u0000' : String(value);
  return `${encoded.length}:${encoded}`;
}

function canonicalIdentity(
  namespace: string,
  parts: ReadonlyArray<string | number | null>,
): string {
  return `${namespace}:${parts.map(identityPart).join('|')}`;
}

/**
 * Canonical identity intentionally excludes API keys, paths, versions and value
 * fingerprints. Those can change while the same field value remains selected.
 */
export function fieldValueIdentity(ref: FieldValueRef): string {
  return canonicalIdentity('field-value', [
    ref.siteId,
    ref.environment,
    ref.rootModelId,
    ref.rootRecordId,
    ref.ownerModelId,
    ref.ownerRecordId,
    ref.fieldId,
    ref.locale,
  ]);
}

/** Occurrence order is the only non-path discriminator for repeated equal text. */
export function exactMatchIdentity(ref: ExactMatchRef): string {
  return canonicalIdentity('exact-match', [
    fieldValueIdentity(ref.fieldValue),
    ref.matcherFingerprint,
    ref.occurrenceIndex,
  ]);
}

export function selectionTargetIdentity(target: SelectionTarget): string {
  return target.kind === 'field_value'
    ? fieldValueIdentity(target)
    : exactMatchIdentity(target);
}

export function selectionTargetFieldValue(
  target: SelectionTarget,
): FieldValueRef {
  return target.kind === 'field_value' ? target : target.fieldValue;
}

export function ancestorFieldValueIds(
  target: SelectionTarget,
): ReadonlyArray<string> {
  return selectionTargetFieldValue(target).ancestorFieldValueIds;
}

export function isFieldValueAncestor(
  ancestor: FieldValueRef | string,
  descendant: FieldValueRef | SelectionTarget,
): boolean {
  const ancestorId =
    typeof ancestor === 'string' ? ancestor : fieldValueIdentity(ancestor);
  const descendantRef =
    'kind' in descendant && descendant.kind === 'exact_match'
      ? descendant.fieldValue
      : (descendant as FieldValueRef);

  return descendantRef.ancestorFieldValueIds.includes(ancestorId);
}

export function areOverlappingFieldValueTargets(
  left: FieldValueRef,
  right: FieldValueRef,
): boolean {
  const leftId = fieldValueIdentity(left);
  const rightId = fieldValueIdentity(right);

  return (
    leftId === rightId ||
    left.ancestorFieldValueIds.includes(rightId) ||
    right.ancestorFieldValueIds.includes(leftId)
  );
}
