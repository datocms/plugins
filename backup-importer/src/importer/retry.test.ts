/// <reference types="vitest" />

import { describe, expect, test } from 'vitest';
import { isRetryableError, withRetry } from './retry';

describe('isRetryableError', () => {
  test('detects retryable statuses and messages', () => {
    expect(isRetryableError({ statusCode: 429 })).toBe(true);
    expect(isRetryableError(new Error('STALE_ITEM_VERSION'))).toBe(true);
    expect(isRetryableError(new Error('Validation failed'))).toBe(false);
  });
});

describe('withRetry', () => {
  test('retries and eventually succeeds', async () => {
    let attempts = 0;

    const result = await withRetry({
      operationName: 'test',
      options: {
        maxAttempts: 3,
        baseDelayMs: 1,
        maxDelayMs: 2,
      },
      fn: async () => {
        attempts += 1;
        if (attempts < 2) {
          throw new Error('timeout');
        }
        return 'ok';
      },
    });

    expect(result).toBe('ok');
    expect(attempts).toBe(2);
  });
});
