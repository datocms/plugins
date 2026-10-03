import {
  ApiError,
  buildClient,
  type Client as CmaClient,
  type SimpleSchemaTypes,
  TimeoutError,
} from '@datocms/cma-client-browser';
import type { Asset } from './optimizationUtils';

export interface AssetReplacementOptions {
  signal?: AbortSignal;
  requestTimeoutMs?: number;
  jobTimeoutMs?: number;
  jobPollIntervalMs?: number;
  maxRetries?: number;
  retryDelayMs?: number;
  maxRetryDelayMs?: number;
  reconciliationAttempts?: number;
  beforeRequest?: (signal?: AbortSignal) => Promise<void>;
  onRateLimit?: (delayMs: number) => void;
}

export class AssetChangedError extends Error {
  constructor(id: string) {
    super(`Asset ${id} changed since it was loaded. Replacement was not sent.`);
    this.name = 'AssetChangedError';
  }
}

export class UnconfirmedReplacementError extends Error {
  constructor(id: string) {
    super(
      `Replacement of asset ${id} could not be confirmed. It was not repeated; reload the asset to check its current file.`,
    );
    this.name = 'UnconfirmedReplacementError';
  }
}

export class CmaRequestTimeoutError extends Error {
  constructor() {
    super('Request timed out');
    this.name = 'CmaRequestTimeoutError';
  }
}

class UploadTransferError extends Error {
  constructor(
    readonly status: number,
    readonly retryAfter: string | null,
  ) {
    super(`File upload failed: HTTP ${status}`);
  }
}

function checkCanceled(signal?: AbortSignal): void {
  if (signal?.aborted) {
    throw new DOMException('Operation canceled', 'AbortError');
  }
}

async function boundedGate(
  gate: Promise<void>,
  timeoutMs: number,
  signal?: AbortSignal,
): Promise<void> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  let rejectWait: ((reason: Error) => void) | undefined;
  const cancel = () =>
    rejectWait?.(new DOMException('Operation canceled', 'AbortError'));
  try {
    await Promise.race([
      gate,
      new Promise<never>((_resolve, reject) => {
        rejectWait = reject;
        timer = setTimeout(
          () => reject(new CmaRequestTimeoutError()),
          Math.max(1, timeoutMs),
        );
        signal?.addEventListener('abort', cancel, { once: true });
        if (signal?.aborted) cancel();
      }),
    ]);
  } finally {
    clearTimeout(timer);
    signal?.removeEventListener('abort', cancel);
  }
}

function wait(ms: number, signal?: AbortSignal): Promise<void> {
  checkCanceled(signal);
  if (ms <= 0) return Promise.resolve();
  return new Promise((resolve, reject) => {
    const cancel = () => {
      clearTimeout(timer);
      signal?.removeEventListener('abort', cancel);
      reject(new DOMException('Operation canceled', 'AbortError'));
    };
    const timer = setTimeout(() => {
      signal?.removeEventListener('abort', cancel);
      resolve();
    }, ms);
    signal?.addEventListener('abort', cancel, { once: true });
  });
}

function retryDelay(
  header: string | null | undefined,
  fallback: number,
): number {
  if (!header) return fallback;
  const seconds = Number(header);
  if (Number.isFinite(seconds) && seconds >= 0) return seconds * 1000;
  const date = Date.parse(header);
  return Number.isFinite(date) ? Math.max(0, date - Date.now()) : fallback;
}

function isTransient(error: unknown): boolean {
  if (error instanceof ApiError) {
    return (
      error.response.status === 429 ||
      error.response.status === 408 ||
      error.response.status >= 500
    );
  }
  if (error instanceof UploadTransferError) {
    return error.status === 429 || error.status === 408 || error.status >= 500;
  }
  return (
    error instanceof TypeError ||
    error instanceof TimeoutError ||
    error instanceof CmaRequestTimeoutError
  );
}

function normalizedHeaders(
  headers: Record<string, unknown>,
): Record<string, string> {
  const result: Record<string, string> = {};
  for (const [key, value] of Object.entries(headers)) {
    if (
      typeof value === 'string' ||
      typeof value === 'number' ||
      typeof value === 'boolean'
    ) {
      result[key] = String(value);
    }
  }
  return result;
}

/** Covers the entire response body and aborts the network, unlike the SDK's promise timeout. */
async function boundedFetch(
  fetcher: typeof fetch,
  input: RequestInfo | URL,
  init: RequestInit,
  timeoutMs: number,
  signal?: AbortSignal,
  readBody = false,
): Promise<Response> {
  checkCanceled(signal);
  const controller = new AbortController();
  let timer: ReturnType<typeof setTimeout> | undefined;
  let rejectDeadline: ((reason: Error) => void) | undefined;
  const deadline = new Promise<never>((_resolve, reject) => {
    rejectDeadline = reject;
    timer = setTimeout(
      () => {
        reject(new CmaRequestTimeoutError());
        controller.abort();
      },
      Math.max(1, timeoutMs),
    );
  });
  const cancel = () => {
    rejectDeadline?.(new DOMException('Operation canceled', 'AbortError'));
    controller.abort();
  };
  signal?.addEventListener('abort', cancel, { once: true });
  try {
    const transport = fetcher(input, {
      ...init,
      signal: controller.signal,
    }).then(async (response) => {
      if (!readBody || response.status === 204) return response;
      const body = await response.text();
      return new Response(body, {
        status: response.status,
        statusText: response.statusText,
        headers: response.headers,
      });
    });
    return await Promise.race([transport, deadline]);
  } finally {
    clearTimeout(timer);
    signal?.removeEventListener('abort', cancel);
  }
}

/** Use for ordinary CMA reads too; keep per-run cancellation out of the shared client config. */
const boundedCmaFetchers = new WeakMap<typeof fetch, typeof fetch>();

export function createBoundedCmaFetch(
  fetcher: typeof fetch = globalThis.fetch,
  timeoutMs = 30000,
): typeof fetch {
  const transport: typeof fetch = (input, init) =>
    boundedFetch(
      fetcher,
      input,
      init ?? {},
      timeoutMs,
      init?.signal ?? undefined,
      true,
    );
  boundedCmaFetchers.set(transport, fetcher);
  return transport;
}

function unchanged(asset: Asset, current: SimpleSchemaTypes.Upload): boolean {
  return (
    current.id === asset.id &&
    current.path === asset.path &&
    current.size === asset.size &&
    (asset.md5 === undefined || asset.md5 === current.md5) &&
    (asset.updated_at === undefined || asset.updated_at === current.updated_at)
  );
}

function confirmed(
  upload: SimpleSchemaTypes.Upload,
  id: string,
  path: string,
  size: number,
): boolean {
  return (
    upload.type === 'upload' &&
    upload.id === id &&
    upload.path === path &&
    upload.size === size
  );
}

function boundedNumber(
  value: number | undefined,
  fallback: number,
  minimum: number,
  maximum: number,
): number {
  return Math.min(
    maximum,
    Math.max(minimum, Number.isFinite(value) ? (value ?? fallback) : fallback),
  );
}

class ReplacementSession {
  private readonly maxRetries: number;
  private readonly initialDelay: number;
  private readonly maximumDelay: number;
  private readonly requestTimeout: number;
  private readonly pollInterval: number;
  private readonly jobTimeout: number;
  private readonly gateTimeout: number;
  private readonly client: CmaClient;
  private mutationStarted = false;
  private jobAccepted = false;
  private jobDeadline: number | undefined;

  constructor(
    private readonly asset: Asset,
    private readonly blob: Blob,
    private readonly filename: string,
    sourceClient: CmaClient,
    private readonly options: AssetReplacementOptions,
  ) {
    this.maxRetries = Math.floor(boundedNumber(options.maxRetries, 3, 0, 5));
    this.initialDelay = boundedNumber(options.retryDelayMs, 1000, 0, 60000);
    this.maximumDelay = boundedNumber(
      options.maxRetryDelayMs,
      60000,
      this.initialDelay,
      60000,
    );
    this.requestTimeout = boundedNumber(
      options.requestTimeoutMs,
      30000,
      1,
      120000,
    );
    this.pollInterval = boundedNumber(
      options.jobPollIntervalMs,
      1000,
      0,
      10000,
    );
    this.jobTimeout = boundedNumber(options.jobTimeoutMs, 180000, 1, 600000);
    this.gateTimeout = Math.max(this.requestTimeout, this.maximumDelay, 60000);
    const sourceFetch = sourceClient.config.fetchFn ?? globalThis.fetch;
    // Ordinary reads already have this wrapper. The replacement session owns
    // its deadline, so unwrap only our own transport to avoid buffering twice.
    const fetcher = boundedCmaFetchers.get(sourceFetch) ?? sourceFetch;
    this.client = buildClient({
      ...sourceClient.config,
      autoRetry: false,
      // Let the abort/body deadline finish first. Failed fetches can leave this
      // SDK version's timer pending, so keep the SDK guard finite too.
      requestTimeout: this.requestTimeout + 1000,
      fetchFn: (input, init) => this.fetchCma(fetcher, input, init),
    });
    this.client.jobResultsFetcher = (id) => this.pollJob(id);
    const request = this.client.request.bind(this.client);
    this.client.request = async <T>(
      options: Parameters<CmaClient['request']>[0],
    ): Promise<T> => {
      // Admission happens before the SDK starts its HTTP timer; a queued write
      // must not be timed out by the SDK and then sent later by its fetcher.
      await this.beforeCmaRequest();
      return request<T>(options);
    };
  }

  private async beforeCmaRequest(): Promise<void> {
    const signal = this.mutationStarted ? undefined : this.options.signal;
    checkCanceled(signal);
    const gate = this.options.beforeRequest?.(signal);
    const remaining =
      this.jobDeadline === undefined
        ? this.gateTimeout
        : this.jobDeadline - Date.now();
    if (gate)
      await boundedGate(gate, Math.min(this.gateTimeout, remaining), signal);
    checkCanceled(signal);
  }

  private async fetchCma(
    fetcher: typeof fetch,
    input: RequestInfo | URL,
    init?: RequestInit,
  ): Promise<Response> {
    const signal = this.mutationStarted ? undefined : this.options.signal;
    checkCanceled(signal);
    const timeout =
      this.jobDeadline === undefined
        ? this.requestTimeout
        : Math.min(this.requestTimeout, this.jobDeadline - Date.now());
    if (timeout <= 0) throw new CmaRequestTimeoutError();
    // After sending a write, complete/reconcile that asset even if the run is canceled.
    const isMutation = init?.method === 'PUT';
    if (isMutation) this.mutationStarted = true;
    try {
      return await boundedFetch(
        fetcher,
        input,
        init ?? {},
        timeout,
        isMutation ? undefined : signal,
        true,
      );
    } catch (error) {
      if (error instanceof DOMException && error.name === 'AbortError') {
        // The installed SDK assumes error.code is a string. DOMException's
        // numeric code would otherwise mask cancellation inside request().
        const cancellation = new Error(error.message);
        cancellation.name = 'AbortError';
        throw cancellation;
      }
      throw error;
    }
  }

  private delayFor(error: unknown, attempt: number): number {
    const fallback = Math.min(
      this.maximumDelay,
      this.initialDelay * 2 ** attempt,
    );
    const header =
      error instanceof ApiError
        ? (error.response.headers['retry-after'] ??
          error.response.headers['x-ratelimit-reset'])
        : error instanceof UploadTransferError
          ? error.retryAfter
          : undefined;
    return retryDelay(header, fallback);
  }

  private async retry<T>(
    operation: () => Promise<T>,
    signal?: AbortSignal,
  ): Promise<T> {
    for (let attempt = 0; ; attempt++) {
      checkCanceled(signal);
      try {
        // biome-ignore lint/performance/noAwaitInLoops: Each bounded retry depends on the previous attempt.
        return await operation();
      } catch (error) {
        if (!isTransient(error) || attempt >= this.maxRetries) throw error;
        await this.waitRetry(error, attempt, signal);
      }
    }
  }

  private async waitRetry(
    error: unknown,
    attempt: number,
    signal?: AbortSignal,
  ): Promise<void> {
    const delay = this.delayFor(error, attempt);
    // Do not retry earlier than requested or let an unreasonable header stall the run forever.
    if (
      delay > this.maximumDelay ||
      (this.jobDeadline !== undefined && Date.now() + delay >= this.jobDeadline)
    )
      throw error;
    if (error instanceof ApiError && error.response.status === 429)
      this.options.onRateLimit?.(delay);
    await wait(delay, signal);
  }

  private async pollJob(jobId: string): Promise<SimpleSchemaTypes.JobResult> {
    this.jobAccepted = true;
    this.jobDeadline = Date.now() + this.jobTimeout;
    try {
      while (Date.now() < this.jobDeadline) {
        // biome-ignore lint/performance/noAwaitInLoops: Polls are sequential to bound traffic and await this job only.
        await wait(
          Math.min(
            this.pollInterval,
            Math.max(0, this.jobDeadline - Date.now()),
          ),
        );
        try {
          return await this.retry(() => this.client.jobResults.find(jobId));
        } catch (error) {
          if (!(error instanceof ApiError) || error.response.status !== 404)
            throw error;
        }
      }
      throw new CmaRequestTimeoutError();
    } finally {
      this.jobDeadline = undefined;
    }
  }

  private async checkOriginal(): Promise<void> {
    const current = await this.retry(
      () => this.client.uploads.find(this.asset.id),
      this.options.signal,
    );
    if (!unchanged(this.asset, current))
      throw new AssetChangedError(this.asset.id);
  }

  private async uploadBlob(): Promise<string> {
    const permission = await this.retry(
      () => this.client.uploadRequest.create({ filename: this.filename }),
      this.options.signal,
    );
    // Binary PUT is idempotent for this signed path and bytes. No ArrayBuffer copy is needed.
    await this.retry(async () => {
      const response = await boundedFetch(
        globalThis.fetch,
        permission.url,
        {
          method: 'PUT',
          headers: normalizedHeaders(permission.request_headers),
          body: this.blob,
        },
        this.requestTimeout,
        this.options.signal,
      );
      // Storage response bodies are unused; a stalled cancel must not hold a worker indefinitely.
      void response.body?.cancel().catch(() => undefined);
      if (!response.ok)
        throw new UploadTransferError(
          response.status,
          response.headers.get('retry-after'),
        );
    }, this.options.signal);
    return permission.id;
  }

  private async retryRejectedWrite(
    error: unknown,
    attempt: number,
  ): Promise<boolean> {
    // A job's failed status has the original PUT URL too; acceptance must be checked separately.
    const rejected =
      !this.jobAccepted &&
      error instanceof ApiError &&
      error.response.status === 429 &&
      error.request.method === 'PUT';
    if (!rejected || attempt >= this.maxRetries) return false;
    const delay = this.delayFor(error, attempt);
    if (delay > this.maximumDelay) throw error;
    this.mutationStarted = false;
    this.options.onRateLimit?.(delay);
    await wait(delay, this.options.signal);
    await this.checkOriginal();
    return true;
  }

  private async update(
    path: string,
  ): Promise<SimpleSchemaTypes.Upload | undefined> {
    for (let attempt = 0; ; attempt++) {
      checkCanceled(this.options.signal);
      this.jobAccepted = false;
      try {
        // biome-ignore lint/performance/noAwaitInLoops: Only direct rejected writes may be retried after completing the previous attempt.
        const updated = await this.client.uploads.update(this.asset.id, {
          path,
        });
        return confirmed(updated, this.asset.id, path, this.blob.size)
          ? updated
          : undefined;
      } catch (error) {
        if (!this.mutationStarted) throw error;
        if (await this.retryRejectedWrite(error, attempt)) continue;
        if (
          error instanceof ApiError &&
          error.response.status >= 400 &&
          error.response.status < 500 &&
          error.response.status !== 408 &&
          error.request.method === 'PUT'
        )
          throw error;
        return undefined;
      }
    }
  }

  private async reconcile(path: string): Promise<SimpleSchemaTypes.Upload> {
    const attempts = Math.floor(
      boundedNumber(this.options.reconciliationAttempts, 4, 1, 8),
    );
    for (let attempt = 0; attempt < attempts; attempt++) {
      if (attempt > 0) {
        // biome-ignore lint/performance/noAwaitInLoops: Reconciliation waits between bounded read-back attempts.
        await wait(
          Math.min(this.maximumDelay, this.initialDelay * 2 ** (attempt - 1)),
        );
      }
      try {
        const result = await this.retry(() =>
          this.client.uploads.find(this.asset.id),
        );
        if (confirmed(result, this.asset.id, path, this.blob.size))
          return result;
        if (result.path !== this.asset.path) break;
      } catch (error) {
        if (!isTransient(error)) break;
      }
    }
    throw new UnconfirmedReplacementError(this.asset.id);
  }

  async run(): Promise<SimpleSchemaTypes.Upload> {
    await this.checkOriginal();
    const path = await this.uploadBlob();
    await this.checkOriginal();
    return (await this.update(path)) ?? this.reconcile(path);
  }
}

/**
 * Replaces only the existing upload's file. IDs, references and every locale's metadata remain intact.
 * Retries reuse the Blob and signed path. An ambiguous asset write is never replayed.
 */
export function replaceAssetFromBlob(
  asset: Asset,
  blob: Blob,
  filename: string,
  sourceClient: CmaClient,
  options: AssetReplacementOptions = {},
): Promise<SimpleSchemaTypes.Upload> {
  if (!asset.id || !asset.path || !filename || blob.size === 0) {
    return Promise.reject(
      new Error('Asset, replacement file and filename are required'),
    );
  }
  return new ReplacementSession(
    asset,
    blob,
    filename,
    sourceClient,
    options,
  ).run();
}
