import { Parser } from 'htmlparser2';
import LinkifyIt from 'linkify-it';
import type { Root, RootContent } from 'mdast';
import remarkGfm from 'remark-gfm';
import remarkParse from 'remark-parse';
import { unified } from 'unified';

const links = new LinkifyIt({
  fuzzyLink: false,
  fuzzyEmail: false,
  fuzzyIP: false,
});
const fuzzyLinks = new LinkifyIt();
const markdown = unified().use(remarkParse).use(remarkGfm);
const IGNORED_HTML = new Set(['code', 'pre', 'script', 'style', 'template']);

/** A string field is a URL value only when the entire value looks like one. */
export function isUrlLikeValue(value: string): boolean {
  const trimmed = value.trim();
  if (!trimmed) return false;
  if (/^(?:https?[:/]|[a-z][a-z\d+.-]*:\/\/)/i.test(trimmed)) return true;
  if (/^[a-z][a-z\d+.-]*:\S+$/i.test(trimmed)) return true;
  if (/^(?:\/|\.\.?\/|#|\?)/.test(trimmed) && !/\s/.test(trimmed)) {
    return true;
  }
  const matches = fuzzyLinks.match(trimmed);
  return Boolean(
    matches?.length === 1 &&
      matches[0].index === 0 &&
      matches[0].lastIndex === trimmed.length,
  );
}

export function plainTextLinks(value: string): string[] {
  const matches = links.match(value);
  if (matches?.length) return matches.map((match) => match.raw);
  return isUrlLikeValue(value) ? [value.trim()] : [];
}

/** Only semantic anchors count: images, scripts, and URL-looking attributes do not. */
export function htmlLinks(value: string): string[] {
  const result: string[] = [];
  let ignoredDepth = 0;
  // A pure tokenizer never creates DOM elements or starts subresource requests.
  const parser = new Parser(
    {
      onopentag(name, attributes) {
        if (IGNORED_HTML.has(name)) ignoredDepth += 1;
        if (
          name === 'a' &&
          ignoredDepth === 0 &&
          attributes.href !== undefined
        ) {
          result.push(attributes.href);
        }
      },
      onclosetag(name) {
        if (IGNORED_HTML.has(name))
          ignoredDepth = Math.max(0, ignoredDepth - 1);
      },
    },
    { decodeEntities: true },
  );
  parser.end(value);
  return result;
}

function referenceKey(identifier: string): string {
  return identifier.trim().replace(/\s+/g, ' ').toUpperCase();
}

function childrenOf(node: Root | RootContent): readonly RootContent[] {
  return 'children' in node ? node.children : [];
}

function definitionsIn(root: Root): Map<string, string> {
  const definitions = new Map<string, string>();
  const visit = (node: Root | RootContent) => {
    if (node.type === 'definition') {
      const key = referenceKey(node.identifier);
      if (!definitions.has(key)) definitions.set(key, node.url);
    }
    for (const child of childrenOf(node)) visit(child);
  };
  visit(root);
  return definitions;
}

type MarkdownState = {
  source: string;
  urls: string[];
  definitions: Map<string, string>;
  ignoredHtmlStack: string[];
};

function markdownDestination(
  node: Extract<RootContent, { type: 'link' }>,
  source: string,
): string {
  const start = node.position?.start.offset;
  const end = node.position?.end.offset;
  const literal =
    start === undefined || end === undefined ? '' : source.slice(start, end);
  // GFM manufactures http:// for www autolinks. Keep the source spelling so
  // classification can correctly skip a destination without an explicit scheme.
  return literal.startsWith('www.') && node.url === `http://${literal}`
    ? literal
    : node.url;
}

function visitHtml(value: string, state: MarkdownState): void {
  // Inline HTML may be split across sibling Markdown nodes, e.g. <code>, text,
  // </code>. Carry that context so the intervening text is not treated as prose.
  const prefix = state.ignoredHtmlStack.map((tag) => `<${tag}>`).join('');
  state.urls.push(...htmlLinks(prefix + value));
  for (const match of value.matchAll(
    /<\s*(\/?)\s*(code|pre|script|style|template)\b[^>]*>/gi,
  )) {
    const tag = match[2].toLowerCase();
    if (match[1]) {
      const index = state.ignoredHtmlStack.lastIndexOf(tag);
      if (index !== -1) state.ignoredHtmlStack.splice(index);
    } else if (!match[0].endsWith('/>')) {
      state.ignoredHtmlStack.push(tag);
    }
  }
}

function visitMarkdown(node: Root | RootContent, state: MarkdownState): void {
  switch (node.type) {
    case 'code':
    case 'inlineCode':
    case 'image':
    case 'imageReference':
    case 'definition':
      return;
    case 'html':
      visitHtml(node.value, state);
      return;
    case 'link':
      if (!state.ignoredHtmlStack.length)
        state.urls.push(markdownDestination(node, state.source));
      return;
    case 'linkReference': {
      const url = state.definitions.get(referenceKey(node.identifier));
      if (url !== undefined && !state.ignoredHtmlStack.length)
        state.urls.push(url);
      return;
    }
    case 'text':
      if (!state.ignoredHtmlStack.length)
        state.urls.push(...plainTextLinks(node.value));
      return;
    default:
      for (const child of childrenOf(node)) visitMarkdown(child, state);
  }
}

export function markdownLinks(value: string): string[] {
  const root = markdown.parse(value);
  const state: MarkdownState = {
    source: value,
    urls: [],
    definitions: definitionsIn(root),
    ignoredHtmlStack: [],
  };
  visitMarkdown(root, state);
  return state.urls;
}
