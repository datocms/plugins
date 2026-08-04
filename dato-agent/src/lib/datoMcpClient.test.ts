import type { Transport } from '@modelcontextprotocol/sdk/shared/transport.js';
import { describe, expect, it, vi } from 'vitest';
import {
  createDatoMcpClient,
  createDatoMcpCorsCompatibleFetch,
  type DatoMcpSdkClient,
  MAX_DATOCMS_MCP_TOOL_PAGES,
  serializeDatoMcpToolResult,
} from './datoMcpClient';

function fakeTransport(): Transport {
  return {
    start: vi.fn().mockResolvedValue(undefined),
    send: vi.fn().mockResolvedValue(undefined),
    close: vi.fn().mockResolvedValue(undefined),
  };
}

function fakeSdkClient() {
  const connect = vi.fn().mockResolvedValue(undefined);
  const listTools = vi.fn().mockResolvedValue({
    tools: [],
  });
  const callTool = vi.fn().mockResolvedValue({
    content: [{ type: 'text', text: 'Done' }],
  });
  const close = vi.fn().mockResolvedValue(undefined);

  return {
    connect,
    listTools,
    callTool,
    close,
    client: {
      connect,
      listTools,
      callTool,
      close,
    } as DatoMcpSdkClient,
  };
}

describe('DatoMcpClient', () => {
  it('removes only the protocol-version header from browser requests', async () => {
    const baseFetch = vi.fn().mockResolvedValue(new Response('ok'));
    const compatibleFetch = createDatoMcpCorsCompatibleFetch(baseFetch);
    const controller = new AbortController();

    await compatibleFetch('https://mcp.datocms.com/', {
      method: 'POST',
      body: '{"jsonrpc":"2.0"}',
      signal: controller.signal,
      headers: [
        ['Authorization', 'Bearer oauth-token'],
        ['Content-Type', 'application/json'],
        ['MCP-Protocol-Version', '2025-11-25'],
        ['X-Keep-Me', 'yes'],
      ],
    });

    expect(baseFetch).toHaveBeenCalledOnce();
    const [url, init] = baseFetch.mock.calls[0] as [string, RequestInit];
    const headers = new Headers(init.headers);
    expect(url).toBe('https://mcp.datocms.com/');
    expect(init.method).toBe('POST');
    expect(init.body).toBe('{"jsonrpc":"2.0"}');
    expect(init.signal).toBe(controller.signal);
    expect(headers.get('authorization')).toBe('Bearer oauth-token');
    expect(headers.get('content-type')).toBe('application/json');
    expect(headers.get('x-keep-me')).toBe('yes');
    expect(headers.has('mcp-protocol-version')).toBe(false);
  });

  it('leaves requests without headers untouched', async () => {
    const baseFetch = vi.fn().mockResolvedValue(new Response('ok'));
    const compatibleFetch = createDatoMcpCorsCompatibleFetch(baseFetch);
    const init = { method: 'GET' };

    await compatibleFetch('https://mcp.datocms.com/', init);

    expect(baseFetch).toHaveBeenCalledWith('https://mcp.datocms.com/', init);
  });

  it('connects once, paginates, filters, and orders the DatoCMS allowlist', async () => {
    const sdk = fakeSdkClient();
    const controller = new AbortController();
    sdk.listTools
      .mockResolvedValueOnce({
        tools: [
          {
            name: 'get_schema',
            description: 'Read schema',
            title: 'Schema',
            inputSchema: {
              type: 'object',
              properties: { site_id: { type: 'string' } },
            },
            annotations: {
              readOnlyHint: true,
              destructiveHint: false,
              unsupported: 'drop this',
            },
          },
          {
            name: 'search_projects',
            inputSchema: { type: 'object' },
          },
          {
            name: 'unknown_tool',
            inputSchema: { type: 'object' },
          },
        ],
        nextCursor: 'page-2',
      })
      .mockResolvedValueOnce({
        tools: [
          {
            name: 'whoami',
            inputSchema: { type: 'object' },
          },
          {
            name: 'list_api_resources',
            inputSchema: { type: 'object' },
          },
        ],
      });
    const transport = fakeTransport();
    const client = createDatoMcpClient(' oauth-token ', {
      client: sdk.client,
      transport,
    });

    const tools = await client.listTools(controller.signal);
    const cachedTools = await client.listTools(controller.signal);

    expect(tools.map((tool) => tool.name)).toEqual([
      'list_api_resources',
      'get_schema',
      'whoami',
    ]);
    expect(tools[1]).toEqual({
      name: 'get_schema',
      title: 'Schema',
      description: 'Read schema',
      inputSchema: {
        type: 'object',
        properties: { site_id: { type: 'string' } },
      },
      annotations: {
        readOnlyHint: true,
        destructiveHint: false,
      },
    });
    expect(cachedTools).toBe(tools);
    expect(sdk.connect).toHaveBeenCalledOnce();
    expect(sdk.connect).toHaveBeenCalledWith(transport, {
      signal: controller.signal,
    });
    expect(sdk.listTools).toHaveBeenNthCalledWith(1, undefined, {
      signal: controller.signal,
    });
    expect(sdk.listTools).toHaveBeenNthCalledWith(
      2,
      { cursor: 'page-2' },
      { signal: controller.signal },
    );
  });

  it('calls only allowed tools, forwards cancellation, and bounds the result', async () => {
    const sdk = fakeSdkClient();
    const controller = new AbortController();
    sdk.callTool.mockResolvedValue({
      isError: true,
      content: [
        {
          type: 'text',
          text: `Could not run with Bearer oauth-secret and sk-${'x'.repeat(
            20,
          )}. ${'z'.repeat(200)}`,
        },
        {
          type: 'image',
          mimeType: 'image/png',
          data: 'large-base64-data',
        },
      ],
    });
    const client = createDatoMcpClient('oauth-token', {
      client: sdk.client,
      transport: fakeTransport(),
      maxResultCharacters: 120,
    });
    const call = {
      name: 'get_schema',
      arguments: { site_id: 'site-1', fields_details: 'basic' },
    };

    const result = await client.callTool(call, controller.signal);

    expect(sdk.callTool).toHaveBeenCalledWith(call, undefined, {
      signal: controller.signal,
    });
    expect(result.isError).toBe(true);
    expect(result.content.length).toBeLessThanOrEqual(120);
    expect(result.content).toContain('Bearer [redacted]');
    expect(result.content).toContain('[redacted]');
    expect(result.content).not.toContain('oauth-secret');
    expect(result.content).not.toContain('large-base64-data');
    expect(result.content).toContain('… [truncated]');
  });

  it('blocks excluded and unknown tools before connecting', async () => {
    const sdk = fakeSdkClient();
    const client = createDatoMcpClient('oauth-token', {
      client: sdk.client,
      transport: fakeTransport(),
    });

    await expect(
      client.callTool({ name: 'search_projects', arguments: {} }),
    ).rejects.toThrow('not allowed');
    await expect(
      client.callTool({ name: 'made_up_operation', arguments: {} }),
    ).rejects.toThrow('not allowed');
    expect(sdk.connect).not.toHaveBeenCalled();
    expect(sdk.callTool).not.toHaveBeenCalled();
  });

  it('serializes text, resources, structured content, cycles, and empty results', () => {
    expect(
      serializeDatoMcpToolResult({
        content: [
          { type: 'text', text: 'First' },
          {
            type: 'resource',
            resource: {
              uri: 'dato://record/1',
              text: 'Second',
            },
          },
          {
            type: 'audio',
            mimeType: 'audio/mpeg',
            data: 'binary',
          },
        ],
      }),
    ).toEqual({
      isError: false,
      content:
        'First\n\nResource dato://record/1\nSecond\n\n[audio: audio/mpeg omitted]',
    });
    expect(
      serializeDatoMcpToolResult({
        structuredContent: { count: 2, ok: true },
      }),
    ).toEqual({
      isError: false,
      content: '{"count":2,"ok":true}',
    });

    const cyclic: Record<string, unknown> = { ok: true };
    cyclic.self = cyclic;
    expect(serializeDatoMcpToolResult(cyclic).content).toContain('[circular]');
    expect(serializeDatoMcpToolResult(undefined)).toEqual({
      isError: false,
      content: 'DatoCMS returned no content.',
    });
  });

  it('fails fast for a pre-aborted request without touching the SDK', async () => {
    const sdk = fakeSdkClient();
    const controller = new AbortController();
    controller.abort();
    const client = createDatoMcpClient('oauth-token', {
      client: sdk.client,
      transport: fakeTransport(),
    });

    await expect(client.listTools(controller.signal)).rejects.toMatchObject({
      name: 'AbortError',
    });
    await expect(
      client.callTool({ name: 'whoami', arguments: {} }, controller.signal),
    ).rejects.toMatchObject({ name: 'AbortError' });
    expect(sdk.connect).not.toHaveBeenCalled();
  });

  it('keeps a failed single-start transport terminal within one client', async () => {
    const sdk = fakeSdkClient();
    sdk.connect.mockRejectedValue(new Error('Temporary connection failure'));
    const client = createDatoMcpClient('oauth-token', {
      client: sdk.client,
      transport: fakeTransport(),
    });

    await expect(client.listTools()).rejects.toThrow(
      'Temporary connection failure',
    );
    await expect(client.listTools()).rejects.toThrow(
      'Temporary connection failure',
    );
    expect(sdk.connect).toHaveBeenCalledOnce();
  });

  it('rejects repeated cursors and excessive pagination', async () => {
    const repeated = fakeSdkClient();
    repeated.listTools.mockResolvedValue({
      tools: [],
      nextCursor: 'same',
    });
    const repeatedClient = createDatoMcpClient('oauth-token', {
      client: repeated.client,
      transport: fakeTransport(),
    });

    await expect(repeatedClient.listTools()).rejects.toThrow(
      'repeated tool-pagination cursor',
    );

    const excessive = fakeSdkClient();
    excessive.listTools.mockImplementation(async (_params) => ({
      tools: [],
      nextCursor: `page-${excessive.listTools.mock.calls.length}`,
    }));
    const excessiveClient = createDatoMcpClient('oauth-token', {
      client: excessive.client,
      transport: fakeTransport(),
    });

    await expect(excessiveClient.listTools()).rejects.toThrow(
      `more than ${MAX_DATOCMS_MCP_TOOL_PAGES} pages`,
    );
  });

  it('closes the owned SDK client exactly once and cannot be reused', async () => {
    const sdk = fakeSdkClient();
    const client = createDatoMcpClient('oauth-token', {
      client: sdk.client,
      transport: fakeTransport(),
    });
    await client.listTools();

    const firstClose = client.close();
    const secondClose = client.close();
    expect(secondClose).toBe(firstClose);
    await firstClose;

    expect(sdk.close).toHaveBeenCalledOnce();
    await expect(client.listTools()).rejects.toThrow('connection is closed');
    await expect(
      client.callTool({ name: 'whoami', arguments: {} }),
    ).rejects.toThrow('connection is closed');
  });

  it('validates credentials, endpoints, and result bounds', () => {
    expect(() => createDatoMcpClient('  ')).toThrow('access token is required');
    expect(() =>
      createDatoMcpClient('token', {
        endpoint: 'http://example.com/',
      }),
    ).toThrow('must use HTTPS');
    expect(() =>
      createDatoMcpClient('token', {
        maxResultCharacters: 12,
      }),
    ).toThrow('at least 32');
    expect(() => serializeDatoMcpToolResult({}, 12)).toThrow('at least 32');
  });
});
