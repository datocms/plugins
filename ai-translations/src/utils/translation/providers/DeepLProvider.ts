import { ProviderError, createTimeoutSignal, DEFAULT_API_TIMEOUT_MS } from '../types';
import type { TranslationProvider, VendorId, StreamOptions, BatchTranslationOptions } from '../types';

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
    this.baseUrl = (cfg.baseUrl || 'https://api.deepl.com');
  }

  /**
   * Fetches glossary info from DeepL API with caching.
   * Returns null if the glossary doesn't exist or fetch fails.
   *
   * @param glossaryId - The glossary ID to fetch info for.
   * @returns Glossary info or null if not found/error.
   */
  private async fetchGlossaryInfo(glossaryId: string): Promise<GlossaryInfo | null> {
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
          'Authorization': `DeepL-Auth-Key ${this.apiKey}`,
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
    targetLang: string
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
  async *streamText(prompt: string, options?: StreamOptions): AsyncIterable<string> {
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
  async completeText(prompt: string, _options?: StreamOptions): Promise<string> {
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
  async translateArray(segments: string[], opts: BatchTranslationOptions): Promise<string[]> {
    if (!segments.length) return segments;

    // Validate glossary before using it - if the glossary doesn't support this
    // language pair, we skip it entirely to avoid silent failures where DeepL
    // returns the original text untranslated.
    let validatedGlossaryId = opts.glossaryId;
    if (validatedGlossaryId) {
      const isValid = await this.isGlossaryValidForPair(
        validatedGlossaryId,
        opts.sourceLang,
        opts.targetLang
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
      'Authorization': `DeepL-Auth-Key ${this.apiKey}`,
    };

    // EDGE-002: Use timeout for each batch request
    const timeoutMs = opts.timeoutMs ?? DEFAULT_API_TIMEOUT_MS;

    for (let i = 0; i < segments.length; i += batchSize) {
      const slice = segments.slice(i, i + batchSize);
      const makeBody = (injectGlossary: boolean): Record<string, unknown> => {
        const body: Record<string, unknown> = {
          text: slice,
          target_lang: opts.targetLang,
        };
        if (opts.sourceLang) body.source_lang = opts.sourceLang;
        if (opts.isHTML) body.tag_handling = 'html';
        if (opts.formality && opts.formality !== 'default') body.formality = opts.formality;
        // JSON API expects a boolean here; using '0'/'1' causes
        // "Value for 'preserve_formatting' not supported".
        body.preserve_formatting = opts.preserveFormatting !== false;
        if (opts.ignoreTags?.length) body.ignore_tags = opts.ignoreTags;
        if (opts.nonSplittingTags?.length) body.non_splitting_tags = opts.nonSplittingTags;
        if (opts.splittingTags?.length) body.splitting_tags = opts.splittingTags;
        if (injectGlossary && validatedGlossaryId) body.glossary_id = validatedGlossaryId;
        return body;
      };

      // Create timeout signal for this batch
      const { signal, cleanup } = createTimeoutSignal(timeoutMs);

      try {
        // First attempt: include glossary if provided and validated
        let res = await fetch(url, { method: 'POST', headers, body: JSON.stringify(makeBody(!!validatedGlossaryId)), signal });
        if (!res.ok) {
          let msg = res.statusText;
          let raw: any = null;
          try { raw = await res.json(); msg = raw?.message || raw?.error?.message || msg; } catch { /* JSON parse failed, use statusText */ }
          const isGlossaryMismatch = /glossary/i.test(msg) && /(language|pair|match|not found)/i.test(msg);
          // Graceful fallback: if glossary caused a 4xx, retry once without it
          if (validatedGlossaryId && isGlossaryMismatch && res.status >= 400 && res.status < 500) {
            res = await fetch(url, { method: 'POST', headers, body: JSON.stringify(makeBody(false)), signal });
          }
        }

      if (!res.ok) {
        let msg = res.statusText;
        try { const err = await res.json(); msg = err?.message || err?.error?.message || msg; } catch { /* JSON parse failed, use statusText */ }
        if (/wrong endpoint/i.test(msg)) {
          const isFreeKey = /:fx\b/i.test(this.apiKey);
          const usingPro = /api\.deepl\.com/i.test(this.baseUrl);
          const hint = isFreeKey && usingPro
            ? 'Your key looks like a Free key (:fx), but the Pro endpoint is configured. In Settings → DeepL, enable "Use DeepL Free endpoint (api-free.deepl.com)".'
            : (!isFreeKey && /api-free\.deepl\.com/i.test(this.baseUrl))
              ? 'A Pro key is being used with the Free endpoint. In Settings → DeepL, disable "Use DeepL Free endpoint" to use api.deepl.com.'
              : 'Ensure the endpoint matches your plan: api-free.deepl.com for Free (:fx) keys; api.deepl.com for Pro.';
          msg = `DeepL: wrong endpoint for your API key. ${hint}`;
        }
        throw new ProviderError(msg, res.status, 'deepl');
      }

        const data: DeepLResponse = await res.json();
        // Type-safe extraction of translated text from the response
        const translations: string[] = Array.isArray(data?.translations)
          ? data.translations.map((t: DeepLTranslation) => String(t?.text ?? ''))
          : [];
        for (let j = 0; j < slice.length; j++) out[i + j] = translations[j] ?? slice[j];
      } finally {
        cleanup();
      }
    }
    return out;
  }
}
