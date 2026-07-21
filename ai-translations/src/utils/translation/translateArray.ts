/**
 * Vendor-agnostic utility to translate an array of strings, preserving
 * placeholders and formatting tokens. Uses vendor-specific array APIs when
 * available (DeepL and Yandex) and falls back to a JSON-array prompting strategy for
 * chat models (OpenAI, Gemini, Anthropic).
 */

import type { ctxParamsType } from '../../entrypoints/Config/ConfigScreen';
import { createLogger, type Logger } from '../logging/Logger';
import { resolveGlossaryId } from './DeepLGlossary';
import { isFormalitySupported, mapDatoToDeepL } from './DeepLMap';
import {
  formatErrorForUser,
  normalizeProviderError,
} from './ProviderErrors';
import {
  type BatchTranslationOptions,
  type ProviderDebugHooks,
  ProviderConfigurationError,
  ProviderError,
  isProviderError,
  type TranslationProvider,
} from './types';

/**
 * Maximum number of segments to translate in a single API call for chat vendors.
 * DeepL uses its own batching (45 segments), but chat vendors (OpenAI, Gemini, Anthropic)
 * need chunking to handle large arrays reliably.
 */
const CHAT_VENDOR_CHUNK_SIZE = 25;

type Options = {
  isHTML?: boolean;
  formality?: 'default' | 'more' | 'less';
  recordContext?: string;
};

type ParseContext = {
  provider: string;
  fromLocale: string;
  toLocale: string;
  chunkStart?: number;
  chunkSize?: number;
};

type ParseResponseResult = {
  array: unknown[];
  repaired: boolean;
  repairedArray?: unknown[];
};

/**
 * Map of safe tokens to their original values.
 */
export type TokenMap = { safe: string; orig: string }[];

function buildProviderDebugHooks(logger: Logger): ProviderDebugHooks {
  return {
    request: (message, data) => logger.logRequest(message, data),
    response: (message, data) => logger.logResponse(message, data),
  };
}

/**
 * Replaces placeholders and variables with safe tokens to protect them during translation.
 * @param text - The input text to tokenize.
 * @returns An object containing the safe text and a map of tokens to original values.
 */
export function tokenize(text: string): { safe: string; map: TokenMap } {
  const patterns = [
    /\{\{[^}]+\}\}/g, // {{var}}
    /\{[\w.-]+\}/g, // {var} (strict simple variables only, to avoid masking ICU)
    /%[0-9]*\$?[sd]/g, // %s, %1$s
    /:[a-zA-Z_][a-zA-Z0-9_-]*/g, // :slug
  ];
  const map: TokenMap = [];
  let safe = text;
  let idx = 0;
  for (const re of patterns) {
    safe = safe.replace(re, (m) => {
      const token = `⟦PH_${idx++}⟧`;
      map.push({ safe: token, orig: m });
      return token;
    });
  }
  return { safe, map };
}

/**
 * Restores original placeholders and variables from safe tokens.
 * @param text - The text with safe tokens.
 * @param map - The map of tokens to original values.
 * @returns The text with original values restored.
 */
function detokenize(text: string, map: TokenMap): string {
  let out = text;
  for (const { safe, orig } of map) {
    out = out.split(safe).join(orig);
  }
  return out;
}

/**
 * Attempts to extract a JSON array by locating the first `[` and last `]` in text.
 * Used as a repair strategy when direct JSON.parse fails.
 *
 * @param text - Raw text that should contain a JSON array.
 * @returns The parsed array on success, or null on failure.
 */
function tryRepairJsonArray(
  text: string,
  logger: Logger,
  context: ParseContext,
): unknown[] | null {
  const start = text.indexOf('[');
  const end = text.lastIndexOf(']');
  if (start < 0 || end <= start) {
    logger.warning('Response repair skipped', {
      ...context,
      reason: 'missing-array-brackets',
      rawResponse: text,
    });
    return null;
  }

  try {
    const repaired = JSON.parse(text.slice(start, end + 1));
    if (Array.isArray(repaired)) {
      logger.info('Response repaired by extracting array brackets', {
        ...context,
        rawResponse: text,
        extractedRange: [start, end],
        repairedArray: repaired,
      });
      return repaired;
    }
  } catch (error) {
    logger.warning('Response repair failed', {
      ...context,
      originalLength: text.length,
      extractedRange: [start, end],
      rawResponse: text,
      error,
    });
  }
  return null;
}

/**
 * Parses a JSON array from the raw provider response text.
 * Attempts a bracket-extraction repair when the initial parse fails.
 *
 * @param trimmedTxt - Trimmed response text from the provider.
 * @returns The parsed array, or throws if no valid array can be recovered.
 */
function parseResponseArray(
  trimmedTxt: string,
  logger: Logger,
  context: ParseContext,
): ParseResponseResult {
  // Empty/blank response — return an empty array so length repair downstream
  // can fall back to the original segments instead of throwing. This matches
  // the contract relied on by parseTranslationResponse callers.
  if (trimmedTxt.length === 0) {
    logger.warning('Response was empty; falling back by length repair', {
      ...context,
      rawResponse: trimmedTxt,
    });
    return { array: [], repaired: false };
  }

  try {
    const parsed = JSON.parse(trimmedTxt);
    if (Array.isArray(parsed)) {
      logger.info('Parsed response array', {
        ...context,
        rawResponse: trimmedTxt,
        parsedArray: parsed,
      });
      return { array: parsed, repaired: false };
    }
    logger.warning('Parsed response was not an array', {
      ...context,
      rawResponse: trimmedTxt,
      parsed,
    });
  } catch (error) {
    logger.warning('Response JSON parse failed', {
      ...context,
      rawResponse: trimmedTxt,
      error,
    });
  }

  const repaired = tryRepairJsonArray(trimmedTxt, logger, context);
  if (repaired) {
    logger.info('Parsed response array after repair', {
      ...context,
      rawResponse: trimmedTxt,
      repairedArray: repaired,
      repairedLength: repaired.length,
    });
    return { array: repaired, repaired: true, repairedArray: repaired };
  }

  throw new Error('Model did not return a JSON array');
}

/**
 * Parses a translation response from a chat vendor and repairs common issues.
 * Handles JSON parsing, bracket extraction repair, and length mismatch repair.
 *
 * @param responseText - Raw response text from the translation provider.
 * @param originalSegments - Original segments for length repair fallback.
 * @param isHtml - Whether the segments are HTML (enables the over-split rejoin).
 * @returns Array of translated strings with the same length as originalSegments.
 */
function parseTranslationResponse(
  responseText: string,
  originalSegments: string[],
  logger: Logger,
  context: ParseContext,
  isHtml: boolean,
): string[] {
  const trimmedTxt = (responseText || '').trim();
  const parsed = parseResponseArray(trimmedTxt, logger, context);
  const arr = parsed.array;

  // Over-split repair (HTML only): a single HTML segment can come back as
  // several elements when the model splits a multi-block value (e.g. a WYSIWYG
  // field holding several <p> blocks) into one element per block. The positional
  // length repair below maps output to input by index, so it would silently drop
  // every element past the first — cropping the field. When exactly one segment
  // was sent, rejoin the returned string elements with newlines (whitespace
  // between block-level HTML elements is insignificant) instead of discarding
  // the surplus. This is gated to HTML because newlines are NOT a safe join
  // separator for single_line, slug, or json values.
  const stringParts = arr.filter((v): v is string => typeof v === 'string');
  const isOverSplitRejoin =
    isHtml && originalSegments.length === 1 && stringParts.length > 1;

  let fixed: string[];
  if (isOverSplitRejoin) {
    fixed = [stringParts.join('\n')];
    logger.warning('Model over-split a single HTML segment; rejoined elements', {
      ...context,
      rawResponse: responseText,
      parsedArray: arr,
      returnedLength: arr.length,
    });
  } else {
    // Length repair: ensure output has same length as input
    fixed = [];
    for (let i = 0; i < originalSegments.length; i++) {
      const v = arr[i];
      fixed.push(typeof v === 'string' ? v : String(originalSegments[i] ?? ''));
    }
  }

  logger.info('Final parsed response array', {
    ...context,
    rawResponse: responseText,
    parsedArray: arr,
    repaired: parsed.repaired,
    repairedArray: parsed.repairedArray,
    originalSegments,
    finalArray: fixed,
  });

  return fixed;
}

/**
 * Translates an array of string segments from one locale to another.
 * Placeholders like `{{var}}`, `{slug}` and printf-style tokens are protected
 * before sending to the provider and restored afterward.
 *
 * @param provider - Active translation provider.
 * @param pluginParams - Plugin configuration and vendor-specific flags.
 * @param segments - String segments to translate, kept in order.
 * @param fromLocale - Source locale code (e.g. "en").
 * @param toLocale - Target locale code (e.g. "pt-BR").
 * @param opts - Options such as HTML mode and formality.
 * @returns Translated segments with placeholders restored.
 */
/**
 * Builds DeepL request options while preserving its existing locale,
 * formality, formatting, tag, and glossary behavior.
 */
function buildDeepLBatchOptions(
  pluginParams: ctxParamsType,
  fromLocale: string,
  toLocale: string,
  opts: Options,
  providerDebugHooks: ProviderDebugHooks,
): BatchTranslationOptions {
  const target = mapDatoToDeepL(toLocale, 'target');
  const source = fromLocale ? mapDatoToDeepL(fromLocale, 'source') : undefined;
  const formality =
    opts.formality && isFormalitySupported(target) ? opts.formality : undefined;

  return {
    sourceLang: source,
    targetLang: target,
    isHTML: !!opts.isHTML,
    formality,
    preserveFormatting: pluginParams.deeplPreserveFormatting !== false,
    ignoreTags: ['notranslate', 'ph'],
    nonSplittingTags: ['a', 'code', 'pre', 'strong', 'em', 'ph', 'notranslate'],
    splittingTags: [],
    glossaryId: resolveGlossaryId(pluginParams, fromLocale, toLocale),
    originalSourceLocale: fromLocale,
    originalTargetLocale: toLocale,
    debug: providerDebugHooks,
  };
}

/**
 * Builds Yandex request options. Locale resolution is delegated to the
 * provider because it validates against Yandex's live language list.
 */
function buildYandexBatchOptions(
  fromLocale: string,
  toLocale: string,
  opts: Options,
  providerDebugHooks: ProviderDebugHooks,
): BatchTranslationOptions {
  return {
    sourceLang: fromLocale || undefined,
    targetLang: toLocale,
    isHTML: !!opts.isHTML,
    originalSourceLocale: fromLocale,
    originalTargetLocale: toLocale,
    debug: providerDebugHooks,
  };
}

/**
 * Returns options for a supported native provider. The explicit switch keeps
 * future native providers from accidentally inheriting DeepL semantics.
 */
function buildNativeBatchOptions(
  provider: TranslationProvider,
  pluginParams: ctxParamsType,
  fromLocale: string,
  toLocale: string,
  opts: Options,
  providerDebugHooks: ProviderDebugHooks,
): BatchTranslationOptions {
  switch (provider.vendor) {
    case 'deepl':
      return buildDeepLBatchOptions(
        pluginParams,
        fromLocale,
        toLocale,
        opts,
        providerDebugHooks,
      );
    case 'yandex':
      return buildYandexBatchOptions(
        fromLocale,
        toLocale,
        opts,
        providerDebugHooks,
      );
    default:
      throw new ProviderConfigurationError(
        provider.vendor,
        'Native batch translation is not configured for this provider.',
      );
  }
}

/**
 * Translates protected segments using a provider with a native batch API.
 *
 * @param provider - Provider with a `translateArray` method.
 * @param pluginParams - Plugin configuration with provider-specific settings.
 * @param protectedSegments - Tokenized (placeholder-safe) text segments.
 * @param fromLocale - Source locale code.
 * @param toLocale - Target locale code.
 * @param opts - Additional options (formality, HTML mode).
 * @returns Translated segments in order.
 */
async function translateWithNativeBatchProvider(
  provider: Required<Pick<TranslationProvider, 'translateArray'>> &
    TranslationProvider,
  pluginParams: ctxParamsType,
  protectedSegments: string[],
  fromLocale: string,
  toLocale: string,
  opts: Options,
  logger: Logger,
  providerDebugHooks: ProviderDebugHooks,
): Promise<string[]> {
  const requestOptions = buildNativeBatchOptions(
    provider,
    pluginParams,
    fromLocale,
    toLocale,
    opts,
    providerDebugHooks,
  );

  logger.logRequest('Native batch translation request', {
    provider: provider.vendor,
    fromLocale,
    toLocale,
    segments: protectedSegments,
    options: requestOptions,
  });

  const translated = await provider.translateArray(
    protectedSegments,
    requestOptions,
  );
  logger.logResponse('Native batch translation response', {
    provider: provider.vendor,
    fromLocale,
    toLocale,
    responseArray: translated,
  });
  return translated;
}

/**
 * Translates an array of protected segments using a chat vendor (OpenAI, Gemini, Anthropic)
 * by sending a JSON-array prompt. Large arrays are chunked for reliability.
 *
 * @param provider - Chat-based translation provider.
 * @param protectedSegments - Tokenized (placeholder-safe) text segments.
 * @param fromLocale - Source locale code.
 * @param toLocale - Target locale code.
 * @returns Translated segments in order.
 */
async function translateWithChatProvider(
  provider: TranslationProvider,
  protectedSegments: string[],
  fromLocale: string,
  toLocale: string,
  logger: Logger,
  providerDebugHooks: ProviderDebugHooks,
  isHtml: boolean,
): Promise<string[]> {
  const instruction = `Translate the following array of strings from ${fromLocale} to ${toLocale}. Return ONLY a valid JSON array of the exact same length, with a strict one-to-one mapping: each input string maps to exactly one output string. NEVER split a single input string into multiple array elements and never merge multiple inputs into one, even when a string contains newlines or multiple HTML blocks like <p>…</p><p>…</p> — translate the whole string as one element. Preserve placeholders like {foo}, {{bar}}, and tokens like ⟦PH_0⟧. You may encounter ICU Message Format strings (e.g., {gender, select, male {He said} female {She said}}). You MUST preserve the structure, keywords, and variable keys exactly. ONLY translate the human-readable content inside the brackets. Do not explain.`;

  if (protectedSegments.length <= CHAT_VENDOR_CHUNK_SIZE) {
    const prompt = `${instruction}\n${JSON.stringify(protectedSegments)}`;
    logger.logPrompt('Prompt request', prompt);
    logger.logRequest('Provider text request input', {
      provider: provider.vendor,
      fromLocale,
      toLocale,
      chunkStart: 0,
      chunkSize: protectedSegments.length,
      prompt,
      protectedSegments,
    });
    const txt = await provider.completeText(prompt, {
      debug: providerDebugHooks,
    });
    logger.logResponse('Raw provider response', {
      provider: provider.vendor,
      fromLocale,
      toLocale,
      chunkStart: 0,
      chunkSize: protectedSegments.length,
      rawResponse: txt,
    });
    return parseTranslationResponse(
      txt,
      protectedSegments,
      logger,
      {
        provider: provider.vendor,
        fromLocale,
        toLocale,
        chunkStart: 0,
        chunkSize: protectedSegments.length,
      },
      isHtml,
    );
  }

  // Chunk large arrays to improve reliability and enable partial recovery
  const translateChunk = async (chunkStart: number): Promise<string[]> => {
    const chunkSegments = protectedSegments.slice(
      chunkStart,
      chunkStart + CHAT_VENDOR_CHUNK_SIZE,
    );
    const chunkPrompt = `${instruction}\n${JSON.stringify(chunkSegments)}`;
    logger.logPrompt('Prompt request', chunkPrompt);
    logger.logRequest('Provider text request input', {
      provider: provider.vendor,
      fromLocale,
      toLocale,
      chunkStart,
      chunkSize: chunkSegments.length,
      prompt: chunkPrompt,
      protectedSegments: chunkSegments,
    });
    const chunkResponse = await provider.completeText(chunkPrompt, {
      debug: providerDebugHooks,
    });
    logger.logResponse('Raw provider response', {
      provider: provider.vendor,
      fromLocale,
      toLocale,
      chunkStart,
      chunkSize: chunkSegments.length,
      rawResponse: chunkResponse,
    });
    return parseTranslationResponse(
      chunkResponse,
      chunkSegments,
      logger,
      {
        provider: provider.vendor,
        fromLocale,
        toLocale,
        chunkStart,
        chunkSize: chunkSegments.length,
      },
      isHtml,
    );
  };

  const chunkStarts: number[] = [];
  for (let i = 0; i < protectedSegments.length; i += CHAT_VENDOR_CHUNK_SIZE) {
    chunkStarts.push(i);
  }

  return chunkStarts.reduce(async (chain, start) => {
    const accumulated = await chain;
    const chunkResults = await translateChunk(start);
    return [...accumulated, ...chunkResults];
  }, Promise.resolve<string[]>([]));
}

export async function translateArray(
  provider: TranslationProvider,
  pluginParams: ctxParamsType,
  segments: string[],
  fromLocale: string,
  toLocale: string,
  opts: Options = {},
): Promise<string[]> {
  if (!Array.isArray(segments) || segments.length === 0) return segments;

  const logger = createLogger(pluginParams, 'translateArray');
  const providerDebugHooks = buildProviderDebugHooks(logger);

  // Protect placeholders
  const tokenMaps: TokenMap[] = [];
  const protectedSegments = segments.map((s) => {
    const { safe, map } = tokenize(String(s ?? ''));
    tokenMaps.push(map);
    return safe;
  });

  logger.info('Translation batch payload', {
    provider: provider.vendor,
    fromLocale,
    toLocale,
    options: opts,
    originalSegments: segments,
    protectedSegments,
    tokenMaps,
  });

  try {
    let out: string[];

    // Use native batch translation if the provider supports it.
    if (provider.translateArray) {
      const nativeProvider = provider as Required<
        Pick<TranslationProvider, 'translateArray'>
      > &
        TranslationProvider;
      out = await translateWithNativeBatchProvider(
        nativeProvider,
        pluginParams,
        protectedSegments,
        fromLocale,
        toLocale,
        opts,
        logger,
        providerDebugHooks,
      );
    } else {
      out = await translateWithChatProvider(
        provider,
        protectedSegments,
        fromLocale,
        toLocale,
        logger,
        providerDebugHooks,
        opts.isHTML === true,
      );
    }

    // Reinsert tokens with safe fallback for tokenMaps
    const finalSegments = out.map((t, i) => {
      const tokenMap = tokenMaps[i] ?? [];
      return detokenize(String(t ?? ''), tokenMap);
    });
    logger.info('Translation batch output', {
      provider: provider.vendor,
      fromLocale,
      toLocale,
      translatedSegments: out,
      finalSegments,
      tokenMaps,
    });
    return finalSegments;
  } catch (error) {
    const norm = normalizeProviderError(error, provider.vendor);
    const message = formatErrorForUser(norm);
    // Preserve provider metadata as well as the original cause. Record-level
    // schedulers use status/vendor to distinguish fatal credentials from
    // retryable failures after this layer adds user-facing context.
    if (isProviderError(error)) {
      throw new ProviderError(
        message,
        error.status,
        error.vendor ?? provider.vendor,
        { cause: error },
      );
    }
    throw new Error(message, { cause: error });
  }
}
