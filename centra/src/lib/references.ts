import type {
  CentraDisplayItemReference,
  CentraFieldParametersV1,
  CentraItemReference,
  CentraReference,
  CentraReferenceDocumentV1,
  CentraReferenceKind,
} from '../types';
import { normalizeFieldParameters } from './parameters';

export type ReferenceDocumentErrorCode =
  | 'invalid-shape'
  | 'unsupported-version'
  | 'kind-mismatch'
  | 'cardinality-mismatch'
  | 'invalid-reference'
  | 'duplicate-reference';

export class CentraReferenceError extends Error {
  readonly code: ReferenceDocumentErrorCode;

  constructor(code: ReferenceDocumentErrorCode, message: string) {
    super(message);
    this.name = 'CentraReferenceError';
    this.code = code;
  }
}

export type ReferenceDocumentParseResult =
  | {
      ok: true;
      document: CentraReferenceDocumentV1 | null;
      references: CentraReference[];
    }
  | {
      ok: false;
      error: CentraReferenceError;
      rawValue: unknown;
    };

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function hasExactKeys(
  value: Record<string, unknown>,
  expectedKeys: readonly string[],
): boolean {
  const keys = Object.keys(value);
  return (
    keys.length === expectedKeys.length &&
    expectedKeys.every(
      // biome-ignore lint/suspicious/noPrototypeBuiltins: Object.hasOwn is unavailable with the ES2020 target.
      (key) => Object.prototype.hasOwnProperty.call(value, key),
    )
  );
}

export function isDisplayItemReference(
  value: unknown,
): value is CentraDisplayItemReference {
  return (
    isRecord(value) &&
    Number.isSafeInteger(value.displayItemId) &&
    typeof value.displayItemId === 'number' &&
    value.displayItemId > 0 &&
    hasExactKeys(value, ['displayItemId'])
  );
}

export function isItemReference(value: unknown): value is CentraItemReference {
  return (
    isRecord(value) &&
    Number.isSafeInteger(value.displayItemId) &&
    typeof value.displayItemId === 'number' &&
    value.displayItemId > 0 &&
    typeof value.itemId === 'string' &&
    value.itemId.trim().length > 0 &&
    hasExactKeys(value, ['displayItemId', 'itemId'])
  );
}

export function referenceKey(
  kind: CentraReferenceKind,
  reference: CentraReference,
): string {
  if (kind === 'item') {
    if (!isItemReference(reference)) {
      throw new CentraReferenceError(
        'invalid-reference',
        'A Centra SKU reference must include a displayItemId and itemId.',
      );
    }
    return `item:${reference.displayItemId}:${reference.itemId}`;
  }

  if (!isDisplayItemReference(reference)) {
    throw new CentraReferenceError(
      'invalid-reference',
      'A Centra product reference must include only a numeric displayItemId.',
    );
  }
  return `displayItem:${reference.displayItemId}`;
}

export function dedupeReferences(
  kind: CentraReferenceKind,
  references: readonly CentraReference[],
): CentraReference[] {
  const seen = new Set<string>();
  const deduped: CentraReference[] = [];

  for (const reference of references) {
    const key = referenceKey(kind, reference);
    if (!seen.has(key)) {
      seen.add(key);
      deduped.push(reference);
    }
  }

  return deduped;
}

function parseFailure(
  rawValue: unknown,
  code: ReferenceDocumentErrorCode,
  message: string,
): ReferenceDocumentParseResult {
  return {
    ok: false,
    error: new CentraReferenceError(code, message),
    rawValue,
  };
}

type DecodedReferenceValue =
  | { ok: true; value: unknown }
  | { ok: false; result: ReferenceDocumentParseResult };

function decodeReferenceValue(rawValue: unknown): DecodedReferenceValue {
  if (typeof rawValue !== 'string') {
    return { ok: true, value: rawValue };
  }
  if (rawValue.trim().length === 0) {
    return {
      ok: false,
      result: parseFailure(
        rawValue,
        'invalid-shape',
        'This field contains an empty JSON string. Clear it to store null.',
      ),
    };
  }
  try {
    return { ok: true, value: JSON.parse(rawValue) };
  } catch {
    return {
      ok: false,
      result: parseFailure(
        rawValue,
        'invalid-shape',
        'This field does not contain valid JSON. Fix the raw value before editing the Centra selection.',
      ),
    };
  }
}

function validateDocumentEnvelope(
  value: Record<string, unknown>,
  fieldParameters: CentraFieldParametersV1,
  rawValue: unknown,
): ReferenceDocumentParseResult | null {
  if (value.version !== 1) {
    return parseFailure(
      rawValue,
      'unsupported-version',
      `This field uses unsupported Centra reference version ${String(value.version)}. Update the plugin before editing it.`,
    );
  }
  if (value.kind !== fieldParameters.kind) {
    return parseFailure(
      rawValue,
      'kind-mismatch',
      `This field is configured for ${fieldParameters.kind} references, but its saved value contains ${String(value.kind)} references.`,
    );
  }
  const references = value.references;
  if (!Array.isArray(references) || references.length === 0) {
    return parseFailure(
      rawValue,
      'invalid-shape',
      Array.isArray(references)
        ? 'Empty Centra selections must be stored as null.'
        : 'This field does not contain a valid Centra reference document. Clear it or restore the original JSON value.',
    );
  }
  if (fieldParameters.cardinality === 'single' && references.length !== 1) {
    return parseFailure(
      rawValue,
      'cardinality-mismatch',
      'This single-value field must contain exactly one Centra reference.',
    );
  }
  return null;
}

type ValidatedReferenceList =
  | { ok: true; references: CentraReference[] }
  | { ok: false; result: ReferenceDocumentParseResult };

function validateReferenceList(
  rawReferences: unknown[],
  fieldParameters: CentraFieldParametersV1,
  rawValue: unknown,
): ValidatedReferenceList {
  const references: CentraReference[] = [];
  for (const reference of rawReferences) {
    const itemReference =
      fieldParameters.kind === 'item' && isItemReference(reference);
    const displayItemReference =
      fieldParameters.kind !== 'item' && isDisplayItemReference(reference);
    if (!itemReference && !displayItemReference) {
      return {
        ok: false,
        result: parseFailure(
          rawValue,
          'invalid-reference',
          fieldParameters.kind === 'item'
            ? 'A saved Centra SKU reference has an invalid displayItemId or itemId, or includes stale metadata.'
            : 'A saved Centra product reference has an invalid displayItemId or includes stale metadata.',
        ),
      };
    }
    if (itemReference) {
      references.push(reference);
    } else if (displayItemReference) {
      references.push(reference);
    }
  }
  const keys = references.map((reference) =>
    referenceKey(fieldParameters.kind, reference),
  );
  if (new Set(keys).size !== keys.length) {
    return {
      ok: false,
      result: parseFailure(
        rawValue,
        'duplicate-reference',
        'This field contains duplicate Centra references. Remove the duplicates from the raw JSON before editing it.',
      ),
    };
  }
  return { ok: true, references };
}

export function parseReferenceDocument(
  rawValue: unknown,
  rawFieldParameters: unknown,
): ReferenceDocumentParseResult {
  const fieldParameters = normalizeFieldParameters(rawFieldParameters);
  const decoded = decodeReferenceValue(rawValue);
  if (!decoded.ok) {
    return decoded.result;
  }
  const value = decoded.value;
  if (value === null) {
    return { ok: true, document: null, references: [] };
  }
  if (!isRecord(value)) {
    return parseFailure(
      rawValue,
      'invalid-shape',
      'This field does not contain a valid Centra reference document. Clear it or restore the original JSON value.',
    );
  }
  const envelopeError = validateDocumentEnvelope(
    value,
    fieldParameters,
    rawValue,
  );
  if (envelopeError) {
    return envelopeError;
  }
  const references = validateReferenceList(
    value.references as unknown[],
    fieldParameters,
    rawValue,
  );
  if (!references.ok) {
    return references.result;
  }
  const document = value as CentraReferenceDocumentV1;
  return { ok: true, document, references: references.references };
}

export function buildReferenceDocument(
  rawFieldParameters: unknown,
  references: readonly CentraReference[],
): CentraReferenceDocumentV1 | null {
  const fieldParameters = normalizeFieldParameters(rawFieldParameters);
  const deduped = dedupeReferences(fieldParameters.kind, references);
  if (deduped.length === 0) {
    return null;
  }

  if (fieldParameters.cardinality === 'single' && deduped.length !== 1) {
    throw new CentraReferenceError(
      'cardinality-mismatch',
      'A single-value Centra field can contain only one reference.',
    );
  }

  if (fieldParameters.kind === 'item') {
    return {
      version: 1,
      kind: 'item',
      references: deduped.map((reference) => {
        if (!isItemReference(reference)) {
          throw new CentraReferenceError(
            'invalid-reference',
            'A Centra SKU reference must include a displayItemId and itemId.',
          );
        }
        return {
          displayItemId: reference.displayItemId,
          itemId: reference.itemId,
        };
      }),
    };
  }

  const productReferences = deduped.map((reference) => {
    if (!isDisplayItemReference(reference)) {
      throw new CentraReferenceError(
        'invalid-reference',
        'A Centra product reference must include only a numeric displayItemId.',
      );
    }
    return { displayItemId: reference.displayItemId };
  });

  return fieldParameters.kind === 'primaryProduct'
    ? { version: 1, kind: 'primaryProduct', references: productReferences }
    : { version: 1, kind: 'variant', references: productReferences };
}

export function moveReference<T extends CentraReference>(
  references: readonly T[],
  fromIndex: number,
  toIndex: number,
): T[] {
  const result = [...references];
  if (
    !Number.isInteger(fromIndex) ||
    !Number.isInteger(toIndex) ||
    fromIndex < 0 ||
    toIndex < 0 ||
    fromIndex >= result.length ||
    toIndex >= result.length ||
    fromIndex === toIndex
  ) {
    return result;
  }

  const moved = result.splice(fromIndex, 1)[0];
  if (moved !== undefined) {
    result.splice(toIndex, 0, moved);
  }
  return result;
}
