import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StreamableHTTPClientTransport } from '@modelcontextprotocol/sdk/client/streamableHttp.js';
import type { RequestOptions } from '@modelcontextprotocol/sdk/shared/protocol.js';
import type {
  FetchLike,
  Transport,
} from '@modelcontextprotocol/sdk/shared/transport.js';
import {
  type DatoScriptOutcomeV1,
  extractDatoScriptOutcome,
  stripDatoScriptOutcomeMarker,
} from './datoScriptOutcome';
import { DATOCMS_MCP_URL, datoCmsMcpAllowedTools } from './mcpPolicy';

export const MAX_DATOCMS_MCP_TOOL_PAGES = 20;
export const MAX_DATOCMS_MCP_RESULT_CHARACTERS = 60_000;

export interface DatoMcpToolAnnotations {
  title?: string;
  readOnlyHint?: boolean;
  destructiveHint?: boolean;
  idempotentHint?: boolean;
  openWorldHint?: boolean;
}

/**
 * Provider-neutral tool metadata. OpenAI and Anthropic adapters can map this
 * shape to their own function-tool formats without importing MCP SDK types.
 */
export interface DatoMcpToolDescriptor {
  name: string;
  title?: string;
  description?: string;
  inputSchema: Record<string, unknown>;
  annotations?: DatoMcpToolAnnotations;
}

/**
 * A bounded, text-only result suitable for either provider's tool-result
 * message. Binary MCP content is represented by metadata, never copied into a
 * model request.
 */
export interface DatoMcpToolResult {
  content: string;
  isError: boolean;
  structuredContent?: unknown;
  datoScriptOutcome?: DatoScriptOutcomeV1;
  /** Exact transport text retained only when display normalization changes it. */
  outcomeSourceText?: string;
}

export interface DatoMcpCall {
  name: string;
  arguments: Record<string, unknown>;
}

interface SdkTool {
  name: string;
  title?: string;
  description?: string;
  inputSchema: Record<string, unknown>;
  annotations?: DatoMcpToolAnnotations;
}

interface SdkListToolsResult {
  tools: SdkTool[];
  nextCursor?: string;
}

export interface DatoMcpSdkClient {
  connect(transport: Transport, options?: RequestOptions): Promise<void>;
  listTools(
    params?: { cursor?: string },
    options?: RequestOptions,
  ): Promise<SdkListToolsResult>;
  callTool(
    params: {
      name: string;
      arguments?: Record<string, unknown>;
    },
    resultSchema?: undefined,
    options?: RequestOptions,
  ): Promise<unknown>;
  close(): Promise<void>;
}

export interface DatoMcpClient {
  listTools(signal?: AbortSignal): Promise<readonly DatoMcpToolDescriptor[]>;
  callTool(call: DatoMcpCall, signal?: AbortSignal): Promise<DatoMcpToolResult>;
  close(): Promise<void>;
}

export interface CreateDatoMcpClientOptions {
  endpoint?: string | URL;
  fetch?: FetchLike;
  maxResultCharacters?: number;
  /** Prevent unsafe-script discovery and dispatch at the transport boundary. */
  readOnly?: boolean;
  /**
   * Test/proxy seam. Production callers should let the factory construct the
   * official MCP client and Streamable HTTP transport.
   */
  client?: DatoMcpSdkClient;
  transport?: Transport;
}

const SENSITIVE_KEY_PATTERN = /\bsk-[A-Za-z0-9_-]{12,}\b/g;
const BEARER_PATTERN = /\b(Bearer\s+)[A-Za-z0-9._~+/-]+=*/gi;

class DatoMcpAbortError extends Error {
  override name = 'AbortError';
}

function abortError(): DatoMcpAbortError {
  return new DatoMcpAbortError('The DatoCMS operation was cancelled.');
}

function throwIfAborted(signal?: AbortSignal): void {
  if (signal?.aborted) {
    throw abortError();
  }
}

function redactSensitiveText(value: string): string {
  return value
    .replace(BEARER_PATTERN, '$1[redacted]')
    .replace(SENSITIVE_KEY_PATTERN, '[redacted]');
}

function boundedText(value: string, maxCharacters: number): string {
  const redacted = redactSensitiveText(value);
  if (redacted.length <= maxCharacters) {
    return redacted;
  }

  return `${redacted.slice(0, Math.max(0, maxCharacters - 14))}\n… [truncated]`;
}

function safeJson(value: unknown): string | undefined {
  const seen = new WeakSet<object>();

  try {
    return JSON.stringify(value, (_key, nested: unknown) => {
      if (typeof nested === 'string') {
        return redactSensitiveText(nested);
      }

      if (!nested || typeof nested !== 'object') {
        return nested;
      }

      if (seen.has(nested)) {
        return '[circular]';
      }
      seen.add(nested);
      return nested;
    });
  } catch {
    return undefined;
  }
}

function formatMcpResource(resourceValue: unknown): string | undefined {
  if (!isRecord(resourceValue)) {
    return safeJson(resourceValue);
  }

  const label =
    typeof resourceValue.uri === 'string'
      ? `Resource ${resourceValue.uri}`
      : 'MCP resource';
  return typeof resourceValue.text === 'string'
    ? `${label}\n${resourceValue.text}`
    : `${label} [binary content omitted]`;
}

function formatMcpContentPart(part: unknown): string | undefined {
  if (!part || typeof part !== 'object' || Array.isArray(part)) {
    return safeJson(part);
  }

  const candidate = part as Record<string, unknown>;
  switch (candidate.type) {
    case 'text':
      return typeof candidate.text === 'string' ? candidate.text : undefined;
    case 'image':
    case 'audio':
      return `[${candidate.type}${
        typeof candidate.mimeType === 'string' ? `: ${candidate.mimeType}` : ''
      } omitted]`;
    case 'resource':
      return formatMcpResource(candidate.resource);
    case 'resource_link':
      return typeof candidate.uri === 'string'
        ? `Resource link: ${candidate.uri}`
        : 'MCP resource link';
    default:
      return safeJson(candidate);
  }
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value);
}

export function serializeDatoMcpToolResult(
  result: unknown,
  maxCharacters = MAX_DATOCMS_MCP_RESULT_CHARACTERS,
): DatoMcpToolResult {
  if (!Number.isInteger(maxCharacters) || maxCharacters < 32) {
    throw new Error('maxCharacters must be an integer of at least 32.');
  }

  const candidate = isRecord(result) ? result : {};
  const isError = candidate.isError === true;
  const contentParts = Array.isArray(candidate.content)
    ? candidate.content
        .map(formatMcpContentPart)
        .filter((part): part is string => Boolean(part))
    : [];
  const serialized =
    contentParts.length > 0
      ? contentParts.join('\n\n')
      : candidate.structuredContent !== undefined
        ? safeJson(candidate.structuredContent)
        : safeJson(result);
  // Outcome markers and rolling-compatibility headings are byte-zero
  // contracts. Preserve the assembled transport text for extraction; trimming
  // first would turn an indented/spoofed marker into a trusted one.
  const rawContent = serialized || 'DatoCMS returned no content.';
  const extractedOutcome = extractDatoScriptOutcome({
    text: rawContent,
    ...(candidate.structuredContent !== undefined
      ? { structuredContent: candidate.structuredContent }
      : {}),
  });
  const normalizedDisplayContent =
    stripDatoScriptOutcomeMarker(rawContent).trim() ||
    'DatoCMS returned no content.';

  return {
    isError,
    content: boundedText(normalizedDisplayContent, maxCharacters),
    ...(rawContent !== normalizedDisplayContent
      ? { outcomeSourceText: rawContent }
      : {}),
    ...(candidate.structuredContent !== undefined
      ? { structuredContent: candidate.structuredContent }
      : {}),
    ...(extractedOutcome.outcome
      ? { datoScriptOutcome: extractedOutcome.outcome }
      : {}),
  };
}

/**
 * mcp.datocms.com currently does not include `MCP-Protocol-Version` in its
 * CORS `Access-Control-Allow-Headers` response. The MCP SDK adds that header
 * after initialization, which makes browser preflight reject otherwise valid
 * requests. Remove exactly that compatibility header while preserving every
 * other request option and header.
 */
export function createDatoMcpCorsCompatibleFetch(
  baseFetch: FetchLike = globalThis.fetch.bind(globalThis),
): FetchLike {
  return async (url, init) => {
    if (!init?.headers) {
      return await baseFetch(url, init);
    }

    const headers = new Headers(init.headers);
    headers.delete('mcp-protocol-version');
    return await baseFetch(url, { ...init, headers });
  };
}

function normalizeEndpoint(endpoint: string | URL | undefined): URL {
  const url =
    endpoint instanceof URL
      ? new URL(endpoint.toString())
      : new URL(endpoint ?? DATOCMS_MCP_URL);

  if (url.protocol !== 'https:' && url.hostname !== 'localhost') {
    throw new Error('The DatoCMS MCP endpoint must use HTTPS.');
  }

  return url;
}

function normalizeAccessToken(accessToken: string): string {
  const normalized = accessToken.trim();
  if (!normalized) {
    throw new Error('A DatoCMS MCP access token is required.');
  }

  return normalized;
}

function normalizeMaxResultCharacters(value: number | undefined): number {
  if (value === undefined) {
    return MAX_DATOCMS_MCP_RESULT_CHARACTERS;
  }

  if (!Number.isInteger(value) || value < 32) {
    throw new Error('maxResultCharacters must be an integer of at least 32.');
  }

  return value;
}

function copyAnnotations(
  annotations: DatoMcpToolAnnotations | undefined,
): DatoMcpToolAnnotations | undefined {
  if (!annotations) {
    return undefined;
  }

  return {
    ...(typeof annotations.title === 'string'
      ? { title: annotations.title }
      : {}),
    ...(typeof annotations.readOnlyHint === 'boolean'
      ? { readOnlyHint: annotations.readOnlyHint }
      : {}),
    ...(typeof annotations.destructiveHint === 'boolean'
      ? { destructiveHint: annotations.destructiveHint }
      : {}),
    ...(typeof annotations.idempotentHint === 'boolean'
      ? { idempotentHint: annotations.idempotentHint }
      : {}),
    ...(typeof annotations.openWorldHint === 'boolean'
      ? { openWorldHint: annotations.openWorldHint }
      : {}),
  };
}

function toolDescriptor(tool: SdkTool): DatoMcpToolDescriptor {
  return {
    name: tool.name,
    ...(typeof tool.title === 'string' ? { title: tool.title } : {}),
    ...(typeof tool.description === 'string'
      ? { description: tool.description }
      : {}),
    inputSchema: tool.inputSchema,
    ...(tool.annotations
      ? { annotations: copyAnnotations(tool.annotations) }
      : {}),
  };
}

class BrowserDatoMcpClient implements DatoMcpClient {
  private readonly client: DatoMcpSdkClient;
  private readonly transport: Transport;
  private readonly maxResultCharacters: number;
  private readonly allowedTools: readonly string[];
  private readonly allowedToolNames: ReadonlySet<string>;
  private connection?: Promise<void>;
  private tools?: Promise<readonly DatoMcpToolDescriptor[]>;
  private closeRequest?: Promise<void>;
  private closed = false;

  constructor(accessToken: string, options: CreateDatoMcpClientOptions) {
    const token = normalizeAccessToken(accessToken);
    this.allowedTools = datoCmsMcpAllowedTools({
      readOnly: Boolean(options.readOnly),
    });
    this.allowedToolNames = new Set(this.allowedTools);
    this.maxResultCharacters = normalizeMaxResultCharacters(
      options.maxResultCharacters,
    );
    this.transport =
      options.transport ??
      new StreamableHTTPClientTransport(normalizeEndpoint(options.endpoint), {
        requestInit: {
          headers: { Authorization: `Bearer ${token}` },
        },
        fetch: createDatoMcpCorsCompatibleFetch(options.fetch),
      });
    this.client =
      options.client ??
      new Client({
        name: 'dato-agent',
        version: '0.1.0',
      });
  }

  private ensureOpen(): void {
    if (this.closed) {
      throw new Error('The DatoCMS MCP connection is closed.');
    }
  }

  private async connect(signal?: AbortSignal): Promise<void> {
    this.ensureOpen();
    throwIfAborted(signal);

    if (!this.connection) {
      // The official Streamable HTTP transport is single-start: after a failed
      // initialization it cannot safely be started again. Keep that rejection
      // terminal for this runtime instance; a user retry constructs a fresh
      // client and transport.
      this.connection = this.client.connect(this.transport, { signal });
    }

    await this.connection;
    throwIfAborted(signal);
  }

  async listTools(
    signal?: AbortSignal,
  ): Promise<readonly DatoMcpToolDescriptor[]> {
    this.ensureOpen();
    throwIfAborted(signal);

    if (!this.tools) {
      const loadRequest = this.loadTools(signal);
      const tools = loadRequest.catch((error: unknown) => {
        if (this.tools === tools) {
          this.tools = undefined;
        }
        throw error;
      });
      this.tools = tools;
    }

    const tools = await this.tools;
    throwIfAborted(signal);
    return tools;
  }

  private async loadTools(
    signal?: AbortSignal,
  ): Promise<readonly DatoMcpToolDescriptor[]> {
    await this.connect(signal);
    const found = new Map<string, DatoMcpToolDescriptor>();
    const cursors = new Set<string>();
    let cursor: string | undefined;

    for (let page = 0; page < MAX_DATOCMS_MCP_TOOL_PAGES; page += 1) {
      throwIfAborted(signal);
      // biome-ignore lint/performance/noAwaitInLoops: MCP pagination is cursor-dependent and must remain sequential.
      const result = await this.client.listTools(
        cursor ? { cursor } : undefined,
        { signal },
      );

      for (const tool of result.tools) {
        if (
          this.allowedToolNames.has(tool.name) &&
          !found.has(tool.name) &&
          isRecord(tool.inputSchema)
        ) {
          found.set(tool.name, toolDescriptor(tool));
        }
      }

      const nextCursor = result.nextCursor?.trim();
      if (!nextCursor) {
        return this.allowedTools.flatMap((name) => {
          const descriptor = found.get(name);
          return descriptor ? [descriptor] : [];
        });
      }

      if (cursors.has(nextCursor)) {
        throw new Error(
          'DatoCMS MCP returned a repeated tool-pagination cursor.',
        );
      }
      cursors.add(nextCursor);
      cursor = nextCursor;
    }

    throw new Error(
      `DatoCMS MCP returned more than ${MAX_DATOCMS_MCP_TOOL_PAGES} pages of tools.`,
    );
  }

  async callTool(
    call: DatoMcpCall,
    signal?: AbortSignal,
  ): Promise<DatoMcpToolResult> {
    this.ensureOpen();
    throwIfAborted(signal);
    const name = call.name.trim();
    if (!this.allowedToolNames.has(name)) {
      throw new Error(
        'This DatoCMS MCP operation is not allowed by the host application.',
      );
    }
    if (!isRecord(call.arguments)) {
      throw new Error('DatoCMS MCP tool arguments must be an object.');
    }

    await this.connect(signal);
    const result = await this.client.callTool(
      { name, arguments: call.arguments },
      undefined,
      { signal },
    );
    throwIfAborted(signal);
    return serializeDatoMcpToolResult(result, this.maxResultCharacters);
  }

  close(): Promise<void> {
    if (this.closeRequest) {
      return this.closeRequest;
    }

    this.closed = true;
    this.closeRequest = (async () => {
      if (this.connection) {
        // Closing the owned SDK client aborts its transport immediately. Observe
        // a concurrent initialization rejection so it never becomes unhandled.
        void this.connection.catch(() => undefined);
      }
      await this.client.close();
    })();
    return this.closeRequest;
  }
}

export function createDatoMcpClient(
  accessToken: string,
  options: CreateDatoMcpClientOptions = {},
): DatoMcpClient {
  return new BrowserDatoMcpClient(accessToken, options);
}
