/**
 * Wraps `globalThis.fetch` for provider calls made by the real SDKs inside the
 * runtime. It records usage and stop reasons from each streamed response and can
 * rewrite request bodies, so evals compare request variants without changing
 * production code.
 */

export type ProviderCall = {
  provider: 'anthropic' | 'openai';
  model: string;
  maxTokens?: number;
  stopReason?: string;
  inputTokens: number;
  cacheReadTokens: number;
  cacheWriteTokens: number;
  outputTokens: number;
};

export type RequestRewrite = (
  body: Record<string, unknown>,
  headers: Headers,
) => void;

const providerOf = (url: string): ProviderCall['provider'] | undefined => {
  if (url.startsWith('https://api.anthropic.com/v1/messages'))
    return 'anthropic';
  if (url.startsWith('https://api.openai.com/v1/responses')) return 'openai';
  return undefined;
};

const numberAt = (value: unknown, key: string): number => {
  const found = (value as Record<string, unknown> | undefined)?.[key];
  return typeof found === 'number' ? found : 0;
};

/** Folds one parsed SSE `data:` payload into the call's totals. */
function absorbEvent(call: ProviderCall, event: Record<string, unknown>): void {
  if (call.provider === 'anthropic') {
    const message = event.message as Record<string, unknown> | undefined;
    const usage = (event.usage ?? message?.usage) as
      | Record<string, unknown>
      | undefined;
    if (usage) {
      call.inputTokens = Math.max(
        call.inputTokens,
        numberAt(usage, 'input_tokens'),
      );
      call.cacheReadTokens = Math.max(
        call.cacheReadTokens,
        numberAt(usage, 'cache_read_input_tokens'),
      );
      call.cacheWriteTokens = Math.max(
        call.cacheWriteTokens,
        numberAt(usage, 'cache_creation_input_tokens'),
      );
      call.outputTokens = Math.max(
        call.outputTokens,
        numberAt(usage, 'output_tokens'),
      );
    }
    const delta = event.delta as Record<string, unknown> | undefined;
    if (typeof delta?.stop_reason === 'string')
      call.stopReason = delta.stop_reason;
    return;
  }
  const response = event.response as Record<string, unknown> | undefined;
  const usage = response?.usage as Record<string, unknown> | undefined;
  if (!usage) return;
  const cached = numberAt(usage.input_tokens_details, 'cached_tokens');
  call.inputTokens = numberAt(usage, 'input_tokens') - cached;
  call.cacheReadTokens = cached;
  call.outputTokens = numberAt(usage, 'output_tokens');
  const incomplete = response?.incomplete_details as
    | Record<string, unknown>
    | undefined;
  call.stopReason =
    typeof incomplete?.reason === 'string'
      ? incomplete.reason
      : String(response?.status ?? '');
}

/** Reads a copy of the SSE stream in the background; the SDK reads the other copy. */
async function drain(stream: ReadableStream<Uint8Array>, call: ProviderCall) {
  const decoder = new TextDecoder();
  let buffer = '';
  for await (const chunk of stream) {
    buffer += decoder.decode(chunk, { stream: true });
    const lines = buffer.split('\n');
    buffer = lines.pop() ?? '';
    for (const line of lines) {
      if (!line.startsWith('data:')) continue;
      try {
        absorbEvent(call, JSON.parse(line.slice(5)));
      } catch {
        // Keep-alive or non-JSON frames.
      }
    }
  }
}

/**
 * Installs the tap and returns the calls it records plus a function that
 * restores the original fetch.
 */
export function installProviderTap(rewrite?: RequestRewrite) {
  const originalFetch = globalThis.fetch;
  const calls: ProviderCall[] = [];
  const pending: Promise<void>[] = [];

  globalThis.fetch = async (input, init) => {
    const request = new Request(input, init);
    const provider = providerOf(request.url);
    if (!provider || request.method !== 'POST')
      return originalFetch(input, init);

    const body = (await request.json()) as Record<string, unknown>;
    const headers = new Headers(request.headers);
    rewrite?.(body, headers);
    const call: ProviderCall = {
      provider,
      model: String(body.model),
      maxTokens:
        typeof body.max_tokens === 'number'
          ? body.max_tokens
          : typeof body.max_output_tokens === 'number'
            ? body.max_output_tokens
            : undefined,
      inputTokens: 0,
      cacheReadTokens: 0,
      cacheWriteTokens: 0,
      outputTokens: 0,
    };
    calls.push(call);

    const response = await originalFetch(request.url, {
      method: 'POST',
      headers,
      body: JSON.stringify(body),
      signal: request.signal,
    }).catch((error: unknown) => {
      // The runtime maps network failures to a generic message; keep the real cause.
      call.stopReason = `fetch_error: ${error instanceof Error ? `${error.message} ${String((error as { cause?: unknown }).cause ?? '')}` : String(error)}`;
      throw error;
    });
    if (!response.ok) call.stopReason = `http_${response.status}`;
    if (!response.body) return response;
    const [forSdk, forTap] = response.body.tee();
    pending.push(drain(forTap, call).catch(() => undefined));
    return new Response(forSdk, {
      status: response.status,
      statusText: response.statusText,
      headers: response.headers,
    });
  };

  return {
    calls,
    /** Waits for every tapped stream to finish, then puts the original fetch back. */
    async restore() {
      await Promise.all(pending);
      globalThis.fetch = originalFetch;
    },
  };
}
