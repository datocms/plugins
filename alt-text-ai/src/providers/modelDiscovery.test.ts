import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  listAnthropicModels,
  listGeminiModels,
  listOpenAIModels,
} from './modelDiscovery';

function jsonResponse(payload: unknown, status = 200): Response {
  return new Response(JSON.stringify(payload), {
    status,
    headers: { 'Content-Type': 'application/json' },
  });
}

afterEach(() => {
  vi.unstubAllGlobals();
});

describe('provider model discovery', () => {
  it('lists every model returned by OpenAI', async () => {
    const fetchMock = vi.fn<typeof fetch>().mockResolvedValue(
      jsonResponse({
        data: [
          { id: 'gpt-5.4-mini' },
          { id: 'gpt-5.4' },
          { id: 'gpt-5.4-pro' },
          { id: 'gpt-5.4-reasoning' },
          { id: 'gpt-4o-audio-preview' },
          { id: 'gpt-image-1' },
          { id: 'gpt-3.5-turbo' },
          { id: 'text-embedding-3-large' },
        ],
      }),
    );
    vi.stubGlobal('fetch', fetchMock);
    const controller = new AbortController();

    await expect(
      listOpenAIModels('openai-key', controller.signal),
    ).resolves.toEqual([
      'gpt-3.5-turbo',
      'gpt-4o-audio-preview',
      'gpt-5.4',
      'gpt-5.4-mini',
      'gpt-5.4-pro',
      'gpt-5.4-reasoning',
      'gpt-image-1',
      'text-embedding-3-large',
    ]);
    const [url, init] = fetchMock.mock.calls[0] ?? [];

    expect(url).toBe('https://api.openai.com/v1/models');
    expect(init?.signal).toBe(controller.signal);
    expect(new Headers(init?.headers).get('Authorization')).toBe(
      'Bearer openai-key',
    );
  });

  it('lists every Anthropic model across every page', async () => {
    const fetchMock = vi
      .fn<typeof fetch>()
      .mockResolvedValueOnce(
        jsonResponse({
          data: [
            {
              id: 'claude-haiku-4-5-latest',
              capabilities: { image_input: { supported: true } },
            },
            {
              id: 'claude-sonnet-4-6',
              capabilities: { image_input: { supported: false } },
            },
            { id: 'claude-mythos-5' },
            { id: 'claude-2.1' },
          ],
          has_more: true,
          last_id: 'page-one-cursor',
        }),
      )
      .mockResolvedValueOnce(
        jsonResponse({
          data: [
            {
              id: 'claude-fable-5',
              capabilities: { image_input: { supported: true } },
            },
            { id: 'claude-3-5-sonnet-latest' },
            { id: 'claude-instant-1.2' },
          ],
          has_more: false,
        }),
      );
    vi.stubGlobal('fetch', fetchMock);

    await expect(listAnthropicModels('anthropic-key')).resolves.toEqual([
      'claude-2.1',
      'claude-3-5-sonnet-latest',
      'claude-fable-5',
      'claude-haiku-4-5-latest',
      'claude-instant-1.2',
      'claude-mythos-5',
      'claude-sonnet-4-6',
    ]);
    expect(fetchMock).toHaveBeenCalledTimes(2);
    const [firstUrl, init] = fetchMock.mock.calls[0] ?? [];
    const [secondUrl] = fetchMock.mock.calls[1] ?? [];

    expect(
      new Headers(init?.headers).get(
        'anthropic-dangerous-direct-browser-access',
      ),
    ).toBe('true');
    expect(new URL(String(firstUrl)).searchParams.get('limit')).toBe('1000');
    expect(new URL(String(firstUrl)).searchParams.has('after_id')).toBe(false);
    expect(new URL(String(secondUrl)).searchParams.get('after_id')).toBe(
      'page-one-cursor',
    );
  });

  it('lists every Gemini API model across every page', async () => {
    const fetchMock = vi
      .fn<typeof fetch>()
      .mockResolvedValueOnce(
        jsonResponse({
          models: [
            {
              name: 'models/gemini-2.5-flash',
              supportedGenerationMethods: ['generateContent'],
            },
            {
              name: 'models/gemini-flash-latest',
              supportedGenerationMethods: ['generateContent'],
            },
            {
              name: 'models/gemini-pro-latest',
              supportedGenerationMethods: ['generateContent'],
            },
            {
              name: 'models/gemini-2.5-pro',
              supportedGenerationMethods: ['generateContent'],
            },
            {
              name: 'models/gemini-2.5-flash-image',
              supportedGenerationMethods: ['generateContent'],
            },
          ],
          nextPageToken: 'page two + slash/equals=',
        }),
      )
      .mockResolvedValueOnce(
        jsonResponse({
          models: [
            {
              name: 'models/gemini-3.5-pro',
              supportedGenerationMethods: ['generateContent'],
            },
            {
              name: 'models/gemini-embedding-001',
              supportedGenerationMethods: ['embedContent'],
            },
            {
              name: 'models/gemini-2.5-flash-preview-tts',
              supportedGenerationMethods: ['generateContent'],
            },
            {
              name: 'models/gemini-1.0-pro',
              supportedGenerationMethods: ['generateContent'],
            },
          ],
        }),
      );
    vi.stubGlobal('fetch', fetchMock);

    await expect(listGeminiModels('gemini-key')).resolves.toEqual([
      'gemini-1.0-pro',
      'gemini-2.5-flash',
      'gemini-2.5-flash-image',
      'gemini-2.5-flash-preview-tts',
      'gemini-2.5-pro',
      'gemini-3.5-pro',
      'gemini-embedding-001',
      'gemini-flash-latest',
      'gemini-pro-latest',
    ]);
    expect(fetchMock).toHaveBeenCalledTimes(2);
    const [url, init] = fetchMock.mock.calls[0] ?? [];
    const [secondUrl] = fetchMock.mock.calls[1] ?? [];

    expect(new URL(String(url)).pathname).toBe('/v1beta/models');
    expect(new URL(String(url)).searchParams.get('pageSize')).toBe('1000');
    expect(new URL(String(secondUrl)).searchParams.get('pageToken')).toBe(
      'page two + slash/equals=',
    );
    expect(String(url)).not.toContain('gemini-key');
    expect(new Headers(init?.headers).get('x-goog-api-key')).toBe('gemini-key');
  });

  it('normalizes model-list rate limits with the correct provider', async () => {
    const fetchMock = vi
      .fn<typeof fetch>()
      .mockResolvedValue(
        jsonResponse({ error: { message: 'Too many requests' } }, 429),
      );
    vi.stubGlobal('fetch', fetchMock);

    await expect(listGeminiModels('gemini-key')).rejects.toMatchObject({
      provider: 'gemini',
      code: 'rate_limit',
      status: 429,
    });
  });
});
