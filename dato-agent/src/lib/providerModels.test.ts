import { describe, expect, it, vi } from 'vitest';
import {
  listAnthropicProviderModels,
  listOpenAiProviderModels,
  listProviderModels,
  preferredProviderModel,
} from './providerModels';

function jsonResponse(payload: unknown, status = 200): Response {
  return new Response(JSON.stringify(payload), {
    status,
    headers: { 'Content-Type': 'application/json' },
  });
}

function anthropicModel({
  adaptive = true,
  displayName,
  efforts = ['low', 'medium', 'high'],
  id,
  maxTokens = 64_000,
}: {
  adaptive?: boolean;
  displayName?: string;
  efforts?: string[];
  id: string;
  maxTokens?: unknown;
}) {
  return {
    id,
    display_name: displayName,
    max_tokens: maxTokens,
    capabilities: {
      effort: {
        supported: efforts.length > 0,
        low: { supported: efforts.includes('low') },
        medium: { supported: efforts.includes('medium') },
        high: { supported: efforts.includes('high') },
        xhigh: { supported: efforts.includes('xhigh') },
        max: { supported: efforts.includes('max') },
      },
      thinking: {
        supported: true,
        types: {
          adaptive: { supported: adaptive },
          enabled: { supported: true },
        },
      },
    },
  };
}

describe('provider model discovery', () => {
  it('keeps the compatible OpenAI ordering and capability set', async () => {
    const fetchModels = vi.fn<typeof fetch>().mockResolvedValue(
      jsonResponse({
        data: [
          { id: 'gpt-5.6' },
          { id: 'gpt-5.6-sol' },
          { id: 'gpt-5.6-terra' },
          { id: 'gpt-5.6-terra' },
          { id: 'gpt-4.1' },
        ],
      }),
    );

    await expect(
      listOpenAiProviderModels(' sk-project ', undefined, fetchModels),
    ).resolves.toEqual([
      {
        id: 'gpt-5.6-terra',
        label: 'gpt-5.6-terra',
        reasoningEfforts: ['none', 'low', 'medium', 'high', 'xhigh', 'max'],
      },
      {
        id: 'gpt-5.6-sol',
        label: 'gpt-5.6-sol',
        reasoningEfforts: ['none', 'low', 'medium', 'high', 'xhigh', 'max'],
      },
      {
        id: 'gpt-5.6',
        label: 'gpt-5.6',
        reasoningEfforts: ['none', 'low', 'medium', 'high', 'xhigh', 'max'],
      },
    ]);
  });

  it('paginates Anthropic models and uses returned capabilities and labels', async () => {
    const fetchModels = vi
      .fn<typeof fetch>()
      .mockResolvedValueOnce(
        jsonResponse({
          data: [
            anthropicModel({
              id: 'claude-opus-4-8',
              displayName: 'Claude Opus 4.8',
              efforts: ['low', 'medium', 'high', 'xhigh', 'max'],
              maxTokens: 128_000,
            }),
            anthropicModel({
              id: 'claude-sonnet-5',
              displayName: 'Claude Sonnet 5',
              efforts: ['low', 'medium', 'high', 'xhigh'],
            }),
            anthropicModel({
              id: 'claude-sonnet-4-5',
              adaptive: false,
            }),
            anthropicModel({ id: 'other-model' }),
          ],
          has_more: true,
          last_id: 'claude-sonnet-5',
        }),
      )
      .mockResolvedValueOnce(
        jsonResponse({
          data: [
            anthropicModel({
              id: 'claude-sonnet-5',
              displayName: 'Duplicate',
            }),
            anthropicModel({
              id: 'claude-opus-4-6',
              displayName: 'Claude Opus 4.6',
              efforts: ['low', 'medium', 'high', 'max'],
              maxTokens: 32_000,
            }),
          ],
          has_more: false,
          last_id: 'claude-opus-4-6',
        }),
      );

    const models = await listAnthropicProviderModels(
      ' sk-ant-project ',
      undefined,
      fetchModels,
    );

    expect(models).toEqual([
      {
        id: 'claude-opus-4-8',
        label: 'Claude Opus 4.8',
        maxOutputTokens: 128_000,
        reasoningEfforts: ['low', 'medium', 'high', 'xhigh', 'max'],
      },
      {
        id: 'claude-sonnet-5',
        label: 'Claude Sonnet 5',
        maxOutputTokens: 64_000,
        reasoningEfforts: ['low', 'medium', 'high', 'xhigh'],
      },
      {
        id: 'claude-opus-4-6',
        label: 'Claude Opus 4.6',
        maxOutputTokens: 32_000,
        reasoningEfforts: ['low', 'medium', 'high', 'max'],
      },
    ]);
    expect(preferredProviderModel('anthropic', models)?.id).toBe(
      'claude-sonnet-5',
    );

    const [firstUrl, firstInit] = fetchModels.mock.calls[0] ?? [];
    expect(String(firstUrl)).toBe(
      'https://api.anthropic.com/v1/models?limit=1000',
    );
    expect(new Headers(firstInit?.headers).get('x-api-key')).toBe(
      'sk-ant-project',
    );
    expect(new Headers(firstInit?.headers).get('anthropic-version')).toBe(
      '2023-06-01',
    );
    expect(
      new Headers(firstInit?.headers).get(
        'anthropic-dangerous-direct-browser-access',
      ),
    ).toBe('true');
    expect(String(fetchModels.mock.calls[1]?.[0])).toBe(
      'https://api.anthropic.com/v1/models?limit=1000&after_id=claude-sonnet-5',
    );
  });

  it('gracefully omits an unreadable Anthropic output-token capability', async () => {
    const fetchModels = vi.fn<typeof fetch>().mockResolvedValue(
      jsonResponse({
        data: [
          anthropicModel({
            id: 'claude-sonnet-5',
            maxTokens: 'not-a-number',
          }),
        ],
        has_more: false,
      }),
    );

    await expect(
      listAnthropicProviderModels('sk-ant-project', undefined, fetchModels),
    ).resolves.toEqual([
      {
        id: 'claude-sonnet-5',
        label: 'claude-sonnet-5',
        reasoningEfforts: ['low', 'medium', 'high'],
      },
    ]);
  });

  it('rejects malformed Anthropic pagination instead of looping', async () => {
    const fetchModels = vi.fn<typeof fetch>().mockImplementation(async () =>
      jsonResponse({
        data: [],
        has_more: true,
        last_id: 'same-cursor',
      }),
    );

    await expect(
      listAnthropicProviderModels('sk-ant-project', undefined, fetchModels),
    ).rejects.toThrow('invalid model-list pagination');
    expect(fetchModels).toHaveBeenCalledTimes(2);
  });

  it('redacts provider keys from model API errors', async () => {
    const fetchModels = vi.fn<typeof fetch>().mockResolvedValue(
      jsonResponse(
        {
          error: {
            message: 'Invalid x-api-key sk-ant-very-secret-project-key',
          },
        },
        401,
      ),
    );

    const result = listAnthropicProviderModels(
      'sk-ant-very-secret-project-key',
      undefined,
      fetchModels,
    );
    await expect(result).rejects.toThrow('Invalid x-api-key [redacted]');
    await expect(result).rejects.not.toThrow('sk-ant-very-secret-project-key');
  });

  it('explains Anthropic browser-access failures without exposing credentials', async () => {
    const fetchModels = vi
      .fn<typeof fetch>()
      .mockRejectedValue(new TypeError('Failed to fetch'));

    const result = listAnthropicProviderModels(
      'sk-ant-very-secret-project-key',
      undefined,
      fetchModels,
    );

    await expect(result).rejects.toThrow(
      'Anthropic could not be reached from this browser',
    );
    await expect(result).rejects.toThrow('Zero Data Retention');
    await expect(result).rejects.not.toThrow('sk-ant-very-secret-project-key');
  });

  it('routes discovery through the selected provider only', async () => {
    const fetchModels = vi.fn<typeof fetch>().mockResolvedValue(
      jsonResponse({
        data: [
          anthropicModel({
            id: 'claude-sonnet-5',
            displayName: 'Claude Sonnet 5',
          }),
        ],
        has_more: false,
      }),
    );

    await expect(
      listProviderModels('anthropic', 'sk-ant-project', undefined, fetchModels),
    ).resolves.toMatchObject([{ id: 'claude-sonnet-5' }]);
    expect(String(fetchModels.mock.calls[0]?.[0])).toContain(
      'api.anthropic.com',
    );
  });
});
