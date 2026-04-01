/**
 * Tests for OpenAIProvider.ts
 * Tests OpenAI Chat Completions provider implementation.
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

// Create the mock function outside and before the mock
const mockCreate = vi.fn();

// Mock the OpenAI SDK
vi.mock('openai', () => {
  return {
    default: class MockOpenAI {
      chat = {
        completions: {
          create: mockCreate,
        },
      };
    },
  };
});

import OpenAIProvider from './OpenAIProvider';

describe('OpenAIProvider', () => {
  let provider: OpenAIProvider;

  beforeEach(() => {
    vi.useFakeTimers();
    mockCreate.mockReset();

    provider = new OpenAIProvider({
      apiKey: 'test-api-key',
      model: 'gpt-4',
    });
  });

  afterEach(() => {
    vi.useRealTimers();
    vi.clearAllMocks();
  });

  describe('constructor', () => {
    it('should create provider instance', () => {
      expect(provider).toBeDefined();
    });

    it('should accept optional baseUrl and organization', () => {
      const customProvider = new OpenAIProvider({
        apiKey: 'key',
        model: 'gpt-4',
        baseUrl: 'https://custom.api.com',
        organization: 'org-123',
      });

      expect(customProvider).toBeDefined();
      expect(customProvider.vendor).toBe('openai');
    });
  });

  describe('vendor property', () => {
    it('should have vendor set to "openai"', () => {
      expect(provider.vendor).toBe('openai');
    });
  });

  describe('completeText', () => {
    it('should return empty string for empty prompt', async () => {
      const result = await provider.completeText('');
      expect(result).toBe('');
      expect(mockCreate).not.toHaveBeenCalled();
    });

    it('should return empty string for whitespace-only prompt', async () => {
      const result = await provider.completeText('   \n\t  ');
      expect(result).toBe('');
      expect(mockCreate).not.toHaveBeenCalled();
    });

    it('should call OpenAI API with correct parameters', async () => {
      mockCreate.mockResolvedValue({
        choices: [{ message: { content: 'Translated text' } }],
      });

      await provider.completeText('Translate this');

      expect(mockCreate).toHaveBeenCalledWith(
        {
          model: 'gpt-4',
          messages: [{ role: 'user', content: 'Translate this' }],
          stream: false,
        },
        { signal: expect.any(AbortSignal) }
      );
    });

    it('should return response content', async () => {
      mockCreate.mockResolvedValue({
        choices: [{ message: { content: 'Hello World' } }],
      });

      const result = await provider.completeText('Test prompt');
      expect(result).toBe('Hello World');
    });

    it('should return empty string for null content', async () => {
      mockCreate.mockResolvedValue({
        choices: [{ message: { content: null } }],
      });

      const result = await provider.completeText('Test prompt');
      expect(result).toBe('');
    });

    it('should return empty string for missing choices', async () => {
      mockCreate.mockResolvedValue({ choices: [] });

      const result = await provider.completeText('Test prompt');
      expect(result).toBe('');
    });

    it('should propagate API errors', async () => {
      mockCreate.mockRejectedValue(new Error('API Error'));

      await expect(provider.completeText('Test')).rejects.toThrow('API Error');
    });
  });

  describe('streamText', () => {
    it('should return empty for empty prompt', async () => {
      const chunks: string[] = [];
      for await (const chunk of provider.streamText('')) {
        chunks.push(chunk);
      }
      expect(chunks).toEqual([]);
      expect(mockCreate).not.toHaveBeenCalled();
    });

    it('should call OpenAI API with stream: true', async () => {
      const mockStream = {
        [Symbol.asyncIterator]: async function* () {
          yield { choices: [{ delta: { content: 'Hello' } }] };
          yield { choices: [{ delta: { content: ' World' } }] };
        },
      };
      mockCreate.mockResolvedValue(mockStream);

      const chunks: string[] = [];
      for await (const chunk of provider.streamText('Test prompt')) {
        chunks.push(chunk);
      }

      expect(mockCreate).toHaveBeenCalledWith(
        {
          model: 'gpt-4',
          messages: [{ role: 'user', content: 'Test prompt' }],
          stream: true,
        },
        { signal: expect.any(AbortSignal) }
      );
    });

    it('should yield text chunks', async () => {
      const mockStream = {
        [Symbol.asyncIterator]: async function* () {
          yield { choices: [{ delta: { content: 'Hello' } }] };
          yield { choices: [{ delta: { content: ' World' } }] };
        },
      };
      mockCreate.mockResolvedValue(mockStream);

      const chunks: string[] = [];
      for await (const chunk of provider.streamText('Test')) {
        chunks.push(chunk);
      }

      expect(chunks).toEqual(['Hello', ' World']);
    });

    it('should skip null/undefined content in chunks', async () => {
      const mockStream = {
        [Symbol.asyncIterator]: async function* () {
          yield { choices: [{ delta: { content: 'Hello' } }] };
          yield { choices: [{ delta: { content: null } }] };
          yield { choices: [{ delta: {} }] };
          yield { choices: [{ delta: { content: 'World' } }] };
        },
      };
      mockCreate.mockResolvedValue(mockStream);

      const chunks: string[] = [];
      for await (const chunk of provider.streamText('Test')) {
        chunks.push(chunk);
      }

      expect(chunks).toEqual(['Hello', 'World']);
    });

    it('should handle missing choices', async () => {
      const mockStream = {
        [Symbol.asyncIterator]: async function* () {
          yield { choices: [] };
          yield { choices: [{ delta: { content: 'Hello' } }] };
        },
      };
      mockCreate.mockResolvedValue(mockStream);

      const chunks: string[] = [];
      for await (const chunk of provider.streamText('Test')) {
        chunks.push(chunk);
      }

      expect(chunks).toEqual(['Hello']);
    });
  });

  describe('timeout handling', () => {
    it('should use default timeout', async () => {
      mockCreate.mockResolvedValue({
        choices: [{ message: { content: 'Test' } }],
      });

      await provider.completeText('Test');

      // The signal passed to create should be an AbortSignal
      const callArgs = mockCreate.mock.calls[0][1];
      expect(callArgs.signal).toBeInstanceOf(AbortSignal);
    });

    it('should use custom timeout', async () => {
      mockCreate.mockResolvedValue({
        choices: [{ message: { content: 'Test' } }],
      });

      await provider.completeText('Test', { timeoutMs: 5000 });

      // Verify API was called (timeout doesn't fire immediately)
      expect(mockCreate).toHaveBeenCalled();
    });
  });

  describe('abort signal handling', () => {
    it('should pass abort signal to API call', async () => {
      const controller = new AbortController();
      mockCreate.mockResolvedValue({
        choices: [{ message: { content: 'Test' } }],
      });

      await provider.completeText('Test', { abortSignal: controller.signal });

      expect(mockCreate).toHaveBeenCalled();
    });
  });
});
