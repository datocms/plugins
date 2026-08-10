import { describe, expect, it, vi } from 'vitest';
import { listOpenAiModels } from './openAiModels';

function jsonResponse(payload: unknown, status = 200): Response {
  return new Response(JSON.stringify(payload), {
    status,
    headers: { 'Content-Type': 'application/json' },
  });
}

describe('listOpenAiModels', () => {
  it('loads, deduplicates, and sorts models from the OpenAI endpoint', async () => {
    const fetchModels = vi.fn<typeof fetch>().mockResolvedValue(
      jsonResponse({
        object: 'list',
        data: [
          { id: 'gpt-5.6-terra', object: 'model' },
          { id: 'gpt-5.6-sol', object: 'model' },
          { id: 'gpt-5.6-terra', object: 'model' },
          { id: 'text-embedding-3-large', object: 'model' },
          { id: 'gpt-image-2', object: 'model' },
          { id: 'gpt-4.1', object: 'model' },
        ],
      }),
    );

    await expect(
      listOpenAiModels('  sk-project  ', undefined, fetchModels),
    ).resolves.toEqual(['gpt-5.6-terra', 'gpt-5.6-sol']);

    const [url, init] = fetchModels.mock.calls[0] ?? [];
    expect(url).toBe('https://api.openai.com/v1/models');
    expect(new Headers(init?.headers).get('Authorization')).toBe(
      'Bearer sk-project',
    );
  });

  it('keeps compatible GPT-5.6 aliases and snapshots', async () => {
    const fetchModels = vi.fn<typeof fetch>().mockResolvedValue(
      jsonResponse({
        data: [
          { id: 'gpt-5.6' },
          { id: 'gpt-5.6-luna' },
          { id: 'gpt-5.6-sol-2026-07-01' },
          { id: 'omni-moderation-latest' },
        ],
      }),
    );

    await expect(
      listOpenAiModels('sk-project', undefined, fetchModels),
    ).resolves.toEqual(['gpt-5.6-luna', 'gpt-5.6', 'gpt-5.6-sol-2026-07-01']);
  });

  it('surfaces the OpenAI API error without exposing the key', async () => {
    const fetchModels = vi
      .fn<typeof fetch>()
      .mockResolvedValue(
        jsonResponse({ error: { message: 'Incorrect API key.' } }, 401),
      );

    await expect(
      listOpenAiModels('sk-secret', undefined, fetchModels),
    ).rejects.toThrow('Incorrect API key.');
    await expect(
      listOpenAiModels('sk-secret', undefined, fetchModels),
    ).rejects.not.toThrow('sk-secret');
  });
});
