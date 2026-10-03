import { describe, expect, it } from 'vitest';
import { describeApiError, getApiErrorInfo, retryDelay } from './requestErrors';

function error(status: number, headers: Record<string, string> = {}) {
  return { response: { status, headers } };
}

describe('retry policy', () => {
  it('honors server seconds and HTTP-date Retry-After as well as DatoCMS reset seconds', () => {
    expect(retryDelay(error(429, { 'Retry-After': '5' }), 0, 0, 0)).toBe(5000);
    expect(
      retryDelay(
        error(429, { 'retry-after': new Date(10_000).toUTCString() }),
        0,
        1000,
        0,
      ),
    ).toBe(9000);
    expect(retryDelay(error(429, { 'X-RateLimit-Reset': '3' }), 0, 0, 0)).toBe(
      3000,
    );
    expect(retryDelay(error(429, { 'retry-after': 'invalid' }), 1, 0, 0)).toBe(
      2000,
    );
    expect(retryDelay(error(429, { 'retry-after': '-10' }), 0, 0, 0.5)).toBe(
      1125,
    );
  });

  it('never exposes request headers, raw messages or payloads in failure samples', () => {
    expect(describeApiError(new Error('Bearer secret'))).toBe(
      'Request failed.',
    );
    const input = {
      request: { headers: { authorization: 'Bearer secret' } },
      response: {
        status: 422,
        body: {
          data: [{ attributes: { code: 'INVALID_FIELD', details: 'secret' } }],
        },
      },
    };
    expect(describeApiError(input)).toBe('HTTP 422 (INVALID_FIELD)');
  });

  it('distinguishes definite rejections from ambiguous outcomes', () => {
    expect(getApiErrorInfo(error(429))).toMatchObject({
      retryable: true,
      ambiguous: false,
    });
    expect(getApiErrorInfo(error(422))).toMatchObject({
      retryable: false,
      ambiguous: false,
    });
    expect(getApiErrorInfo(error(503))).toMatchObject({
      retryable: true,
      ambiguous: true,
    });
    expect(getApiErrorInfo(error(200))).toMatchObject({ ambiguous: true });
    expect(getApiErrorInfo(new TypeError('offline'))).toMatchObject({
      ambiguous: true,
    });
  });
});
