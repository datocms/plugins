import { captureGroupInfo } from '../selection/matcher';
import type { ExactMatchRef, MatcherSpec } from '../selection/types';

export type TemplatePart =
  | { type: 'text'; value: string }
  | { type: 'match' }
  | { type: 'group'; index: number }
  | { type: 'named'; name: string };

/**
 * A compiled replacement. `literal` is inserted as-is (text mode: `$` has no
 * meaning, as in VS Code). `pattern` expands per match (regex mode).
 */
export type ReplacementTemplate =
  | { kind: 'literal'; text: string }
  | { kind: 'pattern'; parts: ReadonlyArray<TemplatePart> };

export type TemplateCompilation =
  | {
      ok: true;
      template: ReplacementTemplate;
      /**
       * References kept literally (or expanded to '') because the pattern has
       * no such group, in template order: `$3`, `$<x>`. For the warning.
       */
      outOfRange: ReadonlyArray<string>;
    }
  /** The template uses $` or $' (they need text around the match that isn't kept). */
  | { ok: false; code: 'context_token' };

/** What a template needs from a match: an `ExactMatchRef` or a `TextMatch`. */
export type TemplateMatch = Pick<
  ExactMatchRef,
  'matchedText' | 'captures' | 'namedCaptures'
>;

type GroupInfo = ReturnType<typeof captureGroupInfo>;

type Token = { part: TemplatePart; length: number; outOfRange?: string };

function isDigit(character: string): boolean {
  return character.length === 1 && character >= '0' && character <= '9';
}

/**
 * `$n` / `$nn` as in JavaScript's GetSubstitution: two digits when that group
 * exists, else one digit (the second digit stays literal) when that one does,
 * else the reference is literal. `$0` and `$00` are always literal.
 */
function numberedReference(
  template: string,
  index: number,
  groups: GroupInfo,
): Token {
  const first = template.charAt(index + 1);
  const second = template.charAt(index + 2);
  const oneDigit = Number(first);

  if (isDigit(second)) {
    const twoDigits = Number(first + second);
    if (twoDigits >= 1 && twoDigits <= groups.count) {
      return { part: { type: 'group', index: twoDigits }, length: 3 };
    }
    if (twoDigits <= groups.count) {
      // "$00": there is no group 0, so the reference stays literal.
      return {
        part: { type: 'text', value: template.slice(index, index + 3) },
        length: 3,
      };
    }
  }

  if (oneDigit >= 1 && oneDigit <= groups.count) {
    return { part: { type: 'group', index: oneDigit }, length: 2 };
  }

  const reference = template.slice(index, index + 2);
  const written = template.slice(index, index + (isDigit(second) ? 3 : 2));
  return {
    part: { type: 'text', value: reference },
    length: 2,
    ...(oneDigit >= 1 || isDigit(second) ? { outOfRange: written } : {}),
  };
}

/** `$<name>`: literal unless the pattern has named groups. */
function namedReference(
  template: string,
  index: number,
  groups: GroupInfo,
): Token {
  const close = groups.names.length > 0 ? template.indexOf('>', index + 2) : -1;
  if (close < 0) {
    return { part: { type: 'text', value: '$<' }, length: 2 };
  }

  const name = template.slice(index + 2, close);
  return {
    part: { type: 'named', name },
    length: close + 1 - index,
    ...(groups.names.includes(name)
      ? {}
      : { outOfRange: template.slice(index, close + 1) }),
  };
}

/** The token starting at a `$`, or null for $` and $'. */
function dollarToken(
  template: string,
  index: number,
  groups: GroupInfo,
): Token | null {
  const next = template.charAt(index + 1);
  switch (next) {
    case '$':
      return { part: { type: 'text', value: '$' }, length: 2 };
    case '&':
      return { part: { type: 'match' }, length: 2 };
    case '`':
    case "'":
      return null;
    case '<':
      return namedReference(template, index, groups);
    default:
      return isDigit(next)
        ? numberedReference(template, index, groups)
        : { part: { type: 'text', value: '$' }, length: 1 };
  }
}

function appendPart(parts: TemplatePart[], part: TemplatePart): void {
  const previous = parts[parts.length - 1];
  if (part.type === 'text' && previous?.type === 'text') {
    parts[parts.length - 1] = {
      type: 'text',
      value: previous.value + part.value,
    };
    return;
  }
  parts.push(part);
}

/**
 * Compiles the Replace input once per change. Literal matchers keep the text
 * verbatim. Regex matchers follow JavaScript's `String.prototype.replace`
 * rules, without $` and $' (rejected): `$$`, `$&`, `$n`/`$nn`, `$<name>`.
 */
export function compileReplacementTemplate(
  text: string,
  matcher: MatcherSpec,
): TemplateCompilation {
  if (matcher.kind === 'literal') {
    return { ok: true, template: { kind: 'literal', text }, outOfRange: [] };
  }

  const groups = captureGroupInfo(matcher);
  const parts: TemplatePart[] = [];
  const outOfRange: string[] = [];
  let index = 0;

  while (index < text.length) {
    const dollar = text.indexOf('$', index);
    if (dollar < 0) {
      appendPart(parts, { type: 'text', value: text.slice(index) });
      break;
    }
    if (dollar > index) {
      appendPart(parts, { type: 'text', value: text.slice(index, dollar) });
    }

    const token = dollarToken(text, dollar, groups);
    if (!token) return { ok: false, code: 'context_token' };
    appendPart(parts, token.part);
    if (token.outOfRange) outOfRange.push(token.outOfRange);
    index = dollar + token.length;
  }

  return { ok: true, template: { kind: 'pattern', parts }, outOfRange };
}

/** A literal template for `text` (text mode, or a regex replacement without `$`). */
export function literalTemplate(text: string): ReplacementTemplate {
  return { kind: 'literal', text };
}

function namedCapture(match: TemplateMatch, name: string): string {
  if (!match.namedCaptures) return '';
  // Own properties only: a structured-cloned object has a prototype.
  const value = Object.getOwnPropertyDescriptor(match.namedCaptures, name)
    ?.value as unknown;
  return typeof value === 'string' ? value : '';
}

/**
 * The text that replaces one match. Pure and linear: it never runs a regular
 * expression, so the preview (main thread) and the write use the same
 * function and can't disagree. Unmatched or missing groups expand to ''.
 */
export function expandReplacement(
  template: ReplacementTemplate,
  match: TemplateMatch,
): string {
  if (template.kind === 'literal') return template.text;

  let result = '';
  for (const part of template.parts) {
    switch (part.type) {
      case 'text':
        result += part.value;
        break;
      case 'match':
        result += match.matchedText;
        break;
      case 'group':
        result += match.captures?.[part.index - 1] ?? '';
        break;
      case 'named':
        result += namedCapture(match, part.name);
        break;
    }
  }
  return result;
}

/** True when the expanded replacement equals the matched text (nothing changes). */
export function isNoOpMatch(
  template: ReplacementTemplate,
  match: TemplateMatch,
): boolean {
  return expandReplacement(template, match) === match.matchedText;
}

/** A per-match replacer for `replaceExactMatches` and `prepareRootChanges`. */
export function templateReplacer(
  template: ReplacementTemplate,
): (match: TemplateMatch) => string {
  return (match) => expandReplacement(template, match);
}
