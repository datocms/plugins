import { createDatoMcpClient, type DatoMcpClient } from './datoMcpClient';
import { DatoMcpAuthenticationError } from './mcpAuthentication';

export type McpAccessLevel =
  | 'content_view_only'
  | 'content_only'
  | 'unrestricted'
  | 'unknown';

export const MCP_ACCESS_CHECK_TIMEOUT_MS = 10_000;
export const MCP_ACCESS_CHANGE_URL =
  'https://dashboard.datocms.com/personal-account/account';
export const MCP_ACCESS_CHANGE_GUIDANCE =
  'To change OAuth access, revoke the authorization in your DatoCMS account settings, then reconnect. This affects all MCP clients of your account. Your project role can still limit access.';

export function mcpAccessLabel(level: McpAccessLevel): string {
  return {
    content_view_only: 'Read content only',
    content_only: 'Read and edit content',
    unrestricted: 'Same as your role',
    unknown: 'Not checked',
  }[level];
}

export function agentWritesAllowed(
  pluginReadOnly: boolean,
  level: McpAccessLevel,
): boolean {
  return (
    !pluginReadOnly && (level === 'content_only' || level === 'unrestricted')
  );
}

export function writeAccessReason(
  pluginReadOnly: boolean,
  level: McpAccessLevel,
): string {
  if (pluginReadOnly)
    return 'Read Only is enabled. An administrator must disable it before Dato Agent can make changes.';
  if (level === 'unknown')
    return 'DatoCMS access could not be verified. Read-only work is available; check access again before making changes.';
  if (level === 'content_view_only')
    return 'Your DatoCMS OAuth connection only permits reading content. Change OAuth access before making changes.';
  return '';
}

export function accessNarrowed(
  previous: McpAccessLevel,
  next: McpAccessLevel,
): boolean {
  const rank = {
    unknown: 0,
    content_view_only: 0,
    content_only: 1,
    unrestricted: 2,
  };
  return rank[next] < rank[previous];
}

function flatToonString(value: string): string | undefined {
  if (value.startsWith('"')) {
    try {
      const decoded: unknown = JSON.parse(value);
      return typeof decoded === 'string' ? decoded : undefined;
    } catch {
      return undefined;
    }
  }
  return /[:[\]{}"\n\r]/.test(value) || value.trim() !== value
    ? undefined
    : value;
}

export function oauthAccessGuidance(level: McpAccessLevel): string {
  if (level === 'content_only')
    return 'Only content operations are available. Do not prepare changes to schema, plugins, settings, environments, users, roles, API tokens, or webhooks. Project permissions can restrict content operations further.';
  if (level === 'unrestricted')
    return 'OAuth adds no restriction; project permissions and the plugin setting still apply.';
  return writeAccessReason(false, level);
}

/** Decode only the server's flat whoami TOON data, never its surrounding prose. */
export function parseMcpAccessLevel(text: string): McpAccessLevel {
  const blocks = [...text.matchAll(/^```toon\r?\n([\s\S]*?)^```[ \t]*\r?$/gm)];
  if (blocks.length !== 1) return 'unknown';
  const fields = new Map<string, string>();
  for (const line of blocks[0][1].trimEnd().split(/\r?\n/)) {
    const match = /^([a-z_]+): (.+)$/.exec(line);
    if (!match || fields.has(match[1])) return 'unknown';
    const value = flatToonString(match[2]);
    if (value === undefined) return 'unknown';
    fields.set(match[1], value);
  }
  const level = fields.get('access_level');
  return level === 'content_view_only' ||
    level === 'content_only' ||
    level === 'unrestricted'
    ? level
    : 'unknown';
}

export interface McpAccessSnapshot {
  generation: number;
  checked: boolean;
  level: McpAccessLevel;
}

function aborted(): DOMException {
  return new DOMException(
    'The DatoCMS access check was cancelled.',
    'AbortError',
  );
}

function abortable<T>(promise: Promise<T>, signal?: AbortSignal): Promise<T> {
  if (!signal) return promise;
  if (signal.aborted) return Promise.reject(aborted());
  return new Promise((resolve, reject) => {
    const cancel = () => reject(aborted());
    signal.addEventListener('abort', cancel, { once: true });
    promise
      .then(resolve, reject)
      .finally(() => signal.removeEventListener('abort', cancel));
  });
}

/** Coalesces concurrent checks, but never reuses a completed permission check. */
export class McpAccessSession {
  private token = '';
  private generation = 0;
  private pending?: {
    controller: AbortController;
    promise: Promise<McpAccessSnapshot>;
  };
  snapshot: McpAccessSnapshot = {
    generation: 0,
    checked: false,
    level: 'unknown',
  };

  constructor(
    private readonly createClient: (
      token: string,
    ) => DatoMcpClient = createDatoMcpClient,
    private readonly timeoutMs = MCP_ACCESS_CHECK_TIMEOUT_MS,
  ) {}

  setToken(token: string): void {
    if (this.token === token) return;
    this.pending?.controller.abort();
    this.pending = undefined;
    this.token = token;
    this.generation += 1;
    this.snapshot = {
      generation: this.generation,
      checked: false,
      level: 'unknown',
    };
  }

  close(): void {
    this.pending?.controller.abort();
    this.pending = undefined;
    this.generation += 1;
    this.snapshot = {
      generation: this.generation,
      checked: false,
      level: 'unknown',
    };
  }

  check(token: string, signal?: AbortSignal): Promise<McpAccessSnapshot> {
    if (signal?.aborted) return Promise.reject(aborted());
    this.setToken(token);
    if (!token) return Promise.reject(new DatoMcpAuthenticationError());
    if (!this.pending) {
      const controller = new AbortController();
      const generation = this.generation;
      const promise = this.runCheck(token, generation, controller);
      const pending = { controller, promise };
      this.pending = pending;
      void promise
        .finally(() => {
          if (this.pending === pending) this.pending = undefined;
        })
        .catch(() => undefined);
    }
    return abortable(this.pending.promise, signal);
  }

  private async runCheck(
    token: string,
    generation: number,
    controller: AbortController,
  ): Promise<McpAccessSnapshot> {
    let client: DatoMcpClient | undefined;
    let timedOut = false;
    const timeout = setTimeout(() => {
      timedOut = true;
      controller.abort();
    }, this.timeoutMs);
    try {
      client = this.createClient(token);
      const result = await abortable(
        client.callTool({ name: 'whoami', arguments: {} }, controller.signal),
        controller.signal,
      );
      if (generation !== this.generation) throw aborted();
      if (result.authenticationRequired) throw new DatoMcpAuthenticationError();
      this.snapshot = {
        generation,
        checked: true,
        level: result.isError ? 'unknown' : parseMcpAccessLevel(result.content),
      };
      return this.snapshot;
    } catch (error) {
      if (
        generation !== this.generation ||
        (controller.signal.aborted && !timedOut)
      )
        throw aborted();
      this.snapshot = { generation, checked: true, level: 'unknown' };
      if (error instanceof DatoMcpAuthenticationError) throw error;
      return this.snapshot;
    } finally {
      clearTimeout(timeout);
      void client?.close().catch(() => undefined);
    }
  }
}
