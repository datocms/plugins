import { resolveYandexLocale } from '../YandexMap';
import type {
  BatchTranslationOptions,
  ProviderDebugHooks,
  StreamOptions,
  TranslationProvider,
  VendorId,
} from '../types';
import {
  createTimeoutSignal,
  DEFAULT_API_TIMEOUT_MS,
  ProviderError,
} from '../types';

/** A language advertised by Yandex Translate's live language-list endpoint. */
export interface YandexLanguage {
  code: string;
  name?: string;
}

interface TranslationBatch {
  startIndex: number;
  texts: string[];
}

interface YandexApiError {
  code?: unknown;
  message: string;
  requestId?: string;
}

const CORS_PROXY_URL = 'https://cors-proxy.datocms.com';
const YANDEX_API_URL = 'https://translate.api.cloud.yandex.net';
const MAX_BATCH_CHARACTERS = 10_000;
// A small safety margin above 50 ms keeps this instance below Yandex's
// default 20-calls-per-second quota even at rolling-window boundaries.
const REQUEST_START_INTERVAL_MS = 55;

const GRPC_STATUS_TO_HTTP: Readonly<Record<number, number>> = {
  1: 499,
  2: 500,
  3: 400,
  4: 504,
  5: 404,
  6: 409,
  7: 403,
  8: 429,
  9: 400,
  10: 409,
  11: 400,
  12: 501,
  13: 500,
  14: 503,
  15: 500,
  16: 401,
};

const GRPC_NAME_TO_HTTP: Readonly<Record<string, number>> = {
  ABORTED: 409,
  ALREADY_EXISTS: 409,
  CANCELLED: 499,
  DATA_LOSS: 500,
  DEADLINE_EXCEEDED: 504,
  FAILED_PRECONDITION: 400,
  INTERNAL: 500,
  INVALID_ARGUMENT: 400,
  NOT_FOUND: 404,
  OUT_OF_RANGE: 400,
  PERMISSION_DENIED: 403,
  RESOURCE_EXHAUSTED: 429,
  UNAUTHENTICATED: 401,
  UNAVAILABLE: 503,
  UNIMPLEMENTED: 501,
  UNKNOWN: 500,
};

function toRecord(value: unknown): Record<string, unknown> | null {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return null;
  return value as Record<string, unknown>;
}

function isSuccessfulCode(code: unknown): boolean {
  return (
    code === 0 ||
    code === '0' ||
    (typeof code === 'string' && code.toUpperCase() === 'OK')
  );
}

function extractRequestId(value: unknown, depth = 0): string | undefined {
  if (depth > 5 || !value || typeof value !== 'object') return undefined;

  if (Array.isArray(value)) {
    for (const item of value) {
      const result = extractRequestId(item, depth + 1);
      if (result) return result;
    }
    return undefined;
  }

  const record = value as Record<string, unknown>;
  const direct =
    record.requestId ??
    record.request_id ??
    record['request-id'] ??
    record.xRequestId;
  if (typeof direct === 'string' && direct.trim()) return direct.trim();

  for (const nested of Object.values(record)) {
    const result = extractRequestId(nested, depth + 1);
    if (result) return result;
  }
  return undefined;
}

function extractApiError(value: unknown): YandexApiError | null {
  const root = toRecord(value);
  if (!root) return null;

  const nestedError = toRecord(root.error);
  const error = nestedError ?? root;
  const code = error.code ?? error.grpcCode ?? error.status;
  const rawMessage = error.message ?? root.message;
  const message = typeof rawMessage === 'string' ? rawMessage.trim() : '';
  const hasSuccessPayload =
    Array.isArray(root.translations) || Array.isArray(root.languages);
  const hasNonSuccessCode = code !== undefined && !isSuccessfulCode(code);
  const hasErrorMessage = !!message && !hasSuccessPayload;

  if (!nestedError && !hasNonSuccessCode && !hasErrorMessage) return null;

  return {
    code,
    message: message || 'Yandex Translate request failed.',
    requestId: extractRequestId(error) ?? extractRequestId(root),
  };
}

function statusFromApiCode(code: unknown, fallback = 500): number {
  if (typeof code === 'number') {
    if (code >= 100 && code <= 599) return code;
    return GRPC_STATUS_TO_HTTP[code] ?? fallback;
  }

  if (typeof code !== 'string') return fallback;
  const normalized = code.trim().toUpperCase();
  const numeric = Number(normalized);
  if (normalized && Number.isInteger(numeric)) {
    return statusFromApiCode(numeric, fallback);
  }
  return GRPC_NAME_TO_HTTP[normalized] ?? fallback;
}

function unicodeLength(value: string): number {
  return Array.from(value).length;
}

function buildTranslationBatches(segments: string[]): TranslationBatch[] {
  for (let index = 0; index < segments.length; index += 1) {
    const length = unicodeLength(segments[index]);
    if (length > MAX_BATCH_CHARACTERS) {
      throw new ProviderError(
        `Yandex Translate accepts at most ${MAX_BATCH_CHARACTERS.toLocaleString('en-US')} Unicode characters per request, but segment ${index + 1} contains ${length.toLocaleString('en-US')}. Shorten the field before translating it.`,
        400,
        'yandex',
      );
    }
  }

  const batches: TranslationBatch[] = [];
  let texts: string[] = [];
  let batchCharacters = 0;
  let startIndex = 0;

  for (let index = 0; index < segments.length; index += 1) {
    const segment = segments[index];
    const length = unicodeLength(segment);
    if (texts.length > 0 && batchCharacters + length > MAX_BATCH_CHARACTERS) {
      batches.push({ startIndex, texts });
      texts = [];
      batchCharacters = 0;
      startIndex = index;
    }
    texts.push(segment);
    batchCharacters += length;
  }

  if (texts.length > 0) batches.push({ startIndex, texts });
  return batches;
}

function abortError(signal: AbortSignal): unknown {
  return signal.reason instanceof Error
    ? signal.reason
    : new DOMException('Aborted', 'AbortError');
}

function waitFor(delayMs: number, signal?: AbortSignal): Promise<void> {
  if (delayMs <= 0) return Promise.resolve();
  if (signal?.aborted) return Promise.reject(abortError(signal));

  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => {
      signal?.removeEventListener('abort', onAbort);
      resolve();
    }, delayMs);
    const onAbort = () => {
      clearTimeout(timer);
      signal?.removeEventListener('abort', onAbort);
      reject(signal ? abortError(signal) : new DOMException('Aborted'));
    };
    signal?.addEventListener('abort', onAbort, { once: true });
  });
}

/**
 * Native Yandex Translate REST v2 provider.
 *
 * Requests are routed through DatoCMS's CORS proxy because Yandex's browser
 * endpoint does not answer CORS preflight requests.
 */
export default class YandexProvider implements TranslationProvider {
  public readonly vendor: VendorId = 'yandex';
  private readonly apiKey: string;
  private readonly folderId?: string;
  private languagesPromise?: Promise<YandexLanguage[]>;
  private requestStartQueue: Promise<void> = Promise.resolve();
  private nextRequestStartAt = 0;

  constructor(cfg: { apiKey: string; folderId?: string }) {
    this.apiKey = cfg.apiKey.trim();
    this.folderId = cfg.folderId?.trim() || undefined;
  }

  async *streamText(
    prompt: string,
    options?: StreamOptions,
  ): AsyncIterable<string> {
    const text = await this.completeText(prompt, options);
    if (text) yield text;
  }

  async completeText(
    prompt: string,
    options?: StreamOptions,
  ): Promise<string> {
    const translated = await this.translateSegments(
      [prompt],
      {
        targetLang: 'en',
        timeoutMs: options?.timeoutMs,
        debug: options?.debug,
      },
      options?.abortSignal,
    );
    return translated[0] ?? '';
  }

  async translateArray(
    segments: string[],
    opts: BatchTranslationOptions,
  ): Promise<string[]> {
    return this.translateSegments(segments, opts);
  }

  /**
   * Returns Yandex's current supported languages. The successful result is
   * cached for the lifetime of this credential-scoped provider instance.
   */
  async listLanguages(
    options: StreamOptions = {},
  ): Promise<YandexLanguage[]> {
    if (!this.languagesPromise) {
      this.languagesPromise = this.fetchLanguages(options).catch((error) => {
        this.languagesPromise = undefined;
        throw error;
      });
    }
    return this.languagesPromise;
  }

  /** Performs a fresh credential check without relying on the language cache. */
  async testCredentials(options: StreamOptions = {}): Promise<void> {
    await this.fetchLanguages(options);
  }

  private async translateSegments(
    segments: string[],
    opts: BatchTranslationOptions,
    abortSignal?: AbortSignal,
  ): Promise<string[]> {
    if (segments.length === 0) return [];

    // Construct all batches before the first network call. This guarantees a
    // single oversized segment cannot leave a partially translated operation.
    const batches = buildTranslationBatches(segments);
    const languages = await this.listLanguages({
      abortSignal,
      timeoutMs: opts.timeoutMs,
      debug: opts.debug,
    });
    const codes = languages.map(({ code }) => code);
    const targetLanguageCode = resolveYandexLocale(opts.targetLang, codes);
    if (!targetLanguageCode) {
      const target = opts.originalTargetLocale ?? opts.targetLang;
      throw new ProviderError(
        `Yandex Translate does not support the target locale "${target}".`,
        400,
        'yandex',
      );
    }

    const sourceLanguageCode = opts.sourceLang
      ? resolveYandexLocale(opts.sourceLang, codes)
      : undefined;
    const output = new Array<string>(segments.length);

    const translateBatch = async (batch: TranslationBatch): Promise<void> => {
      const translations = await this.executeTranslationBatch(
        batch,
        {
          sourceLanguageCode,
          targetLanguageCode,
          isHTML: opts.isHTML === true,
          timeoutMs: opts.timeoutMs,
          debug: opts.debug,
          originalSourceLocale: opts.originalSourceLocale,
          originalTargetLocale: opts.originalTargetLocale,
        },
        abortSignal,
      );
      for (let index = 0; index < translations.length; index += 1) {
        output[batch.startIndex + index] = translations[index];
      }
    };

    await batches.reduce(
      (chain, batch) => chain.then(() => translateBatch(batch)),
      Promise.resolve(),
    );
    return output;
  }

  private async fetchLanguages(
    options: StreamOptions,
  ): Promise<YandexLanguage[]> {
    const body: Record<string, unknown> = {};
    if (this.folderId) body.folderId = this.folderId;
    const raw = await this.executeJsonRequest(
      '/translate/v2/languages',
      body,
      'listLanguages',
      options.timeoutMs,
      options.abortSignal,
      options.debug,
      false,
    );
    const record = toRecord(raw);
    if (!record || !Array.isArray(record.languages)) {
      throw this.invalidResponse('language-list');
    }

    const languages: YandexLanguage[] = [];
    for (const value of record.languages) {
      const language = toRecord(value);
      if (
        !language ||
        typeof language.code !== 'string' ||
        !language.code.trim() ||
        (language.name !== undefined && typeof language.name !== 'string')
      ) {
        throw this.invalidResponse('language-list');
      }
      languages.push({
        code: language.code,
        ...(typeof language.name === 'string' ? { name: language.name } : {}),
      });
    }

    if (languages.length === 0) throw this.invalidResponse('language-list');
    return languages;
  }

  private async executeTranslationBatch(
    batch: TranslationBatch,
    options: {
      sourceLanguageCode?: string;
      targetLanguageCode: string;
      isHTML: boolean;
      timeoutMs?: number;
      debug?: ProviderDebugHooks;
      originalSourceLocale?: string;
      originalTargetLocale?: string;
    },
    abortSignal?: AbortSignal,
  ): Promise<string[]> {
    const body: Record<string, unknown> = {
      texts: batch.texts,
      targetLanguageCode: options.targetLanguageCode,
      format: options.isHTML ? 'HTML' : 'PLAIN_TEXT',
    };
    if (options.sourceLanguageCode) {
      body.sourceLanguageCode = options.sourceLanguageCode;
    }
    if (this.folderId) body.folderId = this.folderId;

    const raw = await this.executeJsonRequest(
      '/translate/v2/translate',
      body,
      'translateArray',
      options.timeoutMs,
      abortSignal,
      options.debug,
      true,
      {
        batchStartIndex: batch.startIndex,
        originalSourceLocale: options.originalSourceLocale,
        originalTargetLocale: options.originalTargetLocale,
      },
    );
    const record = toRecord(raw);
    if (!record || !Array.isArray(record.translations)) {
      throw this.invalidResponse('translation');
    }
    if (record.translations.length !== batch.texts.length) {
      throw new ProviderError(
        `Yandex Translate returned ${record.translations.length} translations for ${batch.texts.length} requested segments. No content was saved.`,
        502,
        'yandex',
      );
    }

    const translations: string[] = [];
    for (const value of record.translations) {
      const translation = toRecord(value);
      if (!translation || typeof translation.text !== 'string') {
        throw this.invalidResponse('translation');
      }
      translations.push(translation.text);
    }
    return translations;
  }

  private invalidResponse(kind: string): ProviderError {
    return new ProviderError(
      `Yandex Translate returned an invalid ${kind} response. No content was saved.`,
      502,
      'yandex',
    );
  }

  private async acquireRequestStart(signal?: AbortSignal): Promise<void> {
    const turn = this.requestStartQueue.then(async () => {
      if (signal?.aborted) throw abortError(signal);
      const delayMs = Math.max(0, this.nextRequestStartAt - Date.now());
      await waitFor(delayMs, signal);
      if (signal?.aborted) throw abortError(signal);
      this.nextRequestStartAt = Date.now() + REQUEST_START_INTERVAL_MS;
    });
    this.requestStartQueue = turn.catch(() => undefined);
    return turn;
  }

  private endpointUrl(path: string): string {
    const endpoint = `${YANDEX_API_URL}${path}`;
    return `${CORS_PROXY_URL}/?url=${encodeURIComponent(endpoint)}`;
  }

  private responseRequestId(response: Response): string | undefined {
    return (
      response.headers?.get('x-request-id') ??
      response.headers?.get('x-server-trace-id') ??
      undefined
    );
  }

  private async performFetch(
    url: string,
    body: Record<string, unknown>,
    signal: AbortSignal,
    externalSignal: AbortSignal | undefined,
    timeoutMs: number,
  ): Promise<Response> {
    try {
      return await fetch(url, {
        method: 'POST',
        headers: {
          'content-type': 'application/json',
          Authorization: `Api-Key ${this.apiKey}`,
        },
        body: JSON.stringify(body),
        signal,
      });
    } catch (error) {
      if (externalSignal?.aborted) throw abortError(externalSignal);
      if (signal.aborted) {
        throw new ProviderError(
          `Yandex Translate request timed out after ${timeoutMs.toLocaleString('en-US')} ms.`,
          408,
          'yandex',
        );
      }
      const message = error instanceof Error ? error.message : String(error);
      throw new ProviderError(
        `Yandex Translate network request failed: ${message}`,
        undefined,
        'yandex',
      );
    }
  }

  private async readResponseJson(response: Response): Promise<unknown> {
    try {
      return await response.json();
    } catch {
      const status = response.ok ? 502 : response.status;
      const message = response.ok
        ? 'Yandex Translate returned a non-JSON response.'
        : response.statusText || 'Yandex Translate request failed.';
      throw new ProviderError(message, status, 'yandex');
    }
  }

  private throwResponseError(
    response: Response,
    apiError: YandexApiError | null,
  ): never {
    const status = response.ok
      ? statusFromApiCode(apiError?.code)
      : response.status;
    const requestId = apiError?.requestId ?? this.responseRequestId(response);
    const requestIdSuffix = requestId ? ` (request ID: ${requestId})` : '';
    const message =
      apiError?.message ||
      response.statusText ||
      'Yandex Translate request failed.';
    throw new ProviderError(`${message}${requestIdSuffix}`, status, 'yandex');
  }

  private async executeJsonRequest(
    path: string,
    body: Record<string, unknown>,
    operation: string,
    timeoutMs = DEFAULT_API_TIMEOUT_MS,
    externalSignal?: AbortSignal,
    debug?: ProviderDebugHooks,
    rateLimited = false,
    debugOptions?: Record<string, unknown>,
  ): Promise<unknown> {
    if (rateLimited) await this.acquireRequestStart(externalSignal);
    const url = this.endpointUrl(path);
    const { signal, cleanup } = createTimeoutSignal(timeoutMs, externalSignal);
    debug?.request?.('Provider request', {
      provider: this.vendor,
      operation,
      url,
      body,
      options: { timeoutMs, ...debugOptions },
    });

    try {
      const response = await this.performFetch(
        url,
        body,
        signal,
        externalSignal,
        timeoutMs,
      );
      const raw = await this.readResponseJson(response);

      const apiError = extractApiError(raw);
      if (!response.ok || apiError) {
        debug?.response?.('Provider error response', {
          provider: this.vendor,
          operation,
          status: response.status,
          response: raw,
          ...debugOptions,
        });
        this.throwResponseError(response, apiError);
      }

      debug?.response?.('Provider response', {
        provider: this.vendor,
        operation,
        status: response.status,
        response: raw,
        ...debugOptions,
      });
      return raw;
    } finally {
      cleanup();
    }
  }
}
