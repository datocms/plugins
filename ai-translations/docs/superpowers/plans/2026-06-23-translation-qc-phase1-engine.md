# Translation QC — Phase 1a (Engine Core) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development or superpowers:executing-plans to implement task-by-task. Steps use checkbox (`- [ ]`) syntax.

**Goal:** Make the translation engine *detect* and *emit* completeness flags (length mismatch, placeholder loss, provider truncation) instead of silently degrading — without changing existing return types or breaking existing tests.

**Architecture:** A new pure-function `qc/` module (flag model + checks). `translateArray` gains a non-breaking optional `onQcFlag` callback in its `Options`; `parseTranslationResponse` and the output-mapping step call the checks and forward any flag through it. Chat providers gain a `completeTextWithMeta` returning `{ text, finishReason }` so truncation is observable. The UI consumes flags in Phase 1b (separate plan).

**Tech Stack:** TypeScript, Vitest, existing `translateArray`/provider classes.

## Global Constraints
- No new runtime dependencies.
- Do not change `completeText`'s existing `Promise<string>` signature or `translateArray`'s `Promise<string[]>` return — additions must be backward-compatible (optional params / new optional methods).
- All new logic is pure + unit-tested; checks take `(…) => QcFlag | null`.
- `QcCheckId` values exactly: `length-mismatch`, `placeholder-loss`, `truncated` (Phase 1); `html-structure`, `markdown-structure`, `no-op`, `length-ratio` reserved for Phase 2.

---

### Task 1: QC flag model

**Files:**
- Create: `src/utils/translation/qc/types.ts`
- Test: (covered via Task 2 — pure type module, no behavior)

**Produces:**
```ts
export type QcSeverity = 'error' | 'warning';
export type QcCheckId =
  | 'length-mismatch' | 'placeholder-loss' | 'truncated'
  | 'html-structure' | 'markdown-structure' | 'no-op' | 'length-ratio';
export type QcFlag = {
  checkId: QcCheckId;
  severity: QcSeverity;
  fieldPath?: string;
  locale?: string;
  segmentIndex?: number;
  message: string;
};
export type OnQcFlag = (flag: QcFlag) => void;
```

- [ ] **Step 1:** Create the file with the types above and a TSDoc header. No logic.
- [ ] **Step 2:** `npx tsc -b` → Expected: PASS (no type errors).

---

### Task 2: Deterministic check functions (`length-mismatch`, `placeholder-loss`)

**Files:**
- Create: `src/utils/translation/qc/checks.ts`
- Test: `src/utils/translation/qc/checks.test.ts`

**Interfaces — Produces:**
```ts
// length: expected N segments, model returned arr (any[])
export function checkLengthMismatch(args: {
  expected: number; received: number; fieldPath?: string; locale?: string;
}): QcFlag | null;   // error when received !== expected

// placeholder: tokens injected into one segment vs the model's output for it
export function checkPlaceholderSurvival(args: {
  tokens: string[];        // e.g. ['⟦PH_0⟧','⟦PH_1⟧'] from the TokenMap
  output: string;          // model output segment (pre-detokenize)
  segmentIndex: number; fieldPath?: string; locale?: string;
}): QcFlag | null;   // error when any token is absent from output
```

- [ ] **Step 1: Write failing tests** (`checks.test.ts`):

```ts
import { describe, expect, it } from 'vitest';
import { checkLengthMismatch, checkPlaceholderSurvival } from './checks';

describe('checkLengthMismatch', () => {
  it('returns null when lengths match', () => {
    expect(checkLengthMismatch({ expected: 3, received: 3 })).toBeNull();
  });
  it('flags an error when the model returned fewer/more elements', () => {
    const flag = checkLengthMismatch({ expected: 1, received: 2, fieldPath: 'body', locale: 'nl' });
    expect(flag).toMatchObject({ checkId: 'length-mismatch', severity: 'error', fieldPath: 'body', locale: 'nl' });
    expect(flag?.message).toContain('2');
    expect(flag?.message).toContain('1');
  });
});

describe('checkPlaceholderSurvival', () => {
  it('returns null when all tokens survive', () => {
    expect(checkPlaceholderSurvival({ tokens: ['⟦PH_0⟧'], output: 'Hallo ⟦PH_0⟧', segmentIndex: 0 })).toBeNull();
  });
  it('returns null when there are no tokens', () => {
    expect(checkPlaceholderSurvival({ tokens: [], output: 'Hallo', segmentIndex: 0 })).toBeNull();
  });
  it('flags an error when a token is dropped', () => {
    const flag = checkPlaceholderSurvival({ tokens: ['⟦PH_0⟧','⟦PH_1⟧'], output: 'Hallo ⟦PH_0⟧', segmentIndex: 2, fieldPath: 'body' });
    expect(flag).toMatchObject({ checkId: 'placeholder-loss', severity: 'error', segmentIndex: 2, fieldPath: 'body' });
  });
});
```

- [ ] **Step 2: Run** `npx vitest run src/utils/translation/qc/checks.test.ts` → Expected: FAIL (module not found).
- [ ] **Step 3: Implement** `checks.ts`:

```ts
import type { QcFlag } from './types';

export function checkLengthMismatch(args: {
  expected: number; received: number; fieldPath?: string; locale?: string;
}): QcFlag | null {
  const { expected, received, fieldPath, locale } = args;
  if (received === expected) return null;
  return {
    checkId: 'length-mismatch', severity: 'error', fieldPath, locale,
    message: `Model returned ${received} segment(s) for ${expected} sent; output was repaired and may be incomplete.`,
  };
}

export function checkPlaceholderSurvival(args: {
  tokens: string[]; output: string; segmentIndex: number; fieldPath?: string; locale?: string;
}): QcFlag | null {
  const { tokens, output, segmentIndex, fieldPath, locale } = args;
  const missing = tokens.filter((t) => !output.includes(t));
  if (missing.length === 0) return null;
  return {
    checkId: 'placeholder-loss', severity: 'error', segmentIndex, fieldPath, locale,
    message: `${missing.length} placeholder(s) lost in translation of segment ${segmentIndex}.`,
  };
}
```

- [ ] **Step 4: Run** the test → Expected: PASS.
- [ ] **Step 5: Commit** `feat(qc): add flag model + length/placeholder checks`.

---

### Task 3: Provider truncation metadata + `checkTruncated` + Anthropic `max_tokens` fix

**Files:**
- Modify: `src/utils/translation/types.ts` (add `CompletionResult` + optional `completeTextWithMeta`)
- Modify: `src/utils/translation/providers/OpenAIProvider.ts`, `GeminiProvider.ts`, `AnthropicProvider.ts`
- Modify: `src/utils/translation/qc/checks.ts` (+ `checkTruncated`)
- Test: `src/utils/translation/qc/checks.test.ts`, the three provider test files.

**Interfaces — Produces:**
```ts
// types.ts
export interface CompletionResult { text: string; finishReason?: string }
// TranslationProvider gains:  completeTextWithMeta?(prompt, options?): Promise<CompletionResult>
// checks.ts
export function checkTruncated(args: {
  finishReason?: string; fieldPath?: string; locale?: string;
}): QcFlag | null;   // error when finishReason is a truncation marker
```

- [ ] **Step 1 (checkTruncated): failing test** — add to `checks.test.ts`:

```ts
import { checkTruncated } from './checks';
describe('checkTruncated', () => {
  it.each(['length','max_tokens','MAX_TOKENS'])('flags %s', (fr) => {
    expect(checkTruncated({ finishReason: fr })?.checkId).toBe('truncated');
  });
  it('returns null for normal stop', () => {
    expect(checkTruncated({ finishReason: 'stop' })).toBeNull();
    expect(checkTruncated({})).toBeNull();
  });
});
```

- [ ] **Step 2: Run** → FAIL. **Step 3: Implement** in `checks.ts`:

```ts
const TRUNCATION_MARKERS = new Set(['length', 'max_tokens', 'MAX_TOKENS']);
export function checkTruncated(args: {
  finishReason?: string; fieldPath?: string; locale?: string;
}): QcFlag | null {
  if (!args.finishReason || !TRUNCATION_MARKERS.has(args.finishReason)) return null;
  return {
    checkId: 'truncated', severity: 'error', fieldPath: args.fieldPath, locale: args.locale,
    message: 'Provider cut the response off at the output-token limit; translation is incomplete.',
  };
}
```
**Step 4: Run** → PASS.

- [ ] **Step 5:** Add to `types.ts`: `CompletionResult` interface and (on `TranslationProvider`) `completeTextWithMeta?(prompt: string, options?: StreamOptions): Promise<CompletionResult>;`. `npx tsc -b` → PASS.

- [ ] **Step 6 (OpenAI): failing test** — in `OpenAIProvider.test.ts`, assert `completeTextWithMeta` returns `{ text, finishReason }` from a mocked `create` resolving `{ choices: [{ message: { content: 'x' }, finish_reason: 'length' }] }`. Run → FAIL.
- [ ] **Step 7: Implement** `completeTextWithMeta` on OpenAIProvider (refactor `completeText` to delegate):

```ts
async completeTextWithMeta(prompt: string, options?: StreamOptions): Promise<CompletionResult> {
  if (isEmptyPrompt(prompt)) return { text: '' };
  return withTimeout(options, async (signal) => {
    const requestBody = { model: this.model, messages: [{ role: 'user' as const, content: prompt }], stream: false as const };
    options?.debug?.request?.('Provider request', { provider: this.vendor, operation: 'completeText', url: `${this.baseUrl.replace(/\/$/, '')}/chat/completions`, body: requestBody, options: { timeoutMs: options?.timeoutMs, hasAbortSignal: options?.abortSignal !== undefined } });
    const resp = await this.client.chat.completions.create(requestBody, { signal });
    const text = resp.choices?.[0]?.message?.content ?? '';
    const finishReason = resp.choices?.[0]?.finish_reason ?? undefined;
    options?.debug?.response?.('Provider response', { provider: this.vendor, operation: 'completeText', response: resp, text });
    return { text, finishReason };
  });
}
async completeText(prompt: string, options?: StreamOptions): Promise<string> {
  return (await this.completeTextWithMeta(prompt, options)).text;
}
```
Run OpenAI tests → PASS.

- [ ] **Step 8 (Gemini):** same pattern. `finishReason = result.response?.candidates?.[0]?.finishReason ?? undefined`. `completeText` delegates to `completeTextWithMeta`. Failing test (mock `generateContent` → `{ response: { text: () => 'x', candidates: [{ finishReason: 'MAX_TOKENS' }] } }`) → implement → PASS.

- [ ] **Step 9 (Anthropic):** make `fetchAnthropicResponse` return `{ text, finishReason }` (read `data.stop_reason`), add `completeTextWithMeta`, delegate `completeText`. **Also fix the field name:** `max_output_tokens` → `max_tokens` in the body (Messages API requires `max_tokens`). Failing test: assert body contains `max_tokens` and `completeTextWithMeta` surfaces `stop_reason: 'max_tokens'` → implement → PASS.

- [ ] **Step 10: Commit** `feat(qc): provider truncation metadata + checkTruncated; fix Anthropic max_tokens`.

---

### Task 4: Wire checks into `translateArray`

**Files:**
- Modify: `src/utils/translation/translateArray.ts`
- Test: `src/utils/translation/translateArray.test.ts`

**Interfaces — Consumes** Task 1–3. **Produces:** `Options.onQcFlag?: OnQcFlag`; emits flags during a translate run.

- [ ] **Step 1: failing tests** (translateArray.test.ts):

```ts
import type { QcFlag } from './qc/types';
it('emits a length-mismatch flag when the model over-splits a single segment', async () => {
  vi.mocked(mockProvider.completeText).mockResolvedValue('["a","b"]');
  const flags: QcFlag[] = [];
  await translateArray(mockProvider, mockPluginParams, ['x'], 'en', 'de', { onQcFlag: (f) => flags.push(f) });
  expect(flags.some((f) => f.checkId === 'length-mismatch')).toBe(true);
});
it('emits no flags on a clean matched response', async () => {
  vi.mocked(mockProvider.completeText).mockResolvedValue('["a","b"]');
  const flags: QcFlag[] = [];
  await translateArray(mockProvider, mockPluginParams, ['x','y'], 'en', 'de', { onQcFlag: (f) => flags.push(f) });
  expect(flags).toHaveLength(0);
});
it('emits a placeholder-loss flag when a token is dropped', async () => {
  vi.mocked(mockProvider.completeText).mockResolvedValue('["Hallo"]'); // token dropped
  const flags: QcFlag[] = [];
  await translateArray(mockProvider, mockPluginParams, ['Hello {{name}}'], 'en', 'de', { onQcFlag: (f) => flags.push(f) });
  expect(flags.some((f) => f.checkId === 'placeholder-loss')).toBe(true);
});
```

- [ ] **Step 2: Run** → FAIL (`onQcFlag` not read).
- [ ] **Step 3: Implement:**
  - Add `onQcFlag?: OnQcFlag` to the `Options` type and `recordContext?`-sibling. Add `fieldPath?: string` is NOT needed (UI supplies later) — leave undefined.
  - Add an optional `onQcFlag` param to `parseTranslationResponse`, `translateWithChatProvider`, and `translateChunk`. Thread `opts.onQcFlag` from `translateArray`.
  - In `parseTranslationResponse`, after computing `arr`, call `checkLengthMismatch({ expected: originalSegments.length, received: stringParts.length })` (use `stringParts` so the over-split case counts the real elements) and forward a non-null result; keep the existing repair logic unchanged.
  - In `parseTranslationResponse` (or `translateWithChatProvider`), when a `finishReason` is available from `completeTextWithMeta`, call `checkTruncated` and forward.
  - In `translateWithChatProvider`, prefer `provider.completeTextWithMeta` when present (capture `finishReason`); else fall back to `completeText` (finishReason undefined).
  - In `translateArray`'s output-mapping loop (where `detokenize` runs), call `checkPlaceholderSurvival({ tokens: tokenMaps[i].map(m => m.safe), output: String(out[i] ?? ''), segmentIndex: i })` BEFORE detokenize and forward.
- [ ] **Step 4: Run** the full `translateArray.test.ts` → Expected: PASS (new + all pre-existing).
- [ ] **Step 5:** `npm run lint && npm run build && npx vitest run` → all green.
- [ ] **Step 6: Commit** `feat(qc): emit length/placeholder/truncated flags from translateArray`.

---

## Phase 1b (separate plan, next): surfacing
Consume `onQcFlag` in `TranslateField`/sidebar (error bubbles + `ctx.alert`) and bulk (`ItemsDropdownUtils`/`TranslationProgressModal`/`AIBulkTranslationsPage`: `completed-with-warnings`, accurate counts, retained list). Threading: a `QcCollector` passed via `onQcFlag` from each entry point.

## Self-review
- **Coverage:** length-mismatch ✓(T2,T4) placeholder-loss ✓(T2,T4) truncated ✓(T3,T4) provider metadata ✓(T3) Anthropic max_tokens ✓(T3) flag model ✓(T1). Surfacing → Phase 1b. Phase 2 checks → out of scope here.
- **Placeholders:** none — every code step has literal code.
- **Type consistency:** `QcFlag`/`OnQcFlag`/`CompletionResult` names used identically across T1–T4; `completeTextWithMeta` signature identical in types.ts and all three providers.
