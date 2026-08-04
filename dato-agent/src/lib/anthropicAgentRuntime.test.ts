import type {
  ContentBlock,
  Message,
  MessageCreateParamsStreaming,
  MessageStreamEvent,
  StopReason,
  ToolResultBlockParam,
  ToolUseBlock,
} from '@anthropic-ai/sdk/resources/messages/messages';
import { describe, expect, it, vi } from 'vitest';
import type {
  AgentAnthropicMessageStream,
  AgentAnthropicMessagesClient,
  AgentRuntimeEvent,
  AgentRuntimeHandle,
  AgentTurnResult,
} from './agentRuntime';
import {
  createAgentRuntime,
  DEEP_ANTHROPIC_MAX_OUTPUT_TOKENS,
  DEFAULT_ANTHROPIC_MAX_OUTPUT_TOKENS,
  MAX_AGENT_HISTORY_CHARACTERS,
  MAX_CURRENT_FORM_STATE_FIELDS,
  MAX_DISTINCT_MODEL_SCHEMAS_PER_TURN,
  MAX_PRESENTED_ASSETS,
  MAX_PRESENTED_FIELDS,
  MAX_TOOL_RESULT_CHARACTERS_PER_TURN,
  normalizeAgentHistory,
} from './agentRuntime';
import { MAX_CONVERSATION_MESSAGE_CHARACTERS } from './conversations';
import type {
  DatoMcpClient,
  DatoMcpToolDescriptor,
  DatoMcpToolResult,
} from './datoMcpClient';

const ANTHROPIC_MODEL = 'claude-sonnet-4-6';

function message(
  id: string,
  content: ContentBlock[],
  stopReason: Message['stop_reason'] = 'end_turn',
): Message {
  return {
    id,
    container: null,
    content,
    model: ANTHROPIC_MODEL,
    role: 'assistant',
    stop_details: null,
    stop_reason: stopReason,
    stop_sequence: null,
    type: 'message',
    usage: {
      cache_creation: null,
      cache_creation_input_tokens: 0,
      cache_read_input_tokens: 0,
      inference_geo: null,
      input_tokens: 1,
      output_tokens: 1,
      output_tokens_details: null,
      server_tool_use: null,
      service_tier: 'standard',
    },
  };
}

function textBlock(text: string): ContentBlock {
  return {
    citations: null,
    text,
    type: 'text',
  };
}

function thinkingBlock(
  thinking = 'I should inspect the current project.',
): ContentBlock {
  return {
    signature: 'thinking-signature',
    thinking,
    type: 'thinking',
  };
}

function toolUse(id: string, name: string, input: unknown): ToolUseBlock {
  return {
    caller: { type: 'direct' },
    id,
    input,
    name,
    type: 'tool_use',
  };
}

function eventsFor(
  finalMessage: Message,
  options: {
    redactedThinking?: boolean;
    textDeltas?: string[];
    thinkingDelta?: string;
  } = {},
): MessageStreamEvent[] {
  const events: MessageStreamEvent[] = [
    {
      type: 'message_start',
      message: {
        ...finalMessage,
        content: [],
        stop_reason: null,
      },
    },
  ];
  let blockIndex = 0;

  if (options.thinkingDelta) {
    events.push(
      {
        type: 'content_block_start',
        index: blockIndex,
        content_block: {
          signature: '',
          thinking: '',
          type: 'thinking',
        },
      },
      {
        type: 'content_block_delta',
        index: blockIndex,
        delta: {
          thinking: options.thinkingDelta,
          type: 'thinking_delta',
        },
      },
      {
        type: 'content_block_stop',
        index: blockIndex,
      },
    );
    blockIndex += 1;
  }

  if (options.redactedThinking) {
    events.push(
      {
        type: 'content_block_start',
        index: blockIndex,
        content_block: {
          data: 'opaque-thinking',
          type: 'redacted_thinking',
        },
      },
      {
        type: 'content_block_stop',
        index: blockIndex,
      },
    );
    blockIndex += 1;
  }

  const textDeltas = options.textDeltas ?? [];
  if (textDeltas.length > 0) {
    events.push({
      type: 'content_block_start',
      index: blockIndex,
      content_block: {
        citations: null,
        text: '',
        type: 'text',
      },
    });
    for (const text of textDeltas) {
      events.push({
        type: 'content_block_delta',
        index: blockIndex,
        delta: {
          text,
          type: 'text_delta',
        },
      });
    }
    events.push({
      type: 'content_block_stop',
      index: blockIndex,
    });
  }

  events.push({
    type: 'message_stop',
  });
  return events;
}

class FakeAnthropicStream implements AgentAnthropicMessageStream {
  constructor(
    private readonly events: MessageStreamEvent[],
    private readonly final: Message,
  ) {}

  async *[Symbol.asyncIterator](): AsyncIterator<MessageStreamEvent> {
    for (const event of this.events) {
      yield event;
    }
  }

  async finalMessage(): Promise<Message> {
    return this.final;
  }
}

class QueueAnthropicClient implements AgentAnthropicMessagesClient {
  readonly requests: MessageCreateParamsStreaming[] = [];
  readonly signals: Array<AbortSignal | undefined> = [];

  constructor(private readonly messages: Array<Message | Error>) {}

  stream(
    params: MessageCreateParamsStreaming,
    options?: { signal?: AbortSignal },
  ): AgentAnthropicMessageStream {
    this.requests.push(params);
    this.signals.push(options?.signal);
    const next = this.messages.shift();
    if (!next) {
      throw new Error('No fake Anthropic message was queued.');
    }
    if (next instanceof Error) {
      throw next;
    }

    return new FakeAnthropicStream(
      eventsFor(next, {
        redactedThinking:
          !next.content.some((block) => block.type === 'thinking') &&
          next.content.some((block) => block.type === 'redacted_thinking'),
        textDeltas: next.content
          .filter(
            (block): block is Extract<ContentBlock, { type: 'text' }> =>
              block.type === 'text',
          )
          .map((block) => block.text),
        thinkingDelta: next.content.some((block) => block.type === 'thinking')
          ? 'Inspecting DatoCMS.'
          : undefined,
      }),
      next,
    );
  }
}

const MCP_TOOLS: readonly DatoMcpToolDescriptor[] = [
  {
    name: 'whoami',
    description: 'Read the current DatoCMS identity.',
    inputSchema: {
      type: 'object',
      additionalProperties: false,
      properties: {},
    },
    annotations: { readOnlyHint: true },
  },
  {
    name: 'get_schema',
    description: 'Read the current project schema.',
    inputSchema: {
      type: 'object',
      properties: {
        site_id: { type: 'string' },
      },
    },
  },
  {
    name: 'upsert_and_execute_safe_script',
    description: 'Run a read-only DatoCMS script.',
    inputSchema: {
      type: 'object',
      properties: {
        site_id: { type: 'string' },
      },
    },
  },
  {
    name: 'upsert_and_execute_unsafe_script',
    description: 'Run a DatoCMS script that can change content.',
    inputSchema: {
      type: 'object',
      properties: {
        site_id: { type: 'string' },
      },
    },
  },
];

function mcpClientWith(
  callImplementation: (
    name: string,
    args: Record<string, unknown>,
    signal?: AbortSignal,
  ) => Promise<DatoMcpToolResult> = async () => ({
    content: '{"ok":true}',
    isError: false,
  }),
): {
  client: DatoMcpClient;
  listTools: ReturnType<typeof vi.fn>;
  callTool: ReturnType<typeof vi.fn>;
  close: ReturnType<typeof vi.fn>;
} {
  const listTools = vi.fn(async () => MCP_TOOLS);
  const callTool = vi.fn(
    async (
      call: { name: string; arguments: Record<string, unknown> },
      signal?: AbortSignal,
    ) => await callImplementation(call.name, call.arguments, signal),
  );
  const close = vi.fn(async () => undefined);

  return {
    client: {
      listTools,
      callTool,
      close,
    },
    listTools,
    callTool,
    close,
  };
}

function runtimeWith(
  anthropicClient: AgentAnthropicMessagesClient,
  datoMcpClient: DatoMcpClient,
  overrides: Partial<Parameters<typeof createAgentRuntime>[0]> = {},
): AgentRuntimeHandle {
  return createAgentRuntime({
    provider: 'anthropic',
    anthropicClient,
    datoMcpClient,
    mcpAccessToken: 'mcp-token',
    context: {
      siteId: 'site-1',
      environment: 'sandbox-1',
      isEnvironmentPrimary: false,
    },
    navigation: {
      openRecord: vi.fn(),
      showRecords: vi.fn(),
      presentRecords: vi.fn(),
      presentFields: vi.fn(),
      readCurrentRecordLiveFormState: vi.fn(),
      presentAssets: vi.fn(),
    },
    model: ANTHROPIC_MODEL,
    reasoningEffort: 'xhigh',
    ...overrides,
  });
}

async function drain(
  stream: AsyncGenerator<AgentRuntimeEvent, AgentTurnResult>,
): Promise<{ events: AgentRuntimeEvent[]; result: AgentTurnResult }> {
  const events: AgentRuntimeEvent[] = [];

  while (true) {
    // biome-ignore lint/performance/noAwaitInLoops: Capturing an async generator's return value requires ordered iteration.
    const next = await stream.next();
    if (next.done) {
      return { events, result: next.value };
    }
    events.push(next.value);
  }
}

function providerError(
  status: number | undefined,
  message: string,
  type?: string,
): Error {
  return Object.assign(new Error(message), {
    ...(status === undefined ? {} : { status }),
    ...(type ? { type } : {}),
  });
}

function unsafeScriptInput(
  filename = 'update-title.ts',
): Record<string, unknown> {
  return {
    site_id: 'site-1',
    environment: 'sandbox-1',
    name: `script://dato-agent/site-1/sandbox-1/${filename}`,
    body: {
      mode: 'full',
      content: 'await client.items.update("item-1", { title: "Updated" });',
    },
    method_tokens: ['method-token'],
  };
}

function lastMessageContent(request: MessageCreateParamsStreaming): unknown[] {
  const content = request.messages.at(-1)?.content;
  if (!Array.isArray(content)) {
    throw new Error('Expected a block-based final request message.');
  }
  return content;
}

function isToolResultBlock(value: unknown): value is ToolResultBlockParam {
  return (
    value !== null &&
    typeof value === 'object' &&
    'type' in value &&
    value.type === 'tool_result'
  );
}

describe('AnthropicAgentRuntime', () => {
  it('rejects an oversized message before contacting Anthropic or DatoCMS', async () => {
    const anthropic = new QueueAnthropicClient([]);
    const mcp = mcpClientWith();
    const runtime = runtimeWith(anthropic, mcp.client);
    const { result } = await drain(
      runtime.streamTurn({
        message: 'x'.repeat(MAX_CONVERSATION_MESSAGE_CHARACTERS + 1),
      }),
    );

    expect(result).toMatchObject({
      status: 'failed',
      error: {
        code: 'invalid_request',
        message: `A message cannot exceed ${MAX_CONVERSATION_MESSAGE_CHARACTERS.toLocaleString()} characters.`,
        retryable: false,
      },
    });
    expect(anthropic.requests).toHaveLength(0);
    expect(mcp.listTools).not.toHaveBeenCalled();
  });

  it('builds a native Anthropic request with direct MCP tools, context, and history', async () => {
    const anthropic = new QueueAnthropicClient([
      message('msg-config', [textBlock('Ready.')]),
    ]);
    const mcp = mcpClientWith();
    const runtime = runtimeWith(anthropic, mcp.client, {
      additionalInstructions: 'Prefer sentence case.',
      getModelSchema: vi.fn(),
      hostContext: 'models:\n- article | Article | title:string',
    });
    const { events, result } = await drain(
      runtime.streamTurn({
        history: [
          { role: 'user', text: 'What is in this project?' },
          { role: 'assistant', text: 'I can inspect it.' },
        ],
        injectHostContext: true,
        message: 'Find the homepage.',
      }),
    );

    expect(result).toMatchObject({
      status: 'completed',
      responseId: 'msg-config',
      text: 'Ready.',
      continuationCount: 0,
    });
    expect(
      events
        .filter(
          (
            event,
          ): event is Extract<AgentRuntimeEvent, { type: 'text_delta' }> =>
            event.type === 'text_delta',
        )
        .map((event) => event.delta),
    ).toEqual(['Ready.']);
    expect(mcp.listTools).toHaveBeenCalledOnce();

    const request = anthropic.requests[0];
    expect(request).toMatchObject({
      model: ANTHROPIC_MODEL,
      stream: true,
      thinking: { type: 'adaptive', display: 'omitted' },
      output_config: { effort: 'xhigh' },
      tool_choice: {
        type: 'auto',
        disable_parallel_tool_use: true,
      },
    });
    expect(JSON.stringify(request.system)).toContain(
      'models:\\n- article | Article | title:string',
    );
    expect(JSON.stringify(request.system)).toContain('Prefer sentence case.');
    expect(request.messages.map(({ role }) => role)).toEqual([
      'user',
      'assistant',
      'user',
    ]);
    expect(JSON.stringify(request.messages)).toContain(
      'What is in this project?',
    );
    expect(JSON.stringify(request.messages)).toContain('Find the homepage.');
    expect(JSON.stringify(request.messages)).not.toContain(
      'article | Article | title:string',
    );

    const toolNames = (request.tools ?? [])
      .map((tool) => ('name' in tool ? tool.name : undefined))
      .filter(Boolean);
    expect(toolNames).toEqual(
      expect.arrayContaining([
        'whoami',
        'get_schema',
        'upsert_and_execute_safe_script',
        'upsert_and_execute_unsafe_script',
        'open_record',
        'show_records',
        'present_records',
        'present_fields',
        'read_current_record_live_form_state',
        'present_assets',
        'get_model_schema',
      ]),
    );
    expect(
      request.tools?.find((tool) => tool.name === 'present_fields'),
    ).toMatchObject({
      input_schema: {
        type: 'object',
        additionalProperties: false,
        required: ['title', 'fields'],
        properties: {
          fields: {
            type: 'array',
            minItems: 1,
            maxItems: MAX_PRESENTED_FIELDS,
            items: {
              type: 'object',
              additionalProperties: false,
              required: ['field_path', 'label', 'locale'],
            },
          },
        },
      },
    });
    expect(
      request.tools?.find(
        (tool) => tool.name === 'read_current_record_live_form_state',
      ),
    ).toMatchObject({
      description: expect.stringMatching(
        /current record only[\s\S]*unsaved[\s\S]*not evidence[\s\S]*saved-state verification/i,
      ),
      input_schema: {
        type: 'object',
        additionalProperties: false,
        required: ['fields'],
        properties: {
          fields: {
            type: 'array',
            minItems: 1,
            maxItems: MAX_CURRENT_FORM_STATE_FIELDS,
            items: {
              type: 'object',
              additionalProperties: false,
              required: ['field_api_key', 'locale'],
            },
          },
        },
      },
    });
    expect(
      request.tools?.find((tool) => tool.name === 'present_assets'),
    ).toMatchObject({
      input_schema: {
        type: 'object',
        additionalProperties: false,
        required: ['title', 'assets'],
        properties: {
          assets: {
            type: 'array',
            minItems: 1,
            maxItems: MAX_PRESENTED_ASSETS,
            items: {
              type: 'object',
              additionalProperties: false,
              required: ['upload_id', 'label'],
              properties: {
                upload_id: { type: 'string' },
                label: { type: ['string', 'null'] },
              },
            },
          },
        },
      },
    });
    expect(
      (request.tools ?? []).some((tool) => Object.hasOwn(tool, 'strict')),
    ).toBe(false);
    expect(
      (request as MessageCreateParamsStreaming & { mcp_servers?: unknown })
        .mcp_servers,
    ).toBeUndefined();
    expect(mcp.close).toHaveBeenCalledOnce();
  });

  it('does not advertise current-record field tools when the Anthropic host surface lacks those capabilities', async () => {
    const anthropic = new QueueAnthropicClient([
      message('msg-no-current-record', [textBlock('Ready.')]),
    ]);
    const mcp = mcpClientWith();
    const runtime = runtimeWith(anthropic, mcp.client, {
      navigation: {
        openRecord: vi.fn(),
        showRecords: vi.fn(),
        presentRecords: vi.fn(),
        presentAssets: vi.fn(),
      },
    });

    await drain(runtime.streamTurn({ message: 'Help me' }));

    const toolNames = (anthropic.requests[0]?.tools ?? []).map(
      (tool) => tool.name,
    );
    expect(toolNames).not.toContain('present_fields');
    expect(toolNames).not.toContain('read_current_record_live_form_state');
    expect(toolNames).toContain('present_assets');
  });

  it.each([
    {
      effort: 'low',
      discoveredMaximum: 128_000,
      expectedMaximum: DEFAULT_ANTHROPIC_MAX_OUTPUT_TOKENS,
    },
    {
      effort: 'medium',
      discoveredMaximum: 128_000,
      expectedMaximum: DEFAULT_ANTHROPIC_MAX_OUTPUT_TOKENS,
    },
    {
      effort: 'high',
      discoveredMaximum: 128_000,
      expectedMaximum: DEFAULT_ANTHROPIC_MAX_OUTPUT_TOKENS,
    },
    {
      effort: 'xhigh',
      discoveredMaximum: 128_000,
      expectedMaximum: DEEP_ANTHROPIC_MAX_OUTPUT_TOKENS,
    },
    {
      effort: 'max',
      discoveredMaximum: 128_000,
      expectedMaximum: DEEP_ANTHROPIC_MAX_OUTPUT_TOKENS,
    },
    {
      effort: 'xhigh',
      discoveredMaximum: 32_000,
      expectedMaximum: 32_000,
    },
    {
      effort: 'max',
      discoveredMaximum: undefined,
      expectedMaximum: DEFAULT_ANTHROPIC_MAX_OUTPUT_TOKENS,
    },
    {
      effort: 'high',
      discoveredMaximum: 8_000,
      expectedMaximum: 8_000,
    },
  ] as const)(
    'maps $effort effort to a model-safe $expectedMaximum token budget',
    async ({ discoveredMaximum, effort, expectedMaximum }) => {
      const anthropic = new QueueAnthropicClient([
        message(`msg-effort-${effort}-${expectedMaximum}`, [
          textBlock('Done.'),
        ]),
      ]);
      const mcp = mcpClientWith();
      const runtime = runtimeWith(anthropic, mcp.client, {
        modelMaxOutputTokens: discoveredMaximum,
        reasoningEffort: effort,
      });

      await drain(runtime.streamTurn({ message: 'Check this project.' }));

      expect(anthropic.requests[0]).toMatchObject({
        max_tokens: expectedMaximum,
        output_config: { effort },
        thinking: { type: 'adaptive', display: 'omitted' },
      });
    },
  );

  it('bounds browser history and never starts a request with an orphan assistant turn', () => {
    const normalized = normalizeAgentHistory([
      {
        role: 'user',
        text: 'This old user turn should fall outside the retained budget.',
      },
      {
        role: 'assistant',
        text: 'a'.repeat(MAX_AGENT_HISTORY_CHARACTERS),
      },
      {
        role: 'user',
        text: 'Keep this recent question.',
      },
    ]);

    expect(
      normalized.reduce((total, entry) => total + entry.text.length, 0),
    ).toBeLessThanOrEqual(MAX_AGENT_HISTORY_CHARACTERS);
    expect(normalized).toEqual([
      {
        role: 'user',
        text: 'Keep this recent question.',
      },
    ]);
  });

  it('executes safe MCP tools and preserves every assistant block in the continuation', async () => {
    const originalBlocks: ContentBlock[] = [
      thinkingBlock(),
      {
        data: 'opaque-safety-preserving-thinking',
        type: 'redacted_thinking',
      },
      toolUse('toolu-safe', 'whoami', {}),
    ];
    const anthropic = new QueueAnthropicClient([
      message('msg-safe', originalBlocks, 'tool_use'),
      message('msg-safe-done', [textBlock('This is the marketing project.')]),
    ]);
    const mcp = mcpClientWith();
    const runtime = runtimeWith(anthropic, mcp.client);

    const { result } = await drain(
      runtime.streamTurn({ message: 'Describe this project.' }),
    );

    expect(result).toMatchObject({
      status: 'completed',
      responseId: 'msg-safe-done',
      text: 'This is the marketing project.',
      continuationCount: 1,
    });
    expect(mcp.callTool).toHaveBeenCalledOnce();
    expect(mcp.callTool).toHaveBeenCalledWith(
      {
        name: 'whoami',
        arguments: {},
      },
      undefined,
    );
    expect(anthropic.requests).toHaveLength(2);

    const continuationMessages = anthropic.requests[1].messages;
    expect(continuationMessages.at(-2)).toEqual({
      role: 'assistant',
      content: originalBlocks,
    });
    expect(continuationMessages.at(-1)?.role).toBe('user');
    expect(lastMessageContent(anthropic.requests[1])).toEqual([
      expect.objectContaining({
        type: 'tool_result',
        tool_use_id: 'toolu-safe',
        content: '{"ok":true}',
      }),
    ]);
  });

  it('treats redacted thinking as activity and replays it unchanged', async () => {
    const redactedThinking: ContentBlock = {
      data: 'opaque-signed-reasoning',
      type: 'redacted_thinking',
    };
    const originalBlocks = [
      redactedThinking,
      toolUse('toolu-redacted', 'whoami', {}),
    ];
    const anthropic = new QueueAnthropicClient([
      message('msg-redacted', originalBlocks, 'tool_use'),
      message('msg-redacted-done', [textBlock('Done.')]),
    ]);
    const mcp = mcpClientWith();
    const runtime = runtimeWith(anthropic, mcp.client);

    const { events, result } = await drain(
      runtime.streamTurn({ message: 'Check the project.' }),
    );

    expect(result.status).toBe('completed');
    expect(
      events.some(
        (event) =>
          event.type === 'activity' &&
          event.activity.kind === 'thinking' &&
          event.activity.status === 'in_progress',
      ),
    ).toBe(true);
    expect(
      events.some(
        (event) =>
          event.type === 'activity' &&
          event.activity.kind === 'thinking' &&
          event.activity.status === 'completed',
      ),
    ).toBe(true);
    expect(anthropic.requests[1].messages.at(-2)).toEqual({
      role: 'assistant',
      content: originalBlocks,
    });
  });

  it('returns safe MCP transport failures to Claude and keeps the turn running', async () => {
    const anthropic = new QueueAnthropicClient([
      message(
        'msg-safe-error',
        [toolUse('toolu-safe-error', 'whoami', {})],
        'tool_use',
      ),
      message('msg-recovered', [
        textBlock('The connection was temporary; no content was changed.'),
      ]),
    ]);
    const mcp = mcpClientWith(async () => {
      throw new Error('temporary transport error');
    });
    const runtime = runtimeWith(anthropic, mcp.client);

    const { events, result } = await drain(
      runtime.streamTurn({ message: 'Describe this project.' }),
    );

    expect(result).toMatchObject({
      status: 'completed',
      responseId: 'msg-recovered',
      text: 'The connection was temporary; no content was changed.',
    });
    expect(lastMessageContent(anthropic.requests[1])).toEqual([
      expect.objectContaining({
        type: 'tool_result',
        tool_use_id: 'toolu-safe-error',
        is_error: true,
        content: expect.stringContaining('temporary transport error'),
      }),
    ]);
    expect(
      events.some(
        (event) =>
          event.type === 'activity' &&
          event.activity.kind === 'mcp_tool' &&
          event.activity.status === 'failed',
      ),
    ).toBe(true);
    expect(events.some((event) => event.type === 'approval_required')).toBe(
      false,
    );
  });

  it.each([
    {
      label: 'a different project',
      name: 'get_schema',
      input: {
        site_id: 'another-site',
        environment: 'sandbox-1',
      },
    },
    {
      label: 'a different environment',
      name: 'get_schema',
      input: {
        site_id: 'site-1',
        environment: 'production',
      },
    },
    {
      label: 'an unadvertised tool',
      name: 'search_projects',
      input: {},
    },
    {
      label: 'a malformed argument value',
      name: 'whoami',
      input: 'not-an-object',
    },
  ])(
    'blocks $label before MCP dispatch and lets Claude recover',
    async ({ name, input }) => {
      const anthropic = new QueueAnthropicClient([
        message(
          'msg-invalid-call',
          [toolUse('toolu-invalid-call', name, input)],
          'tool_use',
        ),
        message('msg-invalid-recovered', [
          textBlock('That operation was outside the current project scope.'),
        ]),
      ]);
      const mcp = mcpClientWith();
      const runtime = runtimeWith(anthropic, mcp.client);

      const { result } = await drain(
        runtime.streamTurn({ message: 'Inspect that project.' }),
      );

      expect(result).toMatchObject({
        status: 'completed',
        responseId: 'msg-invalid-recovered',
      });
      expect(mcp.callTool).not.toHaveBeenCalled();
      expect(lastMessageContent(anthropic.requests[1])).toEqual([
        expect.objectContaining({
          type: 'tool_result',
          tool_use_id: 'toolu-invalid-call',
          is_error: true,
        }),
      ]);
    },
  );

  it('caps distinct local model-schema lookups and redirects the model to global search', async () => {
    const schemaResponseCount = MAX_DISTINCT_MODEL_SCHEMAS_PER_TURN + 1;
    const anthropic = new QueueAnthropicClient([
      ...Array.from({ length: schemaResponseCount }, (_, index) =>
        message(
          `msg-schema-${index}`,
          [
            toolUse(`toolu-schema-${index}`, 'get_model_schema', {
              identifier: `model_${index}`,
              cursor: null,
            }),
          ],
          'tool_use',
        ),
      ),
      message('msg-schema-done', [
        textBlock('I used the project-wide search.'),
      ]),
    ]);
    const mcp = mcpClientWith();
    const getModelSchema = vi.fn(async (input: { identifier: string }) => ({
      model: input.identifier,
      fields: [],
    }));
    const runtime = runtimeWith(anthropic, mcp.client, { getModelSchema });

    const { result } = await drain(
      runtime.streamTurn({ message: 'Find the matching record.' }),
    );

    expect(result.status).toBe('completed');
    expect(getModelSchema).toHaveBeenCalledTimes(
      MAX_DISTINCT_MODEL_SCHEMAS_PER_TURN,
    );
    const finalRequest = anthropic.requests.at(-1);
    if (!finalRequest) {
      throw new Error('Expected a final Anthropic request.');
    }
    expect(JSON.stringify(lastMessageContent(finalRequest))).toContain(
      'items.rawList search with filter.query',
    );
  });

  it('presents verified records in chat without invoking either navigation callback', async () => {
    const anthropic = new QueueAnthropicClient([
      message(
        'msg-present',
        [
          toolUse('toolu-present', 'present_records', {
            title: 'Web development',
            records: [
              {
                item_id: 'item-1',
                item_type_id: 'article',
                label: 'Building for the web',
              },
              {
                item_id: 'item-2',
                item_type_id: null,
                label: null,
              },
            ],
          }),
        ],
        'tool_use',
      ),
      message('msg-present-done', [textBlock('I found two relevant records.')]),
    ]);
    const mcp = mcpClientWith();
    const openRecord = vi.fn();
    const showRecords = vi.fn();
    const presentRecords = vi.fn().mockResolvedValue({
      presented: true,
    });
    const runtime = runtimeWith(anthropic, mcp.client, {
      navigation: {
        openRecord,
        showRecords,
        presentRecords,
        presentFields: vi.fn(),
        readCurrentRecordLiveFormState: vi.fn(),
        presentAssets: vi.fn(),
      },
    });

    const { events, result } = await drain(
      runtime.streamTurn({
        message: 'Which records discuss web development?',
      }),
    );

    expect(presentRecords).toHaveBeenCalledOnce();
    expect(presentRecords).toHaveBeenCalledWith({
      title: 'Web development',
      records: [
        {
          itemId: 'item-1',
          itemTypeId: 'article',
          label: 'Building for the web',
        },
        { itemId: 'item-2' },
      ],
    });
    expect(openRecord).not.toHaveBeenCalled();
    expect(showRecords).not.toHaveBeenCalled();
    expect(mcp.callTool).not.toHaveBeenCalled();
    expect(lastMessageContent(anthropic.requests[1])).toEqual([
      expect.objectContaining({
        type: 'tool_result',
        tool_use_id: 'toolu-present',
        is_error: false,
        content: JSON.stringify({ ok: true, presented: true }),
      }),
    ]);
    expect(result).toMatchObject({
      status: 'completed',
      responseId: 'msg-present-done',
      text: 'I found two relevant records.',
    });
    expect(events).toContainEqual({
      type: 'activity',
      responseId: 'msg-present',
      activity: expect.objectContaining({
        id: 'toolu-present',
        kind: 'navigation',
        status: 'completed',
        label: 'Record links ready',
        toolName: 'present_records',
        output: JSON.stringify({ ok: true, presented: true }),
      }),
    });
  });

  it('executes field links, live current-form reads, and asset links through strict host callbacks', async () => {
    const anthropic = new QueueAnthropicClient([
      message(
        'msg-local-presentation',
        [
          toolUse('toolu-fields', 'present_fields', {
            title: 'Fields to review',
            fields: [
              { field_path: 'seo_title', label: 'SEO title', locale: 'en' },
              { field_path: 'seo_title', label: 'Duplicate', locale: 'en' },
              { field_path: 'seo_title', label: 'Titolo SEO', locale: 'it' },
              { field_path: 'body', label: null, locale: null },
            ],
          }),
          toolUse('toolu-form', 'read_current_record_live_form_state', {
            fields: [
              { field_api_key: 'seo_title', locale: 'en' },
              { field_api_key: 'seo_title', locale: 'en' },
              { field_api_key: 'body', locale: null },
            ],
          }),
          toolUse('toolu-assets', 'present_assets', {
            title: 'Referenced assets',
            assets: [
              { upload_id: 'upload-1', label: 'Hero image' },
              { upload_id: 'upload-1', label: 'Duplicate' },
              { upload_id: 'upload-2', label: null },
            ],
          }),
        ],
        'tool_use',
      ),
      message('msg-local-presentation-done', [textBlock('Ready.')]),
    ]);
    const mcp = mcpClientWith();
    const presentFields = vi.fn().mockResolvedValue({ presented: true });
    const readCurrentRecordLiveFormState = vi.fn().mockResolvedValue({
      values: [
        { fieldApiKey: 'seo_title', locale: 'en', value: 'Unsaved title' },
        { fieldApiKey: 'body', value: 'Current body' },
      ],
    });
    const presentAssets = vi.fn().mockResolvedValue({ presented: true });
    const runtime = runtimeWith(anthropic, mcp.client, {
      navigation: {
        openRecord: vi.fn(),
        showRecords: vi.fn(),
        presentRecords: vi.fn(),
        presentFields,
        readCurrentRecordLiveFormState,
        presentAssets,
      },
    });

    const { events, result } = await drain(
      runtime.streamTurn({ message: 'Help me review this record.' }),
    );

    expect(presentFields).toHaveBeenCalledWith({
      title: 'Fields to review',
      fields: [
        { fieldPath: 'seo_title', label: 'SEO title', locale: 'en' },
        { fieldPath: 'seo_title', label: 'Titolo SEO', locale: 'it' },
        { fieldPath: 'body' },
      ],
    });
    expect(readCurrentRecordLiveFormState).toHaveBeenCalledWith({
      fields: [
        { fieldApiKey: 'seo_title', locale: 'en' },
        { fieldApiKey: 'body' },
      ],
    });
    expect(presentAssets).toHaveBeenCalledWith({
      title: 'Referenced assets',
      assets: [
        { uploadId: 'upload-1', label: 'Hero image' },
        { uploadId: 'upload-2' },
      ],
    });
    expect(mcp.callTool).not.toHaveBeenCalled();

    const continuationContent = lastMessageContent(anthropic.requests[1]);
    const formResult = continuationContent.find(
      (block): block is ToolResultBlockParam =>
        isToolResultBlock(block) && block.tool_use_id === 'toolu-form',
    );
    expect(formResult).toMatchObject({
      type: 'tool_result',
      tool_use_id: 'toolu-form',
      is_error: false,
      content: expect.stringContaining(
        '"source":"live_browser_form_for_current_record"',
      ),
    });
    if (typeof formResult?.content !== 'string') {
      throw new Error('Expected a string current-form tool result.');
    }
    expect(JSON.parse(formResult.content)).toMatchObject({
      source: 'live_browser_form_for_current_record',
      valuesMayBeUnsaved: true,
      savedDatoCmsStateVerified: false,
    });
    expect(result).toMatchObject({
      status: 'completed',
      responseId: 'msg-local-presentation-done',
      text: 'Ready.',
    });
    expect(
      events
        .filter(
          (event): event is Extract<AgentRuntimeEvent, { type: 'activity' }> =>
            event.type === 'activity',
        )
        .map((event) => event.activity.label),
    ).toEqual(
      expect.arrayContaining([
        'Adding field links',
        'Field links ready',
        'Reading current form values',
        'Current form values read',
        'Adding asset links',
        'Asset links ready',
      ]),
    );
  });

  it('rejects malformed field, live-form, and asset inputs before Anthropic host callbacks run', async () => {
    const anthropic = new QueueAnthropicClient([
      message(
        'msg-invalid-local',
        [
          toolUse('toolu-fields-invalid', 'present_fields', {
            title: 'Fields',
            fields: [{ field_path: 'title', locale: null }],
          }),
          toolUse('toolu-form-invalid', 'read_current_record_live_form_state', {
            fields: [{ field_api_key: 'seo.title', locale: null }],
          }),
          toolUse('toolu-assets-invalid', 'present_assets', {
            title: 'Assets',
            assets: [
              {
                upload_id: 'upload-1',
                label: 'Hero',
                url: 'https://example.test/not-accepted',
              },
            ],
          }),
        ],
        'tool_use',
      ),
      message('msg-invalid-local-done', [textBlock('I need valid inputs.')]),
    ]);
    const mcp = mcpClientWith();
    const presentFields = vi.fn();
    const readCurrentRecordLiveFormState = vi.fn();
    const presentAssets = vi.fn();
    const runtime = runtimeWith(anthropic, mcp.client, {
      navigation: {
        openRecord: vi.fn(),
        showRecords: vi.fn(),
        presentRecords: vi.fn(),
        presentFields,
        readCurrentRecordLiveFormState,
        presentAssets,
      },
    });

    const { events, result } = await drain(
      runtime.streamTurn({ message: 'Show these references.' }),
    );

    expect(presentFields).not.toHaveBeenCalled();
    expect(readCurrentRecordLiveFormState).not.toHaveBeenCalled();
    expect(presentAssets).not.toHaveBeenCalled();
    expect(mcp.callTool).not.toHaveBeenCalled();
    expect(result.status).toBe('completed');
    expect(
      lastMessageContent(anthropic.requests[1]).filter(isToolResultBlock),
    ).toEqual([
      expect.objectContaining({
        tool_use_id: 'toolu-fields-invalid',
        is_error: true,
        content: expect.stringContaining('missing required key: label'),
      }),
      expect.objectContaining({
        tool_use_id: 'toolu-form-invalid',
        is_error: true,
        content: expect.stringContaining('exact top-level field API key'),
      }),
      expect.objectContaining({
        tool_use_id: 'toolu-assets-invalid',
        is_error: true,
        content: expect.stringContaining('unsupported key: url'),
      }),
    ]);
    expect(
      events
        .filter(
          (event): event is Extract<AgentRuntimeEvent, { type: 'activity' }> =>
            event.type === 'activity' && event.activity.status === 'failed',
        )
        .map((event) => event.activity.label),
    ).toEqual([
      'Could not add field links',
      'Could not read current form values',
      'Could not add asset links',
    ]);
  });

  it('pauses an unsafe tool, then atomically groups approved and local results', async () => {
    const unsafeInput = unsafeScriptInput();
    const originalBlocks: ContentBlock[] = [
      thinkingBlock('I found the exact record and prepared the update.'),
      toolUse('toolu-unsafe', 'upsert_and_execute_unsafe_script', unsafeInput),
      toolUse('toolu-open', 'open_record', {
        item_id: 'item-1',
        item_type_id: 'article',
        field_path: 'title',
      }),
    ];
    const anthropic = new QueueAnthropicClient([
      message('msg-approval', originalBlocks, 'tool_use'),
      message('msg-approved', [textBlock('The title was updated.')]),
    ]);
    const mcp = mcpClientWith(async () => ({
      content: '{"updated":["item-1"]}',
      isError: false,
    }));
    const openRecord = vi.fn().mockResolvedValue(undefined);
    const runtime = runtimeWith(anthropic, mcp.client, {
      navigation: {
        openRecord,
        showRecords: vi.fn(),
        presentRecords: vi.fn(),
        presentFields: vi.fn(),
        readCurrentRecordLiveFormState: vi.fn(),
        presentAssets: vi.fn(),
      },
    });

    const first = await drain(
      runtime.streamTurn({ message: 'Update the title.' }),
    );

    expect(first.result).toMatchObject({
      status: 'approval_required',
      responseId: 'msg-approval',
      approvals: [
        {
          approvalRequestId: 'toolu-unsafe',
          name: 'upsert_and_execute_unsafe_script',
          serverLabel: 'datocms',
          parsedArguments: unsafeInput,
        },
      ],
    });
    expect(mcp.callTool).not.toHaveBeenCalled();
    expect(mcp.close).not.toHaveBeenCalled();
    expect(openRecord).toHaveBeenCalledWith({
      itemId: 'item-1',
      itemTypeId: 'article',
      fieldPath: 'title',
    });

    const second = await drain(
      runtime.continueApproval({
        responseId: 'msg-approval',
        approvalRequestId: 'toolu-unsafe',
        approve: true,
      }),
    );

    expect(second.result).toMatchObject({
      status: 'completed',
      responseId: 'msg-approved',
      text: 'The title was updated.',
    });
    expect(second.events).toContainEqual({
      type: 'activity',
      responseId: 'msg-approval',
      activity: expect.objectContaining({
        id: 'toolu-unsafe',
        status: 'completed',
        output: '{"updated":["item-1"]}',
      }),
    });
    expect(mcp.callTool).toHaveBeenCalledOnce();
    expect(mcp.callTool).toHaveBeenCalledWith(
      {
        name: 'upsert_and_execute_unsafe_script',
        arguments: unsafeInput,
      },
      undefined,
    );
    expect(anthropic.requests[1].messages.at(-2)).toEqual({
      role: 'assistant',
      content: originalBlocks,
    });
    expect(lastMessageContent(anthropic.requests[1])).toEqual([
      expect.objectContaining({
        type: 'tool_result',
        tool_use_id: 'toolu-unsafe',
        content: '{"updated":["item-1"]}',
      }),
      expect.objectContaining({
        type: 'tool_result',
        tool_use_id: 'toolu-open',
      }),
    ]);
    expect(mcp.close).toHaveBeenCalledOnce();
  });

  it('journals each unsafe call before Remote MCP dispatch and confirms its result', async () => {
    const beforeDispatch = vi.fn();
    const confirmed = vi.fn();
    const anthropic = new QueueAnthropicClient([
      message(
        'msg-journal',
        [
          toolUse(
            'toolu-journal',
            'upsert_and_execute_unsafe_script',
            unsafeScriptInput(),
          ),
        ],
        'tool_use',
      ),
      message('msg-journal-done', [textBlock('Updated.')]),
    ]);
    const mcp = mcpClientWith(async () => {
      expect(beforeDispatch).toHaveBeenCalledWith(['toolu-journal']);
      return { content: '{"ok":true}', isError: false };
    });
    const runtime = runtimeWith(anthropic, mcp.client);

    await drain(runtime.streamTurn({ message: 'Update it.' }));
    const result = await drain(
      runtime.continueApproval({
        responseId: 'msg-journal',
        approvalRequestId: 'toolu-journal',
        approve: true,
        unsafeDispatchCallbacks: { beforeDispatch, confirmed },
      }),
    );

    expect(result.result.status).toBe('completed');
    expect(beforeDispatch).toHaveBeenCalledOnce();
    expect(confirmed).toHaveBeenCalledOnce();
    expect(confirmed).toHaveBeenCalledWith(['toolu-journal']);
    expect(mcp.callTool).toHaveBeenCalledOnce();
  });

  it('does not call Remote MCP when durable journaling fails', async () => {
    const anthropic = new QueueAnthropicClient([
      message(
        'msg-journal-failure',
        [
          toolUse(
            'toolu-journal-failure',
            'upsert_and_execute_unsafe_script',
            unsafeScriptInput(),
          ),
        ],
        'tool_use',
      ),
    ]);
    const mcp = mcpClientWith();
    const runtime = runtimeWith(anthropic, mcp.client);

    await drain(runtime.streamTurn({ message: 'Update it.' }));
    const failed = await drain(
      runtime.continueApproval({
        responseId: 'msg-journal-failure',
        approvalRequestId: 'toolu-journal-failure',
        approve: true,
        unsafeDispatchCallbacks: {
          beforeDispatch() {
            throw new Error('Durable storage unavailable.');
          },
        },
      }),
    );

    expect(failed.result).toMatchObject({
      status: 'failed',
      error: { code: 'api_error' },
    });
    expect(mcp.callTool).not.toHaveBeenCalled();
  });

  it('requires an exact, unique decision set for grouped unsafe approvals', async () => {
    const anthropic = new QueueAnthropicClient([
      message(
        'msg-grouped-approvals',
        [
          toolUse(
            'toolu-group-a',
            'upsert_and_execute_unsafe_script',
            unsafeScriptInput('update-a.ts'),
          ),
          toolUse(
            'toolu-group-b',
            'upsert_and_execute_unsafe_script',
            unsafeScriptInput('update-b.ts'),
          ),
        ],
        'tool_use',
      ),
      message('msg-grouped-rejected', [textBlock('Nothing was changed.')]),
    ]);
    const mcp = mcpClientWith();
    const runtime = runtimeWith(anthropic, mcp.client);

    const pending = await drain(
      runtime.streamTurn({ message: 'Apply both changes.' }),
    );
    expect(
      pending.result.approvals.map((approval) => approval.approvalRequestId),
    ).toEqual(['toolu-group-a', 'toolu-group-b']);

    const missing = await drain(
      runtime.continueApprovals({
        responseId: 'msg-grouped-approvals',
        decisions: [
          {
            approvalRequestId: 'toolu-group-a',
            approve: false,
          },
        ],
      }),
    );
    expect(missing.result).toMatchObject({
      status: 'failed',
      error: { code: 'invalid_request' },
    });
    expect(mcp.callTool).not.toHaveBeenCalled();
    expect(mcp.close).not.toHaveBeenCalled();

    const duplicate = await drain(
      runtime.continueApprovals({
        responseId: 'msg-grouped-approvals',
        decisions: [
          {
            approvalRequestId: 'toolu-group-a',
            approve: false,
          },
          {
            approvalRequestId: 'toolu-group-a',
            approve: false,
          },
        ],
      }),
    );
    expect(duplicate.result).toMatchObject({
      status: 'failed',
      error: { code: 'invalid_request' },
    });
    expect(mcp.callTool).not.toHaveBeenCalled();

    const exact = await drain(
      runtime.continueApprovals({
        responseId: 'msg-grouped-approvals',
        decisions: [
          {
            approvalRequestId: 'toolu-group-a',
            approve: false,
          },
          {
            approvalRequestId: 'toolu-group-b',
            approve: false,
          },
        ],
      }),
    );
    expect(exact.result).toMatchObject({
      status: 'completed',
      responseId: 'msg-grouped-rejected',
    });
    expect(mcp.close).toHaveBeenCalledOnce();
    expect(
      lastMessageContent(anthropic.requests[1]).map(
        (block) => (block as { tool_use_id?: string }).tool_use_id,
      ),
    ).toEqual(['toolu-group-a', 'toolu-group-b']);

    const stale = await drain(
      runtime.continueApprovals({
        responseId: 'msg-grouped-approvals',
        decisions: [
          {
            approvalRequestId: 'toolu-group-a',
            approve: false,
          },
          {
            approvalRequestId: 'toolu-group-b',
            approve: false,
          },
        ],
      }),
    );
    expect(stale.result).toMatchObject({
      status: 'failed',
      error: { code: 'invalid_request' },
    });
    expect(mcp.callTool).not.toHaveBeenCalled();
  });

  it('turns an unsafe rejection into a tool result without calling DatoCMS', async () => {
    const anthropic = new QueueAnthropicClient([
      message(
        'msg-reject',
        [
          toolUse(
            'toolu-reject',
            'upsert_and_execute_unsafe_script',
            unsafeScriptInput(),
          ),
        ],
        'tool_use',
      ),
      message('msg-rejected', [textBlock('No action was taken.')]),
    ]);
    const mcp = mcpClientWith();
    const runtime = runtimeWith(anthropic, mcp.client);

    await drain(runtime.streamTurn({ message: 'Update the title.' }));
    const rejected = await drain(
      runtime.continueApproval({
        responseId: 'msg-reject',
        approvalRequestId: 'toolu-reject',
        approve: false,
        reason: 'Keep the current copy.',
      }),
    );

    expect(rejected.result).toMatchObject({
      status: 'completed',
      responseId: 'msg-rejected',
      text: 'No action was taken.',
    });
    expect(mcp.callTool).not.toHaveBeenCalled();
    expect(lastMessageContent(anthropic.requests[1])).toEqual([
      expect.objectContaining({
        type: 'tool_result',
        tool_use_id: 'toolu-reject',
        is_error: true,
        content: expect.stringContaining('Keep the current copy.'),
      }),
    ]);
  });

  it('continues after a definitive unsafe MCP error without claiming an unknown outcome', async () => {
    const anthropic = new QueueAnthropicClient([
      message(
        'msg-definitive-error',
        [
          toolUse(
            'toolu-definitive-error',
            'upsert_and_execute_unsafe_script',
            unsafeScriptInput(),
          ),
        ],
        'tool_use',
      ),
      message('msg-definitive-recovered', [
        textBlock('DatoCMS rejected the change, so nothing was updated.'),
      ]),
    ]);
    const mcp = mcpClientWith(async () => ({
      content: 'DatoCMS rejected the script before execution.',
      isError: true,
    }));
    const runtime = runtimeWith(anthropic, mcp.client);

    await drain(runtime.streamTurn({ message: 'Update the title.' }));
    const continued = await drain(
      runtime.continueApproval({
        responseId: 'msg-definitive-error',
        approvalRequestId: 'toolu-definitive-error',
        approve: true,
      }),
    );

    expect(continued.result).toMatchObject({
      status: 'completed',
      responseId: 'msg-definitive-recovered',
      text: 'DatoCMS rejected the change, so nothing was updated.',
    });
    expect(continued.result.error).toBeUndefined();
    expect(mcp.callTool).toHaveBeenCalledOnce();
    expect(lastMessageContent(anthropic.requests[1])).toEqual([
      expect.objectContaining({
        type: 'tool_result',
        tool_use_id: 'toolu-definitive-error',
        is_error: true,
        content: 'DatoCMS rejected the script before execution.',
      }),
    ]);
  });

  it('dispatches the exact reviewed unsafe arguments even if exposed result data is mutated', async () => {
    const reviewedInput = unsafeScriptInput();
    const expectedArguments = structuredClone(reviewedInput);
    const retainedToolUse = toolUse(
      'toolu-reviewed-arguments',
      'upsert_and_execute_unsafe_script',
      reviewedInput,
    );
    const anthropic = new QueueAnthropicClient([
      message('msg-reviewed-arguments', [retainedToolUse], 'tool_use'),
      message('msg-reviewed-done', [textBlock('The reviewed change ran.')]),
    ]);
    const mcp = mcpClientWith();
    const runtime = runtimeWith(anthropic, mcp.client);

    const pending = await drain(
      runtime.streamTurn({ message: 'Update the title.' }),
    );
    const exposedApproval = pending.result.approvals[0];
    if (!exposedApproval) {
      throw new Error('Expected an approval.');
    }
    exposedApproval.name = 'open_record';
    exposedApproval.serverLabel = 'another-server';
    retainedToolUse.name = 'whoami';
    exposedApproval.arguments = JSON.stringify({
      ...expectedArguments,
      body: {
        mode: 'full',
        content: 'await client.items.destroy("item-1");',
      },
    });
    const exposedArguments = exposedApproval.parsedArguments as Record<
      string,
      unknown
    >;
    exposedArguments.site_id = 'another-site';
    exposedArguments.environment = 'production';
    exposedArguments.body = {
      mode: 'full',
      content: 'await client.items.destroy("item-1");',
    };

    const approved = await drain(
      runtime.continueApproval({
        responseId: 'msg-reviewed-arguments',
        approvalRequestId: 'toolu-reviewed-arguments',
        approve: true,
      }),
    );

    expect(approved.result.status).toBe('completed');
    expect(mcp.callTool).toHaveBeenCalledWith(
      {
        name: 'upsert_and_execute_unsafe_script',
        arguments: expectedArguments,
      },
      undefined,
    );
  });

  it('reports an unknown unsafe outcome and never retries its dispatched call', async () => {
    const anthropic = new QueueAnthropicClient([
      message(
        'msg-uncertain',
        [
          toolUse(
            'toolu-uncertain',
            'upsert_and_execute_unsafe_script',
            unsafeScriptInput(),
          ),
        ],
        'tool_use',
      ),
    ]);
    const mcp = mcpClientWith(async () => {
      throw new Error('connection closed after dispatch');
    });
    const runtime = runtimeWith(anthropic, mcp.client);

    await drain(runtime.streamTurn({ message: 'Update the title.' }));
    const failed = await drain(
      runtime.continueApproval({
        responseId: 'msg-uncertain',
        approvalRequestId: 'toolu-uncertain',
        approve: true,
      }),
    );

    expect(failed.result).toMatchObject({
      status: 'failed',
      error: {
        code: 'unsafe_outcome_unknown',
        retryable: false,
      },
    });
    expect(mcp.callTool).toHaveBeenCalledOnce();
    expect(anthropic.requests).toHaveLength(1);
    expect(mcp.close).toHaveBeenCalledOnce();

    const retry = await drain(
      runtime.continueApproval({
        responseId: 'msg-uncertain',
        approvalRequestId: 'toolu-uncertain',
        approve: true,
      }),
    );
    expect(retry.result).toMatchObject({
      status: 'failed',
      error: {
        code: 'invalid_request',
        retryable: false,
      },
    });
    expect(mcp.callTool).toHaveBeenCalledOnce();
  });

  it('retains confirmed approvals when a later Claude continuation fails', async () => {
    const anthropic = new QueueAnthropicClient([
      message(
        'msg-confirmed-before-provider-error',
        [
          toolUse(
            'toolu-confirmed-before-provider-error',
            'upsert_and_execute_unsafe_script',
            unsafeScriptInput(),
          ),
        ],
        'tool_use',
      ),
      new TypeError('Failed to fetch'),
    ]);
    const mcp = mcpClientWith();
    const runtime = runtimeWith(anthropic, mcp.client);

    await drain(runtime.streamTurn({ message: 'Update the title.' }));
    const failed = await drain(
      runtime.continueApproval({
        responseId: 'msg-confirmed-before-provider-error',
        approvalRequestId: 'toolu-confirmed-before-provider-error',
        approve: true,
      }),
    );

    expect(failed.result).toMatchObject({
      status: 'failed',
      confirmedApprovalIds: ['toolu-confirmed-before-provider-error'],
      error: {
        code: 'api_error',
        retryable: true,
        message: expect.stringContaining('server-side provider proxy'),
      },
    });
    expect(failed.result.error?.code).not.toBe('unsafe_outcome_unknown');
    expect(mcp.callTool).toHaveBeenCalledOnce();
    expect(mcp.close).toHaveBeenCalledOnce();
  });

  it.each([
    ['max_tokens', 'output limit'],
    ['model_context_window_exceeded', 'context window'],
  ] satisfies Array<[StopReason, string]>)(
    'maps %s to a retryable incomplete turn',
    async (stopReason, messagePart) => {
      const anthropic = new QueueAnthropicClient([
        message('msg-incomplete', [textBlock('Partial answer.')], stopReason),
      ]);
      const mcp = mcpClientWith();
      const runtime = runtimeWith(anthropic, mcp.client);

      const { result } = await drain(
        runtime.streamTurn({ message: 'Describe this project.' }),
      );

      expect(result).toMatchObject({
        status: 'incomplete',
        responseId: 'msg-incomplete',
        text: 'Partial answer.',
        error: {
          code: 'incomplete',
          retryable: true,
          message: expect.stringContaining(messagePart),
        },
      });
      expect(mcp.close).toHaveBeenCalledOnce();
    },
  );

  it('surfaces an Anthropic refusal explanation as a non-retryable provider error', async () => {
    const refusedMessage: Message = {
      ...message('msg-refused', [], 'refusal'),
      stop_details: {
        type: 'refusal',
        category: 'general_harms',
        explanation: 'This request cannot be completed.',
      },
    };
    const anthropic = new QueueAnthropicClient([refusedMessage]);
    const mcp = mcpClientWith();
    const runtime = runtimeWith(anthropic, mcp.client);

    const { result } = await drain(
      runtime.streamTurn({ message: 'Complete this request.' }),
    );

    expect(result).toMatchObject({
      status: 'failed',
      responseId: 'msg-refused',
      error: {
        code: 'api_error',
        message: 'This request cannot be completed.',
        retryable: false,
      },
    });
    expect(mcp.close).toHaveBeenCalledOnce();
  });

  it('continues a pause_turn with the complete assistant blocks and no fabricated tool result', async () => {
    const pausedBlocks = [
      {
        data: 'opaque-paused-thinking',
        type: 'redacted_thinking' as const,
      },
      textBlock('Still checking. '),
    ];
    const anthropic = new QueueAnthropicClient([
      message('msg-paused', pausedBlocks, 'pause_turn'),
      message('msg-after-pause', [textBlock('Done.')]),
    ]);
    const mcp = mcpClientWith();
    const runtime = runtimeWith(anthropic, mcp.client);

    const { result } = await drain(
      runtime.streamTurn({ message: 'Describe this project.' }),
    );

    expect(result).toMatchObject({
      status: 'completed',
      responseId: 'msg-after-pause',
      text: 'Still checking. Done.',
      continuationCount: 1,
    });
    expect(anthropic.requests[1].messages.at(-1)).toEqual({
      role: 'assistant',
      content: pausedBlocks,
    });
    expect(JSON.stringify(anthropic.requests[1].messages)).not.toContain(
      'tool_result',
    );
    expect(mcp.close).toHaveBeenCalledOnce();
  });

  it('normalizes browser network and CORS failures into an actionable provider message', async () => {
    const anthropic = new QueueAnthropicClient([
      new TypeError('NetworkError when attempting to fetch resource.'),
    ]);
    const mcp = mcpClientWith();
    const runtime = runtimeWith(anthropic, mcp.client);

    const { result } = await drain(
      runtime.streamTurn({ message: 'Describe this project.' }),
    );

    expect(result).toMatchObject({
      status: 'failed',
      error: {
        code: 'api_error',
        retryable: true,
        message:
          'Anthropic could not be reached from this browser. ZDR organizations require a server-side provider proxy.',
      },
    });
    expect(mcp.close).toHaveBeenCalledOnce();
  });

  it.each([
    [
      401,
      'Invalid API key.',
      'api_error',
      false,
      'Anthropic rejected the configured API key. Update it in plugin settings.',
    ],
    [
      403,
      'The key cannot access this model.',
      'api_error',
      false,
      'Anthropic denied access. Check the API key and model access in plugin settings.',
    ],
    [
      400,
      'Invalid request body.',
      'invalid_request',
      false,
      'Anthropic rejected this request. Invalid request body.',
    ],
    [
      422,
      'The request could not be processed.',
      'invalid_request',
      false,
      'Anthropic rejected this request. The request could not be processed.',
    ],
    [
      408,
      'Request timed out.',
      'api_error',
      true,
      'Anthropic timed out. Try again.',
    ],
    [
      409,
      'Temporary conflict.',
      'api_error',
      true,
      'Anthropic reported a temporary conflict. Try again.',
    ],
    [
      429,
      'Rate limit reached.',
      'api_error',
      true,
      'Anthropic is temporarily rate limited. Try again shortly.',
    ],
    [
      529,
      'Overloaded.',
      'api_error',
      true,
      'Anthropic is temporarily unavailable. Try again shortly.',
    ],
  ] satisfies Array<[number, string, string, boolean, string]>)(
    'classifies Anthropic HTTP %i failures before offering a retry',
    async (status, message, code, retryable, expectedMessage) => {
      const anthropic = new QueueAnthropicClient([
        providerError(status, message),
      ]);
      const mcp = mcpClientWith();
      const runtime = runtimeWith(anthropic, mcp.client);

      const { result } = await drain(
        runtime.streamTurn({ message: 'Describe this project.' }),
      );

      expect(result).toMatchObject({
        status: 'failed',
        error: { code, retryable, message: expectedMessage },
      });
      expect(mcp.close).toHaveBeenCalledOnce();
    },
  );

  it.each([
    [
      providerError(
        undefined,
        'The API key was revoked.',
        'authentication_error',
      ),
      {
        code: 'api_error',
        retryable: false,
        message:
          'Anthropic rejected the configured API key. Update it in plugin settings.',
      },
    ],
    [
      providerError(undefined, 'Access denied.', 'permission_denied_error'),
      {
        code: 'api_error',
        retryable: false,
        message:
          'Anthropic denied access. Check the API key and model access in plugin settings.',
      },
    ],
    [
      providerError(undefined, 'Invalid request.', 'invalid_request_error'),
      {
        code: 'invalid_request',
        retryable: false,
        message: 'Anthropic rejected this request. Invalid request.',
      },
    ],
    [
      providerError(undefined, 'Overloaded.', 'overloaded_error'),
      {
        code: 'api_error',
        retryable: true,
        message: 'Anthropic is temporarily unavailable. Try again shortly.',
      },
    ],
  ])('classifies Anthropic provider codes', async (cause, expectedError) => {
    const anthropic = new QueueAnthropicClient([cause]);
    const mcp = mcpClientWith();
    const runtime = runtimeWith(anthropic, mcp.client);

    const { result } = await drain(
      runtime.streamTurn({ message: 'Describe this project.' }),
    );

    expect(result.error).toEqual(expectedError);
    expect(mcp.close).toHaveBeenCalledOnce();
  });

  it('keeps an interrupted Anthropic stream retryable with a concise message', async () => {
    const anthropic = new QueueAnthropicClient([
      new Error('The message stream ended unexpectedly.'),
    ]);
    const mcp = mcpClientWith();
    const runtime = runtimeWith(anthropic, mcp.client);

    const { result } = await drain(
      runtime.streamTurn({ message: 'Describe this project.' }),
    );

    expect(result).toMatchObject({
      status: 'failed',
      error: {
        code: 'incomplete',
        retryable: true,
        message: 'Anthropic response was interrupted. Try again.',
      },
    });
    expect(mcp.close).toHaveBeenCalledOnce();
  });

  it('does not mislabel an ordinary TypeError as a browser or ZDR connection problem', async () => {
    const anthropic = new QueueAnthropicClient([
      new TypeError('Cannot read properties of undefined'),
    ]);
    const mcp = mcpClientWith();
    const runtime = runtimeWith(anthropic, mcp.client);

    const { result } = await drain(
      runtime.streamTurn({ message: 'Describe this project.' }),
    );

    expect(result).toMatchObject({
      status: 'failed',
      error: {
        code: 'api_error',
        retryable: true,
        message: 'Cannot read properties of undefined',
      },
    });
    expect(result.error?.message).not.toContain('ZDR');
    expect(mcp.close).toHaveBeenCalledOnce();
  });

  it('stops before discovery when the turn is already aborted', async () => {
    const anthropic = new QueueAnthropicClient([]);
    const mcp = mcpClientWith();
    const runtime = runtimeWith(anthropic, mcp.client);
    const controller = new AbortController();
    controller.abort();

    const { result } = await drain(
      runtime.streamTurn({
        message: 'Describe this project.',
        signal: controller.signal,
      }),
    );

    expect(result).toMatchObject({
      status: 'aborted',
      error: {
        code: 'aborted',
        retryable: false,
      },
    });
    expect(mcp.listTools).not.toHaveBeenCalled();
    expect(anthropic.requests).toHaveLength(0);
    expect(mcp.close).toHaveBeenCalledOnce();
  });

  it('does not expose an approval when stopped on the final streamed text', async () => {
    const final = message(
      'msg-stop-race',
      [
        textBlock('The change is ready for review.'),
        toolUse(
          'toolu-stop-race',
          'upsert_and_execute_unsafe_script',
          unsafeScriptInput('stop-race.ts'),
        ),
      ],
      'tool_use',
    );
    const requests: MessageCreateParamsStreaming[] = [];
    const anthropic: AgentAnthropicMessagesClient = {
      stream(params) {
        requests.push(params);
        return new FakeAnthropicStream(eventsFor(final), final);
      },
    };
    const mcp = mcpClientWith();
    const runtime = runtimeWith(anthropic, mcp.client);
    const controller = new AbortController();
    const events: AgentRuntimeEvent[] = [];

    const result = await runtime.runTurn(
      {
        message: 'Update the title.',
        signal: controller.signal,
      },
      (event) => {
        events.push(event);
        if (event.type === 'text_delta') {
          controller.abort();
        }
      },
    );

    expect(result).toMatchObject({
      status: 'aborted',
      approvals: [],
      error: { code: 'aborted', retryable: false },
    });
    expect(events.some((event) => event.type === 'approval_required')).toBe(
      false,
    );
    expect(requests).toHaveLength(1);
    expect(mcp.callTool).not.toHaveBeenCalled();
    expect(mcp.close).toHaveBeenCalledOnce();
  });

  it('enforces the continuation limit across repeated safe tool calls', async () => {
    const anthropic = new QueueAnthropicClient([
      message(
        'msg-loop-1',
        [toolUse('toolu-loop-1', 'whoami', {})],
        'tool_use',
      ),
      message(
        'msg-loop-2',
        [toolUse('toolu-loop-2', 'whoami', {})],
        'tool_use',
      ),
    ]);
    const mcp = mcpClientWith();
    const runtime = runtimeWith(anthropic, mcp.client, {
      maxContinuations: 1,
    });

    const { result } = await drain(
      runtime.streamTurn({ message: 'Keep checking forever.' }),
    );

    expect(result).toMatchObject({
      status: 'failed',
      continuationCount: 1,
      error: {
        code: 'continuation_limit',
        retryable: true,
      },
    });
    expect(anthropic.requests).toHaveLength(1);
    expect(mcp.callTool).toHaveBeenCalledOnce();
    expect(mcp.close).toHaveBeenCalledOnce();
  });

  it('bounds aggregate tool-result content across a turn', async () => {
    const anthropic = new QueueAnthropicClient([
      message(
        'msg-result-budget',
        [
          toolUse('toolu-result-budget-a', 'whoami', {}),
          toolUse('toolu-result-budget-b', 'whoami', {}),
        ],
        'tool_use',
      ),
      message('msg-result-budget-done', [textBlock('Results summarized.')]),
    ]);
    const mcp = mcpClientWith(async () => ({
      content: 'x'.repeat(MAX_TOOL_RESULT_CHARACTERS_PER_TURN + 100),
      isError: false,
    }));
    const runtime = runtimeWith(anthropic, mcp.client);

    const { result } = await drain(
      runtime.streamTurn({ message: 'Read both results.' }),
    );

    expect(result.status).toBe('completed');
    const results = lastMessageContent(anthropic.requests[1]) as Array<{
      content: string;
    }>;
    expect(results[0]?.content).toContain('[tool result truncated]');
    expect(results[0]?.content.length).toBeLessThanOrEqual(
      MAX_TOOL_RESULT_CHARACTERS_PER_TURN,
    );
    expect(results[1]?.content).toBe('');
    expect(
      results.reduce((total, block) => total + block.content.length, 0),
    ).toBeLessThan(MAX_TOOL_RESULT_CHARACTERS_PER_TURN + 100);
  });

  it('enforces the aggregate MCP tool-call limit independently of continuations', async () => {
    const anthropic = new QueueAnthropicClient([
      message(
        'msg-tool-limit',
        Array.from({ length: 21 }, (_, index) =>
          toolUse(`toolu-limit-${index}`, 'whoami', {}),
        ),
        'tool_use',
      ),
    ]);
    const mcp = mcpClientWith();
    const runtime = runtimeWith(anthropic, mcp.client, {
      maxContinuations: 20,
    });

    const { result } = await drain(
      runtime.streamTurn({ message: 'Keep checking forever.' }),
    );

    expect(result).toMatchObject({
      status: 'failed',
      error: {
        code: 'continuation_limit',
        retryable: true,
      },
    });
    expect(mcp.callTool).not.toHaveBeenCalled();
    expect(mcp.close).toHaveBeenCalledOnce();
  });

  it('closes the browser MCP session once when disposed repeatedly', async () => {
    const anthropic = new QueueAnthropicClient([]);
    const mcp = mcpClientWith();
    const runtime = runtimeWith(anthropic, mcp.client);

    expect(runtime.dispose).toBeTypeOf('function');
    await runtime.dispose?.();
    await runtime.dispose?.();

    expect(mcp.close).toHaveBeenCalledOnce();
  });
});
