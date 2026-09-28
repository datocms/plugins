import { ApiError, TimeoutError } from '@datocms/cma-client-browser';
import { describe, expect, it } from 'vitest';
import { findReplaceSchema } from './replacementPlanner.fixtures';
import {
  classifyWriteError,
  isNotFoundError,
  isStaleItemVersionError,
  writeErrorStatus,
} from './writeErrors';

type Entity = {
  code: string;
  details?: Record<string, unknown>;
  transient?: true;
};

function apiError(status: number, entities: Entity[] = []): ApiError {
  return new ApiError({
    request: { url: '/items/article-1', method: 'PUT', headers: {} },
    response: {
      status,
      statusText: '',
      headers: {},
      body: {
        data: entities.map((entity, index) => ({
          id: `error-${index}`,
          type: 'api_error',
          attributes: {
            code: entity.code,
            doc_url: '',
            details: entity.details ?? {},
            ...(entity.transient ? { transient: true } : {}),
          },
        })),
      },
    },
  });
}

function invalidField(details: Record<string, unknown>): ApiError {
  return apiError(422, [{ code: 'INVALID_FIELD', details }]);
}

const schema = findReplaceSchema();

describe('classifyWriteError', () => {
  it.each([
    [
      'a client timeout',
      new TimeoutError({
        request: { url: '/items/article-1', method: 'PUT', headers: {} },
      }),
    ],
    ['a fetch TypeError', new TypeError('Failed to fetch')],
    ['429', apiError(429)],
    ['500', apiError(500)],
    ['503', apiError(503)],
    [
      'a transient error entity',
      apiError(422, [
        { code: 'BATCH_DATA_VALIDATION_IN_PROGRESS', transient: true },
      ]),
    ],
  ])('treats %s as a retryable network failure', (_label, error) => {
    expect(classifyWriteError(error, schema)).toEqual({
      reason: 'network',
      retryable: true,
      detail: null,
    });
  });

  it.each([401, 403])('treats %s as a permission failure', (status) => {
    expect(classifyWriteError(apiError(status), schema)).toEqual({
      reason: 'permission',
      retryable: false,
      detail: null,
    });
  });

  it.each([
    ['VALIDATION_LENGTH', 'length'],
    ['VALIDATION_FORMAT', 'format'],
    ['VALIDATION_SLUG_FORMAT', 'format'],
    ['VALIDATION_UNIQUE', 'unique'],
    ['VALIDATION_REQUIRED', 'required'],
    ['VALIDATION_ENUM', 'other'],
  ])('maps %s to the %s rule', (code, expected) => {
    expect(
      classifyWriteError(
        invalidField({ field_id: 'slug-field', field: 'slug', code }),
        schema,
      ),
    ).toEqual({
      reason: 'validation',
      retryable: false,
      detail: { fieldLabel: 'Slug', code: expected },
    });
  });

  it('labels the field from the schema first, then from the server', () => {
    const detail = (details: Record<string, unknown>) =>
      classifyWriteError(invalidField(details), schema).detail;

    expect(
      detail({
        field_id: 'quote-text-field',
        field_label: 'Server',
        code: 'x',
      }),
    ).toEqual({ fieldLabel: 'Text', code: 'other' });
    expect(
      detail({
        field_id: 'unknown',
        field_label: 'Server label',
        field: 'key',
      }),
    ).toEqual({ fieldLabel: 'Server label', code: 'other' });
    expect(detail({ field: 'api_key' })).toEqual({
      fieldLabel: 'api_key',
      code: 'other',
    });
    expect(detail({})).toEqual({ fieldLabel: null, code: 'other' });
  });

  it('keeps a 422 without field details as a plain validation failure', () => {
    expect(
      classifyWriteError(apiError(422, [{ code: 'INVALID_FORMAT' }]), schema),
    ).toEqual({ reason: 'validation', retryable: false, detail: null });
  });

  it.each([
    ['a 404', apiError(404)],
    ['a 400', apiError(400)],
    ['a plain error', new Error('secret')],
    ['a non-error value', 'boom'],
    ['nothing', undefined],
  ])('treats %s as unknown and not retryable', (_label, error) => {
    expect(classifyWriteError(error, schema)).toEqual({
      reason: 'unknown',
      retryable: false,
      detail: null,
    });
  });
});

describe('error helpers', () => {
  it('recognizes the optimistic-lock refusal by its code', () => {
    expect(
      isStaleItemVersionError(apiError(422, [{ code: 'STALE_ITEM_VERSION' }])),
    ).toBe(true);
    expect(
      isStaleItemVersionError({
        findError: (code: string) => code === 'STALE_ITEM_VERSION',
      }),
    ).toBe(true);
    expect(
      isStaleItemVersionError(invalidField({ code: 'VALIDATION_LENGTH' })),
    ).toBe(false);
    expect(isStaleItemVersionError(new Error('STALE_ITEM_VERSION'))).toBe(
      false,
    );
  });

  it('reads the status of CMA errors and lookalikes', () => {
    expect(writeErrorStatus(apiError(404))).toBe(404);
    expect(writeErrorStatus({ response: { status: 503 } })).toBe(503);
    expect(writeErrorStatus(new TypeError('Failed to fetch'))).toBeNull();
    expect(isNotFoundError(apiError(404))).toBe(true);
    expect(isNotFoundError(apiError(403))).toBe(false);
  });
});
