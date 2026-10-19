/**
 * Prompt glossary for chat vendors (OpenAI, Gemini, Anthropic). DeepL uses its
 * native glossaries instead (see DeepLGlossary.ts).
 *
 * The glossary is a CSV text with one term pair per line:
 *   fromLocale,toLocale,source term,target term
 * Either locale can be `*` to match any locale. Lines starting with `#` are
 * comments. Fields containing commas can be wrapped in double quotes.
 */

/** A single term pair for one (possibly wildcarded) locale pair. */
export type GlossaryEntry = {
  fromLocale: string;
  toLocale: string;
  source: string;
  target: string;
};

/**
 * Splits one CSV line into fields, honouring double-quoted fields and `""`
 * escapes inside them.
 *
 * @param line - A single CSV line.
 * @returns The trimmed fields.
 */
const splitCsvLine = (line: string): string[] => {
  const fields: string[] = [];
  let current = '';
  let isQuoted = false;
  for (let index = 0; index < line.length; index += 1) {
    const char = line[index];
    if (isQuoted) {
      if (char === '"' && line[index + 1] === '"') {
        current += '"';
        index += 1;
      } else if (char === '"') {
        isQuoted = false;
      } else {
        current += char;
      }
    } else if (char === '"' && current.trim() === '') {
      current = '';
      isQuoted = true;
    } else if (char === ',') {
      fields.push(current.trim());
      current = '';
    } else {
      current += char;
    }
  }
  fields.push(current.trim());
  return fields;
};

/**
 * Parses the glossary CSV text. Lines with fewer than four non-empty fields
 * are ignored; extra fields are ignored too.
 *
 * @param input - Raw glossary text from the plugin settings.
 * @returns The parsed term pairs, in input order.
 */
export const parseLlmGlossary = (input?: string): GlossaryEntry[] => {
  if (!input) return [];
  const entries: GlossaryEntry[] = [];
  for (const rawLine of input.split(/\r?\n/)) {
    const line = rawLine.trim();
    if (!line || line.startsWith('#')) continue;
    const [fromLocale, toLocale, source, target] = splitCsvLine(line);
    if (!fromLocale || !toLocale || !source || !target) continue;
    entries.push({ fromLocale, toLocale, source, target });
  }
  return entries;
};

/**
 * Returns how specifically `pattern` matches `locale`: 2 for an exact
 * (case-insensitive) match, 1 for the `*` wildcard, 0 for no match.
 */
const localeMatchScore = (pattern: string, locale: string): number => {
  if (pattern === '*') return 1;
  return pattern.toLowerCase() === locale.toLowerCase() ? 2 : 0;
};

// Scripts written without spaces between words: a word-boundary check would
// make terms in these scripts never match inside running text.
const UNSPACED_SCRIPT =
  /[\p{Script=Han}\p{Script=Hiragana}\p{Script=Katakana}\p{Script=Thai}\p{Script=Lao}\p{Script=Khmer}\p{Script=Myanmar}]/u;
// Marks (\p{M}) belong to the word: Devanagari vowel signs, Arabic harakat
// and decomposed Latin diacritics would otherwise read as word boundaries.
const WORD_CHAR = /[\p{L}\p{M}\p{N}]/u;
const NOT_AFTER_WORD = '(?<![\\p{L}\\p{M}\\p{N}])';
const NOT_BEFORE_WORD = '(?![\\p{L}\\p{M}\\p{N}])';

const NAMED_ENTITIES: Record<string, string> = {
  amp: '&',
  lt: '<',
  gt: '>',
  quot: '"',
  apos: "'",
  nbsp: ' ',
};

const escapeRegExp = (value: string): string =>
  value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

/**
 * Reduces HTML to the text a reader sees: drops tags, decodes entities and
 * turns non-breaking spaces into plain spaces, so terms match as written.
 *
 * @param html - An HTML string.
 * @returns The visible text.
 */
export const htmlToMatchableText = (html: string): string =>
  html
    .replace(/<[^>]*>/g, ' ')
    .replace(/&(#x[0-9a-f]+|#\d+|[a-z]+);/gi, (entity, code: string) => {
      if (code[0] !== '#') return NAMED_ENTITIES[code.toLowerCase()] ?? entity;
      const codePoint =
        code[1] === 'x' || code[1] === 'X'
          ? Number.parseInt(code.slice(2), 16)
          : Number.parseInt(code.slice(1), 10);
      return codePoint <= 0x10ffff ? String.fromCodePoint(codePoint) : entity;
    })
    .replace(/\u00a0/g, ' ');

/**
 * Builds a case-insensitive matcher for a source term. Edges that end in a
 * letter, mark or digit of a spaced script must sit on a word boundary, so
 * "cat" does not match inside "category".
 */
const buildTermMatcher = (term: string): RegExp => {
  const needsBoundary = (char: string) =>
    WORD_CHAR.test(char) && !UNSPACED_SCRIPT.test(char);
  const chars = Array.from(term);
  const head = needsBoundary(chars[0]) ? NOT_AFTER_WORD : '';
  const tail = needsBoundary(chars[chars.length - 1]) ? NOT_BEFORE_WORD : '';
  return new RegExp(`${head}${escapeRegExp(term)}${tail}`, 'iu');
};

/**
 * Returns the glossary entries that apply to a locale pair, one per source
 * term. When several entries share a source term, the most specific locale
 * pair wins (exact beats `*`), then the earliest line.
 *
 * @param entries - Parsed glossary entries.
 * @param fromLocale - Source locale code.
 * @param toLocale - Target locale code.
 * @returns The applicable entries, in glossary order.
 */
export const entriesForLocalePair = (
  entries: GlossaryEntry[],
  fromLocale: string,
  toLocale: string,
): GlossaryEntry[] => {
  const bestBySource = new Map<
    string,
    { entry: GlossaryEntry; score: number; order: number }
  >();
  for (const [order, entry] of entries.entries()) {
    const fromScore = localeMatchScore(entry.fromLocale, fromLocale);
    const toScore = localeMatchScore(entry.toLocale, toLocale);
    if (fromScore === 0 || toScore === 0) continue;
    const score = fromScore + toScore;
    const key = entry.source.toLowerCase();
    const current = bestBySource.get(key);
    if (!current || score > current.score) {
      bestBySource.set(key, { entry, score, order });
    }
  }
  return [...bestBySource.values()]
    .sort((left, right) => left.order - right.order)
    .map(({ entry }) => entry);
};

/**
 * Compiles the term matchers for a locale pair once, for reuse across the
 * chunks of one translation call.
 *
 * @param entries - Parsed glossary entries.
 * @param fromLocale - Source locale code.
 * @param toLocale - Target locale code.
 * @returns A function returning the entries whose source term appears in
 *   the given texts, in glossary order. With `isHtml`, tags are ignored and
 *   entities decoded before matching.
 */
export const createGlossaryMatcher = (
  entries: GlossaryEntry[],
  fromLocale: string,
  toLocale: string,
): ((texts: string[], isHtml?: boolean) => GlossaryEntry[]) => {
  const candidates = entriesForLocalePair(entries, fromLocale, toLocale).map(
    (entry) => ({ entry, matcher: buildTermMatcher(entry.source) }),
  );
  return (texts, isHtml = false) => {
    if (candidates.length === 0) return [];
    const joined = texts.join('\n');
    const haystack = isHtml ? htmlToMatchableText(joined) : joined;
    return candidates
      .filter(({ matcher }) => matcher.test(haystack))
      .map(({ entry }) => entry);
  };
};

/**
 * Selects the glossary entries that apply to a locale pair and whose source
 * term appears in the texts. One-shot wrapper around
 * {@link createGlossaryMatcher}.
 */
export const selectGlossaryTerms = (
  entries: GlossaryEntry[],
  fromLocale: string,
  toLocale: string,
  texts: string[],
  isHtml = false,
): GlossaryEntry[] =>
  createGlossaryMatcher(entries, fromLocale, toLocale)(texts, isHtml);

const utf8Length = (value: string): number =>
  new TextEncoder().encode(value).length;

/**
 * Formats matched glossary entries as a prompt block, keeping it within
 * `maxBytes` (UTF-8) by dropping the entries that do not fit.
 *
 * @param terms - Entries returned by a glossary matcher.
 * @param fromLocale - Source locale code.
 * @param toLocale - Target locale code.
 * @param maxBytes - Size limit for the whole block.
 * @returns The block (empty when no term fits) and how many terms it omits.
 */
export const formatGlossaryBlock = (
  terms: GlossaryEntry[],
  fromLocale: string,
  toLocale: string,
  maxBytes = Number.POSITIVE_INFINITY,
): { text: string; omittedCount: number } => {
  if (terms.length === 0) return { text: '', omittedCount: 0 };
  const header = `GLOSSARY (required terminology, ${fromLocale} → ${toLocale}):
Whenever a source term below appears, translate it with exactly the given target term, adjusting only grammatical inflection where the target language requires it.`;
  let bytes = utf8Length(header);
  const lines: string[] = [];
  for (const { source, target } of terms) {
    const line = `- ${JSON.stringify(source)} → ${JSON.stringify(target)}`;
    const lineBytes = utf8Length(line) + 1;
    if (bytes + lineBytes > maxBytes) break;
    bytes += lineBytes;
    lines.push(line);
  }
  if (lines.length === 0) return { text: '', omittedCount: terms.length };
  return {
    text: `${header}\n${lines.join('\n')}`,
    omittedCount: terms.length - lines.length,
  };
};
