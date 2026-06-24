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
  'p',
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

/**
 * Flags when the translated HTML has a different block-level tag multiset than
 * the source (a block was dropped/added/changed). Compares `tagName` only, so
 * inline-emphasis reshuffling and `data-*` attributes never trip it.
 */
export function checkHtmlStructure(args: SegmentArgs): QcFlag | null {
  const src = blockTagCounts(args.source);
  const tgt = blockTagCounts(args.translated);
  if (!src || !tgt) return null;
  if (multisetsEqual(src, tgt)) return null;
  return {
    checkId: 'html-structure',
    severity: 'error',
    fieldPath: args.fieldPath,
    locale: args.locale,
    segmentIndex: args.segmentIndex,
    message:
      'Translated HTML has a different block structure than the source — a block may have been dropped or altered.',
  };
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
  if (/^\d+[.)]\s/.test(trimmed)) return 'ol-item';
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
        'Translated Markdown is missing or has extra headings, lists, code blocks, or links vs the source.',
    };
  }
  if (paragraphDiff) {
    return {
      checkId: 'markdown-structure',
      severity: 'warning',
      fieldPath: args.fieldPath,
      locale: args.locale,
      segmentIndex: args.segmentIndex,
      message: 'Translated Markdown has a different paragraph count than the source.',
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
    message: `${unchanged} of ${eligible} segment(s) are unchanged from the source — the translation may not have run.`,
  };
}

function stripForRatio(text: string): string {
  return stripTokens(text)
    .replace(/<[^>]+>/g, '')
    .trim();
}

/**
 * Heuristic: flags when a non-trivial source produced a translation under ~30%
 * of its character length — a loose, one-sided truncation alarm. No upper bound
 * (legitimate expansion is unbounded) and short sources are skipped.
 */
export function checkLengthRatio(args: SegmentArgs): QcFlag | null {
  const source = stripForRatio(args.source);
  const translated = stripForRatio(args.translated);
  if (source.length < 20) return null;
  if (translated.length / source.length >= 0.3) return null;
  return {
    checkId: 'length-ratio',
    severity: 'warning',
    fieldPath: args.fieldPath,
    locale: args.locale,
    segmentIndex: args.segmentIndex,
    message: `Translation is much shorter than the source (${translated.length} vs ${source.length} chars) — it may be truncated.`,
  };
}
