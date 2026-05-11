import { GoogleGenAI, mcpToTool } from '@google/genai';
import { Client as McpClient } from '@modelcontextprotocol/sdk/client/index.js';
import { StreamableHTTPClientTransport } from '@modelcontextprotocol/sdk/client/streamableHttp.js';
import CurrentClient from 'openai';
import type {
  Response as CurrentResponse,
  ResponseOutputItem,
  ResponseStreamEvent,
} from 'openai/resources/responses/responses';
import { derror, dlog } from './debugLog';
import { MCP_BASE_URL } from './oauth';
import {
  type ProcessTrace,
  type TurnStreamEvent,
} from './processTrace';
import {
  PROVIDER_DEFAULT_REASONING_EFFORT,
  type ApiReasoningEffort,
  type ModelProvider,
  type ReasoningEffort,
} from './pluginParams';

export type ChatRole = 'user' | 'assistant';

export type ChatMessage = {
  id: string;
  role: ChatRole;
  text: string;
  responseId?: string;
  process?: ProcessTrace;
  processOpen?: boolean;
};


export type SharedTurnArgs = {
  provider: ModelProvider;
  apiKey: string;
  model: string;
  reasoningEffort: ReasoningEffort;
  datoAccessToken: string;
  recordId: string | null;
  onStreamEvent?: (event: TurnStreamEvent) => void;
};

export type SendChatTurnArgs = SharedTurnArgs & {
  history: ChatMessage[];
  previousResponseId?: string;
};

export type PendingApproval = {
  approvalRequestId: string;
  toolName: string;
  serverLabel: string;
  argumentsJson: string;
};

export type SendChatTurnResult = {
  responseId: string;
  text: string;
  pendingApprovals: PendingApproval[];
};

export type RecoverChatTurnArgs = {
  apiKey: string;
  responseId: string;
  signal?: AbortSignal;
  timeoutMs?: number;
  pollIntervalMs?: number;
};

export type SubmitApprovalDecisionArgs = SharedTurnArgs & {
  previousResponseId: string;
  decisions: Array<{ approvalRequestId: string; approve: boolean }>;
};

export type SubmitToolResponsesArgs = SharedTurnArgs & {
  previousResponseId: string;
  decisions?: Array<{ approvalRequestId: string; approve: boolean }>;
};

const MCP_APPROVAL_REQUIRED_ACTION_NAMES = ['upsert_and_execute_unsafe_script'];
const DEFAULT_RECOVERY_TIMEOUT_MS = 120_000;
const DEFAULT_RECOVERY_POLL_INTERVAL_MS = 1_500;
const STREAM_IDLE_TIMEOUT_MS = 45_000;
const STREAM_RECOVERY_TIMEOUT_MS = 120_000;

type StreamReadResult =
  | { kind: 'event'; result: IteratorResult<ResponseStreamEvent> }
  | { kind: 'timeout' };

type RuntimeReasoningConfig = {
  effort?: ApiReasoningEffort;
  summary?: 'auto';
};

function buildInstructionsForArgs(args: SharedTurnArgs): string {
  if (!args.recordId) return '';
  return `the user is currently in the record ${args.recordId}`;
}

function buildMcpTool(datoAccessToken: string) {
  return {
    type: 'mcp' as const,
    server_label: 'datocms',
    server_url: `${MCP_BASE_URL}/`,
    authorization: datoAccessToken,
    require_approval: {
      always: { tool_names: MCP_APPROVAL_REQUIRED_ACTION_NAMES },
      never: { read_only: true },
    },
  };
}

function stringifyToolValue(value: unknown): string | undefined {
  if (value === undefined || value === null) return undefined;
  if (typeof value === 'string') return value;

  try {
    const json = JSON.stringify(value, null, 2);
    return typeof json === 'string' ? json : String(value);
  } catch {
    return String(value);
  }
}

function stringifyRequiredToolValue(value: unknown): string {
  return stringifyToolValue(value) ?? '';
}

function collectPendingApprovals(output: readonly unknown[]): PendingApproval[] {
  const pending: PendingApproval[] = [];
  for (const rawItem of output ?? []) {
    if (!rawItem || typeof rawItem !== 'object') continue;
    const item = rawItem as Record<string, unknown>;
    if (item.type !== 'mcp_approval_request') continue;
    const id = typeof item.id === 'string' ? item.id : '';
    const toolName = typeof item.name === 'string' ? item.name : '';
    const serverLabel =
      typeof item.server_label === 'string' ? item.server_label : '';
    const argumentsJson = stringifyRequiredToolValue(item.arguments);
    if (!id || !toolName) continue;
    pending.push({
      approvalRequestId: id,
      toolName,
      serverLabel,
      argumentsJson,
    });
  }
  return pending;
}

function buildToolSet(
  args: SharedTurnArgs,
): Array<ReturnType<typeof buildMcpTool>> {
  return [buildMcpTool(args.datoAccessToken)];
}

type ResponseInputPayload = Array<
  | {
      role: ChatRole;
      content: string;
    }
  | {
      type: 'mcp_approval_response';
      approval_request_id: string;
      approve: boolean;
    }
>;

async function createStreamingResponse(args: {
  client: CurrentClient;
  shared: SharedTurnArgs;
  input: ResponseInputPayload;
  previousResponseId?: string;
  eventName: string;
}): Promise<CurrentResponse> {
  const includeReasoning = shouldRequestReasoningSummary(args.shared.model);
  try {
    return await collectStreamingResponse({
      ...args,
      includeReasoning,
    });
  } catch (error) {
    if (!includeReasoning || !isLikelyReasoningSummaryError(error)) {
      throw error;
    }

    dlog('Runtime', 'reasoning_summary_retry', {
      eventName: args.eventName,
      model: args.shared.model,
      message: error instanceof Error ? error.message : String(error),
    });

    return collectStreamingResponse({
      ...args,
      includeReasoning: false,
    });
  }
}

async function collectStreamingResponse(args: {
  client: CurrentClient;
  shared: SharedTurnArgs;
  input: ResponseInputPayload;
  previousResponseId?: string;
  includeReasoning: boolean;
  eventName: string;
}): Promise<CurrentResponse> {
  let completedResponse: CurrentResponse | null = null;
  let failureMessage: string | null = null;
  const reasoning = buildReasoningConfig({
    effort: args.shared.reasoningEffort,
    includeSummary: args.includeReasoning,
  });

  const instructions = buildInstructionsForArgs(args.shared);
  const stream = await args.client.responses
    .create({
      model: args.shared.model,
      ...(instructions ? { instructions } : {}),
      tools: buildToolSet(args.shared),
      input: args.input,
      background: true,
      store: true,
      stream: true,
      ...(args.previousResponseId
        ? { previous_response_id: args.previousResponseId }
        : {}),
      ...(reasoning ? { reasoning } : {}),
    })
    .catch((error) => {
      derror('Provider', `${args.eventName}:failure`, error, {
        model: args.shared.model,
      });
      throw error;
    });

  const seenApprovals = new Set<string>();
  const iterator = stream[Symbol.asyncIterator]();
  let responseId: string | null = null;

  while (true) {
    const read = await readNextStreamEvent(iterator, STREAM_IDLE_TIMEOUT_MS);

    if (read.kind === 'timeout') {
      stream.controller.abort();
      if (!responseId) {
        throw new Error('Response stream stalled before it returned an id.');
      }

      dlog('Runtime', 'stream_idle_recovery_start', {
        eventName: args.eventName,
        responseId,
        idleMs: STREAM_IDLE_TIMEOUT_MS,
      });

      const recovered = await recoverResponse({
        client: args.client,
        responseId,
        timeoutMs: STREAM_RECOVERY_TIMEOUT_MS,
        pollIntervalMs: DEFAULT_RECOVERY_POLL_INTERVAL_MS,
        eventName: args.eventName,
        shared: args.shared,
      });
      emitRecoveredResponseEvents(args.shared, recovered, seenApprovals);
      return recovered;
    }

    if (read.result.done) break;

    const event = read.result.value;
    handleStreamEvent(args.shared, event, seenApprovals);

    if (event.type === 'response.created') {
      responseId = event.response.id;
    } else if (event.type === 'response.completed') {
      completedResponse = event.response;
      responseId = event.response.id;
    } else if (event.type === 'response.failed') {
      completedResponse = event.response;
      responseId = event.response.id;
      failureMessage = responseFailureMessage(event.response);
    } else if (event.type === 'response.incomplete') {
      completedResponse = event.response;
      responseId = event.response.id;
      failureMessage = 'Response ended before it completed.';
    } else if (event.type === 'error') {
      failureMessage = event.message;
    }
  }

  if (failureMessage) {
    throw new Error(failureMessage);
  }

  if (!completedResponse) {
    throw new Error('Response stream ended without a completed response.');
  }

  return completedResponse;
}

function buildReasoningConfig(args: {
  effort: ReasoningEffort;
  includeSummary: boolean;
}): RuntimeReasoningConfig | undefined {
  const reasoning: RuntimeReasoningConfig = {};

  if (args.effort !== PROVIDER_DEFAULT_REASONING_EFFORT) {
    reasoning.effort = args.effort;
  }

  if (args.includeSummary) {
    reasoning.summary = 'auto';
  }

  return reasoning.effort || reasoning.summary ? reasoning : undefined;
}

function readNextStreamEvent(
  iterator: AsyncIterator<ResponseStreamEvent>,
  timeoutMs: number,
): Promise<StreamReadResult> {
  return new Promise((resolve, reject) => {
    let settled = false;
    const timeout = window.setTimeout(() => {
      if (settled) return;
      settled = true;
      resolve({ kind: 'timeout' });
    }, timeoutMs);

    iterator.next().then(
      (result) => {
        if (settled) return;
        settled = true;
        window.clearTimeout(timeout);
        resolve({ kind: 'event', result });
      },
      (error: unknown) => {
        if (settled) return;
        settled = true;
        window.clearTimeout(timeout);
        reject(error);
      },
    );
  });
}

function emitRecoveredResponseEvents(
  args: SharedTurnArgs,
  response: CurrentResponse,
  seenApprovals: Set<string>,
): void {
  for (const item of response.output ?? []) {
    handleOutputItemStreamEvent(args, item, seenApprovals);
  }

  emitStreamEvent(args, {
    kind: 'completed',
    responseId: response.id,
  });
}

function handleStreamEvent(
  args: SharedTurnArgs,
  event: ResponseStreamEvent,
  seenApprovals: Set<string>,
): void {
  switch (event.type) {
    case 'response.created':
      emitStreamEvent(args, {
        kind: 'response_started',
        responseId: event.response.id,
      });
      return;
    case 'response.output_text.delta':
      emitStreamEvent(args, {
        kind: 'text_delta',
        delta: event.delta,
      });
      return;
    case 'response.reasoning_summary_text.delta':
      emitStreamEvent(args, {
        kind: 'reasoning_delta',
        itemId: event.item_id,
        summaryIndex: event.summary_index,
        delta: event.delta,
      });
      return;
    case 'response.reasoning_summary_text.done':
      emitStreamEvent(args, {
        kind: 'reasoning_done',
        itemId: event.item_id,
        summaryIndex: event.summary_index,
        text: event.text,
      });
      return;
    case 'response.mcp_list_tools.in_progress':
      emitStreamEvent(args, {
        kind: 'mcp_list_started',
        itemId: event.item_id,
      });
      return;
    case 'response.mcp_list_tools.completed':
      emitStreamEvent(args, {
        kind: 'mcp_list_completed',
        itemId: event.item_id,
      });
      return;
    case 'response.mcp_list_tools.failed':
      emitStreamEvent(args, {
        kind: 'mcp_list_failed',
        itemId: event.item_id,
      });
      return;
    case 'response.mcp_call.in_progress':
      emitStreamEvent(args, {
        kind: 'mcp_call_started',
        itemId: event.item_id,
      });
      return;
    case 'response.mcp_call_arguments.delta':
      emitStreamEvent(args, {
        kind: 'mcp_call_arguments',
        itemId: event.item_id,
        argumentsJson: stringifyRequiredToolValue(event.delta),
      });
      return;
    case 'response.mcp_call_arguments.done':
      emitStreamEvent(args, {
        kind: 'mcp_call_arguments',
        itemId: event.item_id,
        argumentsJson: stringifyRequiredToolValue(event.arguments),
      });
      return;
    case 'response.mcp_call.completed':
      emitStreamEvent(args, {
        kind: 'mcp_call_completed',
        itemId: event.item_id,
      });
      return;
    case 'response.mcp_call.failed':
      emitStreamEvent(args, {
        kind: 'mcp_call_failed',
        itemId: event.item_id,
      });
      return;
    case 'response.output_item.added':
    case 'response.output_item.done':
      handleOutputItemStreamEvent(args, event.item, seenApprovals);
      return;
    case 'response.completed':
      emitStreamEvent(args, {
        kind: 'completed',
        responseId: event.response.id,
      });
      return;
    case 'response.failed':
      emitStreamEvent(args, {
        kind: 'failed',
        message: responseFailureMessage(event.response),
      });
      return;
    case 'response.incomplete':
      emitStreamEvent(args, {
        kind: 'failed',
        message: 'Response ended before it completed.',
      });
      return;
    case 'error':
      emitStreamEvent(args, {
        kind: 'failed',
        message: event.message,
      });
      return;
  }
}

function handleOutputItemStreamEvent(
  args: SharedTurnArgs,
  item: ResponseOutputItem,
  seenApprovals: Set<string>,
): void {
  if (item.type === 'mcp_call') {
    if (item.status === 'failed') {
      emitStreamEvent(args, {
        kind: 'mcp_call_failed',
        itemId: item.id,
        toolName: item.name,
        argumentsJson: stringifyToolValue(item.arguments),
        error: stringifyToolValue(item.error),
      });
      return;
    }

    if (item.status === 'completed') {
      emitStreamEvent(args, {
        kind: 'mcp_call_completed',
        itemId: item.id,
        toolName: item.name,
        argumentsJson: stringifyToolValue(item.arguments),
        output: stringifyToolValue(item.output),
      });
      return;
    }

    emitStreamEvent(args, {
      kind: 'mcp_call_started',
      itemId: item.id,
      toolName: item.name,
      argumentsJson: stringifyToolValue(item.arguments),
    });
    return;
  }

  if (item.type === 'mcp_approval_request') {
    if (seenApprovals.has(item.id)) return;
    seenApprovals.add(item.id);
    emitStreamEvent(args, {
      kind: 'approval_request',
      approval: {
        approvalRequestId: item.id,
        toolName: item.name,
        serverLabel: item.server_label,
        argumentsJson: stringifyRequiredToolValue(item.arguments),
      },
    });
    return;
  }
}

function emitStreamEvent(args: SharedTurnArgs, event: TurnStreamEvent): void {
  args.onStreamEvent?.(event);
}

function shouldRequestReasoningSummary(model: string): boolean {
  return /^(gpt-5|o1|o3|o4)/i.test(model.trim());
}

function isLikelyReasoningSummaryError(error: unknown): boolean {
  if (!(error instanceof Error)) return false;
  const message = error.message.toLowerCase();
  return (
    message.includes('reasoning') &&
    (message.includes('summary') ||
      message.includes('unsupported') ||
      message.includes('not support') ||
      message.includes('unknown parameter') ||
      message.includes('invalid'))
  );
}

function responseFailureMessage(response: CurrentResponse): string {
  return response.error?.message || 'Response failed.';
}

type ProviderMessage = {
  role: ChatRole;
  content: string;
};

const ANTHROPIC_MCP_BETA = 'mcp-client-2025-11-20';
const ANTHROPIC_API_VERSION = '2023-06-01';
const GOOGLE_RESPONSE_PREFIX = 'google';
const ANTHROPIC_RESPONSE_PREFIX = 'anthropic';

function historyToProviderMessages(history: ChatMessage[]): ProviderMessage[] {
  return history.flatMap((message) => {
    const content = message.text.trim();
    return content ? [{ role: message.role, content }] : [];
  });
}

function makeGeneratedResponseId(prefix: string): string {
  return `${prefix}_${Date.now().toString(36)}_${Math.random()
    .toString(36)
    .slice(2, 10)}`;
}

function unsafeToolDisabledConfig() {
  return {
    upsert_and_execute_unsafe_script: { enabled: false },
  };
}

function makeContextInstruction(recordId: string | null): string | undefined {
  return recordId ? `the user is currently in the record ${recordId}` : undefined;
}

async function sendAnthropicChatTurn(
  args: SendChatTurnArgs,
): Promise<SendChatTurnResult> {
  const messages = historyToProviderMessages(args.history);
  const responseId = makeGeneratedResponseId(ANTHROPIC_RESPONSE_PREFIX);
  let text = '';
  const system = makeContextInstruction(args.recordId);
  emitStreamEvent(args, { kind: 'response_started', responseId });
  const response = await fetch('https://api.anthropic.com/v1/messages', {
    method: 'POST',
    headers: {
      'content-type': 'application/json',
      'x-api-key': args.apiKey,
      'anthropic-version': ANTHROPIC_API_VERSION,
      'anthropic-beta': ANTHROPIC_MCP_BETA,
      'anthropic-dangerous-direct-browser-access': 'true',
    },
    body: JSON.stringify({
      model: args.model,
      max_tokens: 8192,
      stream: true,
      messages,
      ...(system ? { system } : {}),
      mcp_servers: [
        {
          type: 'url',
          name: 'datocms',
          url: `${MCP_BASE_URL}/`,
          authorization_token: args.datoAccessToken,
        },
      ],
      tools: [
        {
          type: 'mcp_toolset',
          mcp_server_name: 'datocms',
          configs: unsafeToolDisabledConfig(),
        },
      ],
    }),
  });

  if (!response.ok) {
    const body = await response.text().catch(() => '');
    throw new Error(
      `Provider request failed (${response.status}): ${
        body || response.statusText
      }`,
    );
  }

  for await (const event of readServerSentEvents(response)) {
    const eventType = stringProp(event, 'type');
    if (eventType === 'content_block_start') {
      const block = recordProp(event, 'content_block');
      const blockType = stringProp(block, 'type');
      if (blockType === 'text') {
        const delta = stringProp(block, 'text') ?? '';
        if (delta) {
          text += delta;
          emitStreamEvent(args, { kind: 'text_delta', delta });
        }
      } else if (blockType === 'mcp_tool_use') {
        emitStreamEvent(args, {
          kind: 'mcp_call_started',
          itemId: stringProp(block, 'id') ?? `anthropic_tool_${Date.now()}`,
          toolName: stringProp(block, 'name'),
          argumentsJson: stringifyToolValue(block?.input),
        });
      } else if (blockType === 'mcp_tool_result') {
        const output = stringifyToolValue(block?.content);
        emitStreamEvent(args, {
          kind:
            block?.is_error === true ? 'mcp_call_failed' : 'mcp_call_completed',
          itemId:
            stringProp(block, 'tool_use_id') ??
            `anthropic_tool_result_${Date.now()}`,
          ...(block?.is_error === true ? { error: output } : { output }),
        });
      }
    } else if (eventType === 'content_block_delta') {
      const delta = recordProp(event, 'delta');
      if (stringProp(delta, 'type') === 'text_delta') {
        const deltaText = stringProp(delta, 'text') ?? '';
        if (deltaText) {
          text += deltaText;
          emitStreamEvent(args, { kind: 'text_delta', delta: deltaText });
        }
      }
    } else if (eventType === 'message_stop') {
      emitStreamEvent(args, { kind: 'completed', responseId });
    }
  }

  return { responseId, text, pendingApprovals: [] };
}

async function* readServerSentEvents(
  response: globalThis.Response,
): AsyncGenerator<Record<string, unknown>> {
  if (!response.body) {
    throw new Error('Provider stream did not return a response body.');
  }

  const reader = response.body.getReader();
  const decoder = new TextDecoder();
  let buffer = '';

  while (true) {
    const { value, done } = await reader.read();
    if (done) break;
    buffer += decoder.decode(value, { stream: true });
    const events = buffer.split(/\r?\n\r?\n/);
    buffer = events.pop() ?? '';
    for (const event of events) {
      const parsed = parseServerSentEvent(event);
      if (parsed) yield parsed;
    }
  }

  buffer += decoder.decode();
  const parsed = parseServerSentEvent(buffer);
  if (parsed) yield parsed;
}

function parseServerSentEvent(rawEvent: string): Record<string, unknown> | null {
  const dataLines = rawEvent
    .split(/\r?\n/)
    .filter((line) => line.startsWith('data:'))
    .map((line) => line.slice('data:'.length).trimStart());
  if (dataLines.length === 0) return null;
  const data = dataLines.join('\n').trim();
  if (!data || data === '[DONE]') return null;
  try {
    const parsed = JSON.parse(data) as unknown;
    return parsed && typeof parsed === 'object' && !Array.isArray(parsed)
      ? (parsed as Record<string, unknown>)
      : null;
  } catch {
    return null;
  }
}

function recordProp(
  record: Record<string, unknown> | null,
  key: string,
): Record<string, unknown> | null {
  const value = record?.[key];
  return value && typeof value === 'object' && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : null;
}

function stringProp(
  record: Record<string, unknown> | null,
  key: string,
): string | undefined {
  const value = record?.[key];
  return typeof value === 'string' ? value : undefined;
}

function safeMcpClient(client: McpClient, args: SharedTurnArgs): McpClient {
  const listTools = client.listTools.bind(client);
  const callTool = client.callTool.bind(client);

  client.listTools = async (...params: Parameters<McpClient['listTools']>) => {
    emitStreamEvent(args, {
      kind: 'mcp_list_started',
      itemId: 'google_mcp_list',
    });
    const result = await listTools(...params);
    emitStreamEvent(args, {
      kind: 'mcp_list_completed',
      itemId: 'google_mcp_list',
    });
    return {
      ...result,
      tools: result.tools.filter(
        (tool) => tool.name !== MCP_APPROVAL_REQUIRED_ACTION_NAMES[0],
      ),
    };
  };

  client.callTool = async (...params: Parameters<McpClient['callTool']>) => {
    const [input] = params;
    if (input.name === MCP_APPROVAL_REQUIRED_ACTION_NAMES[0]) {
      throw new Error('This action is not available for the selected provider.');
    }
    const itemId = `google_mcp_${Date.now().toString(36)}_${Math.random()
      .toString(36)
      .slice(2, 8)}`;
    emitStreamEvent(args, {
      kind: 'mcp_call_started',
      itemId,
      toolName: input.name,
      argumentsJson: stringifyToolValue(input.arguments),
    });
    try {
      const result = await callTool(...params);
      const output = stringifyToolValue(mcpToolResultOutput(result));
      emitStreamEvent(args, {
        kind: isMcpErrorResult(result) ? 'mcp_call_failed' : 'mcp_call_completed',
        itemId,
        toolName: input.name,
        argumentsJson: stringifyToolValue(input.arguments),
        ...(isMcpErrorResult(result) ? { error: output } : { output }),
      });
      return result;
    } catch (error) {
      emitStreamEvent(args, {
        kind: 'mcp_call_failed',
        itemId,
        toolName: input.name,
        argumentsJson: stringifyToolValue(input.arguments),
        error: error instanceof Error ? error.message : String(error),
      });
      throw error;
    }
  };

  return client;
}

function isMcpErrorResult(result: Awaited<ReturnType<McpClient['callTool']>>) {
  return 'isError' in result && result.isError === true;
}

function mcpToolResultOutput(
  result: Awaited<ReturnType<McpClient['callTool']>>,
): unknown {
  if ('content' in result) return result.content;
  if ('toolResult' in result) return result.toolResult;
  return result;
}

async function sendGoogleChatTurn(
  args: SendChatTurnArgs,
): Promise<SendChatTurnResult> {
  const responseId = makeGeneratedResponseId(GOOGLE_RESPONSE_PREFIX);
  const client = new McpClient({ name: 'prompt-dato', version: '0.1.0' });
  const transport = new StreamableHTTPClientTransport(new URL(`${MCP_BASE_URL}/`), {
    requestInit: {
      headers: { Authorization: `Bearer ${args.datoAccessToken}` },
    },
  });
  let text = '';
  emitStreamEvent(args, { kind: 'response_started', responseId });

  try {
    await client.connect(transport);
    const api = new GoogleGenAI({ apiKey: args.apiKey });
    const contents = historyToGoogleContents(args.history);
    const stream = await api.models.generateContentStream({
      model: args.model,
      contents,
      config: {
        tools: [mcpToTool(safeMcpClient(client, args))],
        ...(makeContextInstruction(args.recordId)
          ? { systemInstruction: makeContextInstruction(args.recordId) }
          : {}),
      },
    });

    for await (const chunk of stream) {
      const delta = chunk.text ?? '';
      if (delta) {
        text += delta;
        emitStreamEvent(args, { kind: 'text_delta', delta });
      }
    }
  } finally {
    await client.close();
  }

  emitStreamEvent(args, { kind: 'completed', responseId });
  return { responseId, text, pendingApprovals: [] };
}

function historyToGoogleContents(history: ChatMessage[]) {
  return historyToProviderMessages(history).map((message) => ({
    role: message.role === 'assistant' ? 'model' : 'user',
    parts: [{ text: message.content }],
  }));
}

export async function sendChatTurn(
  args: SendChatTurnArgs,
): Promise<SendChatTurnResult> {
  if (args.provider === 'anthropic') {
    return sendAnthropicChatTurn(args);
  }
  if (args.provider === 'google') {
    return sendGoogleChatTurn(args);
  }

  const client = new CurrentClient({
    apiKey: args.apiKey,
    dangerouslyAllowBrowser: true,
  });

  const input = args.previousResponseId
    ? (() => {
        const last = args.history[args.history.length - 1];
        return last ? [{ role: last.role, content: last.text }] : [];
      })()
    : args.history.map((message) => ({
        role: message.role,
        content: message.text,
      }));

  const response = await createStreamingResponse({
    client,
    shared: args,
    input,
    previousResponseId: args.previousResponseId,
    eventName: 'send_chat_turn',
  });

  const result: SendChatTurnResult = {
    responseId: response.id,
    text: response.output_text ?? '',
    pendingApprovals: collectPendingApprovals(response.output),
  };

  return result;
}

export async function recoverChatTurn(
  args: RecoverChatTurnArgs,
): Promise<SendChatTurnResult> {
  const client = new CurrentClient({
    apiKey: args.apiKey,
    dangerouslyAllowBrowser: true,
  });
  const response = await recoverResponse({
    client,
    responseId: args.responseId,
    signal: args.signal,
    timeoutMs: args.timeoutMs,
    pollIntervalMs: args.pollIntervalMs,
    eventName: 'recover_chat_turn',
  });
  return responseToTurnResult(response);
}

async function recoverResponse(args: {
  client: CurrentClient;
  responseId: string;
  signal?: AbortSignal;
  timeoutMs?: number;
  pollIntervalMs?: number;
  eventName: string;
  shared?: SharedTurnArgs;
}): Promise<CurrentResponse> {
  const deadline = Date.now() + (args.timeoutMs ?? DEFAULT_RECOVERY_TIMEOUT_MS);
  const pollIntervalMs =
    args.pollIntervalMs ?? DEFAULT_RECOVERY_POLL_INTERVAL_MS;

  while (true) {
    throwIfAborted(args.signal);
    const response = await args.client.responses.retrieve(args.responseId, {}, {
      signal: args.signal,
    });
    const status = response.status ?? (response.error ? 'failed' : 'completed');

    if (status === 'completed') {
      return response;
    }

    if (status === 'failed') {
      throw new Error(responseFailureMessage(response));
    }

    if (status === 'incomplete') {
      throw new Error(responseIncompleteMessage(response));
    }

    if (status === 'cancelled') {
      throw new Error('Response was cancelled before it completed.');
    }

    if (Date.now() >= deadline) {
      throw new Error('Response is still running. Try again in a moment.');
    }

    await delay(pollIntervalMs, args.signal);
  }
}

function responseToTurnResult(response: CurrentResponse): SendChatTurnResult {
  return {
    responseId: response.id,
    text: response.output_text ?? '',
    pendingApprovals: collectPendingApprovals(response.output),
  };
}

function responseIncompleteMessage(response: CurrentResponse): string {
  const reason = response.incomplete_details?.reason;
  return reason
    ? `Response ended before it completed (${reason}).`
    : 'Response ended before it completed.';
}

function delay(ms: number, signal?: AbortSignal): Promise<void> {
  return new Promise((resolve, reject) => {
    if (signal?.aborted) {
      reject(new Error('Recovery aborted.'));
      return;
    }

    const timeout = window.setTimeout(resolve, ms);
    signal?.addEventListener(
      'abort',
      () => {
        window.clearTimeout(timeout);
        reject(new Error('Recovery aborted.'));
      },
      { once: true },
    );
  });
}

function throwIfAborted(signal?: AbortSignal): void {
  if (signal?.aborted) {
    throw new Error('Recovery aborted.');
  }
}

export async function submitApprovalDecisions(
  args: SubmitApprovalDecisionArgs,
): Promise<SendChatTurnResult> {
  return submitToolResponses({
    ...args,
    decisions: args.decisions,
  });
}

export async function submitToolResponses(
  args: SubmitToolResponsesArgs,
): Promise<SendChatTurnResult> {
  if (args.provider !== 'current') {
    throw new Error('Tool approval continuations are not available for this provider.');
  }

  const client = new CurrentClient({
    apiKey: args.apiKey,
    dangerouslyAllowBrowser: true,
  });

  const decisions = args.decisions ?? [];
  if (decisions.length === 0) {
    throw new Error('No tool responses to submit');
  }

  const response = await createStreamingResponse({
    client,
    shared: args,
    previousResponseId: args.previousResponseId,
    input: [
      ...decisions.map((d) => ({
        type: 'mcp_approval_response' as const,
        approval_request_id: d.approvalRequestId,
        approve: d.approve,
      })),
    ],
    eventName: 'submit_tool_responses',
  });

  const result: SendChatTurnResult = {
    responseId: response.id,
    text: response.output_text ?? '',
    pendingApprovals: collectPendingApprovals(response.output),
  };

  return result;
}

export function isLikelyMcpAuthError(error: unknown): boolean {
  if (!(error instanceof Error)) return false;
  const message = error.message.toLowerCase();
  return (
    message.includes('401') ||
    message.includes('invalid_token') ||
    message.includes('unauthorized') ||
    message.includes('token is not active')
  );
}

export function isLikelyPreviousResponseError(error: unknown): boolean {
  if (!(error instanceof Error)) return false;
  const message = error.message.toLowerCase();
  return (
    message.includes('previous_response_id') ||
    message.includes('previous response') ||
    (message.includes('response') && message.includes('not found')) ||
    (message.includes('response') && message.includes('expired'))
  );
}

export type ChatModelOption = {
  id: string;
};

const CHAT_MODEL_PATTERN = /^(gpt-|o1|o3|o4|chatgpt-)/i;

export async function fetchProviderModels(
  provider: ModelProvider,
  apiKey: string,
  signal?: AbortSignal,
): Promise<ChatModelOption[]> {
  if (provider === 'google') {
    return fetchGoogleModels(apiKey, signal);
  }
  if (provider === 'anthropic') {
    return fetchAnthropicModels(apiKey, signal);
  }
  return fetchCurrentProviderModels(apiKey, signal);
}

async function fetchCurrentProviderModels(
  apiKey: string,
  signal?: AbortSignal,
): Promise<ChatModelOption[]> {
  const response = await fetch('https://api.openai.com/v1/models', {
    headers: { Authorization: `Bearer ${apiKey}` },
    signal,
  });

  if (!response.ok) {
    const body = await response.text().catch(() => '');
    if (response.status === 401) {
      const error = new Error('The provider key was rejected (401).');
      derror('Provider', 'fetch_models:unauthorized', error);
      throw error;
    }
    const error = new Error(
      `Could not load models (${response.status}): ${
        body || response.statusText
      }`,
    );
    derror('Provider', 'fetch_models:failure', error, {
      status: response.status,
    });
    throw error;
  }

  const data = (await response.json()) as {
    data?: Array<{ id?: string }>;
  };
  const list = data.data ?? [];

  const ids = list
    .map((entry) => (typeof entry.id === 'string' ? entry.id : ''))
    .filter((id) => id.length > 0 && CHAT_MODEL_PATTERN.test(id));

  ids.sort((a, b) => {
    const aMajor = chatModelSortKey(a);
    const bMajor = chatModelSortKey(b);
    if (aMajor !== bMajor) return bMajor - aMajor;
    return a.localeCompare(b);
  });

  return ids.map((id) => ({ id }));
}

async function fetchGoogleModels(
  apiKey: string,
  signal?: AbortSignal,
): Promise<ChatModelOption[]> {
  const response = await fetch(
    `https://generativelanguage.googleapis.com/v1beta/models?pageSize=1000&key=${encodeURIComponent(
      apiKey,
    )}`,
    { signal },
  );
  if (!response.ok) {
    throw await modelFetchError(response);
  }
  const data = (await response.json()) as {
    models?: Array<{
      name?: string;
      supportedGenerationMethods?: string[];
    }>;
  };
  return (data.models ?? [])
    .filter((model) =>
      model.supportedGenerationMethods?.includes('generateContent'),
    )
    .map((model) => model.name?.replace(/^models\//, '') ?? '')
    .filter((id) => id.length > 0)
    .map((id) => ({ id }));
}

async function fetchAnthropicModels(
  apiKey: string,
  signal?: AbortSignal,
): Promise<ChatModelOption[]> {
  const response = await fetch('https://api.anthropic.com/v1/models?limit=1000', {
    headers: {
      'x-api-key': apiKey,
      'anthropic-version': '2023-06-01',
      'anthropic-dangerous-direct-browser-access': 'true',
    },
    signal,
  });
  if (!response.ok) {
    throw await modelFetchError(response);
  }
  const data = (await response.json()) as {
    data?: Array<{ id?: string }>;
  };
  return (data.data ?? [])
    .map((entry) => entry.id ?? '')
    .filter((id) => id.length > 0)
    .map((id) => ({ id }));
}

async function modelFetchError(response: globalThis.Response): Promise<Error> {
  const body = await response.text().catch(() => '');
  const message =
    response.status === 401 || response.status === 403
      ? `The provider key was rejected (${response.status}).`
      : `Could not load models (${response.status}): ${
          body || response.statusText
        }`;
  const error = new Error(message);
  derror('Provider', 'fetch_models:failure', error, { status: response.status });
  return error;
}

function chatModelSortKey(id: string): number {
  const match = id.match(/^gpt-(\d+)/i);
  if (match) return Number.parseInt(match[1], 10) * 100;
  if (/^o4/i.test(id)) return 40;
  if (/^o3/i.test(id)) return 30;
  if (/^o1/i.test(id)) return 10;
  if (/^chatgpt-/i.test(id)) return 50;
  return 0;
}
