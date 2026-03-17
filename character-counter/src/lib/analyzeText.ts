import {
  isInlineNode,
  isText,
  type Node,
} from 'datocms-structured-text-slate-utils';

export type AnalyticsFieldType = 'slug' | 'string' | 'text' | 'structured_text';

export type WordFrequencyRow = {
  word: string;
  count: number;
};

export type AnalyticsResult = {
  charactersWithSpaces: number;
  charactersWithoutSpaces: number;
  words: number;
  uniqueWords: number;
  specialCharacters: number;
  sentences: number;
  paragraphs: number;
  topWords: WordFrequencyRow[];
  wordFrequencyEntries: WordFrequencyRow[];
};

type AnalyzeTextOptions = {
  locale?: string;
  filterStopwords?: boolean;
  maxTopWords?: number;
};

type PreparedText = {
  sourceText: string;
  analysisText: string;
  paragraphs: string[];
  sentenceTexts: string[];
};

type SegmentGranularity = 'sentence' | 'word';

type SegmenterLike = {
  segment(input: string): Iterable<{
    segment: string;
    isWordLike?: boolean;
  }>;
};

type WordSummary = {
  uniqueWords: number;
  topWords: WordFrequencyRow[];
};

const DEFAULT_MAX_TOP_WORDS = 10;
const NON_WHITESPACE_PATTERN = /\S/u;
const SPECIAL_CHARACTER_PATTERN = /[^\p{L}\p{N}\s]/u;
const NORMALIZE_WORD_PATTERN = /[^\p{L}\p{N}]+/gu;
const WORD_FALLBACK_PATTERN = /[\p{L}\p{N}]+(?:['’`-][\p{L}\p{N}]+)*/gu;
const SENTENCE_FALLBACK_PATTERN = /[^.!?]+(?:[.!?]+|$)/g;
const SENTENCE_END_PATTERN = /[.!?]["')\]]*$/u;

const ENGLISH_STOPWORDS = new Set([
  'a',
  'about',
  'above',
  'after',
  'again',
  'against',
  'all',
  'am',
  'an',
  'and',
  'any',
  'are',
  'as',
  'at',
  'be',
  'because',
  'been',
  'before',
  'being',
  'below',
  'between',
  'both',
  'but',
  'by',
  'can',
  'did',
  'do',
  'does',
  'doing',
  'down',
  'during',
  'each',
  'few',
  'for',
  'from',
  'further',
  'had',
  'has',
  'have',
  'having',
  'he',
  'her',
  'here',
  'hers',
  'herself',
  'him',
  'himself',
  'his',
  'how',
  'i',
  'if',
  'in',
  'into',
  'is',
  'it',
  'its',
  'itself',
  'just',
  'me',
  'more',
  'most',
  'my',
  'myself',
  'no',
  'nor',
  'not',
  'now',
  'of',
  'off',
  'on',
  'once',
  'only',
  'or',
  'other',
  'our',
  'ours',
  'ourselves',
  'out',
  'over',
  'own',
  'same',
  'she',
  'should',
  'so',
  'some',
  'such',
  'than',
  'that',
  'the',
  'their',
  'theirs',
  'them',
  'themselves',
  'then',
  'there',
  'these',
  'they',
  'this',
  'those',
  'through',
  'to',
  'too',
  'under',
  'until',
  'up',
  'very',
  'was',
  'we',
  'were',
  'what',
  'when',
  'where',
  'which',
  'while',
  'who',
  'whom',
  'why',
  'will',
  'with',
  'you',
  'your',
  'yours',
  'yourself',
  'yourselves',
]);

const segmenterCache = new Map<string, SegmenterLike>();

export function analyzeFieldValue(
  value: unknown,
  fieldType: AnalyticsFieldType,
  options: AnalyzeTextOptions = {},
): AnalyticsResult {
  if (fieldType === 'structured_text') {
    return analyzePreparedText(prepareStructuredText(value), options);
  }

  if (fieldType === 'slug') {
    return analyzeSlugValue(value);
  }

  return analyzePreparedText(
    preparePlainText(normalizeTextValue(value)),
    options,
  );
}

export function supportsStopwordFiltering(locale?: string): boolean {
  return typeof locale === 'string' && /^en(?:-|$)/i.test(locale);
}

export function summarizeWordFrequencies(
  entries: readonly WordFrequencyRow[],
  options: AnalyzeTextOptions = {},
): WordSummary {
  const topWords: WordFrequencyRow[] = [];
  const maxTopWords = options.maxTopWords ?? DEFAULT_MAX_TOP_WORDS;
  const shouldFilterStopwords =
    !!options.filterStopwords && supportsStopwordFiltering(options.locale);

  let uniqueWords = 0;

  for (const entry of entries) {
    if (shouldFilterStopwords && ENGLISH_STOPWORDS.has(entry.word)) {
      continue;
    }

    uniqueWords += 1;
    insertTopWord(topWords, entry, maxTopWords);
  }

  return { uniqueWords, topWords };
}

function analyzeSlugValue(value: unknown): AnalyticsResult {
  const text = normalizeTextValue(value);
  const { charactersWithoutSpaces, specialCharacters } = scanCharacters(text);

  return {
    charactersWithSpaces: text.length,
    charactersWithoutSpaces,
    words: 0,
    uniqueWords: 0,
    specialCharacters,
    sentences: 0,
    paragraphs: text.trim().length > 0 ? 1 : 0,
    topWords: [],
    wordFrequencyEntries: [],
  };
}

function analyzePreparedText(
  preparedText: PreparedText,
  options: AnalyzeTextOptions,
): AnalyticsResult {
  const { sourceText, analysisText, paragraphs, sentenceTexts } = preparedText;
  const { charactersWithoutSpaces, specialCharacters } =
    scanCharacters(sourceText);

  const wordFrequencyMap = new Map<string, number>();
  let words = 0;
  let sentences = 0;

  for (const sentenceText of sentenceTexts) {
    sentences += countSentences(sentenceText, options.locale);
  }

  forEachWordToken(analysisText, options.locale, (word) => {
    words += 1;
    wordFrequencyMap.set(word, (wordFrequencyMap.get(word) ?? 0) + 1);
  });

  const wordFrequencyEntries = Array.from(
    wordFrequencyMap,
    ([word, count]): WordFrequencyRow => ({ word, count }),
  );

  return {
    charactersWithSpaces: sourceText.length,
    charactersWithoutSpaces,
    words,
    uniqueWords: wordFrequencyEntries.length,
    specialCharacters,
    sentences,
    paragraphs: paragraphs.length,
    topWords: summarizeWordFrequencies(wordFrequencyEntries, options).topWords,
    wordFrequencyEntries,
  };
}

function preparePlainText(text: string): PreparedText {
  return {
    sourceText: text,
    analysisText: text,
    paragraphs: splitPlainTextIntoParagraphs(text),
    sentenceTexts: [text],
  };
}

function prepareStructuredText(value: unknown): PreparedText {
  const paragraphs = extractStructuredTextParagraphs(value);

  return {
    sourceText: paragraphs.join(''),
    analysisText: paragraphs.join('\n\n'),
    paragraphs,
    sentenceTexts: paragraphs,
  };
}

function splitPlainTextIntoParagraphs(text: string): string[] {
  return text
    .split(/\r?\n+/)
    .map((paragraph) => paragraph.trim())
    .filter((paragraph) => paragraph.length > 0);
}

function extractStructuredTextParagraphs(value: unknown): string[] {
  if (!Array.isArray(value)) {
    return [];
  }

  const paragraphs: string[] = [];
  let currentParagraph = '';

  const flushParagraph = () => {
    const normalizedParagraph = currentParagraph.trim();

    if (normalizedParagraph.length > 0) {
      paragraphs.push(normalizedParagraph);
    }

    currentParagraph = '';
  };

  const visitNodes = (nodes: readonly Node[]) => {
    for (const node of nodes) {
      if (isText(node)) {
        currentParagraph += node.text;
        continue;
      }

      const children = Array.isArray(node.children)
        ? (node.children as Node[])
        : [];

      if (isInlineNode(node)) {
        visitNodes(children);
        continue;
      }

      flushParagraph();
      visitNodes(children);
      flushParagraph();
    }
  };

  visitNodes(value as Node[]);
  flushParagraph();

  return paragraphs;
}

function scanCharacters(text: string): {
  charactersWithoutSpaces: number;
  specialCharacters: number;
} {
  let charactersWithoutSpaces = 0;
  let specialCharacters = 0;

  for (const character of text) {
    if (NON_WHITESPACE_PATTERN.test(character)) {
      charactersWithoutSpaces += character.length;
    }

    if (SPECIAL_CHARACTER_PATTERN.test(character)) {
      specialCharacters += 1;
    }
  }

  return { charactersWithoutSpaces, specialCharacters };
}

function countSentences(text: string, locale?: string): number {
  if (text.trim().length === 0) {
    return 0;
  }

  const segmenter = getSegmenter(locale, 'sentence');

  if (segmenter) {
    let sentenceCount = 0;
    let currentSentence = '';

    for (const segment of segmenter.segment(text)) {
      if (segment.segment.trim().length === 0) {
        continue;
      }

      currentSentence += segment.segment;

      if (SENTENCE_END_PATTERN.test(currentSentence.trim())) {
        sentenceCount += 1;
        currentSentence = '';
      }
    }

    if (currentSentence.trim().length > 0) {
      sentenceCount += 1;
    }

    return sentenceCount;
  }

  const matches = text.trim().match(SENTENCE_FALLBACK_PATTERN);
  return matches ? matches.length : 0;
}

function forEachWordToken(
  text: string,
  locale: string | undefined,
  callback: (word: string) => void,
) {
  const segmenter = getSegmenter(locale, 'word');

  if (segmenter) {
    for (const segment of segmenter.segment(text)) {
      if (segment.isWordLike === false) {
        continue;
      }

      const normalizedWord = normalizeWord(segment.segment, locale);

      if (normalizedWord.length > 0) {
        callback(normalizedWord);
      }
    }

    return;
  }

  const matches = text.match(WORD_FALLBACK_PATTERN);

  if (!matches) {
    return;
  }

  for (const match of matches) {
    const normalizedWord = normalizeWord(match, locale);

    if (normalizedWord.length > 0) {
      callback(normalizedWord);
    }
  }
}

function normalizeWord(word: string, locale?: string): string {
  return safeLowerCase(word, locale)
    .normalize('NFKC')
    .replace(NORMALIZE_WORD_PATTERN, '');
}

function safeLowerCase(word: string, locale?: string): string {
  if (!locale) {
    return word.toLowerCase();
  }

  try {
    return word.toLocaleLowerCase(locale);
  } catch {
    return word.toLowerCase();
  }
}

function getSegmenter(
  locale: string | undefined,
  granularity: SegmentGranularity,
): SegmenterLike | undefined {
  const normalizedLocale = locale || 'en';
  const cacheKey = `${normalizedLocale}:${granularity}`;
  const cachedSegmenter = segmenterCache.get(cacheKey);

  if (cachedSegmenter) {
    return cachedSegmenter;
  }

  const IntlWithSegmenter = Intl as typeof Intl & {
    Segmenter?: new (
      locales?: string | string[],
      options?: { granularity: SegmentGranularity },
    ) => SegmenterLike;
  };

  if (!IntlWithSegmenter.Segmenter) {
    return undefined;
  }

  try {
    const segmenter = new IntlWithSegmenter.Segmenter(normalizedLocale, {
      granularity,
    });

    segmenterCache.set(cacheKey, segmenter);
    return segmenter;
  } catch {
    return undefined;
  }
}

function insertTopWord(
  topWords: WordFrequencyRow[],
  candidate: WordFrequencyRow,
  maxTopWords: number,
) {
  if (maxTopWords <= 0) {
    return;
  }

  const insertAt = topWords.findIndex(
    (currentWord) => compareWordRows(candidate, currentWord) < 0,
  );

  if (insertAt === -1) {
    if (topWords.length < maxTopWords) {
      topWords.push(candidate);
    }
  } else {
    topWords.splice(insertAt, 0, candidate);
  }

  if (topWords.length > maxTopWords) {
    topWords.pop();
  }
}

function compareWordRows(a: WordFrequencyRow, b: WordFrequencyRow): number {
  if (a.count !== b.count) {
    return b.count - a.count;
  }

  return a.word.localeCompare(b.word);
}

function normalizeTextValue(value: unknown): string {
  return typeof value === 'string' ? value : '';
}
