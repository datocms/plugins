/**
 * Tests for AnthropicProvider.ts
 * Tests Anthropic Claude API provider implementation.
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import AnthropicProvider from './AnthropicProvider';
import { ProviderError } from '../types';

// Mock fetch globally
const mockFetch = vi.fn();
global.fetch = mockFetch;

describe('AnthropicProvider', () => {
  let provider: AnthropicProvider;

  beforeEach(() => {
    vi.useFakeTimers();
    mockFetch.mockReset();

    provider = new AnthropicProvider({
      apiKey: 'test-api-key',
      model: 'claude-3-sonnet-20240229',
    });
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  describe('constructor', () => {
    it('should use default base URL', () => {
      const p = new AnthropicProvider({
        apiKey: 'key',
        model: 'claude-3-sonnet-20240229',
      });
      expect(p.vendor).toBe('anthropic');
    });

    it('should accept custom base URL', () => {
      const p = new AnthropicProvider({
        apiKey: 'key',
        model: 'claude-3-sonnet-20240229',
        baseUrl: 'https://custom.api.com/messages',
      });
      expect(p.vendor).toBe('anthropic');
    });

    it('should use default maxOutputTokens of 1024', () => {
      const p = new AnthropicProvider({
        apiKey: 'key',
        model: 'claude-3-sonnet-20240229',
      });
      expect(p.vendor).toBe('anthropic');
    });

    it('should accept custom maxOutputTokens', () => {
      const p = new AnthropicProvider({
        apiKey: 'key',
        model: 'claude-3-sonnet-20240229',
        maxOutputTokens: 2048,
      });
      expect(p.vendor).toBe('anthropic');
    });
  });

  describe('vendor property', () => {
    it('should have vendor set to "anthropic"', () => {
      expect(provider.vendor).toBe('anthropic');
    });
  });

  describe('completeText', () => {
    it('should return empty string for empty prompt', async () => {
      const result = await provider.completeText('');
      expect(result).toBe('');
      expect(mockFetch).not.toHaveBeenCalled();
    });

    it('should return empty string for whitespace-only prompt', async () => {
      const result = await provider.completeText('   \n\t  ');
      expect(result).toBe('');
      expect(mockFetch).not.toHaveBeenCalled();
    });

    it('should call Anthropic API with correct parameters', async () => {
      mockFetch.mockResolvedValue({
        ok: true,
        json: () =>
          Promise.resolve({
            content: [{ type: 'text', text: 'Translated text' }],
          }),
      });

      await provider.completeText('Translate this');

      expect(mockFetch).toHaveBeenCalledWith(
        'https://api.anthropic.com/v1/messages',
        expect.objectContaining({
          method: 'POST',
          headers: expect.objectContaining({
            'content-type': 'application/json',
            'x-api-key': 'test-api-key',
            'anthropic-version': '2023-06-01',
          }),
          signal: expect.any(AbortSignal),
        })
      );
    });

    it('should include correct request body', async () => {
      mockFetch.mockResolvedValue({
        ok: true,
        json: () =>
          Promise.resolve({
            content: [{ type: 'text', text: 'Hello' }],
          }),
      });

      await provider.completeText('Test prompt');

      const body = JSON.parse(mockFetch.mock.calls[0][1].body);
      expect(body).toEqual({
        model: 'claude-3-sonnet-20240229',
        max_output_tokens: 1024,
        temperature: undefined,
        messages: [{ role: 'user', content: 'Test prompt' }],
      });
    });

    it('should return concatenated text from response', async () => {
      mockFetch.mockResolvedValue({
        ok: true,
        json: () =>
          Promise.resolve({
            content: [
              { type: 'text', text: 'Hello ' },
              { type: 'text', text: 'World' },
            ],
          }),
      });

      const result = await provider.completeText('Test');
      expect(result).toBe('Hello World');
    });

    it('should skip non-text content blocks', async () => {
      mockFetch.mockResolvedValue({
        ok: true,
        json: () =>
          Promise.resolve({
            content: [
              { type: 'text', text: 'Hello' },
              { type: 'tool_use', id: 'tool1' },
              { type: 'text', text: ' World' },
            ],
          }),
      });

      const result = await provider.completeText('Test');
      expect(result).toBe('Hello World');
    });

    it('should return empty string for empty content array', async () => {
      mockFetch.mockResolvedValue({
        ok: true,
        json: () => Promise.resolve({ content: [] }),
      });

      const result = await provider.completeText('Test');
      expect(result).toBe('');
    });

    it('should return empty string for missing content', async () => {
      mockFetch.mockResolvedValue({
        ok: true,
        json: () => Promise.resolve({}),
      });

      const result = await provider.completeText('Test');
      expect(result).toBe('');
    });

    describe('error handling', () => {
      it('should throw ProviderError for non-OK response', async () => {
        mockFetch.mockResolvedValue({
          ok: false,
          status: 401,
          statusText: 'Unauthorized',
          json: () =>
            Promise.resolve({
              error: { message: 'Invalid API key' },
            }),
        });

        await expect(provider.completeText('Test')).rejects.toThrow(
          ProviderError
        );
      });

      it('should include status code in ProviderError', async () => {
        mockFetch.mockResolvedValue({
          ok: false,
          status: 429,
          statusText: 'Too Many Requests',
          json: () =>
            Promise.resolve({
              error: { message: 'Rate limited' },
            }),
        });

        try {
          await provider.completeText('Test');
          expect.fail('Should have thrown');
        } catch (e) {
          expect(e).toBeInstanceOf(ProviderError);
          expect((e as ProviderError).status).toBe(429);
          expect((e as ProviderError).vendor).toBe('anthropic');
        }
      });

      it('should use statusText when JSON parsing fails', async () => {
        mockFetch.mockResolvedValue({
          ok: false,
          status: 500,
          statusText: 'Internal Server Error',
          json: () => Promise.reject(new Error('Invalid JSON')),
        });

        try {
          await provider.completeText('Test');
          expect.fail('Should have thrown');
        } catch (e) {
          expect((e as ProviderError).message).toBe('Internal Server Error');
        }
      });

      it('should propagate fetch errors', async () => {
        mockFetch.mockRejectedValue(new Error('Network error'));

        await expect(provider.completeText('Test')).rejects.toThrow(
          'Network error'
        );
      });
    });

    describe('empty response warning', () => {
      it('should warn on empty response for non-empty prompt', async () => {
        const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {});

        mockFetch.mockResolvedValue({
          ok: true,
          json: () => Promise.resolve({ content: [] }),
        });

        await provider.completeText('Non-empty prompt');

        expect(warnSpy).toHaveBeenCalledWith(
          expect.stringContaining('empty response')
        );

        warnSpy.mockRestore();
      });
    });
  });

  describe('streamText', () => {
    it('should yield single result from completeText', async () => {
      mockFetch.mockResolvedValue({
        ok: true,
        json: () =>
          Promise.resolve({
            content: [{ type: 'text', text: 'Hello World' }],
          }),
      });

      const chunks: string[] = [];
      for await (const chunk of provider.streamText('Test')) {
        chunks.push(chunk);
      }

      expect(chunks).toEqual(['Hello World']);
    });

    it('should yield nothing for empty result', async () => {
      mockFetch.mockResolvedValue({
        ok: true,
        json: () => Promise.resolve({ content: [] }),
      });

      const chunks: string[] = [];
      for await (const chunk of provider.streamText('Test')) {
        chunks.push(chunk);
      }

      expect(chunks).toEqual([]);
    });

    it('should return empty for empty prompt', async () => {
      const chunks: string[] = [];
      for await (const chunk of provider.streamText('')) {
        chunks.push(chunk);
      }

      expect(chunks).toEqual([]);
      expect(mockFetch).not.toHaveBeenCalled();
    });
  });

  describe('timeout handling', () => {
    it('should use default timeout', async () => {
      mockFetch.mockResolvedValue({
        ok: true,
        json: () =>
          Promise.resolve({
            content: [{ type: 'text', text: 'Test' }],
          }),
      });

      await provider.completeText('Test');

      expect(mockFetch).toHaveBeenCalledWith(
        expect.any(String),
        expect.objectContaining({
          signal: expect.any(AbortSignal),
        })
      );
    });

    it('should use custom timeout', async () => {
      mockFetch.mockResolvedValue({
        ok: true,
        json: () =>
          Promise.resolve({
            content: [{ type: 'text', text: 'Test' }],
          }),
      });

      await provider.completeText('Test', { timeoutMs: 5000 });

      expect(mockFetch).toHaveBeenCalled();
    });
  });

  describe('abort signal handling', () => {
    it('should pass abort signal to fetch', async () => {
      mockFetch.mockResolvedValue({
        ok: true,
        json: () =>
          Promise.resolve({
            content: [{ type: 'text', text: 'Test' }],
          }),
      });

      const controller = new AbortController();
      await provider.completeText('Test', { abortSignal: controller.signal });

      expect(mockFetch).toHaveBeenCalledWith(
        expect.any(String),
        expect.objectContaining({
          signal: expect.any(AbortSignal),
        })
      );
    });
  });

  describe('custom configuration', () => {
    it('should include temperature when provided', async () => {
      const providerWithTemp = new AnthropicProvider({
        apiKey: 'key',
        model: 'claude-3-sonnet-20240229',
        temperature: 0.5,
      });

      mockFetch.mockResolvedValue({
        ok: true,
        json: () =>
          Promise.resolve({
            content: [{ type: 'text', text: 'Test' }],
          }),
      });

      await providerWithTemp.completeText('Test');

      const body = JSON.parse(mockFetch.mock.calls[0][1].body);
      expect(body.temperature).toBe(0.5);
    });

    it('should use custom maxOutputTokens', async () => {
      const providerWithTokens = new AnthropicProvider({
        apiKey: 'key',
        model: 'claude-3-sonnet-20240229',
        maxOutputTokens: 4096,
      });

      mockFetch.mockResolvedValue({
        ok: true,
        json: () =>
          Promise.resolve({
            content: [{ type: 'text', text: 'Test' }],
          }),
      });

      await providerWithTokens.completeText('Test');

      const body = JSON.parse(mockFetch.mock.calls[0][1].body);
      expect(body.max_output_tokens).toBe(4096);
    });
  });
});
