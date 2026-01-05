/**
 * Vendor-agnostic utility to translate an array of strings, preserving
 * placeholders and formatting tokens. Uses vendor-specific array APIs when
 * available (DeepL) and falls back to a JSON-array prompting strategy for
 * chat models (OpenAI, Gemini, Anthropic).
 */
import type { TranslationProvider } from './types';
import type { ctxParamsType } from '../../entrypoints/Config/ConfigScreen';
import { normalizeProviderError } from './ProviderErrors';
import { mapDatoToDeepL, isFormalitySupported } from './DeepLMap';
import { resolveGlossaryId } from './DeepLGlossary';

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
    /\{[\w.-]+\}/g,     // {var} (strict simple variables only, to avoid masking ICU)
    /%[0-9]*\$?[sd]/g,  // %s, %1$s
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
 * Parses a translation response from a chat vendor and repairs common issues.
 * Handles JSON parsing, bracket extraction repair, and length mismatch repair.
 *
 * @param responseText - Raw response text from the translation provider.
 * @param originalSegments - Original segments for length repair fallback.
 * @returns Array of translated strings with the same length as originalSegments.
 */
function parseTranslationResponse(responseText: string, originalSegments: string[]): string[] {
  const trimmedTxt = (responseText || '').trim();
  let arr: unknown = [];
  let jsonRepaired = false;

  try {
    arr = JSON.parse(trimmedTxt);
  } catch {
    // Hard repair: try to extract between first [ and last ]
    // Only attempt if trimmedTxt is not empty
    if (trimmedTxt.length > 0) {
      const start = trimmedTxt.indexOf('[');
      const end = trimmedTxt.lastIndexOf(']');
      if (start >= 0 && end > start) {
        try {
          arr = JSON.parse(trimmedTxt.slice(start, end + 1));
          jsonRepaired = true;
          console.info('[translateArray] JSON repaired by extracting array brackets');
        } catch {
          // Log repair failure for debugging
          console.warn('[translateArray] JSON repair failed', {
            originalLength: trimmedTxt.length,
            extractedRange: [start, end],
          });
        }
      }
    }
  }

  if (!Array.isArray(arr)) {
    throw new Error('Model did not return a JSON array');
  }

  // Log if repair was successful
  if (jsonRepaired) {
    console.info(`[translateArray] Successfully parsed ${arr.length} segments after JSON repair`);
  }

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
export async function translateArray(
  provider: TranslationProvider,
  pluginParams: ctxParamsType,
  segments: string[],
  fromLocale: string,
  toLocale: string,
  opts: Options = {}
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
    let out: string[] = [];

    // Use native batch translation if provider supports it (e.g., DeepL)
    if (provider.translateArray) {
      const target = mapDatoToDeepL(toLocale, 'target');
      const source = fromLocale ? mapDatoToDeepL(fromLocale, 'source') : undefined;
      const formality = opts.formality && isFormalitySupported(target) ? opts.formality : undefined;
      out = await provider.translateArray(protectedSegments, {
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
    } else {
      // Chat vendors: JSON-array prompt with chunking for large arrays
      const from = fromLocale;
      const to = toLocale;
      const instruction = `Translate the following array of strings from ${from} to ${to}. Return ONLY a valid JSON array of the exact same length, preserving placeholders like {foo}, {{bar}}, and tokens like ⟦PH_0⟧. You may encounter ICU Message Format strings (e.g., {gender, select, male {He said} female {She said}}). You MUST preserve the structure, keywords, and variable keys exactly. ONLY translate the human-readable content inside the brackets. Do not explain.`;

      // Chunk large arrays to improve reliability and enable partial recovery
      if (protectedSegments.length > CHAT_VENDOR_CHUNK_SIZE) {
        const allResults: string[] = [];

        for (let i = 0; i < protectedSegments.length; i += CHAT_VENDOR_CHUNK_SIZE) {
          const chunkSegments = protectedSegments.slice(i, i + CHAT_VENDOR_CHUNK_SIZE);
          const chunkPrompt = `${instruction}\n${JSON.stringify(chunkSegments)}`;
          const chunkResponse = await provider.completeText(chunkPrompt);
          const chunkResults = parseTranslationResponse(chunkResponse, chunkSegments);
          allResults.push(...chunkResults);
        }

        out = allResults;
      } else {
        // Single call for small arrays (original behavior)
        const prompt = `${instruction}\n${JSON.stringify(protectedSegments)}`;
        const txt = await provider.completeText(prompt);
        out = parseTranslationResponse(txt, protectedSegments);
      }
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
