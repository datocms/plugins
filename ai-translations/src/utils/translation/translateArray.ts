/**
 * Vendor-agnostic utility to translate an array of strings, preserving
 * placeholders and formatting tokens. Uses vendor-specific array APIs when
 * available (DeepL) and falls back to a JSON-array prompting strategy for
 * chat models (OpenAI, Gemini, Anthropic).
 */

import type { ctxParamsType } from '../../entrypoints/Config/ConfigScreen';
import { createLogger, type Logger } from '../logging/Logger';
import { resolveGlossaryId } from './DeepLGlossary';
import { isFormalitySupported, mapDatoToDeepL } from './DeepLMap';
import { recoverJsonArray } from './jsonArrayRecovery';
import {
  formatErrorForUser,
  normalizeProviderError,
} from './ProviderErrors';
import {
  checkLengthMismatch,
  checkPlaceholderSurvival,
  checkTruncated,
} from './qc/checks';
import {
  checkHtmlStructure,
  checkLengthRatio,
  checkMarkdownStructure,
  checkNoOp,
} from './qc/structuralChecks';
import type { OnQcFlag, QcFlag } from './qc/types';
import type { ProviderDebugHooks, TranslationProvider } from './types';

/**
 * Maximum number of segments to translate in a single API call for chat vendors.
 * DeepL uses its own batching (45 segments), but chat vendors (OpenAI, Gemini, Anthropic)
 * need chunking to handle large arrays reliably.
 */
const CHAT_VENDOR_CHUNK_SIZE = 25;

/** Normalized field content kind, driving structural checks and repairs. */
type ContentKind = 'html' | 'markdown' | 'text';

type Options = {
  isHTML?: boolean;
  /** Field content kind, selects the structural check (html vs markdown). */
  kind?: ContentKind;
  formality?: 'default' | 'more' | 'less';
  recordContext?: string;
  /** Optional sink for quality-control flags emitted during the translation. */
  onQcFlag?: OnQcFlag;
  /**
   * When the segment array holds independent sub-fields rather than parts of one
   * field (e.g. SEO title+description, file alt/title/metadata), the `no-op`
   * check is evaluated per segment instead of aggregated across the batch — each
   * segment is its own field, so a single wholly-unchanged value is flagged.
   */
  qcAtomicSegments?: boolean;
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

  // Last resort: recover lightly-malformed arrays (single-quoted strings,
  // trailing commas) the model emits intermittently — the "single quotes only
  // translated after 3-4 retries" failure mode. Quote-aware, so it never
  // corrupts string contents.
  const recovered = recoverJsonArray(trimmedTxt);
  if (recovered) {
    logger.info('Parsed response array after relaxed recovery', {
      ...context,
      rawResponse: trimmedTxt,
      repairedArray: recovered,
      repairedLength: recovered.length,
    });
    return { array: recovered, repaired: true, repairedArray: recovered };
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
/**
 * Parses the response into an array, tolerating a truncated (hence often
 * unparseable) response by returning an empty array so the length repair can
 * source-pad every slot. Re-throws genuine parse errors when not truncated.
 */
function parseOrEmptyOnTruncation(
  trimmedTxt: string,
  responseText: string,
  finishReason: string | undefined,
  logger: Logger,
  context: ParseContext,
): ParseResponseResult {
  try {
    return parseResponseArray(trimmedTxt, logger, context);
  } catch (error) {
    if (!checkTruncated({ finishReason })) throw error;
    logger.warning(
      'Response unparseable but provider signalled truncation; falling back to source',
      { ...context, finishReason, rawResponse: responseText },
    );
    return { array: [], repaired: false };
  }
}

/**
 * Reconciles the model's array against the input length.
 *
 * Over-split repair (block content only): a single HTML or Markdown segment can
 * come back as several elements when the model splits a multi-block value (e.g.
 * a WYSIWYG field holding several `<p>` blocks, or a Markdown document with
 * several paragraphs) into one element per block. Positional repair maps output
 * to input by index, so it would silently drop every element past the first.
 * When exactly one segment was sent, rejoin the string elements with a
 * kind-appropriate block separator — newline for HTML (insignificant between
 * block-level elements), blank line for Markdown (the block boundary) — a CLEAN
 * recovery, not a length mismatch. Plain-text kinds (single_line/slug/json)
 * keep positional repair: no join separator is safe there, and a short value's
 * first element is the least-wrong recovery.
 *
 * Otherwise, emit a `length-mismatch` flag (using the real element count,
 * `arr.length`) and pad/truncate positionally so output matches input length.
 */
function reconcileArrayLength(args: {
  arr: unknown[];
  originalSegments: string[];
  kind: ContentKind;
  responseText: string;
  logger: Logger;
  context: ParseContext;
  onQcFlag?: OnQcFlag;
}): string[] {
  const { arr, originalSegments, kind, responseText, logger, context } = args;
  const stringParts = arr.filter((v): v is string => typeof v === 'string');
  const isBlockContent = kind === 'html' || kind === 'markdown';
  const isOverSplitRejoin =
    isBlockContent && originalSegments.length === 1 && stringParts.length > 1;

  if (isOverSplitRejoin) {
    logger.warning('Model over-split a single segment; rejoined elements', {
      ...context,
      rawResponse: responseText,
      parsedArray: arr,
      returnedLength: arr.length,
    });
    return [stringParts.join(kind === 'markdown' ? '\n\n' : '\n')];
  }

  const lengthFlag = checkLengthMismatch({
    expected: originalSegments.length,
    received: arr.length,
  });
  if (lengthFlag) args.onQcFlag?.(lengthFlag);
  return originalSegments.map((seg, i) => {
    const v = arr[i];
    return typeof v === 'string' ? v : String(seg ?? '');
  });
}

function parseTranslationResponse(
  responseText: string,
  originalSegments: string[],
  logger: Logger,
  context: ParseContext,
  kind: ContentKind,
  onQcFlag?: OnQcFlag,
  finishReason?: string,
): string[] {
  const trimmedTxt = (responseText || '').trim();
  const parsed = parseOrEmptyOnTruncation(
    trimmedTxt,
    responseText,
    finishReason,
    logger,
    context,
  );
  const arr = parsed.array;

  // The truncation signal is independent of the array shape.
  const truncatedFlag = checkTruncated({ finishReason });
  if (truncatedFlag) onQcFlag?.(truncatedFlag);

  const fixed = reconcileArrayLength({
    arr,
    originalSegments,
    kind,
    responseText,
    logger,
    context,
    onQcFlag,
  });

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

/** Structure + ratio (+ per-segment no-op) flags for a single segment. */
function segmentContentFlags(args: {
  source: string;
  translated: string;
  segmentIndex: number;
  isHtml: boolean;
  isMarkdown: boolean;
  atomicSegments: boolean;
}): QcFlag[] {
  const { source, translated, segmentIndex, isHtml, isMarkdown, atomicSegments } =
    args;
  const out: QcFlag[] = [];
  if (isHtml) {
    const flag = checkHtmlStructure({ source, translated, segmentIndex });
    if (flag) out.push(flag);
  } else if (isMarkdown) {
    const flag = checkMarkdownStructure({ source, translated, segmentIndex });
    if (flag) out.push(flag);
  }
  const ratio = checkLengthRatio({ source, translated, segmentIndex });
  if (ratio) out.push(ratio);
  if (atomicSegments) {
    const noOp = checkNoOp({ sources: [source], translateds: [translated] });
    if (noOp) out.push({ ...noOp, segmentIndex });
  }
  return out;
}

/**
 * Runs the Phase 2 content checks (HTML/Markdown structure, length-ratio, no-op)
 * over each translated segment and returns the resulting flags. `no-op` is
 * aggregated across the batch by default, or evaluated per segment when the
 * segments are independent sub-fields (`atomicSegments`).
 */
function runQcContentChecks(args: {
  sources: string[];
  translateds: string[];
  isHtml: boolean;
  isMarkdown: boolean;
  atomicSegments: boolean;
}): QcFlag[] {
  const { sources, translateds, isHtml, isMarkdown, atomicSegments } = args;
  const flags = translateds.flatMap((translated, i) =>
    segmentContentFlags({
      source: sources[i] ?? '',
      translated,
      segmentIndex: i,
      isHtml,
      isMarkdown,
      atomicSegments,
    }),
  );

  if (!atomicSegments) {
    const noOp = checkNoOp({ sources, translateds });
    if (noOp) flags.push(noOp);
  }

  return flags;
}

/**
 * Drops redundant overlapping QC flags. `length-ratio` is the weakest signal, so
 * it is suppressed when a field-wide deterministic error already condemns the
 * value (length-mismatch / truncated, which carry no segmentIndex) or when a
 * per-segment error fired on the SAME segment. The AGGREGATE `no-op` (no
 * segmentIndex) is suppressed when a truncation already explains the
 * source-padded tail it would otherwise trip on; PER-SEGMENT no-ops (atomic
 * sub-fields like SEO title/description) are kept — a sibling segment's
 * truncation doesn't explain an independent sub-field coming back untranslated,
 * and losing that genuine signal is worse than an occasional overlapping row.
 */
function suppressRedundantFlags(flags: QcFlag[]): QcFlag[] {
  const errorSegments = new Set<number>();
  let hasFieldWideError = false;
  for (const flag of flags) {
    if (flag.severity !== 'error') continue;
    if (flag.segmentIndex === undefined) hasFieldWideError = true;
    else errorSegments.add(flag.segmentIndex);
  }
  const hasTruncated = flags.some((flag) => flag.checkId === 'truncated');

  return flags.filter((flag) => {
    if (flag.checkId === 'length-ratio') {
      if (hasFieldWideError) return false;
      return !(
        flag.segmentIndex !== undefined && errorSegments.has(flag.segmentIndex)
      );
    }
    if (flag.checkId === 'no-op' && flag.segmentIndex === undefined) {
      return !hasTruncated;
    }
    return true;
  });
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
  logger: Logger,
  providerDebugHooks: ProviderDebugHooks,
): Promise<string[]> {
  const target = mapDatoToDeepL(toLocale, 'target');
  const source = fromLocale ? mapDatoToDeepL(fromLocale, 'source') : undefined;
  const formality =
    opts.formality && isFormalitySupported(target) ? opts.formality : undefined;

  const requestOptions = {
    sourceLang: source,
    targetLang: target,
    isHTML: !!opts.isHTML,
    formality,
    preserveFormatting: pluginParams?.deeplPreserveFormatting !== false,
    ignoreTags: ['notranslate', 'ph'],
    nonSplittingTags: ['a', 'code', 'pre', 'strong', 'em', 'ph', 'notranslate'],
    splittingTags: [],
    glossaryId: resolveGlossaryId(pluginParams, fromLocale, toLocale),
    originalSourceLocale: fromLocale,
    originalTargetLocale: toLocale,
    debug: providerDebugHooks,
  };

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
  kind: ContentKind,
  onQcFlag?: OnQcFlag,
): Promise<string[]> {
  // Prefer the metadata-aware completion so we can observe truncation
  // (finish/stop reason); fall back to plain completeText otherwise.
  const complete = async (
    p: string,
  ): Promise<{ text: string; finishReason?: string }> =>
    provider.completeTextWithMeta
      ? provider.completeTextWithMeta(p, { debug: providerDebugHooks })
      : { text: await provider.completeText(p, { debug: providerDebugHooks }) };

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
    const { text: txt, finishReason } = await complete(prompt);
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
      kind,
      onQcFlag,
      finishReason,
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
    const { text: chunkResponse, finishReason } = await complete(chunkPrompt);
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
      kind,
      onQcFlag,
      finishReason,
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

  // One normalized content kind drives both the over-split repair and the
  // structural QC checks (the legacy `isHTML` boolean maps to 'html').
  const kind: ContentKind =
    opts.kind === 'html' || opts.isHTML === true
      ? 'html'
      : (opts.kind ?? 'text');

  // QC flags are buffered, then emitted at the end so redundant warnings can be
  // suppressed before handing them to the caller.
  const qcFlags: QcFlag[] = [];
  const collect: OnQcFlag = (flag) => qcFlags.push(flag);

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
        kind,
        collect,
      );
    }

    // Reinsert tokens with safe fallback for tokenMaps; QC: flag any protected
    // placeholder the model dropped before we detokenize.
    const finalSegments = out.map((t, i) => {
      const tokenMap = tokenMaps[i] ?? [];
      const output = String(t ?? '');
      const placeholderFlag = checkPlaceholderSurvival({
        tokens: tokenMap.map((m) => m.safe),
        output,
        segmentIndex: i,
      });
      if (placeholderFlag) collect(placeholderFlag);
      return detokenize(output, tokenMap);
    });
    logger.info('Translation batch output', {
      provider: provider.vendor,
      fromLocale,
      toLocale,
      translatedSegments: out,
      finalSegments,
      tokenMaps,
    });

    if (opts.onQcFlag) {
      // Phase 2 content checks (structure / ratio / no-op), unioned with the
      // deterministic flags already collected (length-mismatch / truncated /
      // placeholder-loss), then de-duplicated of redundant overlaps.
      const contentFlags = runQcContentChecks({
        sources: segments.map((s) => String(s ?? '')),
        translateds: finalSegments,
        isHtml: kind === 'html',
        isMarkdown: kind === 'markdown',
        atomicSegments: opts.qcAtomicSegments === true,
      });
      const emitted = suppressRedundantFlags([...qcFlags, ...contentFlags]);
      for (const flag of emitted) opts.onQcFlag(flag);
    }

    return finalSegments;
  } catch (error) {
    const norm = normalizeProviderError(error, provider.vendor);
    // ERR-002: Preserve original error context in the cause chain
    throw new Error(formatErrorForUser(norm), { cause: error });
  }
}
