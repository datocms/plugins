/**
 * Tests for TranslationCore.ts
 * Tests shared utilities for translation operations.
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import {
  shouldProcessField,
  getMaxConcurrency,
  getRequestSpacingMs,
  calculateRateLimitBackoff,
  isRateLimitError,
  isAbortError,
  delay,
} from './TranslationCore';
import type { ctxParamsType } from '../../entrypoints/Config/ConfigScreen';

describe('TranslationCore.ts', () => {
  describe('shouldProcessField', () => {
    const baseParams: ctxParamsType = {
      apiKey: 'test-key',
      gptModel: 'gpt-4',
      translationFields: ['single_line', 'textarea', 'markdown', 'seo'],
      translateWholeRecord: false,
      translateBulkRecords: false,
      prompt: '',
      modelsToBeExcludedFromThisPlugin: [],
      rolesToBeExcludedFromThisPlugin: [],
      apiKeysToBeExcludedFromThisPlugin: [],
      enableDebugging: false,
    };

    it('should return true for translatable field types', () => {
      expect(shouldProcessField('single_line', 'field1', baseParams)).toBe(true);
      expect(shouldProcessField('textarea', 'field2', baseParams)).toBe(true);
      expect(shouldProcessField('markdown', 'field3', baseParams)).toBe(true);
      expect(shouldProcessField('seo', 'field4', baseParams)).toBe(true);
    });

    it('should return false for excluded field IDs', () => {
      const paramsWithExclusions = {
        ...baseParams,
        apiKeysToBeExcludedFromThisPlugin: ['excluded-field'],
      };

      expect(shouldProcessField('single_line', 'excluded-field', paramsWithExclusions)).toBe(false);
    });

    it('should return false for non-translatable field types', () => {
      expect(shouldProcessField('boolean', 'field1', baseParams)).toBe(false);
      expect(shouldProcessField('integer', 'field2', baseParams)).toBe(false);
      expect(shouldProcessField('float', 'field3', baseParams)).toBe(false);
    });

    it('should return false for empty translationFields', () => {
      const paramsNoFields = {
        ...baseParams,
        translationFields: [],
      };

      expect(shouldProcessField('single_line', 'field1', paramsNoFields)).toBe(false);
    });

    it('should handle modular content field types', () => {
      const paramsWithModular = {
        ...baseParams,
        translationFields: ['structured_text', 'rich_text'],
      };

      expect(shouldProcessField('structured_text', 'field1', paramsWithModular)).toBe(true);
      expect(shouldProcessField('rich_text', 'field2', paramsWithModular)).toBe(true);
    });
  });

  describe('getMaxConcurrency', () => {
    const baseParams: ctxParamsType = {
      apiKey: 'test-key',
      gptModel: '',
      translationFields: [],
      translateWholeRecord: false,
      translateBulkRecords: false,
      prompt: '',
      modelsToBeExcludedFromThisPlugin: [],
      rolesToBeExcludedFromThisPlugin: [],
      apiKeysToBeExcludedFromThisPlugin: [],
      enableDebugging: false,
    };

    describe('OpenAI models', () => {
      it('should return 6 for nano models', () => {
        const params = { ...baseParams, gptModel: 'gpt-4-nano' };
        expect(getMaxConcurrency(params)).toBe(6);
      });

      it('should return 6 for flash models', () => {
        const params = { ...baseParams, gptModel: 'gpt-4-flash' };
        expect(getMaxConcurrency(params)).toBe(6);
      });

      it('should return 6 for mini models (light)', () => {
        const params = { ...baseParams, gptModel: 'gpt-4o-mini' };
        expect(getMaxConcurrency(params)).toBe(6);
      });

      it('should return 3 for pro models', () => {
        const params = { ...baseParams, gptModel: 'gpt-4-pro' };
        expect(getMaxConcurrency(params)).toBe(3);
      });

      it('should return 4 for default models', () => {
        const params = { ...baseParams, gptModel: 'gpt-4' };
        expect(getMaxConcurrency(params)).toBe(4);
      });
    });

    describe('Google models', () => {
      // Gemini models have lower concurrency due to stricter rate limits
      it('should return 3 for Gemini Flash models (lower due to rate limits)', () => {
        const params = {
          ...baseParams,
          vendor: 'google' as const,
          geminiModel: 'gemini-1.5-flash',
        };
        expect(getMaxConcurrency(params)).toBe(3);
      });

      it('should return 2 for Gemini Pro models (stricter rate limits)', () => {
        const params = {
          ...baseParams,
          vendor: 'google' as const,
          geminiModel: 'gemini-1.5-pro',
        };
        expect(getMaxConcurrency(params)).toBe(2);
      });

      it('should return 2 for gemini-pro', () => {
        const params = {
          ...baseParams,
          vendor: 'google' as const,
          geminiModel: 'gemini-pro',
        };
        expect(getMaxConcurrency(params)).toBe(2);
      });

      it('should return 2 for gemini-1.5 (default Gemini concurrency)', () => {
        const params = {
          ...baseParams,
          vendor: 'google' as const,
          geminiModel: 'gemini-1.5',
        };
        expect(getMaxConcurrency(params)).toBe(2);
      });

      it('should return 2 for unknown Google models (conservative default)', () => {
        const params = {
          ...baseParams,
          vendor: 'google' as const,
          geminiModel: 'google-custom',
        };
        expect(getMaxConcurrency(params)).toBe(2);
      });

      it('should return 3 for Gemini lite models', () => {
        const params = {
          ...baseParams,
          vendor: 'google' as const,
          geminiModel: 'gemini-lite',
        };
        expect(getMaxConcurrency(params)).toBe(3);
      });
    });

    describe('edge cases', () => {
      it('should handle undefined vendor', () => {
        const params = { ...baseParams, gptModel: 'gpt-4' };
        expect(getMaxConcurrency(params)).toBe(4);
      });

      it('should handle undefined model', () => {
        const params = { ...baseParams, gptModel: '' };
        expect(getMaxConcurrency(params)).toBe(4);
      });

      it('should be case insensitive', () => {
        const params = { ...baseParams, gptModel: 'GPT-4-NANO' };
        expect(getMaxConcurrency(params)).toBe(6);
      });
    });
  });

  describe('getRequestSpacingMs', () => {
    const baseParams: ctxParamsType = {
      apiKey: 'test-key',
      gptModel: '',
      translationFields: [],
      translateWholeRecord: false,
      translateBulkRecords: false,
      prompt: '',
      modelsToBeExcludedFromThisPlugin: [],
      rolesToBeExcludedFromThisPlugin: [],
      apiKeysToBeExcludedFromThisPlugin: [],
      enableDebugging: false,
    };

    it('should return higher spacing for Google/Gemini vendor', () => {
      const params = { ...baseParams, vendor: 'google' as const };
      expect(getRequestSpacingMs(params)).toBe(200);
    });

    it('should return default spacing for OpenAI vendor', () => {
      const params = { ...baseParams, vendor: 'openai' as const };
      expect(getRequestSpacingMs(params)).toBe(50);
    });

    it('should return default spacing for Anthropic vendor', () => {
      const params = { ...baseParams, vendor: 'anthropic' as const };
      expect(getRequestSpacingMs(params)).toBe(50);
    });

    it('should return default spacing for DeepL vendor', () => {
      const params = { ...baseParams, vendor: 'deepl' as const };
      expect(getRequestSpacingMs(params)).toBe(50);
    });

    it('should return default spacing when vendor is undefined', () => {
      const params = { ...baseParams };
      expect(getRequestSpacingMs(params)).toBe(50);
    });
  });

  describe('calculateRateLimitBackoff', () => {
    it('should return 1000ms for first retry', () => {
      expect(calculateRateLimitBackoff(1)).toBe(1000);
    });

    it('should return 2000ms for second retry', () => {
      expect(calculateRateLimitBackoff(2)).toBe(2000);
    });

    it('should return 4000ms for third retry', () => {
      expect(calculateRateLimitBackoff(3)).toBe(4000);
    });

    it('should return 8000ms for fourth retry', () => {
      expect(calculateRateLimitBackoff(4)).toBe(8000);
    });

    it('should cap at max delay (10000ms)', () => {
      // 2^4 * 1000 = 16000, but should be capped at 10000
      expect(calculateRateLimitBackoff(5)).toBe(10000);
      expect(calculateRateLimitBackoff(10)).toBe(10000);
    });

    it('should follow exponential growth pattern', () => {
      const backoff1 = calculateRateLimitBackoff(1);
      const backoff2 = calculateRateLimitBackoff(2);
      const backoff3 = calculateRateLimitBackoff(3);

      expect(backoff2).toBe(backoff1 * 2);
      expect(backoff3).toBe(backoff2 * 2);
    });
  });

  describe('isRateLimitError', () => {
    it('should return true for 429 status', () => {
      expect(isRateLimitError({ status: 429 })).toBe(true);
    });

    it('should return true for rate_limit_exceeded code', () => {
      expect(isRateLimitError({ code: 'rate_limit_exceeded' })).toBe(true);
    });

    it('should return true for message containing "rate limit"', () => {
      expect(isRateLimitError({ message: 'Rate limit exceeded' })).toBe(true);
      expect(isRateLimitError({ message: 'You hit a rate limit' })).toBe(true);
    });

    it('should return true for message containing "429"', () => {
      expect(isRateLimitError({ message: 'Error 429: Too many requests' })).toBe(true);
    });

    it('should return true for message containing "Too Many Requests"', () => {
      expect(isRateLimitError({ message: 'Too Many Requests' })).toBe(true);
    });

    it('should return false for non-rate-limit errors', () => {
      expect(isRateLimitError({ status: 400 })).toBe(false);
      expect(isRateLimitError({ status: 500 })).toBe(false);
      expect(isRateLimitError({ message: 'Unauthorized' })).toBe(false);
    });

    it('should return false for null', () => {
      expect(isRateLimitError(null)).toBe(false);
    });

    it('should return false for non-objects', () => {
      expect(isRateLimitError('string')).toBe(false);
      expect(isRateLimitError(123)).toBe(false);
      expect(isRateLimitError(undefined)).toBe(false);
    });

    it('should be case insensitive for message matching', () => {
      expect(isRateLimitError({ message: 'RATE LIMIT' })).toBe(true);
      expect(isRateLimitError({ message: 'too many requests' })).toBe(true);
    });
  });

  describe('isAbortError', () => {
    it('should return true for AbortError DOMException', () => {
      const error = new DOMException('Aborted', 'AbortError');
      expect(isAbortError(error)).toBe(true);
    });

    it('should return false for other DOMException types', () => {
      const error = new DOMException('Timeout', 'TimeoutError');
      expect(isAbortError(error)).toBe(false);
    });

    it('should return false for regular Error', () => {
      const error = new Error('AbortError');
      expect(isAbortError(error)).toBe(false);
    });

    it('should return false for non-errors', () => {
      expect(isAbortError(null)).toBe(false);
      expect(isAbortError(undefined)).toBe(false);
      expect(isAbortError({ name: 'AbortError' })).toBe(false);
      expect(isAbortError('AbortError')).toBe(false);
    });
  });

  describe('delay', () => {
    beforeEach(() => {
      vi.useFakeTimers();
    });

    afterEach(() => {
      vi.useRealTimers();
    });

    it('should resolve after specified milliseconds', async () => {
      const delayPromise = delay(1000);
      let resolved = false;

      delayPromise.then(() => {
        resolved = true;
      });

      expect(resolved).toBe(false);

      vi.advanceTimersByTime(999);
      await Promise.resolve();
      expect(resolved).toBe(false);

      vi.advanceTimersByTime(1);
      await Promise.resolve();
      expect(resolved).toBe(true);
    });

    it('should resolve immediately for 0 delay', async () => {
      const delayPromise = delay(0);
      let resolved = false;

      delayPromise.then(() => {
        resolved = true;
      });

      vi.advanceTimersByTime(0);
      await Promise.resolve();
      expect(resolved).toBe(true);
    });

    it('should return a Promise', () => {
      const result = delay(100);
      expect(result).toBeInstanceOf(Promise);
    });
  });
});
