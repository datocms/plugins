/**
 * Text and JSON fields store some characters encoded: HTML entities in text
 * fields (`&uuml;` for ü), JSON escapes in JSON fields (`\n`, `\"`). Matching
 * runs on the decoded text, as editors read it. Each encoded character is a
 * segment of its own that a match always covers whole, and inserted text is
 * encoded the way the value already stores it.
 */

import type { FlowSegment, StructuredTextFlow } from './matcher';
import type { SchemaField, TextSubfield } from './types';

/** The HTML 4 entities for U+00A0 to U+00FF, in code point order. */
const LATIN_1_ENTITIES =
  'nbsp iexcl cent pound curren yen brvbar sect uml copy ordf laquo not shy reg macr deg plusmn sup2 sup3 acute micro para middot cedil sup1 ordm raquo frac14 frac12 frac34 iquest Agrave Aacute Acirc Atilde Auml Aring AElig Ccedil Egrave Eacute Ecirc Euml Igrave Iacute Icirc Iuml ETH Ntilde Ograve Oacute Ocirc Otilde Ouml times Oslash Ugrave Uacute Ucirc Uuml Yacute THORN szlig agrave aacute acirc atilde auml aring aelig ccedil egrave eacute ecirc euml igrave iacute icirc iuml eth ntilde ograve oacute ocirc otilde ouml divide oslash ugrave uacute ucirc uuml yacute thorn yuml';

const GREEK_UPPER =
  'Alpha Beta Gamma Delta Epsilon Zeta Eta Theta Iota Kappa Lambda Mu Nu Xi Omicron Pi Rho';
const GREEK_LOWER =
  'alpha beta gamma delta epsilon zeta eta theta iota kappa lambda mu nu xi omicron pi rho sigmaf sigma tau upsilon phi chi psi omega';

/** The rest of the HTML 4 entities, plus `apos`. */
const OTHER_ENTITIES: Readonly<Record<string, number>> = {
  quot: 34,
  amp: 38,
  apos: 39,
  lt: 60,
  gt: 62,
  OElig: 338,
  oelig: 339,
  Scaron: 352,
  scaron: 353,
  Yuml: 376,
  fnof: 402,
  circ: 710,
  tilde: 732,
  Sigma: 931,
  Tau: 932,
  Upsilon: 933,
  Phi: 934,
  Chi: 935,
  Psi: 936,
  Omega: 937,
  thetasym: 977,
  upsih: 978,
  piv: 982,
  ensp: 8194,
  emsp: 8195,
  thinsp: 8201,
  zwnj: 8204,
  zwj: 8205,
  lrm: 8206,
  rlm: 8207,
  ndash: 8211,
  mdash: 8212,
  lsquo: 8216,
  rsquo: 8217,
  sbquo: 8218,
  ldquo: 8220,
  rdquo: 8221,
  bdquo: 8222,
  dagger: 8224,
  Dagger: 8225,
  bull: 8226,
  hellip: 8230,
  permil: 8240,
  prime: 8242,
  Prime: 8243,
  lsaquo: 8249,
  rsaquo: 8250,
  oline: 8254,
  frasl: 8260,
  euro: 8364,
  image: 8465,
  weierp: 8472,
  real: 8476,
  trade: 8482,
  alefsym: 8501,
  larr: 8592,
  uarr: 8593,
  rarr: 8594,
  darr: 8595,
  harr: 8596,
  crarr: 8629,
  lArr: 8656,
  uArr: 8657,
  rArr: 8658,
  dArr: 8659,
  hArr: 8660,
  forall: 8704,
  part: 8706,
  exist: 8707,
  empty: 8709,
  nabla: 8711,
  isin: 8712,
  notin: 8713,
  ni: 8715,
  prod: 8719,
  sum: 8721,
  minus: 8722,
  lowast: 8727,
  radic: 8730,
  prop: 8733,
  infin: 8734,
  ang: 8736,
  and: 8743,
  or: 8744,
  cap: 8745,
  cup: 8746,
  int: 8747,
  there4: 8756,
  sim: 8764,
  cong: 8773,
  asymp: 8776,
  ne: 8800,
  equiv: 8801,
  le: 8804,
  ge: 8805,
  sub: 8834,
  sup: 8835,
  nsub: 8836,
  sube: 8838,
  supe: 8839,
  oplus: 8853,
  otimes: 8855,
  perp: 8869,
  sdot: 8901,
  lceil: 8968,
  rceil: 8969,
  lfloor: 8970,
  rfloor: 8971,
  lang: 10216,
  rang: 10217,
  loz: 9674,
  spades: 9824,
  clubs: 9827,
  hearts: 9829,
  diams: 9830,
};

function entityTable(): ReadonlyMap<string, string> {
  const table = new Map<string, string>();
  const addRun = (names: string, first: number): void => {
    for (const [index, name] of names.split(' ').entries()) {
      table.set(name, String.fromCodePoint(first + index));
    }
  };
  addRun(LATIN_1_ENTITIES, 0xa0);
  addRun(GREEK_UPPER, 913);
  addRun(GREEK_LOWER, 945);
  for (const [name, codePoint] of Object.entries(OTHER_ENTITIES)) {
    table.set(name, String.fromCodePoint(codePoint));
  }
  return table;
}

const ENTITIES = entityTable();
const ENTITY_AT =
  /&(?:#(\d{1,7})|#[xX]([0-9a-fA-F]{1,6})|([A-Za-z][A-Za-z0-9]{1,31}));/y;
const ENTITY_ANYWHERE = new RegExp(ENTITY_AT.source, 'g');
const NBSP_ALL = /\u00a0/g;

type Decoded = { char: string; length: number };

function decodeEntity(match: RegExpExecArray): Decoded | null {
  const [entity, decimal, hex, name] = match;
  if (name !== undefined) {
    const char = ENTITIES.get(name);
    return char ? { char, length: entity.length } : null;
  }
  const codePoint =
    decimal !== undefined
      ? Number.parseInt(decimal, 10)
      : Number.parseInt(hex ?? '', 16);
  if (
    !Number.isFinite(codePoint) ||
    codePoint === 0 ||
    codePoint > 0x10ffff ||
    (codePoint >= 0xd800 && codePoint <= 0xdfff)
  ) {
    return null;
  }
  return { char: String.fromCodePoint(codePoint), length: entity.length };
}

function entityAt(raw: string, index: number): Decoded | null {
  ENTITY_AT.lastIndex = index;
  const match = ENTITY_AT.exec(raw);
  return match ? decodeEntity(match) : null;
}

/**
 * Collects flows of decoded text, each segment mapping its projected offsets
 * back to offsets in the raw string (always at the field value itself).
 */
class FlowBuilder {
  readonly flows: StructuredTextFlow[] = [];
  private text = '';
  private segments: FlowSegment[] = [];

  constructor(
    /** Shows non-breaking spaces as plain spaces, as editors see them. */
    private readonly nbspAsSpace: boolean,
    private readonly subfield?: TextSubfield,
  ) {}

  private segment(segment: FlowSegment): void {
    this.segments.push(
      this.subfield ? { ...segment, subfield: this.subfield } : segment,
    );
  }

  private visible(text: string): string {
    return this.nbspAsSpace ? text.replace(NBSP_ALL, ' ') : text;
  }

  /** Raw characters `start` to `end`, stored as they read. */
  verbatim(raw: string, start: number, end: number): void {
    if (end <= start) return;
    const projectedStart = this.text.length;
    this.text += this.visible(raw.slice(start, end));
    this.segment({
      path: [],
      projectedStart,
      projectedEnd: this.text.length,
      rawStart: start,
    });
  }

  /** One character stored encoded in the raw characters `start` to `end`. */
  encoded(start: number, end: number, char: string): void {
    const projectedStart = this.text.length;
    this.text += this.visible(char);
    this.segment({
      path: [],
      projectedStart,
      projectedEnd: this.text.length,
      rawStart: start,
      rawEnd: end,
    });
  }

  /** Ends the current flow: no match spans a flow boundary. */
  flush(): void {
    if (this.text.length > 0) {
      this.flows.push({
        text: this.text,
        flowPath: [],
        segments: this.segments,
      });
    }
    this.text = '';
    this.segments = [];
  }
}

/**
 * Tags that end a run of text: block elements and line breaks (they read
 * as separate lines), links (as in Structured Text, a match never starts
 * outside a link and ends inside it), and embedded media.
 */
const BOUNDARY_TAGS = new Set([
  'a',
  'address',
  'article',
  'aside',
  'audio',
  'blockquote',
  'br',
  'caption',
  'dd',
  'details',
  'div',
  'dl',
  'dt',
  'figcaption',
  'figure',
  'footer',
  'h1',
  'h2',
  'h3',
  'h4',
  'h5',
  'h6',
  'header',
  'hr',
  'iframe',
  'img',
  'li',
  'main',
  'nav',
  'ol',
  'p',
  'pre',
  'section',
  'summary',
  'table',
  'tbody',
  'td',
  'tfoot',
  'th',
  'thead',
  'tr',
  'ul',
  'video',
]);

/** Elements whose content is never visible text. */
const RAW_TEXT_TAGS = new Set(['script', 'style']);

const TAG_NAME_AT = /<(\/?)([A-Za-z][A-Za-z0-9-]*)/y;

type Range = { start: number; end: number };

type Tag = { end: number; boundary: boolean; href?: Range };

/** The end of a tag's `>`, skipping quoted attribute values; -1 if unclosed. */
function tagEnd(raw: string, from: number): number {
  let quote: string | null = null;
  for (let index = from; index < raw.length; index += 1) {
    const char = raw[index];
    if (quote) {
      if (char === quote) quote = null;
    } else if (char === '"' || char === "'") {
      quote = char;
    } else if (char === '>') {
      return index + 1;
    }
  }
  return -1;
}

const HREF_ATTRIBUTE = /\shref\s*=\s*("([^"]*)"|'([^']*)'|[^\s"'=<>`]+)/i;

/** The value of the `href` attribute of the tag from `start` to `end`. */
function hrefRange(raw: string, start: number, end: number): Range | undefined {
  const match = HREF_ATTRIBUTE.exec(raw.slice(start, end));
  const value = match?.[1];
  if (!match || value === undefined) return undefined;
  const quoted = match[2] ?? match[3];
  const valueStart =
    start +
    match.index +
    match[0].length -
    value.length +
    (quoted === undefined ? 0 : 1);
  const length = quoted === undefined ? value.length : quoted.length;
  return length > 0
    ? { start: valueStart, end: valueStart + length }
    : undefined;
}

/** A tag or comment starting at `index` (a `<`), or null for a literal `<`. */
function tagAt(raw: string, index: number): Tag | null {
  if (raw.startsWith('<!--', index)) {
    const close = raw.indexOf('-->', index + 4);
    return { end: close < 0 ? raw.length : close + 3, boundary: false };
  }

  TAG_NAME_AT.lastIndex = index;
  const match = TAG_NAME_AT.exec(raw);
  if (!match) return null;
  const end = tagEnd(raw, TAG_NAME_AT.lastIndex);
  if (end < 0) return null;

  const closing = match[1] === '/';
  const name = (match[2] ?? '').toLowerCase();
  if (!closing && RAW_TEXT_TAGS.has(name)) {
    const closeTag = new RegExp(`</${name}`, 'gi');
    closeTag.lastIndex = end;
    const close = closeTag.exec(raw)?.index ?? -1;
    const closeEnd = close < 0 ? -1 : tagEnd(raw, close);
    return { end: closeEnd < 0 ? raw.length : closeEnd, boundary: true };
  }
  if (!closing && name === 'a') {
    return { end, boundary: true, href: hrefRange(raw, index, end) };
  }
  return { end, boundary: BOUNDARY_TAGS.has(name) };
}

/**
 * An entity (`char` is what it stands for) or a tag (`char` is null, `href`
 * the URL of a link).
 */
type Token = {
  end: number;
  char: string | null;
  boundary: boolean;
  href?: Range;
};

/** The entity, or with `markup` the tag, starting at `index`. */
function tokenAt(raw: string, index: number, markup: boolean): Token | null {
  const char = raw[index];
  if (char === '&') {
    const entity = entityAt(raw, index);
    return entity
      ? { end: index + entity.length, char: entity.char, boundary: false }
      : null;
  }
  if (markup && char === '<') {
    const tag = tagAt(raw, index);
    return tag ? { ...tag, char: null } : null;
  }
  return null;
}

/** HTML text fields: the visible text, not the markup. */
export function storesMarkup(field: SchemaField): boolean {
  const appearance = field.raw.appearance as { editor?: unknown } | undefined;
  return field.fieldType === 'text' && appearance?.editor === 'wysiwyg';
}

function decodeInto(
  flow: FlowBuilder,
  raw: string,
  from: number,
  to: number,
  markup: boolean,
): void {
  let runStart = from;
  let index = from;

  while (index < to) {
    const token = tokenAt(raw, index, markup);
    if (!token || token.end > to) {
      index += 1;
      continue;
    }
    flow.verbatim(raw, runStart, index);
    if (token.char !== null) flow.encoded(index, token.end, token.char);
    if (token.boundary) flow.flush();
    if (token.href) {
      const link = new FlowBuilder(false, 'link_url');
      decodeInto(link, raw, token.href.start, token.href.end, false);
      link.flush();
      flow.flows.push(...link.flows);
    }
    index = token.end;
    runStart = index;
  }

  flow.verbatim(raw, runStart, to);
}

/**
 * The decoded text of a text field value. With `markup` (HTML editor) tags
 * are left out, block tags split the text into separate flows, and each link
 * URL is a flow of its own; otherwise only entities are decoded.
 * Non-breaking spaces read as spaces.
 */
export function projectEncodedText(
  raw: string,
  markup: boolean,
): StructuredTextFlow[] {
  const flow = new FlowBuilder(true);
  decodeInto(flow, raw, 0, raw.length, markup);
  flow.flush();
  return flow.flows;
}

const HTML_ESCAPES: ReadonlyMap<string, string> = new Map([
  ['&', '&amp;'],
  ['<', '&lt;'],
  ['>', '&gt;'],
]);
const NO_ESCAPES: ReadonlyMap<string, string> = new Map();

/**
 * Encodes inserted text for a text field: a character the value already
 * stores as an entity is written with that same entity, and an HTML value
 * also escapes `&`, `<` and `>`.
 */
export function encodedTextEncoder(
  raw: string,
  markup: boolean,
): (text: string) => string {
  const entities = new Map<string, string>();
  for (const match of raw.matchAll(ENTITY_ANYWHERE)) {
    const decoded = decodeEntity(match);
    if (decoded && !entities.has(decoded.char)) {
      entities.set(decoded.char, match[0]);
    }
  }

  const escapes = markup ? HTML_ESCAPES : NO_ESCAPES;
  return (text) => {
    let result = '';
    for (const char of text) {
      result += entities.get(char) ?? escapes.get(char) ?? char;
    }
    return result;
  };
}

const QUOTE_ENTITIES: Readonly<Record<string, string>> = {
  '"': '&quot;',
  "'": '&#39;',
};

/** Encodes text inserted into an attribute value (a link URL): quotes too. */
export function attributeEncoder(
  encode: (text: string) => string,
): (text: string) => string {
  return (text) =>
    encode(text).replace(/["']/g, (quote) => QUOTE_ENTITIES[quote] ?? quote);
}

const JSON_ESCAPES: Readonly<Record<string, string>> = {
  '"': '"',
  '\\': '\\',
  '/': '/',
  b: '\b',
  f: '\f',
  n: '\n',
  r: '\r',
  t: '\t',
};
const UNICODE_ESCAPE_AT = /\\u([0-9a-fA-F]{4})/y;

function unicodeEscapeAt(raw: string, index: number): number | null {
  UNICODE_ESCAPE_AT.lastIndex = index;
  const match = UNICODE_ESCAPE_AT.exec(raw);
  return match ? Number.parseInt(match[1] ?? '', 16) : null;
}

/** The escape sequence at `index` (a backslash) inside a valid JSON string. */
function jsonEscapeAt(raw: string, index: number): Decoded {
  const unit = unicodeEscapeAt(raw, index);
  if (unit === null) {
    return { char: JSON_ESCAPES[raw[index + 1] ?? ''] ?? '', length: 2 };
  }
  if (unit >= 0xd800 && unit <= 0xdbff) {
    const low = unicodeEscapeAt(raw, index + 6);
    if (low !== null && low >= 0xdc00 && low <= 0xdfff) {
      return { char: String.fromCharCode(unit, low), length: 12 };
    }
  }
  return { char: String.fromCharCode(unit), length: 6 };
}

/**
 * The string values of a JSON field value, one flow each, decoded. Object
 * keys, numbers and the structure itself are never matched, so a replacement
 * always leaves the JSON valid. A value that isn't valid JSON has no flows.
 */
export function projectJsonText(raw: string): StructuredTextFlow[] {
  try {
    JSON.parse(raw);
  } catch {
    return [];
  }

  const flows: StructuredTextFlow[] = [];
  let index = 0;
  while (index < raw.length) {
    if (raw[index] !== '"') {
      index += 1;
      continue;
    }

    const flow = new FlowBuilder(false);
    let cursor = index + 1;
    let runStart = cursor;
    while (cursor < raw.length && raw[cursor] !== '"') {
      if (raw[cursor] === '\\') {
        const sequence = jsonEscapeAt(raw, cursor);
        flow.verbatim(raw, runStart, cursor);
        flow.encoded(cursor, cursor + sequence.length, sequence.char);
        cursor += sequence.length;
        runStart = cursor;
      } else {
        cursor += 1;
      }
    }
    flow.verbatim(raw, runStart, cursor);
    flow.flush();

    index = cursor + 1;
    let next = index;
    while (next < raw.length && /\s/.test(raw[next] ?? '')) next += 1;
    if (raw[next] !== ':') flows.push(...flow.flows);
  }
  return flows;
}

const ESCAPED_NON_ASCII =
  /\\u(?:00[89a-fA-F]|0[1-9a-fA-F][0-9a-fA-F]|[1-9a-fA-F][0-9a-fA-F]{2})[0-9a-fA-F]/;

/**
 * Encodes inserted text as the inside of a JSON string. When the value
 * writes non-ASCII characters as `\u` escapes, so does the inserted text.
 */
export function jsonTextEncoder(raw: string): (text: string) => string {
  const asciiOnly = ESCAPED_NON_ASCII.test(raw);
  return (text) => {
    const encoded = JSON.stringify(text).slice(1, -1);
    return asciiOnly
      ? encoded.replace(
          /[\u0080-\uffff]/g,
          (char) => `\\u${char.charCodeAt(0).toString(16).padStart(4, '0')}`,
        )
      : encoded;
  };
}
