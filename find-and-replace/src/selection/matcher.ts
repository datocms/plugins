import { type AST, RegExpParser } from '@eslint-community/regexpp';
import { fingerprintString, stableSerialize } from './identity';
import type {
  ExactMatchRef,
  MatchCaptures,
  MatchContext,
  MatcherSpec,
  MatcherValidation,
  MatcherValidationErrorCode,
  StructuredTextMatch,
  TextFragment,
  TextMatch,
  TraversedFieldValue,
  ValuePath,
} from './types';

type UnknownRecord = Record<string, unknown>;

type FlowSegment = {
  path: ValuePath;
  projectedStart: number;
  projectedEnd: number;
};

export type StructuredTextFlow = {
  text: string;
  flowPath: ValuePath;
  segments: ReadonlyArray<FlowSegment>;
};

export type MatcherWorkerRequest = {
  id: number;
  type: 'match_texts';
  texts: string[];
  matcher: MatcherSpec;
};

export type MatcherWorkerSuccess = {
  id: number;
  ok: true;
  matches: TextMatch[][];
};

export type MatcherWorkerFailure = {
  id: number;
  ok: false;
  error: {
    name: string;
    message: string;
    code?: MatcherValidationErrorCode;
  };
};

export type MatcherWorkerResponse = MatcherWorkerSuccess | MatcherWorkerFailure;

/** Limits for one batched worker request (see `matchesForTraversedFieldsInWorker`). */
export type MatchChunkLimits = {
  /** Texts per `matchTexts` request. */
  maxTexts: number;
  /** UTF-16 units per request; a single longer text still gets its own request. */
  maxChars: number;
  /** Safety timeout for each request, counted from when it is sent. */
  timeoutMs: number;
};

export const DEFAULT_MATCH_CHUNK_LIMITS: MatchChunkLimits = {
  maxTexts: 2_000,
  maxChars: 1_000_000,
  timeoutMs: 10_000,
};

const CONTEXT_RADIUS = 48;
const MAX_CAUSE_LENGTH = 40;
/** Letters, combining marks, digits and underscore count as word characters. */
const WORD_CHARACTER = '[\\p{L}\\p{M}\\p{N}_]';
const regexpParser = new RegExpParser({ ecmaVersion: 2025 });

export class MatcherValidationError extends Error {
  constructor(
    public readonly code: MatcherValidationErrorCode,
    message: string,
    /** Short parser reason for `invalid_regex` ("unterminated group"). */
    public readonly reason: string | null = null,
  ) {
    super(message);
    this.name = 'MatcherValidationError';
  }
}

function asRecord(value: unknown): UnknownRecord | null {
  return value !== null && typeof value === 'object' && !Array.isArray(value)
    ? (value as UnknownRecord)
    : null;
}

function escapeRegex(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

function regexFlags(spec: MatcherSpec): string {
  return `gu${spec.caseSensitive ? '' : 'i'}`;
}

/**
 * The parser's reason is the text after the last ": " of a `SyntaxError`
 * ("Invalid regular expression: /a(/gu: Unterminated group").
 */
function syntaxErrorReason(error: unknown): string | null {
  if (!(error instanceof Error)) return null;
  const separator = error.message.lastIndexOf(': ');
  const reason = (
    separator >= 0 ? error.message.slice(separator + 2) : error.message
  ).trim();
  if (reason.length === 0 || reason.length > MAX_CAUSE_LENGTH) return null;
  return reason.charAt(0).toLowerCase() + reason.slice(1);
}

function compileExpression(source: string, flags: string): RegExp {
  try {
    return new RegExp(source, flags);
  } catch (error) {
    const detail =
      error instanceof Error ? error.message : 'Invalid expression.';
    throw new MatcherValidationError(
      'invalid_regex',
      `Invalid regular expression: ${detail}`,
      syntaxErrorReason(error),
    );
  }
}

function createRegularExpression(spec: MatcherSpec): RegExp {
  if (spec.pattern.length === 0) {
    throw new MatcherValidationError(
      'empty_pattern',
      'Enter text or a regular expression to match.',
    );
  }

  const core =
    spec.kind === 'literal' ? escapeRegex(spec.pattern) : spec.pattern;
  const flags = regexFlags(spec);
  // The raw pattern is always compiled on its own first, so a pattern such as
  // `a)(b` can never become valid (or change meaning) inside the wrapper.
  const expression = compileExpression(core, flags);
  if (!spec.wholeWord) return expression;

  return compileExpression(
    `(?<!${WORD_CHARACTER})(?:${core})(?!${WORD_CHARACTER})`,
    flags,
  );
}

function parseRegexPattern(pattern: string): AST.Pattern {
  return regexpParser.parsePattern(pattern, 0, pattern.length, {
    unicode: true,
    unicodeSets: false,
  });
}

function alternativeCanBeEmpty(alternative: AST.Alternative): boolean {
  return alternative.elements.every(elementCanBeEmpty);
}

function alternativesCanBeEmpty(
  alternatives: ReadonlyArray<AST.Alternative>,
): boolean {
  return alternatives.some(alternativeCanBeEmpty);
}

function nodeContains(ancestor: AST.Node, node: AST.Node): boolean {
  return node.start >= ancestor.start && node.end <= ancestor.end;
}

/**
 * An alternative on the route from a capture to a backreference only
 * guarantees the capture when the reference sits in the same branch, and a
 * negative lookaround never leaves its captures set for the outside.
 */
function alternativeGuaranteesCapture(
  alternative: AST.Alternative,
  reference: AST.Backreference,
): boolean {
  const container: AST.Node = alternative.parent;
  if (
    container.alternatives.length > 1 &&
    !nodeContains(alternative, reference)
  ) {
    return false;
  }
  return !(
    container.type === 'Assertion' &&
    container.negate &&
    !nodeContains(container, reference)
  );
}

function captureIsGuaranteedBeforeReference(
  capture: AST.CapturingGroup,
  reference: AST.Backreference,
): boolean {
  if (capture.end > reference.start) return false;

  let current: AST.Node = capture;
  while (current.parent) {
    const parent: AST.Node = current.parent;
    if (parent.type === 'Quantifier' && parent.min === 0) return false;
    if (
      parent.type === 'Alternative' &&
      !alternativeGuaranteesCapture(parent, reference)
    ) {
      return false;
    }
    current = parent.type === 'Alternative' ? parent.parent : parent;
  }

  return true;
}

function backreferenceCanBeEmpty(reference: AST.Backreference): boolean {
  if (reference.ambiguous) return true;
  return (
    !captureIsGuaranteedBeforeReference(reference.resolved, reference) ||
    alternativesCanBeEmpty(reference.resolved.alternatives)
  );
}

/**
 * Determines whether an element can complete without consuming a character.
 * Assertions consume nothing. Backreferences consume their capture only when
 * that non-empty capture dominates the reference on every matching path.
 */
function elementCanBeEmpty(element: AST.Element): boolean {
  switch (element.type) {
    case 'Assertion':
      return true;
    case 'Backreference':
      return backreferenceCanBeEmpty(element);
    case 'CapturingGroup':
    case 'Group':
      return alternativesCanBeEmpty(element.alternatives);
    case 'Quantifier':
      return element.min === 0 || elementCanBeEmpty(element.element);
    case 'Character':
    case 'CharacterClass':
    case 'CharacterSet':
    case 'ExpressionCharacterClass':
      return false;
  }
}

/** Runs on the raw pattern: the whole-word wrapper never makes it empty. */
function assertNoZeroWidthMatch(spec: MatcherSpec): void {
  if (spec.kind !== 'regex') return;
  const pattern = parseRegexPattern(spec.pattern);
  if (!alternativesCanBeEmpty(pattern.alternatives)) return;

  throw new MatcherValidationError(
    'zero_width',
    'Regular expressions that can match an empty position are not supported.',
  );
}

export function validateMatcherSpec(spec: MatcherSpec): MatcherValidation {
  try {
    createRegularExpression(spec);
    assertNoZeroWidthMatch(spec);
    return { valid: true };
  } catch (error) {
    if (error instanceof MatcherValidationError) {
      return {
        valid: false,
        code: error.code,
        message: error.message,
        cause: error.reason,
      };
    }

    return {
      valid: false,
      code: 'invalid_regex',
      message: error instanceof Error ? error.message : 'Invalid matcher.',
      cause: syntaxErrorReason(error),
    };
  }
}

function collectCapturingGroups(
  alternatives: ReadonlyArray<AST.Alternative>,
  groups: AST.CapturingGroup[],
): void {
  for (const alternative of alternatives) {
    for (const element of alternative.elements) {
      collectElementGroups(element, groups);
    }
  }
}

function collectElementGroups(
  element: AST.Element,
  groups: AST.CapturingGroup[],
): void {
  switch (element.type) {
    case 'CapturingGroup':
      groups.push(element);
      collectCapturingGroups(element.alternatives, groups);
      return;
    case 'Group':
      collectCapturingGroups(element.alternatives, groups);
      return;
    case 'Assertion':
      if ('alternatives' in element) {
        collectCapturingGroups(element.alternatives, groups);
      }
      return;
    case 'Quantifier':
      collectElementGroups(element.element, groups);
      return;
    default:
      return;
  }
}

/**
 * Capture groups of a matcher, in pattern order: how many there are and the
 * distinct group names. Literal matchers (and unparsable patterns) have none.
 */
export function captureGroupInfo(spec: MatcherSpec): {
  count: number;
  names: ReadonlyArray<string>;
} {
  if (spec.kind !== 'regex' || spec.pattern.length === 0) {
    return { count: 0, names: [] };
  }

  let pattern: AST.Pattern;
  try {
    pattern = parseRegexPattern(spec.pattern);
  } catch {
    return { count: 0, names: [] };
  }

  const groups: AST.CapturingGroup[] = [];
  collectCapturingGroups(pattern.alternatives, groups);
  const names = new Set<string>();
  for (const group of groups) {
    if (group.name !== null) names.add(group.name);
  }
  return { count: groups.length, names: [...names] };
}

export function matcherFingerprint(spec: MatcherSpec): string {
  return fingerprintString(
    stableSerialize({
      kind: spec.kind,
      pattern: spec.pattern,
      caseSensitive: spec.caseSensitive,
      wholeWord: spec.wholeWord,
      regexFlags: regexFlags(spec),
    }),
  );
}

function safeContextStart(text: string, start: number): number {
  let result = Math.max(0, start - CONTEXT_RADIUS);
  if (
    result > 0 &&
    text.charCodeAt(result) >= 0xdc00 &&
    text.charCodeAt(result) <= 0xdfff
  ) {
    result -= 1;
  }
  return result;
}

function safeContextEnd(text: string, end: number): number {
  let result = Math.min(text.length, end + CONTEXT_RADIUS);
  if (
    result < text.length &&
    result > 0 &&
    text.charCodeAt(result - 1) >= 0xd800 &&
    text.charCodeAt(result - 1) <= 0xdbff
  ) {
    result += 1;
  }
  return result;
}

function matchContext(text: string, start: number, end: number): MatchContext {
  const contextStart = safeContextStart(text, start);
  const contextEnd = safeContextEnd(text, end);

  return {
    before: text.slice(contextStart, start),
    match: text.slice(start, end),
    after: text.slice(end, contextEnd),
    beforeTruncated: contextStart > 0,
    afterTruncated: contextEnd < text.length,
  };
}

function capturesOf(match: RegExpExecArray): MatchCaptures {
  const captures: MatchCaptures = {};
  if (match.length > 1) {
    captures.captures = match.slice(1).map((value) => value ?? null);
  }
  if (match.groups) {
    const named: Record<string, string | null> = {};
    for (const [name, value] of Object.entries(match.groups)) {
      named[name] = value ?? null;
    }
    captures.namedCaptures = named;
  }
  return captures;
}

function zeroWidthError(): MatcherValidationError {
  return new MatcherValidationError(
    'zero_width',
    'Regular expressions that can match an empty position are not supported.',
  );
}

/**
 * Validates and compiles a matcher once, returning a function that matches
 * one text at a time. Use it to match many texts with the same matcher.
 */
export function createTextMatcher(
  spec: MatcherSpec,
): (text: string) => TextMatch[] {
  const expression = createRegularExpression(spec);
  assertNoZeroWidthMatch(spec);
  const keepCaptures = spec.kind === 'regex';

  return (text) => {
    const matches: TextMatch[] = [];
    expression.lastIndex = 0;

    for (
      let match = expression.exec(text);
      match !== null;
      match = expression.exec(text)
    ) {
      if (match[0].length === 0) {
        expression.lastIndex = 0;
        throw zeroWidthError();
      }

      const start = match.index;
      const end = start + match[0].length;
      matches.push({
        occurrenceIndex: matches.length,
        start,
        end,
        matchedText: match[0],
        context: matchContext(text, start, end),
        ...(keepCaptures ? capturesOf(match) : {}),
      });
    }

    return matches;
  };
}

/** Returns non-overlapping matches with native JavaScript UTF-16 offsets. */
export function matchText(text: string, spec: MatcherSpec): TextMatch[] {
  return createTextMatcher(spec)(text);
}

function structuredTextRoot(
  value: unknown,
): { root: UnknownRecord; rootPath: ValuePath } | null {
  const structuredText = asRecord(value);
  if (!structuredText) return null;
  const document = asRecord(structuredText.document);
  if (document?.type === 'root') {
    return { root: document, rootPath: ['document'] };
  }
  return structuredText.type === 'root'
    ? { root: structuredText, rootPath: [] }
    : null;
}

function projectInlineFlow(
  children: ReadonlyArray<unknown>,
  childrenPath: ValuePath,
  flowPath: ValuePath,
): StructuredTextFlow[] {
  const flows: StructuredTextFlow[] = [];
  let text = '';
  let segments: FlowSegment[] = [];

  const flush = (): void => {
    if (text.length > 0) {
      flows.push({ text, flowPath, segments });
    }
    text = '';
    segments = [];
  };

  const visitInline = (value: unknown, path: ValuePath): void => {
    const node = asRecord(value);
    if (!node) return;

    if (node.type === 'span' && typeof node.value === 'string') {
      const projectedStart = text.length;
      text += node.value;
      segments.push({
        path: [...path, 'value'],
        projectedStart,
        projectedEnd: text.length,
      });
      return;
    }

    if (node.type === 'link' || node.type === 'itemLink') {
      // A link boundary carries semantics in addition to formatting. Keep the
      // prose inside it independently matchable, but never create a match that
      // starts outside the link and ends inside it (or vice versa).
      flush();
      const nestedChildren = Array.isArray(node.children) ? node.children : [];
      flows.push(
        ...projectInlineFlow(nestedChildren, [...path, 'children'], path),
      );
      return;
    }

    // Inline blocks/items are visible boundaries. Do not create a false match
    // by concatenating prose from opposite sides of an embedded entity.
    flush();
  };

  for (const [index, child] of children.entries()) {
    visitInline(child, [...childrenPath, index]);
  }
  flush();
  return flows;
}

function projectSeoText(value: unknown): StructuredTextFlow[] {
  const seo = asRecord(value);
  if (!seo) return [];

  return (['title', 'description'] as const).flatMap((key) => {
    const text = seo[key];
    if (typeof text !== 'string' || text.length === 0) return [];
    return [
      {
        text,
        flowPath: [key],
        segments: [
          {
            path: [key],
            projectedStart: 0,
            projectedEnd: text.length,
          },
        ],
      },
    ];
  });
}

function nodeChildren(node: UnknownRecord): ReadonlyArray<unknown> {
  return Array.isArray(node.children) ? node.children : [];
}

/** A code block is one flow of its own; its text lives in `code`. */
function codeFlow(node: UnknownRecord, path: ValuePath): StructuredTextFlow[] {
  if (typeof node.code !== 'string' || node.code.length === 0) return [];
  return [
    {
      text: node.code,
      flowPath: path,
      segments: [
        {
          path: [...path, 'code'],
          projectedStart: 0,
          projectedEnd: node.code.length,
        },
      ],
    },
  ];
}

/** Projects independently matchable visible prose flows from a DAST value. */
export function projectStructuredText(value: unknown): StructuredTextFlow[] {
  const resolved = structuredTextRoot(value);
  if (!resolved) return [];
  const flows: StructuredTextFlow[] = [];

  const visitNode = (valueToVisit: unknown, path: ValuePath): void => {
    const node = asRecord(valueToVisit);
    if (!node) return;

    if (node.type === 'paragraph' || node.type === 'heading') {
      flows.push(
        ...projectInlineFlow(nodeChildren(node), [...path, 'children'], path),
      );
      return;
    }

    if (node.type === 'code') {
      flows.push(...codeFlow(node, path));
      return;
    }

    for (const [index, child] of nodeChildren(node).entries()) {
      visitNode(child, [...path, 'children', index]);
    }
  };

  visitNode(resolved.root, resolved.rootPath);
  return flows;
}

/**
 * Every independently matchable text of a field value, in document order. A
 * plain string is one flow whose single segment is the value itself. Values
 * that are missing or can't hold exact matches have none.
 */
export function projectFieldText(
  fieldValue: TraversedFieldValue,
): StructuredTextFlow[] {
  if (!fieldValue.ref.present || !fieldValue.field.exactMatchCompatible) {
    return [];
  }

  switch (fieldValue.field.fieldType) {
    case 'structured_text':
      return projectStructuredText(fieldValue.value);
    case 'seo':
      return projectSeoText(fieldValue.value);
    default: {
      const text = fieldValue.value;
      if (typeof text !== 'string' || text.length === 0) return [];
      return [
        {
          text,
          flowPath: [],
          segments: [
            { path: [], projectedStart: 0, projectedEnd: text.length },
          ],
        },
      ];
    }
  }
}

function fragmentsForMatch(
  match: TextMatch,
  segments: ReadonlyArray<FlowSegment>,
): TextFragment[] {
  return segments.flatMap((segment) => {
    const projectedStart = Math.max(match.start, segment.projectedStart);
    const projectedEnd = Math.min(match.end, segment.projectedEnd);
    if (projectedStart >= projectedEnd) return [];

    return [
      {
        path: segment.path,
        start: projectedStart - segment.projectedStart,
        end: projectedEnd - segment.projectedStart,
      },
    ];
  });
}

function structuredMatchesFromFlows(
  flows: ReadonlyArray<StructuredTextFlow>,
  matchesByFlow: ReadonlyArray<ReadonlyArray<TextMatch>>,
): StructuredTextMatch[] {
  const matches: StructuredTextMatch[] = [];

  for (const [flowIndex, flow] of flows.entries()) {
    for (const match of matchesByFlow[flowIndex] ?? []) {
      matches.push({
        ...match,
        occurrenceIndex: matches.length,
        flowPath: flow.flowPath,
        fragments: fragmentsForMatch(match, flow.segments),
      });
    }
  }

  return matches;
}

export function matchStructuredText(
  value: unknown,
  spec: MatcherSpec,
): StructuredTextMatch[] {
  const flows = projectStructuredText(value);
  const match = createTextMatcher(spec);
  return structuredMatchesFromFlows(
    flows,
    flows.map((flow) => match(flow.text)),
  );
}

function exactRefsFromMatches(
  fieldValue: TraversedFieldValue,
  fingerprint: string,
  matches: ReadonlyArray<StructuredTextMatch>,
): ExactMatchRef[] {
  return matches.map((match) => ({
    kind: 'exact_match',
    fieldValue: fieldValue.ref,
    matcherFingerprint: fingerprint,
    occurrenceIndex: match.occurrenceIndex,
    matchedText: match.matchedText,
    context: match.context,
    fragments: match.fragments,
    ...(match.captures ? { captures: match.captures } : {}),
    ...(match.namedCaptures ? { namedCaptures: match.namedCaptures } : {}),
  }));
}

/**
 * Turns the matches of each projected flow into exact-match refs. Occurrences
 * are numbered across the flows of the field value, in document order.
 */
function exactRefsFromFlowMatches(
  fieldValue: TraversedFieldValue,
  fingerprint: string,
  flows: ReadonlyArray<StructuredTextFlow>,
  matchesByFlow: ReadonlyArray<ReadonlyArray<TextMatch>>,
): ExactMatchRef[] {
  return exactRefsFromMatches(
    fieldValue,
    fingerprint,
    structuredMatchesFromFlows(flows, matchesByFlow),
  );
}

/** Synchronous matching of many field values (tests and small inline work). */
export function matchesForTraversedFields(
  fieldValues: ReadonlyArray<TraversedFieldValue>,
  spec: MatcherSpec,
): ExactMatchRef[][] {
  const projections = fieldValues.map(projectFieldText);
  if (projections.every((flows) => flows.length === 0)) {
    return projections.map(() => []);
  }

  const fingerprint = matcherFingerprint(spec);
  const match = createTextMatcher(spec);
  return projections.map((flows, index) =>
    exactRefsFromFlowMatches(
      fieldValues[index],
      fingerprint,
      flows,
      flows.map((flow) => match(flow.text)),
    ),
  );
}

export function matchesForTraversedField(
  fieldValue: TraversedFieldValue,
  spec: MatcherSpec,
): ExactMatchRef[] {
  return matchesForTraversedFields([fieldValue], spec)[0] ?? [];
}

type PendingWorkerRequest = {
  request: MatcherWorkerRequest;
  timeoutMs: number;
  resolve: (matches: TextMatch[][]) => void;
  reject: (error: Error) => void;
  removeAbortListener?: () => void;
  clearTimeout?: () => void;
};

function abortError(): DOMException {
  return new DOMException('Matching was cancelled.', 'AbortError');
}

export class MatcherWorkerTimeoutError extends Error {
  constructor(public readonly timeoutMs: number) {
    super(`Matching exceeded the ${timeoutMs} ms safety limit.`);
    this.name = 'MatcherWorkerTimeoutError';
  }
}

/**
 * One worker session is intended to live for exactly one discovery run.
 *
 * The worker answers one request at a time, so the session posts them one at
 * a time too: a request waits in the queue until the previous one answered,
 * and its timeout starts only when it is posted. Two models scanned at once
 * share the session, and neither is ever timed out for time spent waiting
 * behind the other's chunk.
 */
export class MatcherWorkerSession {
  private readonly worker: Worker;
  private readonly queue: PendingWorkerRequest[] = [];
  private inFlight: PendingWorkerRequest | null = null;
  private nextRequestId = 1;
  private terminated = false;
  private terminationReason: Error | null = null;

  constructor(
    workerFactory: () => Worker = () =>
      new Worker(new URL('./matcher.worker.ts', import.meta.url), {
        type: 'module',
        name: 'find-and-replace-matcher',
      }),
  ) {
    this.worker = workerFactory();
    this.worker.addEventListener('message', this.handleMessage);
    this.worker.addEventListener('error', this.handleWorkerError);
  }

  matchText(
    text: string,
    matcher: MatcherSpec,
    signal?: AbortSignal,
    timeoutMs = DEFAULT_MATCH_CHUNK_LIMITS.timeoutMs,
  ): Promise<TextMatch[]> {
    return this.matchTexts([text], matcher, signal, timeoutMs).then(
      (matches) => matches[0] ?? [],
    );
  }

  matchTexts(
    texts: ReadonlyArray<string>,
    matcher: MatcherSpec,
    signal?: AbortSignal,
    timeoutMs = DEFAULT_MATCH_CHUNK_LIMITS.timeoutMs,
  ): Promise<TextMatch[][]> {
    if (signal?.aborted) {
      return Promise.reject(abortError());
    }
    if (this.terminated) {
      return Promise.reject(this.terminationReason ?? abortError());
    }

    const id = this.nextRequestId;
    this.nextRequestId += 1;

    return new Promise<TextMatch[][]>((resolve, reject) => {
      const pending: PendingWorkerRequest = {
        request: { id, type: 'match_texts', texts: [...texts], matcher },
        timeoutMs,
        resolve,
        reject,
      };

      if (signal) {
        const onAbort = (): void => this.terminate(abortError());
        signal.addEventListener('abort', onAbort, { once: true });
        pending.removeAbortListener = () =>
          signal.removeEventListener('abort', onAbort);
      }

      this.queue.push(pending);
      this.postNext();
    });
  }

  terminate(reason: Error = abortError()): void {
    if (this.terminated) return;
    this.terminated = true;
    this.terminationReason = reason;
    this.worker.terminate();

    const unanswered = this.inFlight
      ? [this.inFlight, ...this.queue]
      : [...this.queue];
    this.inFlight = null;
    this.queue.length = 0;
    for (const pending of unanswered) {
      pending.removeAbortListener?.();
      pending.clearTimeout?.();
      pending.reject(reason);
    }
  }

  /** Posts the next queued request once the worker is free; its timeout starts now. */
  private postNext(): void {
    if (this.terminated || this.inFlight) return;
    const next = this.queue.shift();
    if (!next) return;
    this.inFlight = next;

    if (next.timeoutMs > 0) {
      const timeoutId = globalThis.setTimeout(() => {
        this.terminate(new MatcherWorkerTimeoutError(next.timeoutMs));
      }, next.timeoutMs);
      next.clearTimeout = () => globalThis.clearTimeout(timeoutId);
    }
    this.worker.postMessage(next.request);
  }

  private readonly handleMessage = (
    event: MessageEvent<MatcherWorkerResponse>,
  ): void => {
    const response = event.data;
    const pending = this.inFlight;
    if (!pending || pending.request.id !== response.id) return;
    this.inFlight = null;
    pending.removeAbortListener?.();
    pending.clearTimeout?.();

    if (response.ok) {
      pending.resolve(response.matches);
    } else {
      pending.reject(
        response.error.code
          ? new MatcherValidationError(
              response.error.code,
              response.error.message,
            )
          : new Error(response.error.message),
      );
    }
    this.postNext();
  };

  private readonly handleWorkerError = (event: ErrorEvent): void => {
    this.terminate(new Error(event.message || 'The matcher worker failed.'));
  };
}

/**
 * Splits texts into consecutive chunks of at most `maxTexts` texts and about
 * `maxChars` characters. A text longer than `maxChars` is a chunk of its own.
 */
export function chunkTexts(
  texts: ReadonlyArray<string>,
  limits: Pick<MatchChunkLimits, 'maxTexts' | 'maxChars'>,
): string[][] {
  const chunks: string[][] = [];
  let current: string[] = [];
  let currentChars = 0;

  for (const text of texts) {
    const full =
      current.length >= limits.maxTexts ||
      (current.length > 0 && currentChars + text.length > limits.maxChars);
    if (full) {
      chunks.push(current);
      current = [];
      currentChars = 0;
    }
    current.push(text);
    currentChars += text.length;
  }

  if (current.length > 0) chunks.push(current);
  return chunks;
}

export async function matchStructuredTextInWorker(
  value: unknown,
  spec: MatcherSpec,
  worker: MatcherWorkerSession,
  signal?: AbortSignal,
): Promise<StructuredTextMatch[]> {
  const flows = projectStructuredText(value);
  if (flows.length === 0) return [];
  const matchesByFlow = await worker.matchTexts(
    flows.map((flow) => flow.text),
    spec,
    signal,
  );
  return structuredMatchesFromFlows(flows, matchesByFlow);
}

/**
 * Batched worker matching: projects every flow of every field value (a whole
 * record, or a page of records) and sends one `matchTexts` request per chunk
 * of about 2,000 texts, one chunk at a time so each gets the full timeout.
 * Returns one array of refs per field value, in input order, identical to
 * calling `matchesForTraversedFieldInWorker` for each field value.
 */
export async function matchesForTraversedFieldsInWorker(
  fieldValues: ReadonlyArray<TraversedFieldValue>,
  spec: MatcherSpec,
  worker: MatcherWorkerSession,
  signal?: AbortSignal,
  limits: Partial<MatchChunkLimits> = {},
): Promise<ExactMatchRef[][]> {
  const { maxTexts, maxChars, timeoutMs } = {
    ...DEFAULT_MATCH_CHUNK_LIMITS,
    ...limits,
  };
  const projections = fieldValues.map(projectFieldText);
  const texts = projections.flatMap((flows) => flows.map((flow) => flow.text));
  if (texts.length === 0) return projections.map(() => []);

  const matchesByText: TextMatch[][] = [];
  for (const chunk of chunkTexts(texts, { maxTexts, maxChars })) {
    // biome-ignore lint/performance/noAwaitInLoops: chunks go one at a time; the session queues them with other models' requests, so no timeout counts time spent waiting.
    const chunkMatches = await worker.matchTexts(
      chunk,
      spec,
      signal,
      timeoutMs,
    );
    for (const matches of chunkMatches) matchesByText.push(matches);
  }

  const fingerprint = matcherFingerprint(spec);
  let offset = 0;
  return projections.map((flows, index) => {
    const matchesByFlow = matchesByText.slice(offset, offset + flows.length);
    offset += flows.length;
    return exactRefsFromFlowMatches(
      fieldValues[index],
      fingerprint,
      flows,
      matchesByFlow,
    );
  });
}

export async function matchesForTraversedFieldInWorker(
  fieldValue: TraversedFieldValue,
  spec: MatcherSpec,
  worker: MatcherWorkerSession,
  signal?: AbortSignal,
): Promise<ExactMatchRef[]> {
  const [matches] = await matchesForTraversedFieldsInWorker(
    [fieldValue],
    spec,
    worker,
    signal,
  );
  return matches ?? [];
}
