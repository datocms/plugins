/**
 * Phase 2 content QC checks. Pure functions comparing a translated value
 * against its source. Structural checks (HTML/Markdown) are deterministic and
 * `error`-tier; `no-op` and `length-ratio` are heuristic `warning`-tier.
 */

import type { QcFlag } from './types';

type SegmentArgs = {
  source: string;
  translated: string;
  fieldPath?: string;
  locale?: string;
  segmentIndex?: number;
};

const HTML_BLOCK_TAGS = new Set([
  'h1',
  'h2',
  'h3',
  'h4',
  'h5',
  'h6',
  'ul',
  'ol',
  'li',
  'blockquote',
  'pre',
  'table',
  'tr',
  'td',
  'th',
  'img',
  'hr',
  'figure',
]);

/** Multiset of block-level tag names, or null when DOMParser is unavailable. */
function blockTagCounts(html: string): Map<string, number> | null {
  if (typeof DOMParser === 'undefined') return null;
  const doc = new DOMParser().parseFromString(html, 'text/html');
  const counts = new Map<string, number>();
  for (const el of Array.from(doc.body.querySelectorAll('*'))) {
    const tag = el.tagName.toLowerCase();
    if (HTML_BLOCK_TAGS.has(tag)) counts.set(tag, (counts.get(tag) ?? 0) + 1);
  }
  return counts;
}

function multisetsEqual(a: Map<string, number>, b: Map<string, number>): boolean {
  if (a.size !== b.size) return false;
  for (const [key, value] of a) if (b.get(key) !== value) return false;
  return true;
}

/** Counts <p> elements only. Paragraph reflow is a legitimate translation move. */
function paragraphCount(html: string): number | null {
  if (typeof DOMParser === 'undefined') return null;
  const doc = new DOMParser().parseFromString(html, 'text/html');
  return doc.body.querySelectorAll('p').length;
}

/**
 * Flags a different STRUCTURAL block-tag multiset (heading/list/table/image/…)
 * as an `error` (a block was dropped/added). A pure `<p>`-count drift is a
 * `paragraph-count` `warning`: LLMs legitimately merge/split paragraphs across
 * languages. Inline-emphasis reshuffling never trips either. (spec §5)
 */
export function checkHtmlStructure(args: SegmentArgs): QcFlag | null {
  const src = blockTagCounts(args.source);
  const tgt = blockTagCounts(args.translated);
  if (src && tgt && !multisetsEqual(src, tgt)) {
    return {
      checkId: 'html-structure',
      severity: 'error',
      fieldPath: args.fieldPath,
      locale: args.locale,
      segmentIndex: args.segmentIndex,
      message: 'The translated HTML has a different block structure than the source — a heading, list, table, or image may have been dropped or added. Open the record and compare the formatting; re-translate the field if a block is missing.',
    };
  }
  const srcP = paragraphCount(args.source);
  const tgtP = paragraphCount(args.translated);
  if (srcP !== null && tgtP !== null && srcP !== tgtP) {
    return {
      checkId: 'paragraph-count',
      severity: 'warning',
      fieldPath: args.fieldPath,
      locale: args.locale,
      segmentIndex: args.segmentIndex,
      message: 'The translated HTML has a different number of paragraphs than the source — text may have been merged or split. Review the formatting in this locale.',
    };
  }
  return null;
}

const STRUCTURAL_MD_KEYS = new Set([
  'h1',
  'h2',
  'h3',
  'h4',
  'h5',
  'h6',
  'ul-item',
  'ol-item',
  'blockquote',
  'hr',
  'table-row',
  'code-fence',
  'link',
  'image',
]);

const MD_IMAGE_RE = /!\[[^\]]*\]\([^)]*\)/g;
const MD_LINK_RE = /(?<!!)\[[^\]]*\]\([^)]*\)/g;

/** Classifies a non-empty, non-fenced trimmed Markdown line into a block key. */
function classifyMarkdownBlock(trimmed: string): string {
  const heading = /^(#{1,6})\s/.exec(trimmed);
  if (heading) return `h${heading[1].length}`;
  if (/^>/.test(trimmed)) return 'blockquote';
  if (/^(-{3,}|\*{3,}|_{3,})$/.test(trimmed)) return 'hr';
  if (/^[-*+]\s/.test(trimmed)) return 'ul-item';
  // Only 1-2 digit markers count as ordered-list items: CommonMark allows any
  // number, but a 3+-digit "marker" in real content is almost always a year or
  // figure opening a prose sentence ("2020. A pivotal year…"), and a correct
  // translation may reorder it — misclassifying it produced false
  // missing-list-item structure errors on good translations.
  if (/^\d{1,2}[.)]\s/.test(trimmed)) return 'ol-item';
  if (/^\|.*\|/.test(trimmed)) return 'table-row';
  return 'paragraph';
}

/**
 * Builds a multiset of Markdown block signatures using a fenced-code-aware line
 * scanner (no markdown parser dependency).
 */
function markdownSignature(markdown: string): Map<string, number> {
  const sig = new Map<string, number>();
  const bump = (key: string, amount = 1) => {
    if (amount > 0) sig.set(key, (sig.get(key) ?? 0) + amount);
  };
  let inFence = false;
  for (const line of markdown.split(/\r?\n/)) {
    if (/^\s*(```|~~~)/.test(line)) {
      if (!inFence) bump('code-fence');
      inFence = !inFence;
      continue;
    }
    if (inFence) continue;
    const trimmed = line.trim();
    if (trimmed === '') continue;

    bump('image', (line.match(MD_IMAGE_RE) || []).length);
    bump('link', (line.match(MD_LINK_RE) || []).length);
    bump(classifyMarkdownBlock(trimmed));
  }
  return sig;
}

/**
 * Flags when the translated Markdown drops/adds structural blocks (headings,
 * lists, code fences, links, images → `error`) or merely drifts in paragraph
 * count (→ `warning`).
 */
export function checkMarkdownStructure(args: SegmentArgs): QcFlag | null {
  const a = markdownSignature(args.source);
  const b = markdownSignature(args.translated);
  let structuralDiff = false;
  let paragraphDiff = false;
  for (const key of new Set([...a.keys(), ...b.keys()])) {
    if ((a.get(key) ?? 0) === (b.get(key) ?? 0)) continue;
    if (STRUCTURAL_MD_KEYS.has(key)) structuralDiff = true;
    else paragraphDiff = true;
  }
  if (structuralDiff) {
    return {
      checkId: 'markdown-structure',
      severity: 'error',
      fieldPath: args.fieldPath,
      locale: args.locale,
      segmentIndex: args.segmentIndex,
      message:
        'The translated Markdown is missing or has extra headings, lists, code blocks, or links compared with the source. Compare the two and re-translate the field if structure was lost.',
    };
  }
  if (paragraphDiff) {
    return {
      checkId: 'markdown-structure',
      severity: 'warning',
      fieldPath: args.fieldPath,
      locale: args.locale,
      segmentIndex: args.segmentIndex,
      message: 'The translated Markdown has a different number of paragraphs than the source — text may have been merged or split. Review the formatting in this locale.',
    };
  }
  return null;
}

const PLACEHOLDER_TOKEN = /⟦PH_\d+⟧/g;

function stripTokens(text: string): string {
  return text.replace(PLACEHOLDER_TOKEN, '');
}

function normalize(text: string): string {
  return stripTokens(text).normalize('NFC').replace(/\s+/g, ' ').trim().toLowerCase();
}

/** A segment that is legitimately allowed to be identical across locales. */
function isExemptFromNoOp(source: string): boolean {
  const s = stripTokens(source).trim();
  if (s === '') return true;
  if (/^[\d\s\p{P}\p{S}]+$/u.test(s)) return true; // numeric / symbol only
  if (/^(https?:\/\/|mailto:|\/|www\.)/i.test(s) || /^\S+@\S+$/.test(s)) return true;
  const letters = (s.match(/\p{L}/gu) || []).length;
  const hasSpace = /\s/.test(s);
  if (letters < 3) return true;
  if (letters < 8 && !hasSpace) return true;
  return false;
}

/**
 * Field-level heuristic: flags when more than half of the translatable segments
 * are byte-for-byte unchanged from the source (suggesting no translation ran).
 * Exempts numeric/URL/short/atomic segments to avoid flagging legitimate copies.
 */
export function checkNoOp(args: {
  sources: string[];
  translateds: string[];
  fieldPath?: string;
  locale?: string;
}): QcFlag | null {
  let eligible = 0;
  let unchanged = 0;
  for (let i = 0; i < args.sources.length; i++) {
    const source = args.sources[i] ?? '';
    if (isExemptFromNoOp(source)) continue;
    eligible++;
    if (normalize(source) === normalize(args.translateds[i] ?? '')) unchanged++;
  }
  if (eligible === 0 || unchanged / eligible <= 0.5) return null;
  return {
    checkId: 'no-op',
    severity: 'warning',
    fieldPath: args.fieldPath,
    locale: args.locale,
    message: `${unchanged} of ${eligible} text block(s) came back identical to the source. The provider may have left them untranslated (common for names, code, or already-translated text). Confirm they should read the same in this locale — if they are correct as-is, no action is needed.`,
  };
}

function stripForRatio(text: string): string {
  return stripTokens(text)
    .replace(/<[^>]+>/g, '')
    .trim();
}

/** CJK code points (Han incl. ext-A/compat, kana incl. half-width, hangul). */
const CJK_CHAR_RE =
  /[぀-ヿ㐀-䶿一-鿿豈-﫿ｦ-ﾟ가-힯]/g;

/**
 * Ratio floor below which a translation is flagged as possibly truncated. CJK
 * scripts pack far more information per character than Latin (a good zh/ja/ko
 * translation of a Latin source routinely lands at 20-30% of its character
 * count), so a translation that is predominantly CJK gets a much lower floor —
 * otherwise every substantial en→zh field false-alarms.
 */
function ratioFloor(translated: string): number {
  const cjkCount = (translated.match(CJK_CHAR_RE) || []).length;
  const isMostlyCjk = translated.length > 0 && cjkCount / translated.length > 0.5;
  return isMostlyCjk ? 0.12 : 0.3;
}

/**
 * Heuristic: flags when a non-trivial source produced a translation under a
 * script-aware fraction of its character length — a loose, one-sided truncation
 * alarm. No upper bound (legitimate expansion is unbounded) and short sources
 * are skipped.
 */
export function checkLengthRatio(args: SegmentArgs): QcFlag | null {
  const source = stripForRatio(args.source);
  const translated = stripForRatio(args.translated);
  if (source.length < 20) return null;
  if (translated.length / source.length >= ratioFloor(translated)) return null;
  return {
    checkId: 'length-ratio',
    severity: 'warning',
    fieldPath: args.fieldPath,
    locale: args.locale,
    segmentIndex: args.segmentIndex,
    message: `The translation is much shorter than the source (${translated.length} vs ${source.length} characters), so content may have been cut off or skipped. Compare it against the source and re-translate this field if text is missing.`,
  };
}
