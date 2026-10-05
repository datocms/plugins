/**
 * The plugin-wide auto-apply pattern (`autoApplyToFieldsWithApiKey`). The
 * dashboard asks `overrideFieldExtensions` about every string and JSON field
 * of a form, so the pattern runs once per field.
 */

let cached: { pattern: string; regexp: RegExp | null } | null = null;

/** Compiled once per pattern string; null when the pattern doesn't compile. */
function compile(pattern: string): RegExp | null {
  if (cached?.pattern !== pattern) {
    let regexp: RegExp | null;
    try {
      regexp = new RegExp(pattern);
    } catch {
      regexp = null;
    }
    cached = { pattern, regexp };
  }
  return cached.regexp;
}

export function matchesAutoApplyPattern(
  pattern: string,
  apiKey: string,
): boolean {
  if (!pattern) return false;
  return compile(pattern)?.test(apiKey) ?? false;
}

/** `+`, `*` or `{n,}` (lazy or not) starting at `index`. */
function isUnboundedQuantifierAt(pattern: string, index: number): boolean {
  const char = pattern[index];
  if (char === '+' || char === '*') return true;
  return char === '{' && /^\{\d+,\}/.test(pattern.slice(index));
}

type ScanState = {
  /** One flag per open group: does it contain an unbounded repeat yet? */
  groups: boolean[];
  inClass: boolean;
};

function markEnclosingGroup(state: ScanState): void {
  if (state.groups.length > 0) state.groups[state.groups.length - 1] = true;
}

/** Handles `pattern[index]`; returns true when it closes a nested repeat. */
function scanChar(pattern: string, index: number, state: ScanState): boolean {
  const char = pattern[index];
  if (state.inClass) {
    if (char === ']') state.inClass = false;
    return false;
  }
  if (char === '[') {
    state.inClass = true;
  } else if (char === '(') {
    state.groups.push(false);
  } else if (char === ')') {
    const repeatsInside = state.groups.pop() ?? false;
    if (repeatsInside && isUnboundedQuantifierAt(pattern, index + 1)) {
      return true;
    }
    if (repeatsInside) markEnclosingGroup(state);
  } else if (isUnboundedQuantifierAt(pattern, index)) {
    markEnclosingGroup(state);
  }
  return false;
}

/**
 * True when a group with an unbounded repeat inside is itself repeated, like
 * `(a+)+` or `(\w+_?)*`. Such patterns backtrack exponentially on longer API
 * keys that don't match, which freezes the dashboard's record forms. A
 * heuristic for settings validation: it doesn't catch every slow pattern.
 */
export function hasNestedQuantifier(pattern: string): boolean {
  const state: ScanState = { groups: [], inClass: false };
  for (let index = 0; index < pattern.length; index += 1) {
    if (pattern[index] === '\\') {
      index += 1;
      continue;
    }
    if (scanChar(pattern, index, state)) return true;
  }
  return false;
}
