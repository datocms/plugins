/**
 * Tests for ProviderErrors.ts
 * Tests error normalization and formatting for different providers.
 */

import { describe, expect, it, vi } from 'vitest';
import type { Logger } from '../logging/Logger';
import {
  formatErrorForUser,
  handleTranslationError,
  normalizeProviderError,
} from './ProviderErrors';
import { ProviderError } from './types';

/**
 * Creates a mock Logger for testing.
 * Only stubs the methods needed for handleTranslationError tests.
 *
 * @returns A mock Logger instance with vi.fn() stubs for all methods.
 */
function createMockLogger(): Logger {
  return {
    error: vi.fn(),
    info: vi.fn(),
    warning: vi.fn(),
    logPrompt: vi.fn(),
    logResponse: vi.fn(),
  } as unknown as Logger;
}

describe('ProviderErrors.ts', () => {
  describe('normalizeProviderError', () => {
    describe('authentication errors', () => {
      it('should detect 401 status as auth error', () => {
        const error = { status: 401, message: 'Unauthorized' };
        const result = normalizeProviderError(error, 'openai');

        expect(result.code).toBe('auth');
        expect(result.message).toContain('Authentication failed');
      });

      it('should detect "unauthorized" in message', () => {
        const error = new Error('Request unauthorized');
        const result = normalizeProviderError(error, 'openai');

        expect(result.code).toBe('auth');
      });

      it('should detect "invalid api key" in message', () => {
        const error = new Error('Invalid API key provided');
        const result = normalizeProviderError(error, 'google');

        expect(result.code).toBe('auth');
      });

      it('should detect "permission_denied" in message', () => {
        const error = new Error('permission_denied: API not enabled');
        const result = normalizeProviderError(error, 'google');

        expect(result.code).toBe('auth');
      });

      it('should provide OpenAI-specific hint for auth error', () => {
        const error = { status: 401 };
        const result = normalizeProviderError(error, 'openai');

        expect(result.hint).toContain('OpenAI');
      });

      it('should provide Google-specific hint for auth error', () => {
        const error = { status: 401 };
        const result = normalizeProviderError(error, 'google');

        expect(result.hint).toContain('Google');
      });
    });

    describe('rate limit errors', () => {
      it('should detect 429 status as rate limit', () => {
        const error = { status: 429, message: 'Too Many Requests' };
        const result = normalizeProviderError(error, 'openai');

        expect(result.code).toBe('rate_limit');
        expect(result.message).toContain('Rate limit');
      });

      it('should detect "rate limit" in message', () => {
        const error = new Error('You have exceeded your rate limit');
        const result = normalizeProviderError(error, 'anthropic');

        expect(result.code).toBe('rate_limit');
      });

      it('should detect "too many requests" in message', () => {
        const error = new Error('Too many requests. Please slow down.');
        const result = normalizeProviderError(error, 'deepl');

        expect(result.code).toBe('rate_limit');
      });

      it('should provide vendor-specific hints for rate limits', () => {
        const vendors = ['openai', 'google', 'anthropic', 'deepl'] as const;
        const error = { status: 429 };

        for (const vendor of vendors) {
          const result = normalizeProviderError(error, vendor);
          expect(result.hint).toBeDefined();
        }
      });
    });

    describe('quota errors', () => {
      it('should detect "insufficient_quota" in message', () => {
        const error = new Error('You have insufficient_quota');
        const result = normalizeProviderError(error, 'openai');

        expect(result.code).toBe('quota');
        expect(result.message).toContain('Quota exceeded');
      });

      it('should detect "quota exceeded" in message', () => {
        const error = new Error('Quota exceeded for this project');
        const result = normalizeProviderError(error, 'google');

        expect(result.code).toBe('quota');
      });

      it('should detect "resource has been exhausted" in message', () => {
        const error = new Error('resource has been exhausted (quota)');
        const result = normalizeProviderError(error, 'google');

        expect(result.code).toBe('quota');
      });

      it('should detect "out of quota" in message', () => {
        const error = new Error('You are out of quota');
        const result = normalizeProviderError(error, 'anthropic');

        expect(result.code).toBe('quota');
      });

      it('should provide vendor-specific quota hints', () => {
        const error = new Error('Quota exceeded');

        const openai = normalizeProviderError(error, 'openai');
        expect(openai.hint).toContain('OpenAI');

        const google = normalizeProviderError(error, 'google');
        expect(google.hint).toContain('Google');
      });
    });

    describe('model errors', () => {
      it('should detect 404 status as model error', () => {
        const error = { status: 404, message: 'Not Found' };
        const result = normalizeProviderError(error, 'openai');

        expect(result.code).toBe('model');
        expect(result.message).toContain('model');
      });

      it('should detect "model not found" in message', () => {
        const error = new Error('model not found: gpt-5');
        const result = normalizeProviderError(error, 'openai');

        expect(result.code).toBe('model');
      });

      it('should detect "no such model" in message', () => {
        const error = new Error('No such model exists');
        const result = normalizeProviderError(error, 'google');

        expect(result.code).toBe('model');
      });

      it('should detect "unsupported model" in message', () => {
        const error = new Error('This is an unsupported model');
        const result = normalizeProviderError(error, 'anthropic');

        expect(result.code).toBe('model');
      });
    });

    describe('network errors', () => {
      it('should detect "failed to fetch" in message', () => {
        const error = new Error('Failed to fetch');
        const result = normalizeProviderError(error, 'openai');

        expect(result.code).toBe('network');
        expect(result.hint).toContain('CORS');
      });

      it('should detect "network" in message', () => {
        const error = new Error('Network error occurred');
        const result = normalizeProviderError(error, 'openai');

        expect(result.code).toBe('network');
      });

      it('should detect "timeout" in message', () => {
        const error = new Error('Request timeout');
        const result = normalizeProviderError(error, 'openai');

        expect(result.code).toBe('network');
      });

      it('should detect "ecconn" pattern in message', () => {
        // The implementation checks for 'ecconn' substring (e.g., ECCONNRESET)
        const error = new Error('connect ECCONNRESET');
        const result = normalizeProviderError(error, 'openai');

        expect(result.code).toBe('network');
      });
    });

    describe('DeepL-specific errors', () => {
      it('should detect wrong endpoint error for DeepL', () => {
        const error = { status: 403, message: 'Wrong endpoint' };
        const result = normalizeProviderError(error, 'deepl');

        expect(result.code).toBe('auth');
        expect(result.message).toContain('wrong endpoint');
        expect(result.hint).toContain('endpoint');
      });

      it('should not detect wrong endpoint for non-DeepL vendors', () => {
        const error = { status: 403, message: 'Wrong endpoint' };
        const result = normalizeProviderError(error, 'openai');

        // Should fall through to auth for 403 status
        expect(result.code).not.toBe('auth');
      });
    });

    describe('OpenAI streaming verification error', () => {
      it('should detect streaming verification error', () => {
        const error = {
          status: 400,
          error: {
            code: 'unsupported_value',
            param: 'stream',
            message: 'You must be verified to stream this model',
          },
        };
        const result = normalizeProviderError(error, 'openai');

        expect(result.code).toBe('auth');
        expect(result.hint).toContain('Verify');
      });
    });

    describe('error extraction', () => {
      it('should extract message from Error instance', () => {
        const error = new Error('Test error message');
        const result = normalizeProviderError(error, 'openai');

        expect(result.message).toBe('Test error message');
      });

      it('should extract message from plain object', () => {
        const error = { message: 'Object error message' };
        const result = normalizeProviderError(error, 'openai');

        expect(result.message).toBe('Object error message');
      });

      it('should extract nested error message', () => {
        const error = { error: { message: 'Nested message' } };
        const result = normalizeProviderError(error, 'openai');

        expect(result.message).toBe('Nested message');
      });

      it('should extract status from ProviderError', () => {
        const error = new ProviderError('Provider error', 429, 'openai');
        const result = normalizeProviderError(error, 'openai');

        expect(result.code).toBe('rate_limit');
      });

      it('should extract status from axios-style response', () => {
        const error = { response: { status: 401 } };
        const result = normalizeProviderError(error, 'openai');

        expect(result.code).toBe('auth');
      });

      it('should convert non-object errors to string', () => {
        const result = normalizeProviderError('string error', 'openai');
        expect(result.message).toBe('string error');
      });

      it('should handle null error', () => {
        const result = normalizeProviderError(null, 'openai');
        expect(result.code).toBe('unknown');
      });
    });

    describe('unknown errors', () => {
      it('should return unknown code for unrecognized errors', () => {
        const error = new Error('Some random error');
        const result = normalizeProviderError(error, 'openai');

        expect(result.code).toBe('unknown');
        expect(result.hint).toBeUndefined();
      });
    });
  });

  describe('formatErrorForUser', () => {
    it('should return message only when no hint', () => {
      const error = { code: 'unknown' as const, message: 'Error occurred' };
      expect(formatErrorForUser(error)).toBe('Error occurred');
    });

    it('should combine message and hint', () => {
      const error = {
        code: 'auth' as const,
        message: 'Auth failed',
        hint: 'Check your API key',
      };
      expect(formatErrorForUser(error)).toBe('Auth failed Check your API key');
    });

    it('should format rate limit error with hint', () => {
      const error = {
        code: 'rate_limit' as const,
        message: 'Rate limit reached. Please wait and try again.',
        hint: 'Reduce concurrency or switch models.',
      };
      const result = formatErrorForUser(error);
      expect(result).toContain('Rate limit');
      expect(result).toContain('concurrency');
    });
  });

  describe('handleTranslationError', () => {
    it('should throw an error with normalized message', () => {
      const mockLogger = createMockLogger();
      const originalError = { status: 429, message: 'Too many requests' };

      expect(() => {
        handleTranslationError(originalError, 'openai', mockLogger);
      }).toThrow();
    });

    it('should log the error', () => {
      const mockLogger = createMockLogger();

      try {
        handleTranslationError(new Error('Test'), 'openai', mockLogger);
      } catch {
        // Expected
      }

      expect(mockLogger.error).toHaveBeenCalled();
    });

    it('should include original error as cause', () => {
      const mockLogger = createMockLogger();
      const originalError = new Error('Original');

      try {
        handleTranslationError(originalError, 'openai', mockLogger);
      } catch (e) {
        expect((e as Error).cause).toBe(originalError);
      }
    });

    it('should include hint in thrown error message', () => {
      const mockLogger = createMockLogger();

      try {
        handleTranslationError({ status: 401 }, 'openai', mockLogger);
      } catch (e) {
        expect((e as Error).message).toContain('OpenAI');
      }
    });

    it('should use custom context in log message', () => {
      const mockLogger = createMockLogger();

      try {
        handleTranslationError(
          new Error('Test'),
          'openai',
          mockLogger,
          'Custom context',
        );
      } catch {
        // Expected
      }

      expect(mockLogger.error).toHaveBeenCalledWith(
        'Custom context',
        expect.any(Object),
      );
    });
  });
});
