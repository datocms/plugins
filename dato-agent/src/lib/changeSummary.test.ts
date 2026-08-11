import type { Message } from '@anthropic-ai/sdk/resources/messages/messages';
import type { Response } from 'openai/resources/responses/responses';
import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  CHANGE_SUMMARY_TIMEOUT_MS,
  type ChangeSummaryAnthropicClient,
  ChangeSummaryError,
  type ChangeSummaryOpenAiClient,
  generateChangeSummary,
  MAX_CHANGE_SUMMARY_CHARACTERS,
  MAX_CHANGE_SUMMARY_SOURCE_CHARACTERS,
} from './changeSummary';
import type { AgentConfig } from './config';

const script = 'await client.items.update("item-1", { title: "Updated" });';

const baseConfig = {
  provider: 'openai',
  openAiApiKey: 'sk-openai-test',
  model: 'gpt-5.6-terra',
  anthropicApiKey: 'sk-ant-test',
  anthropicModel: 'claude-sonnet-4-6',
  anthropicReasoningEffort: 'high',
} satisfies Pick<
  AgentConfig,
  | 'provider'
  | 'openAiApiKey'
  | 'model'
  | 'anthropicApiKey'
  | 'anthropicModel'
  | 'anthropicReasoningEffort'
>;

function openAiResponse(overrides: Partial<Response> = {}): Response {
  return {
    status: 'completed',
    output_text: 'Updates the title of one record.',
    output: [],
    error: null,
    ...overrides,
  } as unknown as Response;
}

function anthropicMessage(overrides: Partial<Message> = {}): Message {
  return {
    stop_reason: 'end_turn',
    stop_details: null,
    content: [
      {
        type: 'text',
        text: 'Updates the title of one record.',
        citations: null,
      },
    ],
    ...overrides,
  } as unknown as Message;
}

function openAiClient(
  implementation: ChangeSummaryOpenAiClient['create'] = async () =>
    openAiResponse(),
): ChangeSummaryOpenAiClient & { create: ReturnType<typeof vi.fn> } {
  return { create: vi.fn(implementation) };
}

function anthropicClient(
  implementation: ChangeSummaryAnthropicClient['create'] = async () =>
    anthropicMessage(),
): ChangeSummaryAnthropicClient & { create: ReturnType<typeof vi.fn> } {
  return { create: vi.fn(implementation) };
}

function expectSummaryError(
  code: ChangeSummaryError['code'],
): (error: unknown) => boolean {
  return (error) => {
    expect(error).toBeInstanceOf(ChangeSummaryError);
    expect(error).toMatchObject({ code });
    return true;
  };
}

function neverUntilAbort(signal?: AbortSignal): Promise<never> {
  return new Promise((_, reject) => {
    if (signal?.aborted) {
      reject(signal.reason);
      return;
    }
    signal?.addEventListener('abort', () => reject(signal.reason), {
      once: true,
    });
  });
}

afterEach(() => {
  vi.useRealTimers();
});

describe('generateChangeSummary with OpenAI', () => {
  it('sends only the exact TypeScript with a stateless, low-effort request', async () => {
    const client = openAiClient(async () =>
      openAiResponse({
        output_text: `  Updates one record.\r\n\r\n\r\nKeeps publication state unchanged.  `,
      }),
    );

    await expect(
      generateChangeSummary({
        config: baseConfig,
        script,
        clients: { openai: client },
      }),
    ).resolves.toBe(
      'Updates one record.\n\nKeeps publication state unchanged.',
    );

    const [request, requestOptions] = client.create.mock.calls[0] ?? [];
    expect(request).toMatchObject({
      model: 'gpt-5.6-terra',
      input: script,
      max_output_tokens: 2_000,
      reasoning: { effort: 'low' },
      text: { verbosity: 'low' },
      store: false,
      stream: false,
    });
    expect(request).not.toHaveProperty('tools');
    expect(request).not.toHaveProperty('previous_response_id');
    expect(request).not.toHaveProperty('metadata');
    expect(request?.instructions).toContain('exact TypeScript source');
    expect(request?.instructions).toContain('1–3 short sentences');
    expect(request?.instructions).toContain('previous and replacement values');
    expect(request?.instructions).toContain('comments and string literals');
    expect(requestOptions?.signal).toBeInstanceOf(AbortSignal);
  });

  it('does not reinterpret or strip semantic plain-text output', async () => {
    const client = openAiClient(async () =>
      openAiResponse({
        output_text: '  Changes <title> &amp; keeps **publication** state.  ',
      }),
    );

    await expect(
      generateChangeSummary({
        config: baseConfig,
        script,
        clients: { openai: client },
      }),
    ).resolves.toBe('Changes <title> &amp; keeps **publication** state.');
  });

  it('bounds normalized output', async () => {
    const client = openAiClient(async () =>
      openAiResponse({ output_text: ` ${'x'.repeat(2_000)} ` }),
    );

    const result = await generateChangeSummary({
      config: baseConfig,
      script,
      clients: { openai: client },
    });

    expect(result).toHaveLength(MAX_CHANGE_SUMMARY_CHARACTERS);
  });

  it('returns a provider-safe error when OpenAI fails', async () => {
    const client = openAiClient(async () => {
      throw new Error('secret upstream response sk-sensitive-data');
    });

    const error = await generateChangeSummary({
      config: baseConfig,
      script,
      clients: { openai: client },
    }).catch((cause: unknown) => cause);

    expectSummaryError('provider_error')(error);
    expect(String(error)).not.toContain('secret upstream response');
    expect(String(error)).not.toContain('sk-sensitive-data');
  });

  it('passes caller cancellation to OpenAI and reports an abort', async () => {
    const controller = new AbortController();
    let requestSignal: AbortSignal | undefined;
    const client = openAiClient(async (_request, options) => {
      requestSignal = options?.signal;
      return await neverUntilAbort(options?.signal);
    });
    const promise = generateChangeSummary({
      config: baseConfig,
      script,
      signal: controller.signal,
      clients: { openai: client },
    });

    controller.abort();

    await expect(promise).rejects.toSatisfy(expectSummaryError('aborted'));
    expect(requestSignal?.aborted).toBe(true);
  });

  it('times out OpenAI even when the client ignores its AbortSignal', async () => {
    vi.useFakeTimers();
    let requestSignal: AbortSignal | undefined;
    const client = openAiClient(async (_request, options) => {
      requestSignal = options?.signal;
      return await new Promise<never>(() => undefined);
    });
    const promise = generateChangeSummary({
      config: baseConfig,
      script,
      clients: { openai: client },
    });
    const assertion = expect(promise).rejects.toSatisfy(
      expectSummaryError('timeout'),
    );

    await vi.advanceTimersByTimeAsync(CHANGE_SUMMARY_TIMEOUT_MS);

    await assertion;
    expect(requestSignal?.aborted).toBe(true);
  });

  it('rejects an empty OpenAI response', async () => {
    const client = openAiClient(async () =>
      openAiResponse({ output_text: '' }),
    );
    await expect(
      generateChangeSummary({
        config: baseConfig,
        script,
        clients: { openai: client },
      }),
    ).rejects.toSatisfy(expectSummaryError('empty'));
  });

  it('rejects an incomplete OpenAI response', async () => {
    const client = openAiClient(async () =>
      openAiResponse({ status: 'incomplete' }),
    );
    await expect(
      generateChangeSummary({
        config: baseConfig,
        script,
        clients: { openai: client },
      }),
    ).rejects.toSatisfy(expectSummaryError('incomplete'));
  });

  it('rejects an OpenAI refusal', async () => {
    const client = openAiClient(async () =>
      openAiResponse({
        output_text: '',
        output: [
          {
            type: 'message',
            id: 'message-refusal',
            role: 'assistant',
            status: 'completed',
            content: [{ type: 'refusal', refusal: 'No.' }],
          },
        ] as Response['output'],
      }),
    );
    await expect(
      generateChangeSummary({
        config: baseConfig,
        script,
        clients: { openai: client },
      }),
    ).rejects.toSatisfy(expectSummaryError('refusal'));
  });
});

describe('generateChangeSummary with Anthropic', () => {
  const config = { ...baseConfig, provider: 'anthropic' as const };

  it('sends only the exact TypeScript with a stateless, supported-effort request', async () => {
    const client = anthropicClient(async () =>
      anthropicMessage({
        content: [
          {
            type: 'text',
            text: 'Creates one draft.\r\n\r\n\r\nDoes not publish it.',
            citations: null,
          },
        ],
      }),
    );

    await expect(
      generateChangeSummary({
        config,
        script,
        clients: { anthropic: client },
      }),
    ).resolves.toBe('Creates one draft.\n\nDoes not publish it.');

    const [request, requestOptions] = client.create.mock.calls[0] ?? [];
    expect(request).toMatchObject({
      model: 'claude-sonnet-4-6',
      messages: [{ role: 'user', content: script }],
      max_tokens: 2_000,
      thinking: { type: 'adaptive', display: 'omitted' },
      output_config: { effort: 'high' },
      stream: false,
    });
    expect(request).not.toHaveProperty('tools');
    expect(request).not.toHaveProperty('metadata');
    expect(request?.system).toContain('exact TypeScript source');
    expect(request?.system).toContain('1–3 short sentences');
    expect(request?.system).toContain('previous and replacement values');
    expect(request?.system).toContain('comments and string literals');
    expect(requestOptions?.signal).toBeInstanceOf(AbortSignal);
  });

  it('returns a provider-safe error when Anthropic fails', async () => {
    const client = anthropicClient(async () => {
      throw new Error('secret Anthropic response sk-ant-sensitive-data');
    });

    const error = await generateChangeSummary({
      config,
      script,
      clients: { anthropic: client },
    }).catch((cause: unknown) => cause);

    expectSummaryError('provider_error')(error);
    expect(String(error)).not.toContain('secret Anthropic response');
    expect(String(error)).not.toContain('sk-ant-sensitive-data');
  });

  it('passes caller cancellation to Anthropic and reports an abort', async () => {
    const controller = new AbortController();
    let requestSignal: AbortSignal | undefined;
    const client = anthropicClient(async (_request, options) => {
      requestSignal = options?.signal;
      return await neverUntilAbort(options?.signal);
    });
    const promise = generateChangeSummary({
      config,
      script,
      signal: controller.signal,
      clients: { anthropic: client },
    });

    controller.abort();

    await expect(promise).rejects.toSatisfy(expectSummaryError('aborted'));
    expect(requestSignal?.aborted).toBe(true);
  });

  it('times out Anthropic even when the client ignores its AbortSignal', async () => {
    vi.useFakeTimers();
    let requestSignal: AbortSignal | undefined;
    const client = anthropicClient(async (_request, options) => {
      requestSignal = options?.signal;
      return await new Promise<never>(() => undefined);
    });
    const promise = generateChangeSummary({
      config,
      script,
      clients: { anthropic: client },
    });
    const assertion = expect(promise).rejects.toSatisfy(
      expectSummaryError('timeout'),
    );

    await vi.advanceTimersByTimeAsync(CHANGE_SUMMARY_TIMEOUT_MS);

    await assertion;
    expect(requestSignal?.aborted).toBe(true);
  });

  it('rejects an empty Anthropic response', async () => {
    const client = anthropicClient(async () =>
      anthropicMessage({ content: [] }),
    );
    await expect(
      generateChangeSummary({
        config,
        script,
        clients: { anthropic: client },
      }),
    ).rejects.toSatisfy(expectSummaryError('empty'));
  });

  it('rejects an incomplete Anthropic response', async () => {
    const client = anthropicClient(async () =>
      anthropicMessage({ stop_reason: 'max_tokens' }),
    );
    await expect(
      generateChangeSummary({
        config,
        script,
        clients: { anthropic: client },
      }),
    ).rejects.toSatisfy(expectSummaryError('incomplete'));
  });

  it('rejects an Anthropic refusal', async () => {
    const client = anthropicClient(async () =>
      anthropicMessage({
        stop_reason: 'refusal',
        stop_details: {
          type: 'refusal',
          category: 'general_harms',
          explanation: 'No.',
        },
        content: [],
      }),
    );
    await expect(
      generateChangeSummary({
        config,
        script,
        clients: { anthropic: client },
      }),
    ).rejects.toSatisfy(expectSummaryError('refusal'));
  });
});

describe('generateChangeSummary validation', () => {
  it('requires the active API key and model even with an injected client', async () => {
    const client = openAiClient();
    await expect(
      generateChangeSummary({
        config: { ...baseConfig, openAiApiKey: '' },
        script,
        clients: { openai: client },
      }),
    ).rejects.toSatisfy(expectSummaryError('invalid_configuration'));
    expect(client.create).not.toHaveBeenCalled();
  });

  it('rejects empty or oversized TypeScript before contacting a provider', async () => {
    const client = openAiClient();
    await expect(
      generateChangeSummary({
        config: baseConfig,
        script: '   ',
        clients: { openai: client },
      }),
    ).rejects.toSatisfy(expectSummaryError('invalid_source'));
    await expect(
      generateChangeSummary({
        config: baseConfig,
        script: 'x'.repeat(MAX_CHANGE_SUMMARY_SOURCE_CHARACTERS + 1),
        clients: { openai: client },
      }),
    ).rejects.toSatisfy(expectSummaryError('source_too_large'));
    expect(client.create).not.toHaveBeenCalled();
  });

  it('allows exactly 100,000 source characters', async () => {
    const client = openAiClient();
    await expect(
      generateChangeSummary({
        config: baseConfig,
        script: 'x'.repeat(MAX_CHANGE_SUMMARY_SOURCE_CHARACTERS),
        clients: { openai: client },
      }),
    ).resolves.toBe('Updates the title of one record.');
  });

  it('rejects a signal that was already aborted without contacting a provider', async () => {
    const client = openAiClient();
    const controller = new AbortController();
    controller.abort();
    await expect(
      generateChangeSummary({
        config: baseConfig,
        script,
        signal: controller.signal,
        clients: { openai: client },
      }),
    ).rejects.toSatisfy(expectSummaryError('aborted'));
    expect(client.create).not.toHaveBeenCalled();
  });
});
