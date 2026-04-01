import type {
  BatchTranslationOptions,
  StreamOptions,
  TranslationProvider,
  VendorId,
} from '../types';
import {
  createTimeoutSignal,
  DEFAULT_API_TIMEOUT_MS,
  ProviderError,
} from '../types';

/**
 * Type definition for a single translation in the DeepL API response.
 * This provides proper typing instead of using `any` when parsing responses.
 */
interface DeepLTranslation {
  /** The translated text */
  text: string;
  /** The detected source language (if not explicitly provided) */
  detected_source_language?: string;
}

/**
 * Type definition for the DeepL API response body.
 */
interface DeepLResponse {
  translations: DeepLTranslation[];
}

/**
 * Type definition for glossary info returned by DeepL API.
 */
interface GlossaryInfo {
  glossary_id: string;
  name: string;
  ready: boolean;
  source_lang: string;
  target_lang: string;
  creation_time: string;
  entry_count: number;
}

/** DatoCMS CORS proxy URL for making browser requests to third-party APIs */
const CORS_PROXY_URL = 'https://cors-proxy.datocms.com';

/**
 * Cache for glossary info to avoid repeated API calls.
 * Key is glossary ID, value is the glossary info.
 */
const glossaryInfoCache = new Map<string, GlossaryInfo | null>();

/**
 * Maximum number of text segments per DeepL API request.
 * DeepL's API accepts up to 50 segments, but we use 45 to stay safely within limits
 * and account for potential metadata overhead.
 */
const DEEPL_BATCH_SIZE = 45;

/**
 * DeepL API provider with native array translation support. Uses fetch
 * directly via the DatoCMS CORS proxy to handle browser CORS restrictions.
 *
 * Implements the optional `translateArray()` method from TranslationProvider
 * interface, enabling efficient batch translation via DeepL's native API.
 */
export default class DeepLProvider implements TranslationProvider {
  public readonly vendor: VendorId = 'deepl';
  private readonly apiKey: string;
  private readonly baseUrl: string;

  /**
   * Creates a DeepL provider bound to a base endpoint.
   *
   * @param cfg - API key and optional base URL.
   */
  constructor(cfg: { apiKey: string; baseUrl?: string }) {
    this.apiKey = cfg.apiKey;
    this.baseUrl = cfg.baseUrl || 'https://api.deepl.com';
  }

  /**
   * Fetches glossary info from DeepL API with caching.
   * Returns null if the glossary doesn't exist or fetch fails.
   *
   * @param glossaryId - The glossary ID to fetch info for.
   * @returns Glossary info or null if not found/error.
   */
  private async fetchGlossaryInfo(
    glossaryId: string,
  ): Promise<GlossaryInfo | null> {
    // Check cache first
    if (glossaryInfoCache.has(glossaryId)) {
      return glossaryInfoCache.get(glossaryId) ?? null;
    }

    try {
      const deeplApiUrl = `${this.baseUrl.replace(/\/$/, '')}/v2/glossaries/${glossaryId}`;
      const url = `${CORS_PROXY_URL}/?url=${encodeURIComponent(deeplApiUrl)}`;

      const res = await fetch(url, {
        method: 'GET',
        headers: {
          Authorization: `DeepL-Auth-Key ${this.apiKey}`,
        },
      });

      if (!res.ok) {
        // Glossary not found or other error - cache as null to avoid repeated calls
        glossaryInfoCache.set(glossaryId, null);
        return null;
      }

      const info: GlossaryInfo = await res.json();
      glossaryInfoCache.set(glossaryId, info);
      return info;
    } catch {
      // Network error or other issue - cache as null
      glossaryInfoCache.set(glossaryId, null);
      return null;
    }
  }

  /**
   * Checks if a glossary supports the given language pair.
   * DeepL glossaries are created for a specific source→target pair.
   *
   * @param glossaryId - The glossary ID to check.
   * @param sourceLang - The source language code (e.g., "EN").
   * @param targetLang - The target language code (e.g., "IT").
   * @returns True if the glossary supports this pair, false otherwise.
   */
  private async isGlossaryValidForPair(
    glossaryId: string,
    sourceLang: string | undefined,
    targetLang: string,
  ): Promise<boolean> {
    const info = await this.fetchGlossaryInfo(glossaryId);
    if (!info) return false;

    // Normalize language codes to uppercase for comparison
    // DeepL uses base language codes without regional variants for glossaries
    const normalizeCode = (code: string) => code.toUpperCase().split('-')[0];

    const glossarySource = normalizeCode(info.source_lang);
    const glossaryTarget = normalizeCode(info.target_lang);
    const requestTarget = normalizeCode(targetLang);
    const requestSource = sourceLang ? normalizeCode(sourceLang) : undefined;

    // Target must match
    if (glossaryTarget !== requestTarget) return false;

    // If source is specified in the request, it must match the glossary source
    if (requestSource && glossarySource !== requestSource) return false;

    return true;
  }

  /**
   * Emits a single completion to satisfy the streaming interface.
   *
   * @param prompt - Prompt text to translate.
   * @param options - Optional abort signal (unused).
   */
  async *streamText(
    prompt: string,
    options?: StreamOptions,
  ): AsyncIterable<string> {
    const txt = await this.completeText(prompt, options);
    if (txt) yield txt;
  }

  /**
   * Fallback single-string translation implemented in terms of the array API.
   *
   * @param prompt - Text to translate.
   * @param _options - Optional abort signal (unused).
   * @returns Translated text in English.
   */
  async completeText(
    prompt: string,
    _options?: StreamOptions,
  ): Promise<string> {
    // Fallback single-string translation via DeepL
    const arr = await this.translateArray([prompt], { targetLang: 'EN' });
    return arr[0] || '';
  }

  /**
   * Translates an array of segments using the DeepL JSON API via the DatoCMS CORS proxy.
   * Implements the optional translateArray method from TranslationProvider interface.
   *
   * @param segments - String segments to translate.
   * @param opts - Translation options including languages and HTML handling.
   * @returns Translated segments in order.
   */
  async translateArray(
    segments: string[],
    opts: BatchTranslationOptions,
  ): Promise<string[]> {
    if (!segments.length) return segments;

    // Validate glossary before using it - if the glossary doesn't support this
    // language pair, we skip it entirely to avoid silent failures where DeepL
    // returns the original text untranslated.
    let validatedGlossaryId = opts.glossaryId;
    if (validatedGlossaryId) {
      const isValid = await this.isGlossaryValidForPair(
        validatedGlossaryId,
        opts.sourceLang,
        opts.targetLang,
      );
      if (!isValid) {
        // Glossary doesn't support this language pair - skip it
        validatedGlossaryId = undefined;
      }
    }

    // Construct the DeepL API URL and route through the DatoCMS CORS proxy
    const deeplApiUrl = `${this.baseUrl.replace(/\/$/, '')}/v2/translate`;
    const url = `${CORS_PROXY_URL}/?url=${encodeURIComponent(deeplApiUrl)}`;

    const out: string[] = new Array(segments.length);
    const batchSize = DEEPL_BATCH_SIZE;
    const headers: Record<string, string> = {
      'content-type': 'application/json',
      Authorization: `DeepL-Auth-Key ${this.apiKey}`,
    };

    // EDGE-002: Use timeout for each batch request
    const timeoutMs = opts.timeoutMs ?? DEFAULT_API_TIMEOUT_MS;

    /**
     * Translates a single batch (slice) of segments and writes results into `out`.
     * Extracted to avoid await-in-loop lint errors in the batch iteration.
     */
    const translateBatch = async (batchStartIndex: number): Promise<void> => {
      const slice = segments.slice(
        batchStartIndex,
        batchStartIndex + batchSize,
      );
      const { signal, cleanup } = createTimeoutSignal(timeoutMs);
      try {
        await this.executeBatchRequest(
          slice,
          batchStartIndex,
          out,
          opts,
          validatedGlossaryId,
          url,
          headers,
          signal,
        );
      } finally {
        cleanup();
      }
    };

    // Build batch start indices and process them sequentially using reduce
    const batchStartIndices: number[] = [];
    for (let i = 0; i < segments.length; i += batchSize) {
      batchStartIndices.push(i);
    }
    await batchStartIndices.reduce(
      (chain, startIndex) => chain.then(() => translateBatch(startIndex)),
      Promise.resolve(),
    );

    return out;
  }

  /**
   * Builds the request body for a DeepL translation batch.
   *
   * @param slice - The text segments to translate.
   * @param opts - Translation options (language codes, formality, tags, etc.)
   * @param glossaryId - Optional glossary ID to inject when present.
   * @param injectGlossary - Whether to include the glossary ID in this request.
   * @returns The request body object ready for JSON serialization.
   */
  private buildDeepLRequestBody(
    slice: string[],
    opts: BatchTranslationOptions,
    glossaryId: string | undefined,
    injectGlossary: boolean,
  ): Record<string, unknown> {
    const body: Record<string, unknown> = {
      text: slice,
      target_lang: opts.targetLang,
    };
    if (opts.sourceLang) body.source_lang = opts.sourceLang;
    if (opts.isHTML) body.tag_handling = 'html';
    if (opts.formality && opts.formality !== 'default')
      body.formality = opts.formality;
    body.preserve_formatting = opts.preserveFormatting !== false;
    if (opts.ignoreTags?.length) body.ignore_tags = opts.ignoreTags;
    if (opts.nonSplittingTags?.length)
      body.non_splitting_tags = opts.nonSplittingTags;
    if (opts.splittingTags?.length) body.splitting_tags = opts.splittingTags;
    if (injectGlossary && glossaryId) body.glossary_id = glossaryId;
    return body;
  }

  /**
   * Extracts a human-readable error message from a raw DeepL API error response.
   *
   * @param raw - The parsed JSON error object from the API.
   * @param fallback - Fallback message to use when extraction fails.
   * @returns Resolved error message string.
   */
  private extractDeepLErrorMessage(
    raw: Record<string, unknown>,
    fallback: string,
  ): string {
    const rawMsg = raw?.message;
    const rawErrMsg =
      raw?.error &&
      typeof raw.error === 'object' &&
      (raw.error as Record<string, unknown>).message;
    return (
      (typeof rawMsg === 'string' && rawMsg) ||
      (typeof rawErrMsg === 'string' && rawErrMsg) ||
      fallback
    );
  }

  /**
   * Builds a user-friendly "wrong endpoint" error message based on API key and base URL.
   *
   * @param rawMessage - The original error message from DeepL.
   * @returns Enhanced error message with a targeted configuration hint.
   */
  private buildWrongEndpointMessage(_rawMessage: string): string {
    const isFreeKey = /:fx\b/i.test(this.apiKey);
    const usingPro = /api\.deepl\.com/i.test(this.baseUrl);
    const usingFreeEndpoint = /api-free\.deepl\.com/i.test(this.baseUrl);
    let hint: string;
    if (isFreeKey && usingPro) {
      hint =
        'Your key looks like a Free key (:fx), but the Pro endpoint is configured. In Settings → DeepL, enable "Use DeepL Free endpoint (api-free.deepl.com)".';
    } else if (!isFreeKey && usingFreeEndpoint) {
      hint =
        'A Pro key is being used with the Free endpoint. In Settings → DeepL, disable "Use DeepL Free endpoint" to use api.deepl.com.';
    } else {
      hint =
        'Ensure the endpoint matches your plan: api-free.deepl.com for Free (:fx) keys; api.deepl.com for Pro.';
    }
    return `DeepL: wrong endpoint for your API key. ${hint}`;
  }

  /**
   * Checks if a failed DeepL response is due to a glossary language mismatch.
   *
   * @param msg - The error message from DeepL.
   * @param status - The HTTP status code.
   * @param glossaryId - The glossary ID that was used in the request.
   * @returns True if the failure appears to be a glossary mismatch.
   */
  private isGlossaryMismatchError(
    msg: string,
    status: number,
    glossaryId: string | undefined,
  ): boolean {
    if (!glossaryId) return false;
    if (status < 400 || status >= 500) return false;
    return (
      /glossary/i.test(msg) && /(language|pair|match|not found)/i.test(msg)
    );
  }

  /**
   * Parses error details from a non-OK DeepL response and throws a ProviderError.
   * Adds an extra hint for wrong-endpoint errors.
   *
   * @param res - The failed fetch Response.
   * @returns Never — always throws.
   */
  private async throwDeepLError(res: Response): Promise<never> {
    let msg = res.statusText;
    try {
      const err: Record<string, unknown> = await res.json();
      msg = this.extractDeepLErrorMessage(err, msg);
    } catch {
      /* JSON parse failed, use statusText */
    }
    if (/wrong endpoint/i.test(msg)) {
      msg = this.buildWrongEndpointMessage(msg);
    }
    throw new ProviderError(msg, res.status, 'deepl');
  }

  /**
   * Executes a single batch fetch request against the DeepL API, retrying without
   * the glossary when a glossary-mismatch error is detected, then writes results
   * into the shared output array.
   *
   * @param slice - Segment strings for this batch.
   * @param batchStartIndex - Index into `out` where results should be written.
   * @param out - Shared output array to write translated strings into.
   * @param opts - Translation options (language codes, formality, tags, etc.)
   * @param glossaryId - Optional glossary ID (may be retried without it on mismatch).
   * @param url - Full proxied DeepL endpoint URL.
   * @param headers - Request headers (auth + content-type).
   * @param signal - AbortSignal for timeout cancellation.
   */
  private async executeBatchRequest(
    slice: string[],
    batchStartIndex: number,
    out: string[],
    opts: BatchTranslationOptions,
    glossaryId: string | undefined,
    url: string,
    headers: Record<string, string>,
    signal: AbortSignal,
  ): Promise<void> {
    let res = await fetch(url, {
      method: 'POST',
      headers,
      body: JSON.stringify(
        this.buildDeepLRequestBody(slice, opts, glossaryId, !!glossaryId),
      ),
      signal,
    });

    // On first failure, attempt glossary-mismatch recovery
    if (!res.ok) {
      let msg = res.statusText;
      try {
        const raw = (await res.json()) as Record<string, unknown>;
        msg = this.extractDeepLErrorMessage(raw, msg);
      } catch {
        /* JSON parse failed, use statusText */
      }

      if (this.isGlossaryMismatchError(msg, res.status, glossaryId)) {
        // Retry without the glossary to recover from language-pair mismatch
        res = await fetch(url, {
          method: 'POST',
          headers,
          body: JSON.stringify(
            this.buildDeepLRequestBody(slice, opts, glossaryId, false),
          ),
          signal,
        });
      }
    }

    if (!res.ok) {
      await this.throwDeepLError(res);
    }

    const data: DeepLResponse = await res.json();
    const translations: string[] = Array.isArray(data?.translations)
      ? data.translations.map((t: DeepLTranslation) => String(t?.text ?? ''))
      : [];
    for (let j = 0; j < slice.length; j++) {
      out[batchStartIndex + j] = translations[j] ?? slice[j];
    }
  }
}
