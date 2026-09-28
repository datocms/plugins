import { TimeoutError } from '@datocms/cma-client-browser';
import type { SchemaIndex } from '../selection/types';

/** Why a record write failed (same vocabulary as the page contract). */
export type WriteFailReason =
  | 'validation'
  | 'permission'
  | 'network'
  | 'unknown';

/** Validation details, when the server gives them. */
export type WriteFailDetail = {
  /** From the schema by field id; else the server's label or API key. */
  fieldLabel: string | null;
  code: 'length' | 'format' | 'unique' | 'required' | 'other';
};

export type WriteErrorClassification = {
  reason: WriteFailReason;
  /** Only network failures: trying the same write again may succeed. */
  retryable: boolean;
  detail: WriteFailDetail | null;
};

type UnknownRecord = Record<string, unknown>;

type ErrorEntity = {
  code: string;
  transient: boolean;
  details: UnknownRecord;
};

const VALIDATION_CODES: Readonly<Record<string, WriteFailDetail['code']>> = {
  VALIDATION_LENGTH: 'length',
  VALIDATION_FORMAT: 'format',
  VALIDATION_SLUG_FORMAT: 'format',
  VALIDATION_UNIQUE: 'unique',
  VALIDATION_REQUIRED: 'required',
};

function asRecord(value: unknown): UnknownRecord | null {
  return value !== null && typeof value === 'object' && !Array.isArray(value)
    ? (value as UnknownRecord)
    : null;
}

function nonEmptyString(value: unknown): string | null {
  return typeof value === 'string' && value.length > 0 ? value : null;
}

function toEntity(value: unknown): ErrorEntity | null {
  const attributes = asRecord(asRecord(value)?.attributes);
  const code = nonEmptyString(attributes?.code);
  if (!attributes || !code) return null;
  return {
    code,
    transient: attributes.transient === true,
    details: asRecord(attributes.details) ?? {},
  };
}

/** `ApiError.response`, read structurally so lookalike errors work too. */
function responseOf(error: unknown): UnknownRecord | null {
  return asRecord(asRecord(error)?.response);
}

/** HTTP status of a CMA error (`ApiError` or a lookalike), else null. */
export function writeErrorStatus(error: unknown): number | null {
  const status = responseOf(error)?.status;
  return typeof status === 'number' ? status : null;
}

/** The `api_error` entities of a CMA error body. */
function errorEntities(error: unknown): ErrorEntity[] {
  const body = asRecord(responseOf(error)?.body);
  const data = Array.isArray(body?.data) ? body.data : [];
  return data.flatMap((entry) => {
    const entity = toEntity(entry);
    return entity ? [entity] : [];
  });
}

/**
 * The optimistic lock refused the update: the record's current version is not
 * the one sent in `meta.current_version`.
 */
export function isStaleItemVersionError(error: unknown): boolean {
  if (errorEntities(error).some(({ code }) => code === 'STALE_ITEM_VERSION')) {
    return true;
  }
  const findError = asRecord(error)?.findError;
  if (typeof findError !== 'function') return false;
  try {
    return Boolean(findError.call(error, 'STALE_ITEM_VERSION'));
  } catch {
    return false;
  }
}

/** The record doesn't exist (any more). */
export function isNotFoundError(error: unknown): boolean {
  return writeErrorStatus(error) === 404;
}

function validationDetail(
  entity: ErrorEntity,
  schema: SchemaIndex,
): WriteFailDetail {
  const { details } = entity;
  const fieldId = nonEmptyString(details.field_id);
  const schemaLabel = fieldId
    ? nonEmptyString(schema.fieldsById.get(fieldId)?.label)
    : null;
  const code = nonEmptyString(details.code);
  return {
    fieldLabel:
      schemaLabel ??
      nonEmptyString(details.field_label) ??
      nonEmptyString(details.field),
    code: (code ? VALIDATION_CODES[code] : undefined) ?? 'other',
  };
}

/**
 * Turns a failed read or update into a reason the page can explain. The CMA
 * client already retried rate limits, transient errors and timeouts before
 * giving up, so what reaches here is final for this attempt.
 *
 * - `TimeoutError`, `TypeError` (fetch), 429, 5xx, or a `transient` error
 *   entity → `network`, retryable.
 * - 401/403 → `permission`.
 * - 422 → `validation`, with the field and rule of the first `INVALID_FIELD`.
 * - Anything else → `unknown`.
 *
 * `STALE_ITEM_VERSION` and 404 are handled by the caller before this.
 */
export function classifyWriteError(
  error: unknown,
  schema: SchemaIndex,
): WriteErrorClassification {
  if (error instanceof TimeoutError || error instanceof TypeError) {
    return { reason: 'network', retryable: true, detail: null };
  }

  const status = writeErrorStatus(error);
  const entities = errorEntities(error);
  if (
    status === 429 ||
    (status !== null && status >= 500) ||
    entities.some(({ transient }) => transient)
  ) {
    return { reason: 'network', retryable: true, detail: null };
  }
  if (status === 401 || status === 403) {
    return { reason: 'permission', retryable: false, detail: null };
  }
  if (status === 422) {
    const invalidField = entities.find(({ code }) => code === 'INVALID_FIELD');
    return {
      reason: 'validation',
      retryable: false,
      detail: invalidField ? validationDetail(invalidField, schema) : null,
    };
  }
  return { reason: 'unknown', retryable: false, detail: null };
}
