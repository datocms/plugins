/**
 * Tests for ProviderErrors.ts
 * Tests error normalization and formatting for different providers.
 */

import { describe, expect, it, vi } from 'vitest';
import type { Logger } from '../logging/Logger';
import {
  formatErrorForUser,
  handleTranslationError,
  isFatalProviderError,
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

      it('should provide provider-specific hint for auth error', () => {
        const error = { status: 401 };
        const result = normalizeProviderError(error, 'openai');

        expect(result.hint).toContain('provider API key');
      });

      it('should provide Google-specific hint for auth error', () => {
        const error = { status: 401 };
        const result = normalizeProviderError(error, 'google');

        expect(result.hint).toContain('Google');
      });

      it('provides Yandex service-account guidance for invalid credentials', () => {
        const result = normalizeProviderError(
          new ProviderError('Invalid API key', 401, 'yandex'),
          'yandex',
        );

        expect(result.code).toBe('auth');
        expect(result.hint).toContain('ai.translate.user');
        expect(result.hint).toContain('Folder ID');
      });

      it('maps Yandex permission errors to actionable authentication failures', () => {
        const result = normalizeProviderError(
          new ProviderError('Permission denied', 403, 'yandex'),
          'yandex',
        );

        expect(result.code).toBe('auth');
        expect(result.message).toContain('Yandex Cloud denied access');
        expect(result.hint).toContain('API key scope');
      });

      it('maps Yandex Folder ID failures to actionable configuration errors', () => {
        const result = normalizeProviderError(
          new ProviderError(
            'The specified folder ID was not found',
            400,
            'yandex',
          ),
          'yandex',
        );

        expect(result.code).toBe('auth');
        expect(result.message).toContain('Folder ID');
        expect(result.hint).toContain('service account');
      });

      it('treats a generic Yandex NOT_FOUND response as a Folder ID failure', () => {
        const result = normalizeProviderError(
          new ProviderError(
            'The requested cloud resource was not found',
            404,
            'yandex',
          ),
          'yandex',
        );

        expect(result.code).toBe('auth');
        expect(result.message).toContain('Folder ID');
        expect(isFatalProviderError('yandex', result)).toBe(true);
      });
    });

    describe('rate limit errors', () => {
      it('should detect 429 status as rate limit', () => {
        const error = { status: 429, message: 'Too Many Requests' };
        const result = normalizeProviderError(error, 'openai');

        expect(result.code).toBe('rate_limit');
        expect(result.source).toBe('provider');
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
        const vendors = [
          'openai',
          'google',
          'anthropic',
          'deepl',
          'yandex',
        ] as const;
        const error = { status: 429 };

        for (const vendor of vendors) {
          const result = normalizeProviderError(error, vendor);
          expect(result.hint).toBeDefined();
        }
      });
    });

    describe('DatoCMS errors', () => {
      it('should label DatoCMS rate limits separately from provider rate limits', () => {
        const error = {
          request: {
            url: 'https://site-api.datocms.com/items/123',
            method: 'PUT',
            headers: {},
          },
          response: {
            status: 429,
            statusText: 'Too Many Requests',
            headers: {},
            body: { data: [] },
          },
        };
        const result = normalizeProviderError(error, 'openai');

        expect(result.source).toBe('datocms');
        expect(result.code).toBe('rate_limit');
        expect(formatErrorForUser(result)).toContain('DatoCMS error');
      });

      it('should preserve structured DatoCMS error codes', () => {
        const error = {
          request: {
            url: 'https://site-api.datocms.com/items/123',
            method: 'PUT',
            headers: {},
          },
          response: {
            status: 422,
            statusText: 'Unprocessable Entity',
            headers: {},
            body: {
              data: [
                {
                  id: 'err',
                  type: 'api_error',
                  attributes: {
                    code: 'ITEM_LOCKED',
                    details: {},
                    doc_url: 'https://www.datocms.com',
                  },
                },
              ],
            },
          },
        };
        const result = normalizeProviderError(error, 'openai');

        expect(result.source).toBe('datocms');
        expect(formatErrorForUser(result)).toContain('DatoCMS error');
        expect(formatErrorForUser(result)).toContain('record is locked');
      });

      it('should label DatoCMS request timeouts', () => {
        const error = {
          request: {
            url: 'https://site-api.datocms.com/items/123',
            method: 'GET',
            headers: {},
          },
          message:
            'GET https://site-api.datocms.com/items/123: Timeout error',
        };
        const result = normalizeProviderError(error, 'openai');

        expect(result.source).toBe('datocms');
        expect(result.code).toBe('network');
        expect(formatErrorForUser(result)).toContain('DatoCMS error');
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
        expect(openai.hint).toContain('selected provider');

        const google = normalizeProviderError(error, 'google');
        expect(google.hint).toContain('Google');

        const yandex = normalizeProviderError(error, 'yandex');
        expect(yandex.hint).toContain('Yandex Cloud');
      });

      it('distinguishes a Yandex quota response from request-rate limiting', () => {
        const result = normalizeProviderError(
          new ProviderError('Quota limit exceeded', 429, 'yandex'),
          'yandex',
        );

        expect(result.code).toBe('quota');
        expect(result.hint).toContain('billing');
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

      it('maps the Yandex provider unsupported-target message', () => {
        const error = new ProviderError(
          'Yandex Translate does not support the target locale "xx-YY".',
          400,
          'yandex',
        );
        const result = normalizeProviderError(error, 'yandex');

        expect(result.code).toBe('model');
        expect(result.message).toContain('target language');
        expect(result.hint).toContain('Yandex Translate');
      });
    });

    describe('network errors', () => {
      it('should detect "failed to fetch" in message', () => {
        const error = new Error('Failed to fetch');
        const result = normalizeProviderError(error, 'openai');

        expect(result.code).toBe('network');
        expect(result.hint).toContain('CORS');
      });

      it.each([
        [500, 'Internal server error'],
        [503, 'The service is currently unavailable'],
        [504, 'Deadline exceeded (request ID: request-123)'],
      ])(
        'maps Yandex service status %s to a retryable service error',
        (status, message) => {
          const result = normalizeProviderError(
            new ProviderError(message, status, 'yandex'),
            'yandex',
          );

          expect(result.code).toBe('network');
          expect(result.message).toBe(message);
          expect(result.hint).toContain('temporarily unavailable');
          expect(isFatalProviderError('yandex', result)).toBe(false);
        },
      );

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
      const error = {
        code: 'unknown' as const,
        source: 'plugin' as const,
        message: 'Error occurred',
      };
      expect(formatErrorForUser(error)).toBe('Plugin error: Error occurred');
    });

    it('should combine message and hint', () => {
      const error = {
        code: 'auth' as const,
        source: 'provider' as const,
        message: 'Auth failed',
        hint: 'Check your API key',
      };
      expect(formatErrorForUser(error)).toBe(
        'Translation provider error: Auth failed Check your API key',
      );
    });

    it('should format rate limit error with hint', () => {
      const error = {
        code: 'rate_limit' as const,
        source: 'provider' as const,
        message: 'Rate limit reached. Please wait and try again.',
        hint: 'Reduce concurrency or switch models.',
      };
      const result = formatErrorForUser(error);
      expect(result).toContain('Rate limit');
      expect(result).toContain('concurrency');
    });
  });

  describe('isFatalProviderError', () => {
    it('treats Yandex authentication, permission, and folder errors as fatal', () => {
      const auth = normalizeProviderError(
        new ProviderError('Invalid API key', 401, 'yandex'),
        'yandex',
      );
      const permission = normalizeProviderError(
        new ProviderError('Permission denied', 403, 'yandex'),
        'yandex',
      );
      const folder = normalizeProviderError(
        new ProviderError('Folder ID is invalid', 400, 'yandex'),
        'yandex',
      );

      expect(isFatalProviderError('yandex', auth)).toBe(true);
      expect(isFatalProviderError('yandex', permission)).toBe(true);
      expect(isFatalProviderError('yandex', folder)).toBe(true);
    });

    it('keeps Yandex quota, rate-limit, and network errors retryable', () => {
      const quota = normalizeProviderError(
        new ProviderError('Quota exceeded', 400, 'yandex'),
        'yandex',
      );
      const rateLimit = normalizeProviderError(
        new ProviderError('Too many requests', 429, 'yandex'),
        'yandex',
      );
      const network = normalizeProviderError(
        new ProviderError('Network timeout', 500, 'yandex'),
        'yandex',
      );

      expect(isFatalProviderError('yandex', quota)).toBe(false);
      expect(isFatalProviderError('yandex', rateLimit)).toBe(false);
      expect(isFatalProviderError('yandex', network)).toBe(false);
    });

    it('preserves existing fatal DeepL and OpenAI cases', () => {
      const deepl = normalizeProviderError(
        new ProviderError('Wrong endpoint', 403, 'deepl'),
        'deepl',
      );
      const openai = normalizeProviderError(
        new Error('You must be verified to stream this model'),
        'openai',
      );

      expect(isFatalProviderError('deepl', deepl)).toBe(true);
      expect(isFatalProviderError('openai', openai)).toBe(true);
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

    it('preserves ProviderError status and vendor', () => {
      const mockLogger = createMockLogger();
      const originalError = new ProviderError(
        'Permission denied',
        403,
        'yandex',
      );

      try {
        handleTranslationError(originalError, 'yandex', mockLogger);
      } catch (error) {
        expect(error).toBeInstanceOf(ProviderError);
        expect((error as ProviderError).status).toBe(403);
        expect((error as ProviderError).vendor).toBe('yandex');
        expect((error as Error).cause).toBe(originalError);
      }
    });

    it('should include hint in thrown error message', () => {
      const mockLogger = createMockLogger();

      try {
        handleTranslationError({ status: 401 }, 'openai', mockLogger);
      } catch (e) {
        expect((e as Error).message).toContain('provider API key');
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
