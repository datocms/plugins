import type {
  Response,
  ResponseCreateParamsStreaming,
  ResponseFunctionToolCall,
  ResponseInput,
  ResponseOutputItem,
  ResponseStreamEvent,
} from 'openai/resources/responses/responses';
import { describe, expect, it, vi } from 'vitest';
import {
  type AgentResponsesClient,
  type AgentRuntimeAttachment,
  type AgentRuntimeEvent,
  type AgentTurnResult,
  createAgentRuntime,
  DEFAULT_AGENT_MODEL,
  DEFAULT_MAX_CONTINUATIONS,
  DEFAULT_MAX_TOOL_CALLS,
  MAX_AGENT_ATTACHMENTS_PER_MESSAGE,
  MAX_CURRENT_FORM_STATE_FIELDS,
  MAX_DISTINCT_MODEL_SCHEMAS_PER_TURN,
  MAX_HOST_CONTEXT_CHARACTERS,
  MAX_MODEL_SCHEMA_OUTPUT_CHARACTERS,
  MAX_PRESENTED_ASSETS,
  MAX_PRESENTED_FIELDS,
  MAX_PRESENTED_MODELS,
  MAX_PRESENTED_USERS,
} from './agentRuntime';
import { REASONING_EFFORTS } from './config';
import { MAX_CONVERSATION_MESSAGE_CHARACTERS } from './conversations';

function response(
  id: string,
  output: ResponseOutputItem[] = [],
  status: Response['status'] = 'completed',
): Response {
  return {
    id,
    status,
    output,
    output_text: '',
    error: null,
    incomplete_details: null,
  } as unknown as Response;
}

function eventsFor(
  finalResponse: Response,
  textDeltas: string[] = [],
): ResponseStreamEvent[] {
  return [
    {
      type: 'response.created',
      response: response(finalResponse.id, [], 'in_progress'),
      sequence_number: 0,
    },
    ...textDeltas.map(
      (delta, index) =>
        ({
          type: 'response.output_text.delta',
          response_id: finalResponse.id,
          item_id: `message-${finalResponse.id}`,
          output_index: 0,
          content_index: 0,
          delta,
          logprobs: [],
          sequence_number: index + 1,
        }) as ResponseStreamEvent,
    ),
    {
      type: 'response.completed',
      response: finalResponse,
      sequence_number: textDeltas.length + 1,
    },
  ];
}

function toolEventsAfterReasoning(
  finalResponse: Response,
): ResponseStreamEvent[] {
  const item = finalResponse.output[0];
  if (!item) {
    throw new Error('A tool output item is required.');
  }

  return [
    {
      type: 'response.created',
      response: response(finalResponse.id, [], 'in_progress'),
      sequence_number: 0,
    },
    {
      type: 'response.reasoning_summary_text.delta',
      response_id: finalResponse.id,
      item_id: `reasoning-${finalResponse.id}`,
      output_index: 0,
      summary_index: 0,
      delta: 'Checking the model.',
      sequence_number: 1,
    } as unknown as ResponseStreamEvent,
    {
      type: 'response.output_item.added',
      output_index: 1,
      item,
      sequence_number: 2,
    },
    {
      type: 'response.completed',
      response: finalResponse,
      sequence_number: 3,
    },
  ];
}

function scriptApproval(
  variant: 'safe' | 'unsafe',
  id = `approval-${variant}`,
  overrides: Record<string, unknown> = {},
): ResponseOutputItem.McpApprovalRequest {
  return {
    type: 'mcp_approval_request',
    id,
    name: `upsert_and_execute_${variant}_script`,
    server_label: 'datocms',
    arguments: JSON.stringify({
      site_id: 'site-1',
      environment: 'sandbox-1',
      name: `script://dato-agent/site-1/sandbox-1/${variant}.ts`,
      body: {
        mode: 'full',
        content:
          variant === 'safe'
            ? 'console.log(await client.items.rawList());'
            : 'await client.items.update("item-1", { title: "Updated" });',
      },
      method_tokens: ['method-token'],
      ...overrides,
    }),
  };
}

function assistantMessage(
  content:
    | { type: 'output_text'; text: string; annotations: [] }
    | { type: 'refusal'; refusal: string },
): ResponseOutputItem {
  return {
    type: 'message',
    id: 'message-1',
    role: 'assistant',
    status: 'completed',
    content: [content],
  } as ResponseOutputItem;
}

function modelSchemaCall(
  args: { identifier: string; cursor: number | null } = {
    identifier: 'article',
    cursor: null,
  },
  id = 'schema-call-1',
): ResponseFunctionToolCall {
  return {
    type: 'function_call',
    id: `function-${id}`,
    call_id: id,
    name: 'get_model_schema',
    arguments: JSON.stringify(args),
    status: 'completed',
  };
}

function mcpFailureEvents(
  error: unknown,
  assistantText = 'I could not complete that DatoCMS operation.',
): ResponseStreamEvent[] {
  const responseId = 'resp_mcp_failure';
  const inProgressCall = {
    type: 'mcp_call',
    id: 'mcp-call-1',
    server_label: 'datocms',
    name: 'upsert_and_execute_safe_script',
    arguments: JSON.stringify({
      site_id: 'site-1',
      name: 'script://describe-project.ts',
    }),
    status: 'in_progress',
  } satisfies ResponseOutputItem.McpCall;
  const failedCall = {
    ...inProgressCall,
    status: 'failed',
    error,
    output: '{"diagnostic":"raw-mcp-output"}',
  } as unknown as ResponseOutputItem.McpCall;

  return [
    {
      type: 'response.created',
      response: response(responseId, [], 'in_progress'),
      sequence_number: 0,
    },
    {
      type: 'response.output_item.added',
      output_index: 0,
      item: inProgressCall,
      sequence_number: 1,
    },
    {
      type: 'response.mcp_call.failed',
      output_index: 0,
      item_id: failedCall.id,
      sequence_number: 2,
    },
    {
      type: 'response.output_item.done',
      output_index: 0,
      item: failedCall,
      sequence_number: 3,
    } as unknown as ResponseStreamEvent,
    {
      type: 'response.output_text.delta',
      response_id: responseId,
      item_id: `message-${responseId}`,
      output_index: 1,
      content_index: 0,
      delta: assistantText,
      logprobs: [],
      sequence_number: 4,
    } as ResponseStreamEvent,
    {
      type: 'response.completed',
      response: response(responseId, [failedCall]),
      sequence_number: 5,
    },
  ];
}

class QueueResponsesClient implements AgentResponsesClient {
  readonly requests: ResponseCreateParamsStreaming[] = [];
  readonly signals: Array<AbortSignal | undefined> = [];

  constructor(private readonly queuedEvents: ResponseStreamEvent[][]) {}

  async create(
    params: ResponseCreateParamsStreaming,
    options?: { signal?: AbortSignal },
  ): Promise<AsyncIterable<ResponseStreamEvent>> {
    this.requests.push(params);
    this.signals.push(options?.signal);
    const events = this.queuedEvents.shift();
    if (!events) {
      throw new Error('No fake response was queued.');
    }

    return (async function* stream() {
      for (const event of events) {
        yield event;
      }
    })();
  }
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
  code?: string,
): Error {
  return Object.assign(new Error(message), {
    ...(status === undefined ? {} : { status }),
    ...(code ? { code } : {}),
  });
}

function runtimeWith(
  client: AgentResponsesClient,
  overrides: Partial<Parameters<typeof createAgentRuntime>[0]> = {},
) {
  return createAgentRuntime({
    client,
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
    ...overrides,
  });
}

function attachment({
  id,
  filename,
  mimeType,
  content,
}: {
  id: string;
  filename: string;
  mimeType: string;
  content: string;
}): AgentRuntimeAttachment {
  const file = new Blob([content], { type: mimeType });
  return {
    id,
    filename,
    mimeType,
    size: file.size,
    lastModified: 1_700_000_000_000,
    file,
  };
}

describe('AgentRuntime', () => {
  it('rejects an oversized message before contacting OpenAI', async () => {
    const client = new QueueResponsesClient([]);
    const runtime = runtimeWith(client);
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
    expect(client.requests).toHaveLength(0);
  });

  it('sends current and retained browser files as bounded Responses input_file blocks', async () => {
    const client = new QueueResponsesClient([
      eventsFor(response('resp-files'), ['Read both files.']),
    ]);
    const runtime = runtimeWith(client);
    const historyAttachment = attachment({
      id: 'file-history',
      filename: 'notes.txt',
      mimeType: 'text/plain',
      content: 'Earlier notes',
    });
    const currentAttachment = attachment({
      id: 'file-current',
      filename: 'brief.pdf',
      mimeType: 'application/pdf',
      content: '%PDF-current brief',
    });

    const { result } = await drain(
      runtime.streamTurn({
        history: [
          {
            role: 'user',
            text: 'Keep these notes in mind.',
            attachments: [historyAttachment],
          },
          { role: 'assistant', text: 'I will.' },
        ],
        message: 'Use the attached brief too.',
        attachments: [currentAttachment],
      }),
    );

    expect(result.status).toBe('completed');
    const input = client.requests[0]?.input;
    expect(Array.isArray(input)).toBe(true);
    const messages = input as ResponseInput;
    expect(messages).toHaveLength(3);
    expect(messages[0]).toMatchObject({
      type: 'message',
      role: 'user',
      content: [
        { type: 'input_text', text: 'Keep these notes in mind.' },
        {
          type: 'input_file',
          filename: 'notes.txt',
          file_data: `data:text/plain;base64,${btoa('Earlier notes')}`,
        },
      ],
    });
    expect(messages[1]).toMatchObject({
      type: 'message',
      role: 'assistant',
      content: 'I will.',
    });
    expect(messages[2]).toMatchObject({
      type: 'message',
      role: 'user',
      content: [
        { type: 'input_text', text: 'Use the attached brief too.' },
        {
          type: 'input_file',
          filename: 'brief.pdf',
          file_data: `data:application/pdf;base64,${btoa('%PDF-current brief')}`,
        },
      ],
    });
  });

  it('sends common images as Responses input_image data URL blocks', async () => {
    const client = new QueueResponsesClient([
      eventsFor(response('resp-image'), ['I can see it.']),
    ]);
    const runtime = runtimeWith(client);
    const image = attachment({
      id: 'file-image',
      filename: 'diagram.png',
      mimeType: 'image/png',
      content: 'png-bytes',
    });

    const { result } = await drain(
      runtime.streamTurn({
        message: 'Describe this image.',
        attachments: [image],
      }),
    );

    expect(result.status).toBe('completed');
    expect(client.requests[0]?.input).toEqual([
      {
        type: 'message',
        role: 'user',
        content: [
          { type: 'input_text', text: 'Describe this image.' },
          {
            type: 'input_image',
            detail: 'auto',
            image_url: `data:image/png;base64,${btoa('png-bytes')}`,
          },
        ],
      },
    ]);
  });

  it('keeps an OpenAI-unsupported local file metadata-only for optional asset creation', async () => {
    const client = new QueueResponsesClient([
      eventsFor(response('resp-metadata-only'), [
        'I cannot read that file, but it remains attached.',
      ]),
    ]);
    const runtime = runtimeWith(client);
    const unsupported = attachment({
      id: 'file-binary',
      filename: 'archive.bin',
      mimeType: 'application/octet-stream',
      content: 'opaque',
    });

    const { result } = await drain(
      runtime.streamTurn({
        message: 'Read this file.',
        attachments: [unsupported],
      }),
    );

    expect(result.status).toBe('completed');
    const input = client.requests[0]?.input as ResponseInput;
    expect(input).toHaveLength(1);
    const content = input[0]?.type === 'message' ? input[0].content : undefined;
    expect(content).toEqual([
      {
        type: 'input_text',
        text: expect.stringContaining('HOST-PROVIDED LOCAL FILE AVAILABILITY'),
      },
    ]);
    expect(JSON.stringify(content)).toContain('file-binary');
    expect(JSON.stringify(content)).toContain('not_supplied_to_model');
    expect(JSON.stringify(content)).toContain('Do not claim to have read them');
    expect(JSON.stringify(content)).not.toContain('file_data');
  });

  it('bounds attachment count before reading browser bytes', async () => {
    const client = new QueueResponsesClient([]);
    const runtime = runtimeWith(client);
    const attachments = Array.from(
      { length: MAX_AGENT_ATTACHMENTS_PER_MESSAGE + 1 },
      (_, index) =>
        attachment({
          id: `file-${index}`,
          filename: `file-${index}.txt`,
          mimeType: 'text/plain',
          content: `${index}`,
        }),
    );

    const { result } = await drain(
      runtime.streamTurn({ message: 'Read these.', attachments }),
    );

    expect(result).toMatchObject({
      status: 'failed',
      error: {
        code: 'invalid_request',
        message: `A message cannot include more than ${MAX_AGENT_ATTACHMENTS_PER_MESSAGE} files.`,
      },
    });
    expect(client.requests).toHaveLength(0);
  });

  it('streams assistant text and sends the fixed MCP policy', async () => {
    const client = new QueueResponsesClient([
      eventsFor(response('resp_1'), ['Hello', ' editor']),
    ]);
    const runtime = runtimeWith(client, {
      reasoningEffort: 'high',
      fastMode: true,
      additionalInstructions: 'Prefer sentence case.',
    });
    const { events, result } = await drain(
      runtime.streamTurn({ message: 'Help me' }),
    );

    expect(result).toMatchObject({
      status: 'completed',
      responseId: 'resp_1',
      text: 'Hello editor',
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
    ).toEqual(['Hello', ' editor']);

    const request = client.requests[0];
    expect(request.model).toBe(DEFAULT_AGENT_MODEL);
    expect(request.service_tier).toBe('priority');
    expect(request.reasoning).toEqual({ effort: 'high', summary: 'auto' });
    expect(request.instructions).toContain('"siteId": "site-1"');
    expect(request.instructions).toContain(
      'Every MCP tool call that accepts environment must use exactly "sandbox-1"',
    );
    expect(request.instructions).toContain('Prefer sentence case.');
    expect(request.parallel_tool_calls).toBe(false);
    expect(
      (
        request as ResponseCreateParamsStreaming & {
          max_tool_calls?: number;
        }
      ).max_tool_calls,
    ).toBe(20);
    expect(request.store).toBe(true);
    expect(request.input).toBe('Help me');

    const mcpTool = request.tools?.find((tool) => tool.type === 'mcp');
    expect(mcpTool).toMatchObject({
      type: 'mcp',
      server_url: 'https://mcp.datocms.com/',
      authorization: 'mcp-token',
      require_approval: 'always',
    });
    expect(
      Array.isArray(mcpTool?.allowed_tools) ? mcpTool.allowed_tools : [],
    ).not.toContain('search_projects');
    expect(
      request.tools?.some(
        (tool) => tool.type === 'function' && tool.name === 'get_model_schema',
      ),
    ).toBe(false);
    expect(
      request.tools?.find(
        (tool) => tool.type === 'function' && tool.name === 'present_records',
      ),
    ).toMatchObject({
      type: 'function',
      name: 'present_records',
      strict: true,
      parameters: {
        type: 'object',
        additionalProperties: false,
        required: ['title', 'records'],
        properties: {
          records: {
            type: 'array',
            minItems: 1,
            maxItems: 100,
            items: {
              type: 'object',
              additionalProperties: false,
              required: ['item_id', 'item_type_id', 'label'],
            },
          },
        },
      },
    });
    expect(
      request.tools?.find(
        (tool) => tool.type === 'function' && tool.name === 'present_fields',
      ),
    ).toMatchObject({
      strict: true,
      parameters: {
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
        (tool) =>
          tool.type === 'function' &&
          tool.name === 'read_current_record_live_form_state',
      ),
    ).toMatchObject({
      strict: true,
      description: expect.stringMatching(
        /current record only[\s\S]*unsaved[\s\S]*not evidence[\s\S]*saved-state verification/i,
      ),
      parameters: {
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
      request.tools?.find(
        (tool) => tool.type === 'function' && tool.name === 'present_assets',
      ),
    ).toMatchObject({
      strict: true,
      parameters: {
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
      request.tools?.find(
        (tool) => tool.type === 'function' && tool.name === 'present_models',
      ),
    ).toBeUndefined();
    expect(
      request.tools?.find(
        (tool) => tool.type === 'function' && tool.name === 'present_users',
      ),
    ).toBeUndefined();
  });

  it('does not advertise current-record field tools when the host surface lacks those capabilities', async () => {
    const client = new QueueResponsesClient([
      eventsFor(response('resp-no-current-record'), ['Ready']),
    ]);
    const runtime = runtimeWith(client, {
      navigation: {
        openRecord: vi.fn(),
        showRecords: vi.fn(),
        presentRecords: vi.fn(),
        presentAssets: vi.fn(),
      },
    });

    await drain(runtime.streamTurn({ message: 'Help me' }));

    const toolNames = (client.requests[0]?.tools ?? []).flatMap((tool) =>
      tool.type === 'function' ? [tool.name] : [],
    );
    expect(toolNames).not.toContain('present_fields');
    expect(toolNames).not.toContain('read_current_record_live_form_state');
    expect(toolNames).toContain('present_assets');
  });

  it('injects host context once and keeps continuations on the stored response chain', async () => {
    const openCall = {
      type: 'function_call',
      id: 'function-open',
      call_id: 'call-open',
      name: 'open_record',
      arguments: JSON.stringify({
        item_id: 'item-1',
        item_type_id: 'article',
        field_path: null,
      }),
      status: 'completed',
    } satisfies ResponseFunctionToolCall;
    const client = new QueueResponsesClient([
      eventsFor(response('resp_context', [openCall])),
      eventsFor(response('resp_done'), ['Done']),
    ]);
    const runtime = runtimeWith(client, {
      hostContext: 'models:\n- article | Article',
    });

    await drain(
      runtime.streamTurn({
        message: 'Open the article',
        injectHostContext: true,
      }),
    );

    expect(client.requests[0]?.input).toEqual([
      expect.objectContaining({
        type: 'message',
        role: 'developer',
        content: expect.stringContaining('article | Article'),
      }),
      {
        type: 'message',
        role: 'user',
        content: 'Open the article',
      },
    ]);
    expect(client.requests[1]?.previous_response_id).toBe('resp_context');
    expect(client.requests[1]?.input).toEqual([
      expect.objectContaining({
        type: 'function_call_output',
        call_id: 'call-open',
      }),
    ]);
    expect(JSON.stringify(client.requests[1]?.input)).not.toContain(
      'HOST-PROVIDED CONTEXT SNAPSHOT',
    );
  });

  it('can inject host context once into an existing response chain', async () => {
    const client = new QueueResponsesClient([
      eventsFor(response('resp_migrated'), ['First']),
      eventsFor(response('resp_followup'), ['Second']),
    ]);
    const runtime = runtimeWith(client, {
      hostContext: 'models:\n- article | Article',
    });

    await drain(
      runtime.streamTurn({
        message: 'Continue the old chat',
        previousResponseId: 'resp_legacy',
        injectHostContext: true,
      }),
    );
    await drain(
      runtime.streamTurn({
        message: 'One more question',
        previousResponseId: 'resp_migrated',
      }),
    );

    expect(client.requests[0]?.previous_response_id).toBe('resp_legacy');
    expect(client.requests[0]?.input).toEqual([
      expect.objectContaining({ role: 'developer' }),
      expect.objectContaining({
        role: 'user',
        content: 'Continue the old chat',
      }),
    ]);
    expect(client.requests[1]?.previous_response_id).toBe('resp_migrated');
    expect(client.requests[1]?.input).toBe('One more question');
  });

  it('rejects an oversized host context before dispatching a request', () => {
    expect(() =>
      runtimeWith(new QueueResponsesClient([]), {
        hostContext: 'x'.repeat(MAX_HOST_CONTEXT_CHARACTERS + 1),
      }),
    ).toThrow(
      `hostContext must not exceed ${MAX_HOST_CONTEXT_CHARACTERS} characters`,
    );
  });

  it.each(REASONING_EFFORTS)(
    'maps OpenAI %s reasoning to the provider request',
    async (reasoningEffort) => {
      const client = new QueueResponsesClient([
        eventsFor(response(`resp_${reasoningEffort}`), ['Done']),
      ]);
      const runtime = runtimeWith(client, { reasoningEffort });

      await drain(runtime.streamTurn({ message: 'Check this' }));

      expect(client.requests[0]?.reasoning).toEqual(
        reasoningEffort === 'none'
          ? { effort: 'none' }
          : { effort: reasoningEffort, summary: 'auto' },
      );
    },
  );

  it('executes both local navigation tools and continues with their outputs', async () => {
    const openCall = {
      type: 'function_call',
      id: 'function-1',
      call_id: 'call-1',
      name: 'open_record',
      arguments: JSON.stringify({
        item_id: 'item-1',
        item_type_id: 'article',
        field_path: 'title',
      }),
      status: 'completed',
    } satisfies ResponseFunctionToolCall;
    const showCall = {
      type: 'function_call',
      id: 'function-2',
      call_id: 'call-2',
      name: 'show_records',
      arguments: JSON.stringify({
        title: 'Related articles',
        records: [
          {
            item_id: 'item-1',
            item_type_id: 'article',
            label: 'First article',
          },
          {
            item_id: 'item-2',
            item_type_id: 'article',
            label: 'Second article',
          },
          {
            item_id: 'item-2',
            item_type_id: 'article',
            label: 'Duplicate',
          },
        ],
      }),
      status: 'completed',
    } satisfies ResponseFunctionToolCall;
    const client = new QueueResponsesClient([
      eventsFor(response('resp_1', [openCall])),
      eventsFor(response('resp_2', [showCall])),
      eventsFor(response('resp_3'), ['Done']),
    ]);
    const openRecord = vi.fn().mockResolvedValue(undefined);
    const showRecords = vi.fn().mockResolvedValue(undefined);
    const runtime = runtimeWith(client, {
      navigation: {
        openRecord,
        showRecords,
        presentRecords: vi.fn(),
        presentFields: vi.fn(),
        readCurrentRecordLiveFormState: vi.fn(),
        presentAssets: vi.fn(),
      },
    });
    const { events, result } = await drain(
      runtime.streamTurn({ message: 'Show me the related articles' }),
    );

    expect(openRecord).toHaveBeenCalledWith({
      itemId: 'item-1',
      itemTypeId: 'article',
      fieldPath: 'title',
    });
    expect(showRecords).toHaveBeenCalledWith({
      title: 'Related articles',
      records: [
        {
          itemId: 'item-1',
          itemTypeId: 'article',
          label: 'First article',
        },
        {
          itemId: 'item-2',
          itemTypeId: 'article',
          label: 'Second article',
        },
      ],
    });
    expect(client.requests).toHaveLength(3);
    expect(client.requests[1].previous_response_id).toBe('resp_1');
    expect(client.requests[2].previous_response_id).toBe('resp_2');
    expect(client.requests[1].input).toEqual([
      expect.objectContaining({
        type: 'function_call_output',
        call_id: 'call-1',
      }),
    ]);
    expect(client.requests[2].input).toEqual([
      expect.objectContaining({
        type: 'function_call_output',
        call_id: 'call-2',
      }),
    ]);
    expect(result).toMatchObject({
      status: 'completed',
      responseId: 'resp_3',
      text: 'Done',
      continuationCount: 2,
    });
    const completedNavigation = events.find(
      (event) =>
        event.type === 'activity' &&
        event.activity.kind === 'navigation' &&
        event.activity.status === 'completed' &&
        event.activity.label === 'Record ready',
    );
    expect(completedNavigation).toMatchObject({
      type: 'activity',
      activity: {
        output: expect.stringContaining('"itemId":"item-1"'),
      },
    });
    expect(
      events.some(
        (event) =>
          event.type === 'activity' && event.activity.label === 'Record opened',
      ),
    ).toBe(false);
  });

  it('advertises and executes the explicit host asset-creation tool when available', async () => {
    const createCall = {
      type: 'function_call',
      id: 'function-create-asset',
      call_id: 'call-create-asset',
      name: 'create_dato_asset',
      arguments: JSON.stringify({
        source: 'attached_file',
        attachment_id: 'local-file-123',
        url: null,
        filename: null,
      }),
      status: 'completed',
    } satisfies ResponseFunctionToolCall;
    const client = new QueueResponsesClient([
      eventsFor(response('resp-create-asset', [createCall])),
      eventsFor(response('resp-create-asset-done'), ['Asset created.']),
    ]);
    const createDatoAsset = vi.fn().mockResolvedValue({
      uploadId: 'upload-123',
      filename: 'brief.pdf',
      url: 'https://cdn.example/upload-123',
      mimeType: 'application/pdf',
    });
    const runtime = runtimeWith(client, { createDatoAsset });

    const { events, result } = await drain(
      runtime.streamTurn({
        message: 'Upload the attached brief as a DatoCMS asset.',
        attachments: [
          attachment({
            id: 'local-file-123',
            filename: 'brief.bin',
            mimeType: 'application/octet-stream',
            content: 'opaque-asset-bytes',
          }),
        ],
      }),
    );

    expect(
      client.requests[0]?.tools?.find(
        (tool) => tool.type === 'function' && tool.name === 'create_dato_asset',
      ),
    ).toMatchObject({
      type: 'function',
      name: 'create_dato_asset',
      strict: true,
      description: expect.stringContaining(
        'Merely attaching or referencing a file is never permission',
      ),
    });
    expect(JSON.stringify(client.requests[0]?.input)).toContain(
      'not_supplied_to_model',
    );
    expect(JSON.stringify(client.requests[0]?.input)).not.toContain(
      'opaque-asset-bytes',
    );
    expect(createDatoAsset).toHaveBeenCalledWith(
      {
        source: 'attached_file',
        attachmentId: 'local-file-123',
      },
      undefined,
    );
    expect(client.requests[1]?.input).toEqual([
      expect.objectContaining({
        type: 'function_call_output',
        call_id: 'call-create-asset',
        output: JSON.stringify({
          ok: true,
          uploadId: 'upload-123',
          filename: 'brief.pdf',
          url: 'https://cdn.example/upload-123',
          mimeType: 'application/pdf',
        }),
      }),
    ]);
    expect(events).toContainEqual({
      type: 'activity',
      responseId: 'resp-create-asset',
      activity: expect.objectContaining({
        id: 'call-create-asset',
        kind: 'asset',
        status: 'completed',
        label: 'Asset created',
        toolName: 'create_dato_asset',
      }),
    });
    expect(result).toMatchObject({
      status: 'completed',
      responseId: 'resp-create-asset-done',
      text: 'Asset created.',
    });
  });

  it('presents verified records in chat without invoking either navigation callback', async () => {
    const presentCall = {
      type: 'function_call',
      id: 'function-present',
      call_id: 'call-present',
      name: 'present_records',
      arguments: JSON.stringify({
        title: 'Web development',
        records: [
          {
            item_id: 'item-1',
            item_type_id: 'article',
            label: 'Building for the web',
          },
          {
            item_id: 'item-1',
            item_type_id: 'article',
            label: 'Duplicate result',
          },
          {
            item_id: 'item-2',
            item_type_id: null,
            label: null,
          },
        ],
      }),
      status: 'completed',
    } satisfies ResponseFunctionToolCall;
    const client = new QueueResponsesClient([
      eventsFor(response('resp_present', [presentCall])),
      eventsFor(response('resp_present_done'), ['I found two records.']),
    ]);
    const openRecord = vi.fn();
    const showRecords = vi.fn();
    const presentRecords = vi.fn().mockResolvedValue({
      presented: true,
    });
    const runtime = runtimeWith(client, {
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
    expect(client.requests[1]?.input).toEqual([
      expect.objectContaining({
        type: 'function_call_output',
        call_id: 'call-present',
        output: JSON.stringify({ ok: true, presented: true }),
      }),
    ]);
    expect(result).toMatchObject({
      status: 'completed',
      responseId: 'resp_present_done',
      text: 'I found two records.',
    });
    expect(events).toContainEqual({
      type: 'activity',
      responseId: 'resp_present',
      activity: expect.objectContaining({
        id: 'call-present',
        kind: 'navigation',
        status: 'completed',
        label: 'Record links ready',
        toolName: 'present_records',
        output: JSON.stringify({ ok: true, presented: true }),
      }),
    });
  });

  it('executes field links, live current-form reads, and asset links through strict host callbacks', async () => {
    const presentFieldsCall = {
      type: 'function_call',
      id: 'function-fields',
      call_id: 'call-fields',
      name: 'present_fields',
      arguments: JSON.stringify({
        title: 'Fields to review',
        fields: [
          { field_path: 'seo_title', label: 'SEO title', locale: 'en' },
          { field_path: 'seo_title', label: 'Duplicate', locale: 'en' },
          { field_path: 'seo_title', label: 'Titolo SEO', locale: 'it' },
          { field_path: 'body', label: null, locale: null },
        ],
      }),
      status: 'completed',
    } satisfies ResponseFunctionToolCall;
    const readFormCall = {
      type: 'function_call',
      id: 'function-form',
      call_id: 'call-form',
      name: 'read_current_record_live_form_state',
      arguments: JSON.stringify({
        fields: [
          { field_api_key: 'seo_title', locale: 'en' },
          { field_api_key: 'seo_title', locale: 'en' },
          { field_api_key: 'body', locale: null },
        ],
      }),
      status: 'completed',
    } satisfies ResponseFunctionToolCall;
    const presentAssetsCall = {
      type: 'function_call',
      id: 'function-assets',
      call_id: 'call-assets',
      name: 'present_assets',
      arguments: JSON.stringify({
        title: 'Referenced assets',
        assets: [
          { upload_id: 'upload-1', label: 'Hero image' },
          { upload_id: 'upload-1', label: 'Duplicate' },
          { upload_id: 'upload-2', label: null },
        ],
      }),
      status: 'completed',
    } satisfies ResponseFunctionToolCall;
    const client = new QueueResponsesClient([
      eventsFor(
        response('resp-local-presentation', [
          presentFieldsCall,
          readFormCall,
          presentAssetsCall,
        ]),
      ),
      eventsFor(response('resp-local-presentation-done'), ['Ready.']),
    ]);
    const presentFields = vi.fn().mockResolvedValue({ presented: true });
    const readCurrentRecordLiveFormState = vi.fn().mockResolvedValue({
      values: [
        { fieldApiKey: 'seo_title', locale: 'en', value: 'Unsaved title' },
        { fieldApiKey: 'body', value: 'Current body' },
      ],
    });
    const presentAssets = vi.fn().mockResolvedValue({ presented: true });
    const runtime = runtimeWith(client, {
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

    const continuationInput = client.requests[1]?.input;
    expect(Array.isArray(continuationInput)).toBe(true);
    const formOutput = (continuationInput as ResponseInput).find(
      (item) =>
        item.type === 'function_call_output' && item.call_id === 'call-form',
    );
    expect(formOutput).toMatchObject({
      type: 'function_call_output',
      call_id: 'call-form',
      output: expect.stringContaining(
        '"source":"live_browser_form_for_current_record"',
      ),
    });
    if (
      formOutput?.type !== 'function_call_output' ||
      typeof formOutput.output !== 'string'
    ) {
      throw new Error('Expected a string current-form tool output.');
    }
    expect(JSON.parse(formOutput.output)).toMatchObject({
      source: 'live_browser_form_for_current_record',
      valuesMayBeUnsaved: true,
      savedDatoCmsStateVerified: false,
    });
    expect(result).toMatchObject({
      status: 'completed',
      responseId: 'resp-local-presentation-done',
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

  it('executes model and user links through strict host callbacks', async () => {
    const presentModelsCall = {
      type: 'function_call',
      id: 'function-models',
      call_id: 'call-models',
      name: 'present_models',
      arguments: JSON.stringify({
        title: 'Relevant models',
        models: [
          { model_id: 'model-1', label: 'Article' },
          { model_id: 'model-1', label: 'Duplicate' },
          { model_id: 'block-1', label: null },
        ],
      }),
      status: 'completed',
    } satisfies ResponseFunctionToolCall;
    const presentUsersCall = {
      type: 'function_call',
      id: 'function-users',
      call_id: 'call-users',
      name: 'present_users',
      arguments: JSON.stringify({
        title: 'Editors',
        users: [
          { user_id: 'user-1', label: 'Ada' },
          { user_id: 'user-1', label: 'Duplicate' },
          { user_id: 'sso-1', label: null },
        ],
      }),
      status: 'completed',
    } satisfies ResponseFunctionToolCall;
    const client = new QueueResponsesClient([
      eventsFor(
        response('resp-model-user-presentation', [
          presentModelsCall,
          presentUsersCall,
        ]),
      ),
      eventsFor(response('resp-model-user-presentation-done'), ['Ready.']),
    ]);
    const presentModels = vi.fn().mockResolvedValue({ presented: true });
    const presentUsers = vi.fn().mockResolvedValue({ presented: true });
    const runtime = runtimeWith(client, {
      navigation: {
        openRecord: vi.fn(),
        showRecords: vi.fn(),
        presentRecords: vi.fn(),
        presentFields: vi.fn(),
        readCurrentRecordLiveFormState: vi.fn(),
        presentAssets: vi.fn(),
        presentModels,
        presentUsers,
      },
    });

    const { events, result } = await drain(
      runtime.streamTurn({ message: 'Show the relevant models and editors.' }),
    );

    expect(presentModels).toHaveBeenCalledWith({
      title: 'Relevant models',
      models: [
        { modelId: 'model-1', label: 'Article' },
        { modelId: 'block-1' },
      ],
    });
    expect(presentUsers).toHaveBeenCalledWith({
      title: 'Editors',
      users: [{ userId: 'user-1', label: 'Ada' }, { userId: 'sso-1' }],
    });
    expect(result).toMatchObject({ status: 'completed', text: 'Ready.' });
    expect(
      events
        .filter(
          (event): event is Extract<AgentRuntimeEvent, { type: 'activity' }> =>
            event.type === 'activity',
        )
        .map((event) => event.activity.label),
    ).toEqual(
      expect.arrayContaining([
        'Adding model references',
        'Model references ready',
        'Adding user references',
        'User references ready',
      ]),
    );

    const firstRequestTools = client.requests[0]?.tools ?? [];
    expect(firstRequestTools).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          type: 'function',
          name: 'present_models',
          parameters: expect.objectContaining({
            properties: expect.objectContaining({
              models: expect.objectContaining({
                maxItems: MAX_PRESENTED_MODELS,
              }),
            }),
          }),
        }),
        expect.objectContaining({
          type: 'function',
          name: 'present_users',
          parameters: expect.objectContaining({
            properties: expect.objectContaining({
              users: expect.objectContaining({ maxItems: MAX_PRESENTED_USERS }),
            }),
          }),
        }),
      ]),
    );
  });

  it('rejects malformed field, live-form, and asset inputs before host callbacks run', async () => {
    const malformedCalls = [
      {
        type: 'function_call',
        id: 'function-fields-invalid',
        call_id: 'call-fields-invalid',
        name: 'present_fields',
        arguments: JSON.stringify({
          title: 'Fields',
          fields: [{ field_path: 'title', locale: null }],
        }),
        status: 'completed',
      },
      {
        type: 'function_call',
        id: 'function-form-invalid',
        call_id: 'call-form-invalid',
        name: 'read_current_record_live_form_state',
        arguments: JSON.stringify({
          fields: [{ field_api_key: 'seo.title', locale: null }],
        }),
        status: 'completed',
      },
      {
        type: 'function_call',
        id: 'function-assets-invalid',
        call_id: 'call-assets-invalid',
        name: 'present_assets',
        arguments: JSON.stringify({
          title: 'Assets',
          assets: [
            {
              upload_id: 'upload-1',
              label: 'Hero',
              url: 'https://example.test/not-accepted',
            },
          ],
        }),
        status: 'completed',
      },
    ] satisfies ResponseFunctionToolCall[];
    const client = new QueueResponsesClient([
      eventsFor(response('resp-invalid-local', malformedCalls)),
      eventsFor(response('resp-invalid-local-done'), ['I need valid inputs.']),
    ]);
    const presentFields = vi.fn();
    const readCurrentRecordLiveFormState = vi.fn();
    const presentAssets = vi.fn();
    const runtime = runtimeWith(client, {
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
    expect(result.status).toBe('completed');
    expect(
      events
        .filter(
          (event): event is Extract<AgentRuntimeEvent, { type: 'activity' }> =>
            event.type === 'activity' && event.activity.status === 'failed',
        )
        .map((event) => ({
          label: event.activity.label,
          error: event.activity.error,
        })),
    ).toEqual([
      {
        label: 'Could not add field links',
        error: 'Each fields entry is missing required key: label.',
      },
      {
        label: 'Could not read current form values',
        error:
          'field_api_key must be one exact top-level field API key, not a nested field path.',
      },
      {
        label: 'Could not add asset links',
        error: 'Each assets entry contains an unsupported key: url.',
      },
    ]);
  });

  it('advertises and executes the optional host-bound model schema tool', async () => {
    const schemaCall = modelSchemaCall();
    const client = new QueueResponsesClient([
      eventsFor(response('resp_schema', [schemaCall])),
      eventsFor(response('resp_schema_done'), ['Schema loaded']),
    ]);
    const getModelSchema = vi.fn().mockResolvedValue({
      model: { id: 'model-1', apiKey: 'article', name: 'Article' },
      fields: [
        {
          apiKey: 'title',
          label: 'Title',
          type: 'string',
          localized: false,
        },
      ],
      nextCursor: null,
      authorization: 'Bearer private-token',
      token: 'private-token',
      diagnostic: 'sk-this-value-must-be-redacted',
    });
    const runtime = runtimeWith(client, { getModelSchema });
    const { events, result } = await drain(
      runtime.streamTurn({ message: 'Inspect the Article model' }),
    );

    const tool = client.requests[0]?.tools?.find(
      (candidate) =>
        candidate.type === 'function' && candidate.name === 'get_model_schema',
    );
    expect(tool).toMatchObject({
      type: 'function',
      name: 'get_model_schema',
      description: expect.stringContaining(
        'never once per model to begin a project-wide text search',
      ),
      strict: true,
      parameters: expect.objectContaining({
        additionalProperties: false,
        required: ['identifier', 'cursor'],
      }),
    });
    expect(getModelSchema).toHaveBeenCalledWith(
      { identifier: 'article' },
      undefined,
    );
    expect(client.requests[1]?.previous_response_id).toBe('resp_schema');
    const continuationInput = client.requests[1]?.input as Array<{
      type: string;
      call_id: string;
      output: string;
    }>;
    const output = JSON.parse(continuationInput[0]?.output ?? '{}');
    expect(output).toMatchObject({
      ok: true,
      schema: {
        model: { apiKey: 'article' },
        authorization: '[redacted]',
        token: '[redacted]',
        diagnostic: '[redacted]',
      },
    });
    expect(result.status).toBe('completed');
    expect(
      events.some(
        (event) =>
          event.type === 'activity' &&
          event.activity.kind === 'schema' &&
          event.activity.status === 'completed' &&
          event.activity.label === 'Model fields loaded',
      ),
    ).toBe(true);
  });

  it('bounds distinct model schema enumeration and directs the model back to global search', async () => {
    const modelCount = MAX_DISTINCT_MODEL_SCHEMAS_PER_TURN + 1;
    const schemaResponses = Array.from({ length: modelCount }, (_, index) => {
      const number = index + 1;
      return toolEventsAfterReasoning(
        response(`resp_schema_${number}`, [
          modelSchemaCall(
            { identifier: `model_${number}`, cursor: null },
            `schema-call-${number}`,
          ),
        ]),
      );
    });
    const client = new QueueResponsesClient([
      ...schemaResponses,
      eventsFor(response('resp_search_done'), ['Found the matching record.']),
    ]);
    const getModelSchema = vi.fn().mockImplementation(({ identifier }) => ({
      schema: `model=${identifier}`,
    }));
    const runtime = runtimeWith(client, { getModelSchema });
    const { events, result } = await drain(
      runtime.streamTurn({
        message: 'Show me the record that talks about web development',
      }),
    );

    expect(DEFAULT_MAX_CONTINUATIONS).toBeGreaterThan(modelCount);
    expect(client.requests).toHaveLength(modelCount + 1);
    expect(getModelSchema).toHaveBeenCalledTimes(
      MAX_DISTINCT_MODEL_SCHEMAS_PER_TURN,
    );
    const blockedContinuation = client.requests.at(-1)?.input as
      | Array<{ output: string }>
      | undefined;
    const blockedOutput = JSON.parse(blockedContinuation?.[0]?.output ?? '{}');
    expect(blockedOutput).toEqual({
      ok: false,
      error: expect.stringContaining(
        'run one items.rawList search with filter.query',
      ),
    });
    expect(result).toMatchObject({
      status: 'completed',
      responseId: 'resp_search_done',
      text: 'Found the matching record.',
      continuationCount: modelCount,
    });
    expect(
      events.some(
        (event) =>
          event.type === 'activity' && event.activity.kind === 'continuation',
      ),
    ).toBe(false);

    const latestThinkingStatuses = new Map<string, string>();
    for (const event of events) {
      if (event.type === 'activity' && event.activity.kind === 'thinking') {
        latestThinkingStatuses.set(event.activity.id, event.activity.status);
      }
    }
    expect([...latestThinkingStatuses.values()]).toHaveLength(modelCount);
    expect([...latestThinkingStatuses.values()]).toEqual(
      Array(modelCount).fill('completed'),
    );
  });

  it('allows repeated schema pages for the same model', async () => {
    const pageCount = MAX_DISTINCT_MODEL_SCHEMAS_PER_TURN + 1;
    const client = new QueueResponsesClient([
      ...Array.from({ length: pageCount }, (_, index) =>
        eventsFor(
          response(`resp_schema_page_${index}`, [
            modelSchemaCall(
              { identifier: 'article', cursor: index * 10 },
              `schema-page-${index}`,
            ),
          ]),
        ),
      ),
      eventsFor(response('resp_schema_pages_done'), ['Schema pages loaded.']),
    ]);
    const getModelSchema = vi.fn().mockResolvedValue({ fields: [] });
    const runtime = runtimeWith(client, { getModelSchema });

    const { result } = await drain(
      runtime.streamTurn({ message: 'Inspect every Article field' }),
    );

    expect(getModelSchema).toHaveBeenCalledTimes(pageCount);
    expect(result).toMatchObject({
      status: 'completed',
      text: 'Schema pages loaded.',
      continuationCount: pageCount,
    });
  });

  it('bounds oversized model schema output and continues with a safe tool error', async () => {
    const client = new QueueResponsesClient([
      eventsFor(response('resp_large_schema', [modelSchemaCall()])),
      eventsFor(response('resp_after_large_schema'), ['Ask for another page']),
    ]);
    const getModelSchema = vi.fn().mockResolvedValue({
      fields: ['x'.repeat(MAX_MODEL_SCHEMA_OUTPUT_CHARACTERS)],
    });
    const runtime = runtimeWith(client, { getModelSchema });
    const { events, result } = await drain(
      runtime.streamTurn({ message: 'Read the large model' }),
    );

    const continuationInput = client.requests[1]?.input as Array<{
      output: string;
    }>;
    const output = JSON.parse(continuationInput[0]?.output ?? '{}');
    expect(output).toEqual({
      ok: false,
      error: expect.stringContaining('provide a cursor'),
    });
    expect(continuationInput[0]?.output.length).toBeLessThan(
      MAX_MODEL_SCHEMA_OUTPUT_CHARACTERS,
    );
    expect(result.status).toBe('completed');
    expect(
      events.some(
        (event) =>
          event.type === 'activity' &&
          event.activity.kind === 'schema' &&
          event.activity.status === 'failed' &&
          event.activity.label === 'Could not read model fields',
      ),
    ).toBe(true);
  });

  it('surfaces MCP approval and continues it against the prior response', async () => {
    const approval = {
      type: 'mcp_approval_request',
      id: 'approval-1',
      name: 'upsert_and_execute_unsafe_script',
      server_label: 'datocms',
      arguments: JSON.stringify({
        site_id: 'site-1',
        environment: 'sandbox-1',
        name: 'script://dato-agent/site-1/sandbox-1/update.ts',
        body: {
          mode: 'full',
          content: 'await client.items.update("item-1", { title: "Updated" });',
        },
        method_tokens: ['method-token'],
      }),
    } satisfies ResponseOutputItem.McpApprovalRequest;
    const client = new QueueResponsesClient([
      eventsFor(response('resp_approval', [approval])),
      eventsFor(response('resp_done'), ['Updated']),
    ]);
    const runtime = runtimeWith(client, {
      hostContext: 'currentModel: article',
    });
    const first = await drain(
      runtime.streamTurn({
        message: 'Update it',
        injectHostContext: true,
      }),
    );

    expect(first.result.status).toBe('approval_required');
    expect(first.result.approvals).toEqual([
      {
        approvalRequestId: 'approval-1',
        name: 'upsert_and_execute_unsafe_script',
        serverLabel: 'datocms',
        arguments: approval.arguments,
        parsedArguments: {
          site_id: 'site-1',
          environment: 'sandbox-1',
          name: 'script://dato-agent/site-1/sandbox-1/update.ts',
          body: {
            mode: 'full',
            content:
              'await client.items.update("item-1", { title: "Updated" });',
          },
          method_tokens: ['method-token'],
        },
      },
    ]);
    expect(
      first.events.some((event) => event.type === 'approval_required'),
    ).toBe(true);

    const second = await drain(
      runtime.continueApproval({
        responseId: 'resp_approval',
        approvalRequestId: 'approval-1',
        approve: false,
        reason: 'Keep the current copy.',
      }),
    );
    expect(second.result).toMatchObject({
      status: 'completed',
      responseId: 'resp_done',
      text: 'Updated',
    });
    expect(client.requests[0].input).toEqual([
      expect.objectContaining({ role: 'developer' }),
      expect.objectContaining({ role: 'user', content: 'Update it' }),
    ]);
    expect(client.requests[1].previous_response_id).toBe('resp_approval');
    expect(client.requests[1].input).toEqual([
      {
        type: 'mcp_approval_response',
        approval_request_id: 'approval-1',
        approve: false,
        reason: 'Keep the current copy.',
      },
    ]);
    expect(client.requests[1].instructions).toContain('"siteId": "site-1"');
  });

  it('journals an approved continuation before transport and confirms it after completion', async () => {
    const approval = scriptApproval('unsafe', 'approval-journal');
    const client = new QueueResponsesClient([
      eventsFor(response('resp_journal', [approval])),
      eventsFor(response('resp_journal_done'), ['Updated']),
    ]);
    const runtime = runtimeWith(client);
    const beforeDispatch = vi.fn();
    const confirmed = vi.fn();

    await drain(runtime.streamTurn({ message: 'Update it' }));
    const result = await drain(
      runtime.continueApproval({
        responseId: 'resp_journal',
        approvalRequestId: approval.id,
        approve: true,
        unsafeDispatchCallbacks: { beforeDispatch, confirmed },
      }),
    );

    expect(result.result.status).toBe('completed');
    expect(beforeDispatch).toHaveBeenCalledOnce();
    expect(beforeDispatch).toHaveBeenCalledWith([approval.id]);
    expect(confirmed).toHaveBeenCalledOnce();
    expect(confirmed).toHaveBeenCalledWith([approval.id]);
    expect(client.requests).toHaveLength(2);
  });

  it('confirms an approved write before exposing the next sequential approval', async () => {
    const firstApproval = scriptApproval('unsafe', 'approval-sequential-1');
    const secondApproval = scriptApproval('unsafe', 'approval-sequential-2');
    const client = new QueueResponsesClient([
      eventsFor(response('resp_sequential_1', [firstApproval])),
      eventsFor(response('resp_sequential_2', [secondApproval])),
      eventsFor(response('resp_sequential_done'), ['Both changes completed']),
    ]);
    const runtime = runtimeWith(client);
    const firstBeforeDispatch = vi.fn();
    const settlementOrder: string[] = [];
    const firstConfirmed = vi.fn(() => {
      settlementOrder.push('first-confirmed');
    });
    const secondBeforeDispatch = vi.fn();
    const secondConfirmed = vi.fn();

    const first = await drain(
      runtime.streamTurn({ message: 'Apply both changes' }),
    );
    expect(first.result).toMatchObject({
      status: 'approval_required',
      responseId: 'resp_sequential_1',
    });

    const secondEvents: AgentRuntimeEvent[] = [];
    let secondResult: AgentTurnResult | undefined;
    const secondContinuation = runtime.continueApproval({
      responseId: 'resp_sequential_1',
      approvalRequestId: firstApproval.id,
      approve: true,
      unsafeDispatchCallbacks: {
        beforeDispatch: firstBeforeDispatch,
        confirmed: firstConfirmed,
      },
    });
    while (true) {
      // biome-ignore lint/performance/noAwaitInLoops: Event ordering is the behavior under test.
      const next = await secondContinuation.next();
      if (next.done) {
        secondResult = next.value;
        break;
      }
      secondEvents.push(next.value);
      if (next.value.type === 'approval_required') {
        settlementOrder.push('second-approval-exposed');
      }
    }

    expect(secondResult).toMatchObject({
      status: 'approval_required',
      responseId: 'resp_sequential_2',
      confirmedApprovalIds: [firstApproval.id],
    });
    expect(
      secondEvents.some((event) => event.type === 'approval_required'),
    ).toBe(true);
    expect(settlementOrder).toEqual([
      'first-confirmed',
      'second-approval-exposed',
    ]);
    expect(firstBeforeDispatch).toHaveBeenCalledWith([firstApproval.id]);
    expect(firstConfirmed).toHaveBeenCalledOnce();
    expect(firstConfirmed).toHaveBeenCalledWith([firstApproval.id]);

    const completed = await drain(
      runtime.continueApproval({
        responseId: 'resp_sequential_2',
        approvalRequestId: secondApproval.id,
        approve: true,
        unsafeDispatchCallbacks: {
          beforeDispatch: secondBeforeDispatch,
          confirmed: secondConfirmed,
        },
      }),
    );

    expect(completed.result).toMatchObject({
      status: 'completed',
      responseId: 'resp_sequential_done',
      text: 'Both changes completed',
    });
    expect(secondBeforeDispatch).toHaveBeenCalledWith([secondApproval.id]);
    expect(secondConfirmed).toHaveBeenCalledOnce();
    expect(secondConfirmed).toHaveBeenCalledWith([secondApproval.id]);
    expect(client.requests).toHaveLength(3);
  });

  it('does not send an approved continuation when durable journaling fails', async () => {
    const approval = scriptApproval('unsafe', 'approval-journal-failure');
    const client = new QueueResponsesClient([
      eventsFor(response('resp_journal_failure', [approval])),
      eventsFor(response('should-not-be-sent')),
    ]);
    const runtime = runtimeWith(client);

    await drain(runtime.streamTurn({ message: 'Update it' }));
    const failed = await drain(
      runtime.continueApproval({
        responseId: 'resp_journal_failure',
        approvalRequestId: approval.id,
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
    expect(client.requests).toHaveLength(1);
  });

  it('preserves local schema output while an unsafe MCP call awaits approval', async () => {
    const approval = scriptApproval('unsafe', 'approval-with-schema');
    const schemaCall = modelSchemaCall(
      { identifier: 'article', cursor: null },
      'schema-with-approval',
    );
    const client = new QueueResponsesClient([
      eventsFor(response('resp_schema_approval', [schemaCall, approval])),
      eventsFor(response('resp_schema_approval_done'), ['Kept unchanged']),
    ]);
    const runtime = runtimeWith(client, {
      getModelSchema: vi.fn().mockResolvedValue({
        model: { id: 'model-1', apiKey: 'article' },
        fields: [],
      }),
    });

    const first = await drain(
      runtime.streamTurn({ message: 'Inspect the model, then update it' }),
    );
    expect(first.result.status).toBe('approval_required');

    await drain(
      runtime.continueApproval({
        responseId: 'resp_schema_approval',
        approvalRequestId: 'approval-with-schema',
        approve: false,
      }),
    );

    expect(client.requests[1]?.input).toEqual([
      expect.objectContaining({
        type: 'mcp_approval_response',
        approval_request_id: 'approval-with-schema',
        approve: false,
      }),
      expect.objectContaining({
        type: 'function_call_output',
        call_id: 'schema-with-approval',
        output: expect.stringContaining('"apiKey":"article"'),
      }),
    ]);
  });

  it('preserves continuation, schema, and tool-call budgets across approval', async () => {
    const approval = scriptApproval('unsafe', 'approval-after-schemas');
    const initialSchemaCalls = Array.from(
      { length: MAX_DISTINCT_MODEL_SCHEMAS_PER_TURN },
      (_, index) =>
        modelSchemaCall(
          { identifier: `model_${index}`, cursor: null },
          `schema-before-approval-${index}`,
        ),
    );
    const schemaAfterApproval = modelSchemaCall(
      { identifier: 'model_after_approval', cursor: null },
      'schema-after-approval',
    );
    const client = new QueueResponsesClient([
      eventsFor(
        response('resp_budget_approval', [...initialSchemaCalls, approval]),
      ),
      eventsFor(response('resp_budget_after_approval', [schemaAfterApproval])),
      eventsFor(response('must_not_run'), ['Unexpected extra continuation.']),
    ]);
    const getModelSchema = vi.fn(async ({ identifier }) => ({
      model: identifier,
      fields: [],
    }));
    const runtime = runtimeWith(client, {
      getModelSchema,
      maxContinuations: 2,
    });

    const pending = await drain(
      runtime.streamTurn({ message: 'Check the fields, then update it.' }),
    );
    expect(pending.result).toMatchObject({
      status: 'approval_required',
      responseId: 'resp_budget_approval',
      continuationCount: 0,
    });

    const settled = await drain(
      runtime.continueApproval({
        responseId: 'resp_budget_approval',
        approvalRequestId: approval.id,
        approve: false,
      }),
    );

    expect(client.requests).toHaveLength(2);
    expect(
      (
        client.requests[1] as ResponseCreateParamsStreaming & {
          max_tool_calls?: number;
        }
      ).max_tool_calls,
    ).toBe(DEFAULT_MAX_TOOL_CALLS - MAX_DISTINCT_MODEL_SCHEMAS_PER_TURN - 1);
    expect(getModelSchema).toHaveBeenCalledTimes(
      MAX_DISTINCT_MODEL_SCHEMAS_PER_TURN,
    );
    expect(
      settled.events.some(
        (event) =>
          event.type === 'activity' &&
          event.activity.id === 'schema-after-approval' &&
          event.activity.status === 'failed' &&
          event.activity.error?.includes(
            'items.rawList search with filter.query',
          ),
      ),
    ).toBe(true);
    expect(settled.result).toMatchObject({
      status: 'failed',
      responseId: 'resp_budget_after_approval',
      continuationCount: 2,
      error: { code: 'continuation_limit' },
    });
  });

  it('does not expose an approval until its response is terminal', async () => {
    const approval = scriptApproval('unsafe');
    let terminalWasYielded = false;
    const client: AgentResponsesClient = {
      async create(params) {
        expect(params.previous_response_id).toBeUndefined();
        return (async function* stream() {
          yield {
            type: 'response.created',
            response: response('resp_terminal', [], 'in_progress'),
            sequence_number: 0,
          } as ResponseStreamEvent;
          yield {
            type: 'response.output_item.added',
            output_index: 0,
            item: approval,
            sequence_number: 1,
          } as ResponseStreamEvent;
          terminalWasYielded = true;
          yield {
            type: 'response.completed',
            response: response('resp_terminal', [approval]),
            sequence_number: 2,
          } as ResponseStreamEvent;
        })();
      },
    };
    const runtime = runtimeWith(client);
    const stream = runtime.streamTurn({ message: 'Update it' });

    while (true) {
      // biome-ignore lint/performance/noAwaitInLoops: The assertion checks protocol ordering one event at a time.
      const next = await stream.next();
      if (next.done) {
        expect(next.value.status).toBe('approval_required');
        break;
      }
      if (next.value.type === 'approval_required') {
        expect(terminalWasYielded).toBe(true);
      }
    }
  });

  it('auto-approves a host-validated safe MCP call', async () => {
    const approval = scriptApproval('safe');
    const client = new QueueResponsesClient([
      eventsFor(response('resp_safe_approval', [approval])),
      eventsFor(response('resp_safe_done'), ['Project read']),
    ]);
    const runtime = runtimeWith(client);

    const { events, result } = await drain(
      runtime.streamTurn({ message: 'Read the project' }),
    );

    expect(result).toMatchObject({
      status: 'completed',
      responseId: 'resp_safe_done',
      text: 'Project read',
    });
    expect(events.some((event) => event.type === 'approval_required')).toBe(
      false,
    );
    expect(
      events.some(
        (event) =>
          event.type === 'activity' && event.activity.id === approval.id,
      ),
    ).toBe(false);
    expect(client.requests).toHaveLength(2);
    expect(client.requests[1]).toMatchObject({
      previous_response_id: 'resp_safe_approval',
      input: [
        {
          type: 'mcp_approval_response',
          approval_request_id: approval.id,
          approve: true,
        },
      ],
      max_tool_calls: DEFAULT_MAX_TOOL_CALLS,
    });
  });

  it('denies an out-of-scope safe call without exposing it to the editor', async () => {
    const approval = scriptApproval('safe', 'approval-invalid', {
      site_id: 'another-site',
    });
    const client = new QueueResponsesClient([
      eventsFor(response('resp_invalid_safe', [approval])),
      eventsFor(response('resp_invalid_done'), ['I could not access it.']),
    ]);
    const runtime = runtimeWith(client);

    const { events, result } = await drain(
      runtime.streamTurn({ message: 'Read another project' }),
    );

    expect(result.status).toBe('completed');
    expect(events.some((event) => event.type === 'approval_required')).toBe(
      false,
    );
    expect(client.requests[1]?.input).toEqual([
      expect.objectContaining({
        type: 'mcp_approval_response',
        approval_request_id: 'approval-invalid',
        approve: false,
        reason: expect.stringContaining('different DatoCMS project'),
      }),
    ]);
  });

  it('keeps local outputs atomic with a pending unsafe approval', async () => {
    const approval = scriptApproval('unsafe', 'approval-atomic');
    const navigationCall = {
      type: 'function_call',
      id: 'function-atomic',
      call_id: 'call-atomic',
      name: 'open_record',
      arguments: JSON.stringify({
        item_id: 'item-1',
        item_type_id: null,
        field_path: null,
      }),
      status: 'completed',
    } satisfies ResponseFunctionToolCall;
    const client = new QueueResponsesClient([
      eventsFor(response('resp_atomic', [approval, navigationCall])),
      eventsFor(response('resp_atomic_done'), ['Updated']),
    ]);
    const runtime = runtimeWith(client);

    const first = await drain(runtime.streamTurn({ message: 'Update it' }));
    expect(first.result.status).toBe('approval_required');

    await drain(
      runtime.continueApproval({
        responseId: 'resp_atomic',
        approvalRequestId: approval.id,
        approve: true,
      }),
    );

    expect(client.requests[1]?.input).toEqual([
      {
        type: 'mcp_approval_response',
        approval_request_id: approval.id,
        approve: true,
      },
      expect.objectContaining({
        type: 'function_call_output',
        call_id: 'call-atomic',
      }),
    ]);
  });

  it('keeps validated automatic decisions with a pending unsafe approval', async () => {
    const safeApproval = scriptApproval('safe', 'approval-safe-paired');
    const unsafeApproval = scriptApproval('unsafe', 'approval-unsafe-paired');
    const client = new QueueResponsesClient([
      eventsFor(
        response('resp_paired_approvals', [safeApproval, unsafeApproval]),
      ),
      eventsFor(response('resp_paired_done'), ['Done']),
    ]);
    const runtime = runtimeWith(client);

    const first = await drain(
      runtime.streamTurn({ message: 'Read and update' }),
    );
    expect(first.result.approvals).toHaveLength(1);
    expect(first.result.approvals[0]?.approvalRequestId).toBe(
      unsafeApproval.id,
    );

    await drain(
      runtime.continueApproval({
        responseId: 'resp_paired_approvals',
        approvalRequestId: unsafeApproval.id,
        approve: true,
      }),
    );

    expect(client.requests[1]?.input).toEqual([
      {
        type: 'mcp_approval_response',
        approval_request_id: unsafeApproval.id,
        approve: true,
      },
      {
        type: 'mcp_approval_response',
        approval_request_id: safeApproval.id,
        approve: true,
      },
    ]);
  });

  it('does not retry an approved unsafe continuation after dispatch fails', async () => {
    const approval = scriptApproval('unsafe', 'approval-uncertain');
    const client = new QueueResponsesClient([
      eventsFor(response('resp_uncertain', [approval])),
    ]);
    const runtime = runtimeWith(client);

    await drain(runtime.streamTurn({ message: 'Update it' }));
    const failed = await drain(
      runtime.continueApproval({
        responseId: 'resp_uncertain',
        approvalRequestId: approval.id,
        approve: true,
      }),
    );

    expect(failed.result).toMatchObject({
      status: 'failed',
      error: {
        code: 'unsafe_outcome_unknown',
        retryable: false,
        message: expect.stringContaining('may have run'),
      },
    });

    const retry = await drain(
      runtime.continueApproval({
        responseId: 'resp_uncertain',
        approvalRequestId: approval.id,
        approve: true,
      }),
    );
    expect(retry.result).toMatchObject({
      status: 'failed',
      error: {
        code: 'invalid_request',
        retryable: false,
        message: expect.stringContaining('may already have run'),
      },
    });
    expect(client.requests).toHaveLength(2);
  });

  it('submits an unsafe approval at most once while it is in flight', async () => {
    const approval = scriptApproval('unsafe', 'approval-in-flight');
    let requestCount = 0;
    let releaseContinuation: (() => void) | undefined;
    let continuationStarted: (() => void) | undefined;
    const continuationGate = new Promise<void>((resolve) => {
      releaseContinuation = resolve;
    });
    const started = new Promise<void>((resolve) => {
      continuationStarted = resolve;
    });
    const client: AgentResponsesClient = {
      async create() {
        requestCount += 1;
        if (requestCount === 1) {
          const events = eventsFor(response('resp_in_flight', [approval]));
          return (async function* stream() {
            yield* events;
          })();
        }
        if (requestCount === 2) {
          continuationStarted?.();
          return (async function* stream() {
            await continuationGate;
            yield* eventsFor(response('resp_in_flight_done'), ['Done']);
          })();
        }
        throw new Error('Unexpected duplicate approval request.');
      },
    };
    const runtime = runtimeWith(client);

    await drain(runtime.streamTurn({ message: 'Update it' }));
    const firstSubmission = drain(
      runtime.continueApproval({
        responseId: 'resp_in_flight',
        approvalRequestId: approval.id,
        approve: true,
      }),
    );
    await started;

    const duplicate = await drain(
      runtime.continueApproval({
        responseId: 'resp_in_flight',
        approvalRequestId: approval.id,
        approve: true,
      }),
    );
    expect(duplicate.result).toMatchObject({
      status: 'failed',
      error: {
        code: 'invalid_request',
        message: expect.stringContaining('already being submitted'),
      },
    });

    releaseContinuation?.();
    expect((await firstSubmission).result.status).toBe('completed');
    expect(requestCount).toBe(2);
  });

  it('streams refusals and recovers terminal-only visible text', async () => {
    const refusal = assistantMessage({
      type: 'refusal',
      refusal: 'I cannot perform that request.',
    });
    const refusalResponse = response('resp_refusal', [refusal]);
    const client = new QueueResponsesClient([
      [
        {
          type: 'response.created',
          response: response('resp_refusal', [], 'in_progress'),
          sequence_number: 0,
        },
        {
          type: 'response.refusal.delta',
          item_id: 'message-1',
          output_index: 0,
          content_index: 0,
          delta: 'I cannot ',
          sequence_number: 1,
        },
        {
          type: 'response.completed',
          response: refusalResponse,
          sequence_number: 2,
        },
      ] as ResponseStreamEvent[],
      eventsFor(
        response('resp_terminal_text', [
          assistantMessage({
            type: 'output_text',
            text: 'Recovered terminal answer.',
            annotations: [],
          }),
        ]),
      ),
    ]);
    const runtime = runtimeWith(client);

    const refusalTurn = await drain(
      runtime.streamTurn({ message: 'Disallowed request' }),
    );
    expect(refusalTurn.result.text).toBe('I cannot perform that request.');
    expect(
      refusalTurn.events
        .filter(
          (
            event,
          ): event is Extract<AgentRuntimeEvent, { type: 'text_delta' }> =>
            event.type === 'text_delta',
        )
        .map((event) => event.delta),
    ).toEqual(['I cannot ', 'perform that request.']);

    const terminalOnly = await drain(
      runtime.streamTurn({ message: 'Give me an answer' }),
    );
    expect(terminalOnly.result.text).toBe('Recovered terminal answer.');
    expect(terminalOnly.events).toContainEqual({
      type: 'text_delta',
      responseId: 'resp_terminal_text',
      delta: 'Recovered terminal answer.',
    });
  });

  it('normalizes a structured MCP error without crashing the turn', async () => {
    const client = new QueueResponsesClient([
      mcpFailureEvents({
        type: 'tool_execution_error',
        message:
          "Replacement 1: String not found in script 'script://describe-project.ts'",
      }),
    ]);
    const runtime = runtimeWith(client);

    const { events, result } = await drain(
      runtime.streamTurn({ message: 'Describe this project' }),
    );

    expect(result).toMatchObject({
      status: 'completed',
      responseId: 'resp_mcp_failure',
      text: 'I could not complete that DatoCMS operation.',
    });
    expect(events).toContainEqual({
      type: 'activity',
      responseId: 'resp_mcp_failure',
      activity: expect.objectContaining({
        id: 'mcp-call-1',
        status: 'failed',
        output: '{"diagnostic":"raw-mcp-output"}',
        error:
          "Replacement 1: String not found in script 'script://describe-project.ts'",
      }),
    });
    expect(events.some((event) => event.type === 'error')).toBe(false);
  });

  it.each([
    ['string', 'Plain MCP failure', 'Plain MCP failure'],
    ['Error', new Error('Error instance failure'), 'Error instance failure'],
    [
      'message object',
      { message: 'Structured MCP failure' },
      'Structured MCP failure',
    ],
    [
      'nested error',
      { error: { message: 'Nested MCP failure' } },
      'Nested MCP failure',
    ],
    [
      'MCP content',
      {
        isError: true,
        content: [{ type: 'text', text: 'MCP content failure' }],
      },
      'MCP content failure',
    ],
    [
      'unknown object',
      { unexpected: 'shape' },
      'The DatoCMS operation failed.',
    ],
  ])('normalizes an MCP %s error', async (_label, error, expected) => {
    const client = new QueueResponsesClient([mcpFailureEvents(error)]);
    const runtime = runtimeWith(client);

    const { events } = await drain(
      runtime.streamTurn({ message: 'Describe this project' }),
    );

    expect(events).toContainEqual({
      type: 'activity',
      responseId: 'resp_mcp_failure',
      activity: expect.objectContaining({
        id: 'mcp-call-1',
        status: 'failed',
        error: expected,
      }),
    });
  });

  it('redacts and truncates normalized MCP errors', async () => {
    const secret = 'sk-12345678901234567890';
    const client = new QueueResponsesClient([
      mcpFailureEvents({
        message: `Bearer oauth-secret ${secret} ${'x'.repeat(2_000)}`,
      }),
    ]);
    const runtime = runtimeWith(client);

    const { events } = await drain(
      runtime.streamTurn({ message: 'Describe this project' }),
    );
    const failedActivity = events.find(
      (event): event is Extract<AgentRuntimeEvent, { type: 'activity' }> =>
        event.type === 'activity' &&
        event.activity.id === 'mcp-call-1' &&
        Boolean(event.activity.error),
    );

    expect(failedActivity?.activity.error).toHaveLength(1_000);
    expect(failedActivity?.activity.error).toContain('Bearer [redacted]');
    expect(failedActivity?.activity.error).toContain('[redacted]');
    expect(failedActivity?.activity.error).not.toContain('oauth-secret');
    expect(failedActivity?.activity.error).not.toContain(secret);
  });

  it.each([
    [
      401,
      'Incorrect API key provided.',
      'api_error',
      false,
      'OpenAI rejected the configured API key. Update it in plugin settings.',
    ],
    [
      403,
      'This key cannot access the selected model.',
      'api_error',
      false,
      'OpenAI denied access. Check the API key and model access in plugin settings.',
    ],
    [
      400,
      'Unsupported request parameter.',
      'invalid_request',
      false,
      'OpenAI rejected this request. Unsupported request parameter.',
    ],
    [
      422,
      'The request could not be processed.',
      'invalid_request',
      false,
      'OpenAI rejected this request. The request could not be processed.',
    ],
    [
      408,
      'Request timed out.',
      'api_error',
      true,
      'OpenAI timed out. Try again.',
    ],
    [
      409,
      'A temporary conflict occurred.',
      'api_error',
      true,
      'OpenAI reported a temporary conflict. Try again.',
    ],
    [
      429,
      'Rate limit reached.',
      'api_error',
      true,
      'OpenAI is temporarily rate limited. Try again shortly.',
    ],
    [
      500,
      'Internal server error.',
      'api_error',
      true,
      'OpenAI is temporarily unavailable. Try again shortly.',
    ],
  ] satisfies Array<[number, string, string, boolean, string]>)(
    'classifies OpenAI HTTP %i failures before offering a retry',
    async (status, message, code, retryable, expectedMessage) => {
      const client: AgentResponsesClient = {
        async create() {
          throw providerError(status, message);
        },
      };
      const runtime = runtimeWith(client);

      const { result } = await drain(
        runtime.streamTurn({ message: 'Describe this project.' }),
      );

      expect(result).toMatchObject({
        status: 'failed',
        error: { code, retryable, message: expectedMessage },
      });
    },
  );

  it.each([
    [
      providerError(undefined, 'The API key was revoked.', 'revoked_api_key'),
      {
        code: 'api_error',
        retryable: false,
        message:
          'OpenAI rejected the configured API key. Update it in plugin settings.',
      },
    ],
    [
      providerError(undefined, 'Unsupported request.', 'invalid_request_error'),
      {
        code: 'invalid_request',
        retryable: false,
        message: 'OpenAI rejected this request. Unsupported request.',
      },
    ],
    [
      providerError(undefined, 'Rate limited.', 'rate_limit_exceeded'),
      {
        code: 'api_error',
        retryable: true,
        message: 'OpenAI is temporarily rate limited. Try again shortly.',
      },
    ],
    [
      new TypeError('Failed to fetch'),
      {
        code: 'api_error',
        retryable: true,
        message:
          'OpenAI could not be reached. Check your connection and try again.',
      },
    ],
  ])(
    'classifies OpenAI code and transport failures',
    async (cause, expectedError) => {
      const client: AgentResponsesClient = {
        async create() {
          throw cause;
        },
      };
      const runtime = runtimeWith(client);

      const { result } = await drain(
        runtime.streamTurn({ message: 'Describe this project.' }),
      );

      expect(result.error).toEqual(expectedError);
    },
  );

  it.each([
    [
      'invalid_prompt',
      'The prompt is invalid.',
      'invalid_request',
      false,
      'OpenAI rejected this request. The prompt is invalid.',
    ],
    [
      'server_error',
      'The provider failed.',
      'api_error',
      true,
      'OpenAI is temporarily unavailable. Try again shortly.',
    ],
  ] as const)(
    'classifies a terminal OpenAI %s response',
    async (providerCode, providerMessage, code, retryable, expectedMessage) => {
      const failedResponse = {
        ...response('resp-provider-failure', [], 'failed'),
        error: {
          code: providerCode,
          message: providerMessage,
        },
      } as Response;
      const client = new QueueResponsesClient([eventsFor(failedResponse)]);
      const runtime = runtimeWith(client);

      const { result } = await drain(
        runtime.streamTurn({ message: 'Describe this project.' }),
      );

      expect(result).toMatchObject({
        status: 'failed',
        error: { code, retryable, message: expectedMessage },
      });
    },
  );

  it('keeps an interrupted OpenAI stream retryable without exposing raw protocol text', async () => {
    const client = new QueueResponsesClient([[]]);
    const runtime = runtimeWith(client);

    const { result } = await drain(
      runtime.streamTurn({ message: 'Describe this project.' }),
    );

    expect(result).toMatchObject({
      status: 'failed',
      error: {
        code: 'incomplete',
        retryable: true,
        message: 'OpenAI response was interrupted. Try again.',
      },
    });
  });

  it('passes AbortSignal through and reports a pre-aborted turn', async () => {
    const client = new QueueResponsesClient([]);
    const runtime = runtimeWith(client);
    const controller = new AbortController();
    controller.abort();

    const { events, result } = await drain(
      runtime.streamTurn({
        message: 'Do something',
        signal: controller.signal,
      }),
    );

    expect(client.requests).toHaveLength(0);
    expect(result).toMatchObject({
      status: 'aborted',
      error: { code: 'aborted', retryable: false },
    });
    expect(events.some((event) => event.type === 'error')).toBe(true);
  });

  it('does not expose an approval when stopped on the final streamed text', async () => {
    const approval = scriptApproval('unsafe', 'approval-stop-race');
    const client = new QueueResponsesClient([
      eventsFor(
        response('resp_stop_race', [
          assistantMessage({
            type: 'output_text',
            text: 'The change is ready for review.',
            annotations: [],
          }),
          approval,
        ]),
      ),
    ]);
    const runtime = runtimeWith(client);
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
  });

  it('stops a runaway local-tool continuation loop', async () => {
    const makeCall = (index: number) =>
      ({
        type: 'function_call',
        id: `function-${index}`,
        call_id: `call-${index}`,
        name: 'open_record',
        arguments: JSON.stringify({
          item_id: `item-${index}`,
          item_type_id: null,
          field_path: null,
        }),
        status: 'completed',
      }) satisfies ResponseFunctionToolCall;
    const client = new QueueResponsesClient([
      eventsFor(response('resp_1', [makeCall(1)])),
      eventsFor(response('resp_2', [makeCall(2)])),
    ]);
    const runtime = runtimeWith(client, { maxContinuations: 2 });
    const { events, result } = await drain(
      runtime.streamTurn({ message: 'Keep navigating forever' }),
    );

    expect(client.requests).toHaveLength(2);
    expect(result).toMatchObject({
      status: 'failed',
      responseId: 'resp_2',
      continuationCount: 2,
      error: { code: 'continuation_limit', retryable: true },
    });
    const latestActivityStatuses = new Map<string, string>();
    for (const event of events) {
      if (event.type === 'activity') {
        latestActivityStatuses.set(event.activity.id, event.activity.status);
      }
    }
    expect(
      events.some(
        (event) =>
          event.type === 'activity' && event.activity.kind === 'continuation',
      ),
    ).toBe(false);
    expect([...latestActivityStatuses.values()]).not.toContain('in_progress');
  });
});
