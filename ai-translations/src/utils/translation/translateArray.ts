/**
 * Vendor-agnostic utility to translate an array of strings, preserving
 * placeholders and formatting tokens. Uses vendor-specific array APIs when
 * available (DeepL) and falls back to a JSON-array prompting strategy for
 * chat models (OpenAI, Gemini, Anthropic).
 */

import type { ctxParamsType } from '../../entrypoints/Config/ConfigScreen';
import { resolveGlossaryId } from './DeepLGlossary';
import { isFormalitySupported, mapDatoToDeepL } from './DeepLMap';
import { normalizeProviderError } from './ProviderErrors';
import type { TranslationProvider } from './types';

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

/**
 * Map of safe tokens to their original values.
 */
export type TokenMap = { safe: string; orig: string }[];

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
function tryRepairJsonArray(text: string): unknown[] | null {
  const start = text.indexOf('[');
  const end = text.lastIndexOf(']');
  if (start < 0 || end <= start) return null;

  try {
    const repaired = JSON.parse(text.slice(start, end + 1));
    if (Array.isArray(repaired)) {
      console.info(
        '[translateArray] JSON repaired by extracting array brackets',
      );
      return repaired;
    }
  } catch {
    console.warn('[translateArray] JSON repair failed', {
      originalLength: text.length,
      extractedRange: [start, end],
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
function parseResponseArray(trimmedTxt: string): unknown[] {
  try {
    const parsed = JSON.parse(trimmedTxt);
    if (Array.isArray(parsed)) return parsed;
  } catch {
    // fall through to repair
  }

  if (trimmedTxt.length > 0) {
    const repaired = tryRepairJsonArray(trimmedTxt);
    if (repaired) {
      console.info(
        `[translateArray] Successfully parsed ${repaired.length} segments after JSON repair`,
      );
      return repaired;
    }
  }

  throw new Error('Model did not return a JSON array');
}

/**
 * Parses a translation response from a chat vendor and repairs common issues.
 * Handles JSON parsing, bracket extraction repair, and length mismatch repair.
 *
 * @param responseText - Raw response text from the translation provider.
 * @param originalSegments - Original segments for length repair fallback.
 * @returns Array of translated strings with the same length as originalSegments.
 */
function parseTranslationResponse(
  responseText: string,
  originalSegments: string[],
): string[] {
  const trimmedTxt = (responseText || '').trim();
  const arr = parseResponseArray(trimmedTxt);

  // Length repair: ensure output has same length as input
  const fixed: string[] = [];
  for (let i = 0; i < originalSegments.length; i++) {
    const v = arr[i];
    fixed.push(typeof v === 'string' ? v : String(originalSegments[i] ?? ''));
  }

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
 * Translates an array of protected segments using a provider that supports native
 * batch translation (e.g., DeepL). Maps locale codes and resolves formality/glossary options.
 *
 * @param provider - Provider with a `translateArray` method.
 * @param pluginParams - Plugin configuration for DeepL-specific settings.
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
): Promise<string[]> {
  const target = mapDatoToDeepL(toLocale, 'target');
  const source = fromLocale ? mapDatoToDeepL(fromLocale, 'source') : undefined;
  const formality =
    opts.formality && isFormalitySupported(target) ? opts.formality : undefined;

  return provider.translateArray(protectedSegments, {
    sourceLang: source,
    targetLang: target,
    isHTML: !!opts.isHTML,
    formality,
    preserveFormatting: pluginParams?.deeplPreserveFormatting !== false,
    ignoreTags: ['notranslate', 'ph'],
    nonSplittingTags: ['a', 'code', 'pre', 'strong', 'em', 'ph', 'notranslate'],
    splittingTags: [],
    glossaryId: resolveGlossaryId(pluginParams, fromLocale, toLocale),
  });
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
): Promise<string[]> {
  const instruction = `Translate the following array of strings from ${fromLocale} to ${toLocale}. Return ONLY a valid JSON array of the exact same length, preserving placeholders like {foo}, {{bar}}, and tokens like ⟦PH_0⟧. You may encounter ICU Message Format strings (e.g., {gender, select, male {He said} female {She said}}). You MUST preserve the structure, keywords, and variable keys exactly. ONLY translate the human-readable content inside the brackets. Do not explain.`;

  if (protectedSegments.length <= CHAT_VENDOR_CHUNK_SIZE) {
    const prompt = `${instruction}\n${JSON.stringify(protectedSegments)}`;
    const txt = await provider.completeText(prompt);
    return parseTranslationResponse(txt, protectedSegments);
  }

  // Chunk large arrays to improve reliability and enable partial recovery
  const translateChunk = async (chunkStart: number): Promise<string[]> => {
    const chunkSegments = protectedSegments.slice(
      chunkStart,
      chunkStart + CHAT_VENDOR_CHUNK_SIZE,
    );
    const chunkPrompt = `${instruction}\n${JSON.stringify(chunkSegments)}`;
    const chunkResponse = await provider.completeText(chunkPrompt);
    return parseTranslationResponse(chunkResponse, chunkSegments);
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

  // Protect placeholders
  const tokenMaps: TokenMap[] = [];
  const protectedSegments = segments.map((s) => {
    const { safe, map } = tokenize(String(s ?? ''));
    tokenMaps.push(map);
    return safe;
  });

  try {
    let out: string[];

    // Use native batch translation if provider supports it (e.g., DeepL)
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
      );
    } else {
      out = await translateWithChatProvider(
        provider,
        protectedSegments,
        fromLocale,
        toLocale,
      );
    }

    // Reinsert tokens with safe fallback for tokenMaps
    return out.map((t, i) => {
      const tokenMap = tokenMaps[i] ?? [];
      return detokenize(String(t ?? ''), tokenMap);
    });
  } catch (error) {
    const norm = normalizeProviderError(error, provider.vendor);
    // ERR-002: Preserve original error context in the cause chain
    throw new Error(norm.message, { cause: error });
  }
}
