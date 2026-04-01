import { describe, expect, it } from 'vitest';
import type { errorObject } from '../types/types';
import {
  buildRestoreErrorPayload,
  isRestoreSuccessResponse,
  parseJsonStringSafely,
} from './restoreError';

describe('buildRestoreErrorPayload', () => {
  it('returns an existing errorObject as-is', () => {
    const existingError: errorObject = {
      simplifiedError: {
        code: 'VALIDATION_INVALID',
        details: {
          code: 'INVALID_FIELD',
          field: 'title',
        },
      },
      fullErrorPayload: 'raw-payload',
    };

    expect(buildRestoreErrorPayload(existingError)).toEqual(existingError);
  });

  it('extracts simplified error from Dato errors array payload', () => {
    const result = buildRestoreErrorPayload({
      errors: [
        {
          attributes: {
            code: 'VALIDATION_INVALID',
            details: {
              code: 'INVALID_FIELD',
              field: 'title',
            },
          },
        },
      ],
    });

    expect(result.simplifiedError.code).toBe('VALIDATION_INVALID');
    expect(result.simplifiedError.details.code).toBe('INVALID_FIELD');
    expect(result.simplifiedError.details.field).toBe('title');
    expect(result.fullErrorPayload).toContain('VALIDATION_INVALID');
  });

  it('extracts simplified error from { error: ... } wrapper payload', () => {
    const result = buildRestoreErrorPayload(
      {
        error: {
          code: 'INVALID_LINK',
          details: {
            code: 'MISSING_RELATION',
            message: 'Missing linked record',
          },
        },
      },
      {
        fullErrorPayload: 'raw-response-body',
      },
    );

    expect(result.simplifiedError.code).toBe('INVALID_LINK');
    expect(result.simplifiedError.details.code).toBe('MISSING_RELATION');
    expect(result.simplifiedError.details.message).toBe(
      'Missing linked record',
    );
    expect(result.fullErrorPayload).toBe('raw-response-body');
  });

  it('falls back to UNKNOWN when error payload is unstructured', () => {
    const result = buildRestoreErrorPayload(
      { error: {} },
      { fallbackMessage: 'Custom fallback message' },
    );

    expect(result.simplifiedError.code).toBe('UNKNOWN');
    expect(result.simplifiedError.details.code).toBe('UNKNOWN');
    expect(result.simplifiedError.details.message).toBe(
      'Custom fallback message',
    );
  });

  it('uses plain string payload as fallback message', () => {
    const result = buildRestoreErrorPayload('Gateway timeout');

    expect(result.simplifiedError.code).toBe('UNKNOWN');
    expect(result.simplifiedError.details.message).toBe('Gateway timeout');
  });
});

describe('parseJsonStringSafely', () => {
  it('returns undefined for invalid JSON', () => {
    expect(parseJsonStringSafely('not-json')).toBeUndefined();
  });

  it('parses valid JSON text', () => {
    expect(parseJsonStringSafely('{"ok": true}')).toEqual({ ok: true });
  });
});

describe('isRestoreSuccessResponse', () => {
  it('returns true for valid restore success payload', () => {
    expect(
      isRestoreSuccessResponse({
        restoredRecord: { id: 'record-id', modelID: 'model-id' },
      }),
    ).toBe(true);
  });

  it('returns false when restoredRecord shape is missing', () => {
    expect(
      isRestoreSuccessResponse({ restoredRecord: { id: 'record-id' } }),
    ).toBe(false);
    expect(isRestoreSuccessResponse({})).toBe(false);
  });
});
