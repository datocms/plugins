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
const WORD_CHAR = /[\p{L}\p{N}]/u;

const escapeRegExp = (value: string): string =>
  value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

/**
 * Builds a case-insensitive matcher for a source term. Edges that end in a
 * letter or digit of a spaced script must sit on a word boundary, so "cat"
 * does not match inside "category".
 */
const buildTermMatcher = (term: string): RegExp => {
  const needsBoundary = (char: string) =>
    WORD_CHAR.test(char) && !UNSPACED_SCRIPT.test(char);
  const chars = Array.from(term);
  const head = needsBoundary(chars[0]) ? '(?<![\\p{L}\\p{N}])' : '';
  const tail = needsBoundary(chars[chars.length - 1])
    ? '(?![\\p{L}\\p{N}])'
    : '';
  return new RegExp(`${head}${escapeRegExp(term)}${tail}`, 'iu');
};

/**
 * Selects the glossary entries that apply to a locale pair and whose source
 * term appears in the text. When several entries share a source term, the
 * most specific locale pair wins (exact beats `*`), then the earliest line.
 *
 * @param entries - Parsed glossary entries.
 * @param fromLocale - Source locale code.
 * @param toLocale - Target locale code.
 * @param texts - Source strings the request will translate.
 * @returns The matching entries, in glossary order.
 */
export const selectGlossaryTerms = (
  entries: GlossaryEntry[],
  fromLocale: string,
  toLocale: string,
  texts: string[],
): GlossaryEntry[] => {
  if (entries.length === 0) return [];
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
  if (bestBySource.size === 0) return [];

  const haystack = texts.join('\n');
  return [...bestBySource.values()]
    .filter(({ entry }) => buildTermMatcher(entry.source).test(haystack))
    .sort((left, right) => left.order - right.order)
    .map(({ entry }) => entry);
};

/**
 * Formats matched glossary entries as a prompt block.
 *
 * @param terms - Entries returned by {@link selectGlossaryTerms}.
 * @param fromLocale - Source locale code.
 * @param toLocale - Target locale code.
 * @returns The prompt block, or an empty string when no terms match.
 */
export const formatGlossaryBlock = (
  terms: GlossaryEntry[],
  fromLocale: string,
  toLocale: string,
): string => {
  if (terms.length === 0) return '';
  const lines = terms.map(
    ({ source, target }) =>
      `- ${JSON.stringify(source)} → ${JSON.stringify(target)}`,
  );
  return `GLOSSARY (required terminology, ${fromLocale} → ${toLocale}):
Whenever a source term below appears, translate it with exactly the given target term, adjusting only grammatical inflection where the target language requires it.
${lines.join('\n')}`;
};
