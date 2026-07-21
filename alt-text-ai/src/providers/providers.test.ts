import { afterEach, describe, expect, it, vi } from 'vitest';
import { createAltTextProvider } from './factory';
import type { GenerateAltTextInput } from './types';

const input: GenerateAltTextInput = {
  imageUrl: 'https://www.datocms-assets.com/1/2/photo.jpg?fm=jpg&w=1024',
  assetId: 'upload-123',
  locale: 'it-IT',
  filename: 'tramonto.jpg',
  promptTemplate: 'Describe {filename} in {locale}. Return only alt text.',
};

function jsonResponse(payload: unknown, status = 200): Response {
  return new Response(JSON.stringify(payload), {
    status,
    headers: { 'Content-Type': 'application/json' },
  });
}

afterEach(() => {
  vi.unstubAllGlobals();
});

describe('alt text providers', () => {
  it('keeps the AltText.ai payload backwards compatible', async () => {
    const fetchMock = vi
      .fn<typeof fetch>()
      .mockResolvedValue(
        jsonResponse({ alt_text: '  "Un tramonto sul mare"  ' }),
      );
    vi.stubGlobal('fetch', fetchMock);

    const provider = createAltTextProvider({
      provider: 'alttext-ai',
      apiKey: 'alttext-secret',
    });

    await expect(provider.generate(input)).resolves.toBe(
      'Un tramonto sul mare',
    );
    const [url, init] = fetchMock.mock.calls[0] ?? [];
    const body = JSON.parse(String(init?.body)) as Record<string, unknown>;

    expect(url).toBe('https://alttext.ai/api/v1/images');
    expect(new Headers(init?.headers).get('X-Client')).toBe('datocms');
    expect(body).toMatchObject({
      image: {
        url: input.imageUrl,
        asset_id: 'dato-upload-123',
      },
      lang: 'it-IT',
    });
    expect(body).not.toHaveProperty('gpt_prompt');
  });

  it('prefers the exact AltText.ai locale over the generic response', async () => {
    const fetchMock = vi.fn<typeof fetch>().mockResolvedValue(
      jsonResponse({
        alt_text: 'English description',
        alt_texts: {
          en: 'English description',
          'it-IT': 'Descrizione italiana',
        },
      }),
    );
    vi.stubGlobal('fetch', fetchMock);

    const provider = createAltTextProvider({
      provider: 'alttext-ai',
      apiKey: 'alttext-secret',
    });

    await expect(provider.generate(input)).resolves.toBe(
      'Descrizione italiana',
    );
  });

  it('calls OpenAI Responses with expanded text and a public image URL', async () => {
    const fetchMock = vi.fn<typeof fetch>().mockResolvedValue(
      jsonResponse({
        status: 'completed',
        output: [
          {
            type: 'message',
            status: 'completed',
            content: [{ type: 'output_text', text: 'Alt text: Cielo rosso' }],
          },
        ],
      }),
    );
    vi.stubGlobal('fetch', fetchMock);

    const provider = createAltTextProvider({
      provider: 'openai',
      apiKey: 'openai-secret',
      model: 'gpt-5.4-mini',
    });

    await expect(provider.generate(input)).resolves.toBe('Cielo rosso');
    const [url, init] = fetchMock.mock.calls[0] ?? [];
    const body = JSON.parse(String(init?.body)) as {
      input: Array<{ content: Array<Record<string, unknown>> }>;
      model: string;
      reasoning: { effort: string };
      store: boolean;
    };

    expect(url).toBe('https://api.openai.com/v1/responses');
    expect(body.model).toBe('gpt-5.4-mini');
    expect(body.reasoning).toEqual({ effort: 'none' });
    expect(body.store).toBe(false);
    expect(body.input[0]?.content[0]).toMatchObject({
      type: 'input_text',
      text: expect.stringContaining('Italian'),
    });
    expect(body.input[0]?.content[0]?.text).toContain('locale code "it-IT"');
    expect(body.input[0]?.content[1]).toEqual({
      type: 'input_image',
      image_url: input.imageUrl,
      detail: 'auto',
    });
  });

  it.each([
    ['gpt-5-mini', 'minimal'],
    ['o3', 'low'],
  ])('uses %s-compatible %s reasoning', async (model, effort) => {
    const fetchMock = vi.fn<typeof fetch>().mockResolvedValue(
      jsonResponse({
        status: 'completed',
        output: [
          {
            type: 'message',
            status: 'completed',
            content: [{ type: 'output_text', text: 'A red kite' }],
          },
        ],
      }),
    );
    vi.stubGlobal('fetch', fetchMock);

    const provider = createAltTextProvider({
      provider: 'openai',
      apiKey: 'openai-secret',
      model,
    });

    await provider.generate(input);
    const init = fetchMock.mock.calls[0]?.[1];
    const body = JSON.parse(String(init?.body)) as {
      reasoning: { effort: string };
    };

    expect(body.reasoning).toEqual({ effort });
  });

  it('calls Anthropic Messages with a URL image block and browser header', async () => {
    const fetchMock = vi.fn<typeof fetch>().mockResolvedValue(
      jsonResponse({
        stop_reason: 'end_turn',
        content: [{ type: 'text', text: 'Cielo al tramonto' }],
      }),
    );
    vi.stubGlobal('fetch', fetchMock);

    const provider = createAltTextProvider({
      provider: 'anthropic',
      apiKey: 'anthropic-secret',
      model: 'claude-haiku-4-5-latest',
    });

    await expect(provider.generate(input)).resolves.toBe('Cielo al tramonto');
    const [url, init] = fetchMock.mock.calls[0] ?? [];
    const body = JSON.parse(String(init?.body)) as {
      messages: Array<{ content: Array<Record<string, unknown>> }>;
    };

    expect(url).toBe('https://api.anthropic.com/v1/messages');
    expect(
      new Headers(init?.headers).get(
        'anthropic-dangerous-direct-browser-access',
      ),
    ).toBe('true');
    expect(body.messages[0]?.content[0]).toEqual({
      type: 'image',
      source: { type: 'url', url: input.imageUrl },
    });
  });

  it('downloads and embeds the image for Gemini generateContent', async () => {
    const fetchMock = vi
      .fn<typeof fetch>()
      .mockResolvedValueOnce(
        new Response(new Uint8Array([97, 98, 99]), {
          headers: { 'Content-Type': 'image/jpeg' },
        }),
      )
      .mockResolvedValueOnce(
        jsonResponse({
          candidates: [
            {
              finishReason: 'STOP',
              content: {
                parts: [
                  { thought: true, text: 'Internal reasoning' },
                  { text: 'Un cielo arancione' },
                ],
              },
            },
          ],
        }),
      );
    vi.stubGlobal('fetch', fetchMock);

    const provider = createAltTextProvider({
      provider: 'gemini',
      apiKey: 'gemini-secret',
      model: 'models/gemini-2.5-flash',
    });

    await expect(provider.generate(input)).resolves.toBe('Un cielo arancione');
    expect(fetchMock.mock.calls[0]?.[0]).toBe(input.imageUrl);

    const [url, init] = fetchMock.mock.calls[1] ?? [];
    const body = JSON.parse(String(init?.body)) as {
      contents: Array<{ parts: Array<Record<string, unknown>> }>;
      generationConfig: {
        thinkingConfig: { thinkingBudget: number };
      };
    };

    expect(url).toBe(
      'https://generativelanguage.googleapis.com/v1beta/models/gemini-2.5-flash:generateContent',
    );
    expect(String(url)).not.toContain('gemini-secret');
    expect(body.contents[0]?.parts[0]).toEqual({
      inline_data: { mime_type: 'image/jpeg', data: 'YWJj' },
    });
    expect(body.generationConfig.thinkingConfig).toEqual({
      thinkingBudget: 0,
    });
  });

  it.each([
    ['gemini-3.5-flash', { thinkingLevel: 'minimal' }],
    ['gemini-flash-latest', { thinkingLevel: 'minimal' }],
    ['gemini-3.1-pro-preview', { thinkingLevel: 'low' }],
    ['gemini-pro-latest', { thinkingLevel: 'low' }],
    ['gemini-2.5-pro', { thinkingBudget: 128 }],
  ])('uses thinking supported by %s', async (model, expectedThinkingConfig) => {
    const fetchMock = vi
      .fn<typeof fetch>()
      .mockResolvedValueOnce(
        new Response(new Uint8Array([97, 98, 99]), {
          headers: { 'Content-Type': 'image/jpeg' },
        }),
      )
      .mockResolvedValueOnce(
        jsonResponse({
          candidates: [
            {
              finishReason: 'STOP',
              content: { parts: [{ text: 'Un cielo arancione' }] },
            },
          ],
        }),
      );
    vi.stubGlobal('fetch', fetchMock);

    const provider = createAltTextProvider({
      provider: 'gemini',
      apiKey: 'gemini-secret',
      model,
    });

    await provider.generate(input);
    const init = fetchMock.mock.calls[1]?.[1];
    const body = JSON.parse(String(init?.body)) as {
      generationConfig: {
        thinkingConfig: Record<string, string | number>;
      };
    };

    expect(body.generationConfig.thinkingConfig).toEqual(
      expectedThinkingConfig,
    );
  });

  it('normalizes provider HTTP errors without exposing credentials', async () => {
    const fetchMock = vi
      .fn<typeof fetch>()
      .mockResolvedValue(
        jsonResponse({ error: { message: 'Invalid authentication' } }, 401),
      );
    vi.stubGlobal('fetch', fetchMock);

    const provider = createAltTextProvider({
      provider: 'openai',
      apiKey: 'do-not-expose-this',
      model: 'gpt-5.4-mini',
    });
    const request = provider.generate(input);

    await expect(request).rejects.toMatchObject({
      provider: 'openai',
      code: 'auth',
      status: 401,
    });
    await expect(request).rejects.not.toThrow('do-not-expose-this');
  });

  it('rejects successful responses that contain no alt text', async () => {
    const fetchMock = vi
      .fn<typeof fetch>()
      .mockResolvedValue(jsonResponse({ output: [] }));
    vi.stubGlobal('fetch', fetchMock);

    const provider = createAltTextProvider({
      provider: 'openai',
      apiKey: 'openai-secret',
      model: 'gpt-5.4-mini',
    });

    await expect(provider.generate(input)).rejects.toMatchObject({
      provider: 'openai',
      code: 'empty_response',
    });
  });

  it('rejects incomplete OpenAI responses even when they contain partial text', async () => {
    const fetchMock = vi.fn<typeof fetch>().mockResolvedValue(
      jsonResponse({
        status: 'incomplete',
        incomplete_details: { reason: 'max_output_tokens' },
        output: [
          {
            type: 'message',
            status: 'incomplete',
            content: [{ type: 'output_text', text: 'Partial alt text' }],
          },
        ],
      }),
    );
    vi.stubGlobal('fetch', fetchMock);

    const provider = createAltTextProvider({
      provider: 'openai',
      apiKey: 'openai-secret',
      model: 'gpt-5.4-mini',
    });

    await expect(provider.generate(input)).rejects.toMatchObject({
      provider: 'openai',
      code: 'invalid_response',
    });
  });

  it('rejects OpenAI refusals instead of saving them as alt text', async () => {
    const fetchMock = vi.fn<typeof fetch>().mockResolvedValue(
      jsonResponse({
        status: 'completed',
        output: [
          {
            type: 'message',
            status: 'completed',
            content: [
              { type: 'refusal', refusal: 'I cannot analyze this image.' },
            ],
          },
        ],
      }),
    );
    vi.stubGlobal('fetch', fetchMock);

    const provider = createAltTextProvider({
      provider: 'openai',
      apiKey: 'openai-secret',
      model: 'gpt-5.4-mini',
    });

    await expect(provider.generate(input)).rejects.toMatchObject({
      provider: 'openai',
      code: 'provider',
    });
  });

  it.each([
    ['max_tokens', 'invalid_response'],
    ['refusal', 'provider'],
  ])('rejects Anthropic %s responses even when they contain text', async (stopReason, code) => {
    const fetchMock = vi.fn<typeof fetch>().mockResolvedValue(
      jsonResponse({
        stop_reason: stopReason,
        content: [{ type: 'text', text: 'Do not save this text' }],
      }),
    );
    vi.stubGlobal('fetch', fetchMock);

    const provider = createAltTextProvider({
      provider: 'anthropic',
      apiKey: 'anthropic-secret',
      model: 'claude-haiku-4-5',
    });

    await expect(provider.generate(input)).rejects.toMatchObject({
      provider: 'anthropic',
      code,
    });
  });

  it.each([
    ['MAX_TOKENS', 'invalid_response'],
    ['SAFETY', 'provider'],
  ])('rejects Gemini %s responses even when they contain text', async (finishReason, code) => {
    const fetchMock = vi
      .fn<typeof fetch>()
      .mockResolvedValueOnce(
        new Response(new Uint8Array([97, 98, 99]), {
          headers: { 'Content-Type': 'image/jpeg' },
        }),
      )
      .mockResolvedValueOnce(
        jsonResponse({
          candidates: [
            {
              finishReason,
              content: { parts: [{ text: 'Do not save this text' }] },
            },
          ],
        }),
      );
    vi.stubGlobal('fetch', fetchMock);

    const provider = createAltTextProvider({
      provider: 'gemini',
      apiKey: 'gemini-secret',
      model: 'gemini-3.5-flash',
    });

    await expect(provider.generate(input)).rejects.toMatchObject({
      provider: 'gemini',
      code,
    });
  });

  it('surfaces Gemini prompt safety blocks before looking for output', async () => {
    const fetchMock = vi
      .fn<typeof fetch>()
      .mockResolvedValueOnce(
        new Response(new Uint8Array([97, 98, 99]), {
          headers: { 'Content-Type': 'image/jpeg' },
        }),
      )
      .mockResolvedValueOnce(
        jsonResponse({
          promptFeedback: {
            blockReason: 'SAFETY',
            blockReasonMessage: 'The image was blocked by safety filters.',
          },
        }),
      );
    vi.stubGlobal('fetch', fetchMock);

    const provider = createAltTextProvider({
      provider: 'gemini',
      apiKey: 'gemini-secret',
      model: 'gemini-3.5-flash',
    });

    await expect(provider.generate(input)).rejects.toMatchObject({
      provider: 'gemini',
      code: 'provider',
    });
  });
});
