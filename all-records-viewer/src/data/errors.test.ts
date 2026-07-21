import { describe, expect, it } from 'vitest';
import { normalizeError } from './errors';

describe('normalizeError', () => {
  it('prefers structured API details', () => {
    expect(
      normalizeError({
        message: 'Request failed',
        code: 'INVALID_FIELD',
        response: {
          status: 422,
          body: {
            data: [{ attributes: { details: 'Unknown model' } }],
          },
        },
      }),
    ).toEqual({
      message: 'Unknown model',
      code: 'INVALID_FIELD',
      status: 422,
    });
  });

  it('uses a stable fallback for non-errors', () => {
    expect(normalizeError(null).message).toBe(
      'Could not load records. Please try again.',
    );
  });
});
