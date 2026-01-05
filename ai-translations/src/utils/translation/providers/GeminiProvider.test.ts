/**
 * Tests for GeminiProvider.ts
 * Tests Google Gemini API provider implementation.
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

// Create mock functions before the mock
const mockGenerateContent = vi.fn();
const mockGenerateContentStream = vi.fn();
const mockGetGenerativeModel = vi.fn(() => ({
  generateContent: mockGenerateContent,
  generateContentStream: mockGenerateContentStream,
}));

// Mock the Google Generative AI SDK
vi.mock('@google/generative-ai', () => {
  return {
    GoogleGenerativeAI: class MockGoogleGenerativeAI {
      getGenerativeModel = mockGetGenerativeModel;
      constructor(_apiKey: string) {}
    },
  };
});

import GeminiProvider from './GeminiProvider';

describe('GeminiProvider', () => {
  let provider: GeminiProvider;

  beforeEach(() => {
    vi.useFakeTimers();
    mockGenerateContent.mockReset();
    mockGenerateContentStream.mockReset();
    mockGetGenerativeModel.mockClear();

    provider = new GeminiProvider({
      apiKey: 'test-api-key',
      model: 'gemini-1.5-flash',
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

    it('should get model instance with correct model name', () => {
      expect(mockGetGenerativeModel).toHaveBeenCalledWith({
        model: 'gemini-1.5-flash',
      });
    });

    it('should accept optional temperature and maxOutputTokens', () => {
      const customProvider = new GeminiProvider({
        apiKey: 'key',
        model: 'gemini-1.5-pro',
        temperature: 0.7,
        maxOutputTokens: 2048,
      });

      expect(customProvider).toBeDefined();
      expect(customProvider.vendor).toBe('google');
    });
  });

  describe('vendor property', () => {
    it('should have vendor set to "google"', () => {
      expect(provider.vendor).toBe('google');
    });
  });

  describe('completeText', () => {
    it('should return empty string for empty prompt', async () => {
      const result = await provider.completeText('');
      expect(result).toBe('');
      expect(mockGenerateContent).not.toHaveBeenCalled();
    });

    it('should return empty string for whitespace-only prompt', async () => {
      const result = await provider.completeText('   \n\t  ');
      expect(result).toBe('');
      expect(mockGenerateContent).not.toHaveBeenCalled();
    });

    it('should call generateContent with correct request', async () => {
      mockGenerateContent.mockResolvedValue({
        response: {
          text: () => 'Translated text',
        },
      });

      await provider.completeText('Translate this');

      expect(mockGenerateContent).toHaveBeenCalledWith({
        contents: [{ role: 'user', parts: [{ text: 'Translate this' }] }],
        generationConfig: {
          temperature: undefined,
          maxOutputTokens: undefined,
        },
      });
    });

    it('should return response text', async () => {
      mockGenerateContent.mockResolvedValue({
        response: {
          text: () => 'Hello World',
        },
      });

      const result = await provider.completeText('Test prompt');
      expect(result).toBe('Hello World');
    });

    it('should return empty string for missing response', async () => {
      mockGenerateContent.mockResolvedValue({
        response: null,
      });

      const result = await provider.completeText('Test prompt');
      expect(result).toBe('');
    });

    it('should return empty string for missing text function', async () => {
      mockGenerateContent.mockResolvedValue({
        response: {},
      });

      const result = await provider.completeText('Test prompt');
      expect(result).toBe('');
    });

    it('should propagate API errors', async () => {
      mockGenerateContent.mockRejectedValue(new Error('API Error'));

      await expect(provider.completeText('Test')).rejects.toThrow('API Error');
    });

    it('should throw AbortError when signal is already aborted', async () => {
      const controller = new AbortController();
      controller.abort();

      await expect(
        provider.completeText('Test', { abortSignal: controller.signal })
      ).rejects.toThrow(DOMException);
    });
  });

  describe('streamText', () => {
    it('should return empty for empty prompt', async () => {
      const chunks: string[] = [];
      for await (const chunk of provider.streamText('')) {
        chunks.push(chunk);
      }
      expect(chunks).toEqual([]);
      expect(mockGenerateContentStream).not.toHaveBeenCalled();
    });

    it('should call generateContentStream with correct request', async () => {
      mockGenerateContentStream.mockResolvedValue({
        stream: {
          [Symbol.asyncIterator]: async function* () {
            yield { text: () => 'Hello' };
          },
        },
      });

      const chunks: string[] = [];
      for await (const chunk of provider.streamText('Test prompt')) {
        chunks.push(chunk);
      }

      expect(mockGenerateContentStream).toHaveBeenCalledWith({
        contents: [{ role: 'user', parts: [{ text: 'Test prompt' }] }],
        generationConfig: {
          temperature: undefined,
          maxOutputTokens: undefined,
        },
      });
    });

    it('should yield text chunks', async () => {
      mockGenerateContentStream.mockResolvedValue({
        stream: {
          [Symbol.asyncIterator]: async function* () {
            yield { text: () => 'Hello' };
            yield { text: () => ' World' };
          },
        },
      });

      const chunks: string[] = [];
      for await (const chunk of provider.streamText('Test')) {
        chunks.push(chunk);
      }

      expect(chunks).toEqual(['Hello', ' World']);
    });

    it('should skip empty text chunks', async () => {
      mockGenerateContentStream.mockResolvedValue({
        stream: {
          [Symbol.asyncIterator]: async function* () {
            yield { text: () => 'Hello' };
            yield { text: () => '' };
            yield { text: () => 'World' };
          },
        },
      });

      const chunks: string[] = [];
      for await (const chunk of provider.streamText('Test')) {
        chunks.push(chunk);
      }

      expect(chunks).toEqual(['Hello', 'World']);
    });

    it('should skip chunks without text function', async () => {
      mockGenerateContentStream.mockResolvedValue({
        stream: {
          [Symbol.asyncIterator]: async function* () {
            yield { text: () => 'Hello' };
            yield {};
            yield { text: () => 'World' };
          },
        },
      });

      const chunks: string[] = [];
      for await (const chunk of provider.streamText('Test')) {
        chunks.push(chunk);
      }

      expect(chunks).toEqual(['Hello', 'World']);
    });

    it('should throw AbortError when signal is already aborted', async () => {
      const controller = new AbortController();
      controller.abort();

      await expect(async () => {
        for await (const _chunk of provider.streamText('Test', {
          abortSignal: controller.signal,
        })) {
          // Should not reach here
        }
      }).rejects.toThrow(DOMException);
    });
  });

  describe('timeout handling', () => {
    it('should use default timeout', async () => {
      mockGenerateContent.mockResolvedValue({
        response: { text: () => 'Test' },
      });

      await provider.completeText('Test');
      expect(mockGenerateContent).toHaveBeenCalled();
    });

    it('should use custom timeout', async () => {
      mockGenerateContent.mockResolvedValue({
        response: { text: () => 'Test' },
      });

      await provider.completeText('Test', { timeoutMs: 5000 });
      expect(mockGenerateContent).toHaveBeenCalled();
    });
  });

  describe('generation config', () => {
    it('should include temperature when provided', async () => {
      const providerWithTemp = new GeminiProvider({
        apiKey: 'key',
        model: 'gemini-1.5-flash',
        temperature: 0.5,
      });

      mockGenerateContent.mockResolvedValue({
        response: { text: () => 'Test' },
      });

      await providerWithTemp.completeText('Test');

      expect(mockGenerateContent).toHaveBeenCalledWith({
        contents: expect.any(Array),
        generationConfig: {
          temperature: 0.5,
          maxOutputTokens: undefined,
        },
      });
    });

    it('should include maxOutputTokens when provided', async () => {
      const providerWithTokens = new GeminiProvider({
        apiKey: 'key',
        model: 'gemini-1.5-flash',
        maxOutputTokens: 1024,
      });

      mockGenerateContent.mockResolvedValue({
        response: { text: () => 'Test' },
      });

      await providerWithTokens.completeText('Test');

      expect(mockGenerateContent).toHaveBeenCalledWith({
        contents: expect.any(Array),
        generationConfig: {
          temperature: undefined,
          maxOutputTokens: 1024,
        },
      });
    });
  });
});
