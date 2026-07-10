/**
 * Unicode-safe text helpers for truncating user-facing and persisted strings.
 *
 * DatoCMS content (and our own labels) routinely contains astral characters —
 * emoji, flags, accented letters — that are more than one UTF-16 code unit and,
 * for grapheme clusters (ZWJ emoji, regional-indicator flag pairs, base +
 * combining marks), more than one Unicode code point. Slicing such a string by
 * UTF-16 index (`.substring`) can strand a lone surrogate (mojibake, and it
 * corrupts persisted values); slicing by code point can split a multi-code-point
 * cluster mid-glyph. Both are avoided by segmenting into grapheme clusters first.
 */

/** Cached segmenter — constructing one per call is measurably wasteful. */
const graphemeSegmenter =
  typeof Intl !== 'undefined' && typeof Intl.Segmenter === 'function'
    ? new Intl.Segmenter(undefined, { granularity: 'grapheme' })
    : null;

/**
 * Splits `text` into user-perceived characters (grapheme clusters). Falls back to
 * code-point segmentation (`[...text]`) where `Intl.Segmenter` is unavailable —
 * still surrogate-safe, only lacking multi-code-point cluster grouping.
 */
export function segmentGraphemes(text: string): string[] {
  if (!graphemeSegmenter) return [...text];
  const out: string[] = [];
  for (const { segment } of graphemeSegmenter.segment(text)) out.push(segment);
  return out;
}

/**
 * Truncates `text` to at most `maxGraphemes` grapheme clusters, appending
 * `ellipsis` when (and only when) it actually cuts. Never splits a surrogate pair
 * or a grapheme cluster. `maxGraphemes` bounds the retained content; the ellipsis
 * is added on top, so callers that need the final string within a hard ceiling
 * should pass `limit - [...ellipsis].length`.
 */
export function truncateToGraphemes(
  text: string,
  maxGraphemes: number,
  ellipsis: string,
): string {
  const graphemes = segmentGraphemes(text);
  if (graphemes.length <= maxGraphemes) return text;
  return graphemes.slice(0, Math.max(0, maxGraphemes)).join('') + ellipsis;
}
