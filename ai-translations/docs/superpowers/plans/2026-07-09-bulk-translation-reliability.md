# Bulk Translation Reliability Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make bulk translation fail loudly instead of writing `null` into locales whose provider calls failed, add rate-limit-aware pause/resume, gate Export, and verify writes structurally.

**Architecture:** Replace sentinel-by-absence (`if (updatePayload[field]) continue`) with an explicit `FieldOutcome` discriminated union, so a failed field can never be mistaken for an untranslatable one. Roll results up per `(record, locale)` rather than per record, so one dead locale cannot be masked by a healthy sibling. Classify provider errors as *systemic* (next call fails too → pause the run) or *content* (fail the field and its record, continue). Verify the CMA update response against the set of writes we claimed to make.

**Tech Stack:** TypeScript, React, `datocms-plugin-sdk`, `@datocms/cma-client-browser`, Vitest (unit), Playwright (E2E), Biome (lint).

## Global Constraints

- TypeScript + ESNext. Pure functions, arrow functions, `const`, async/await. Avoid OOP unless genuinely right (`ProviderError` stays a class — it already is one).
- TSDoc on every exported function. Inline comments only for the non-obvious.
- React-style booleans: `isFoo`, `shouldBar`, `hasBaz`.
- Vendors are exactly `'openai' | 'google' | 'anthropic' | 'deepl'` (`src/utils/translation/types.ts:7`). **There is no `deepseek`.** Do not add one.
- **No language-detection dependency.** Explicitly out of scope (see spec § Non-goals).
- Provider calls run **in the browser** (`OpenAIProvider.ts:41`, `dangerouslyAllowBrowser: true`). Response headers are readable only when the server sets `Access-Control-Expose-Headers`. `Retry-After` must therefore be an *optimization over* a working blind exponential backoff — never a precondition for waiting.
- Retry budget for `rate_limit`: **3 auto-retries**, then pause with manual resume.
- Content-scoped retry budget: **2 retries**, then fail the field *and* its record.
- Cancel copy, verbatim: *stopping does not undo the records already translated; they will be re-translated on the next bulk run.*
- Run `npm run lint` and `npx tsc -b --noEmit` before every commit. Unit tests: `npm test`.

**Spec:** `docs/superpowers/specs/2026-07-09-bulk-translation-reliability-design.md`

---

## File Structure

| File | Responsibility | Change |
|---|---|---|
| `src/utils/translation/ProviderErrors.ts` | Error normalization + classification | Add `isSystemicError` |
| `src/utils/translation/types.ts` | Shared types | Add `ProviderError.retryAfterMs`, `RunGate`, `FieldOutcome` |
| `src/utils/translation/retryAfter.ts` | **New.** Parse `Retry-After` (delta-seconds / HTTP-date) | Create |
| `src/utils/translation/providers/*.ts` | Vendor adapters | Populate `retryAfterMs` on throw |
| `src/utils/translation/TranslationCore.ts` | Backoff + pacing primitives | Add `computeRetryDelay`, `createPacer` |
| `src/utils/translation/verifyPersistedWrite.ts` | **New.** Structural read-back assertion | Create |
| `src/utils/translation/ItemsDropdownUtils.ts` | Bulk run loop | `FieldOutcome`, `LocaleOutcome`, `RunGate`, verification |
| `src/components/TranslationProgressModal.tsx` | Progress + pause UI | `RunStatus`, pause screen, Export gating |
| `src/entrypoints/CustomPage/AIBulkTranslationsPage.tsx` | Bulk page | Stale header comment |
| `e2e/tests/steps/fault-injection.ts` | **New.** `page.route()` fault helpers | Create |
| `e2e/tests/bulk-reliability.spec.ts` | **New.** Fault-injection lane | Create |
| `README.md`, `AGENTS.md` | Docs | Update |

Task order is dependency order. Tasks 1–3 touch disjoint files and may run in parallel. Tasks 4–7 all touch `ItemsDropdownUtils.ts` and must run sequentially.

---

## Task 1: Systemic vs content error classification

**Files:**
- Modify: `src/utils/translation/ProviderErrors.ts`
- Test: `src/utils/translation/__tests__/ProviderErrors.classification.test.ts`

**Interfaces:**
- Consumes: `NormalizedProviderError` (already exported, `ProviderErrors.ts:18`).
- Produces: `export const isSystemicError = (err: NormalizedProviderError): boolean`

A *systemic* error means the next provider call will fail the same way, so continuing only burns quota and manufactures corrupt state. `rate_limit`, `auth`, `quota`, `network` are systemic. `model`, `plugin`, `unknown`, `datocms` are content-scoped — they concern one field or one record.

- [ ] **Step 1: Write the failing test**

```ts
import { describe, expect, it } from 'vitest';
import { isSystemicError } from '../ProviderErrors';
import type { NormalizedProviderError } from '../ProviderErrors';

const err = (code: NormalizedProviderError['code']): NormalizedProviderError => ({
  code,
  source: 'provider',
  message: 'x',
});

describe('isSystemicError', () => {
  it.each(['rate_limit', 'auth', 'quota', 'network'] as const)(
    'treats %s as systemic',
    (code) => expect(isSystemicError(err(code))).toBe(true),
  );

  it.each(['model', 'plugin', 'unknown', 'datocms'] as const)(
    'treats %s as content-scoped',
    (code) => expect(isSystemicError(err(code))).toBe(false),
  );
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run src/utils/translation/__tests__/ProviderErrors.classification.test.ts`
Expected: FAIL — `isSystemicError is not a function`.

- [ ] **Step 3: Implement**

Append to `ProviderErrors.ts`:

```ts
/** Error codes whose next call will fail identically — the run must pause. */
const SYSTEMIC_CODES = new Set<NormalizedProviderError['code']>([
  'rate_limit',
  'auth',
  'quota',
  'network',
]);

/**
 * Classifies a normalized error as systemic (the whole run must pause) or
 * content-scoped (fail this field and its record, then continue).
 *
 * @param err - The normalized provider error.
 * @returns True when continuing the run would only burn quota.
 */
export const isSystemicError = (err: NormalizedProviderError): boolean =>
  SYSTEMIC_CODES.has(err.code);
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run src/utils/translation/__tests__/ProviderErrors.classification.test.ts`
Expected: PASS, 8 assertions.

- [ ] **Step 5: Lint, typecheck, commit**

```bash
npm run lint && npx tsc -b --noEmit
git add src/utils/translation/ProviderErrors.ts src/utils/translation/__tests__/ProviderErrors.classification.test.ts
git commit -m "feat(errors): classify provider errors as systemic vs content-scoped"
```

---

## Task 2: Capture `Retry-After` from provider responses

**Files:**
- Create: `src/utils/translation/retryAfter.ts`
- Modify: `src/utils/translation/types.ts:187-205` (`ProviderError`)
- Modify: `src/utils/translation/providers/OpenAIProvider.ts`, `AnthropicProvider.ts`, `DeepLProvider.ts`, `GeminiProvider.ts`
- Test: `src/utils/translation/__tests__/retryAfter.test.ts`

**Interfaces:**
- Produces:
  - `export const parseRetryAfter = (raw: string | null | undefined, nowMs: number) => number | undefined` — returns milliseconds to wait, or `undefined` when unparseable.
  - `export const retryAfterFromHeaders = (headers: unknown, nowMs: number) => number | undefined` — accepts a `Headers`, a plain record, or anything else (returns `undefined`).
  - `ProviderError` gains `public readonly retryAfterMs?: number` as a **4th constructor parameter** (`message, status, vendor, retryAfterMs`) so existing call sites keep compiling.

`Retry-After` is either delta-seconds (`"120"`) or an HTTP-date (`"Wed, 21 Oct 2015 07:28:00 GMT"`). Pass `nowMs` explicitly rather than calling `Date.now()` internally, so it is testable.

- [ ] **Step 1: Write the failing test**

```ts
import { describe, expect, it } from 'vitest';
import { parseRetryAfter, retryAfterFromHeaders } from '../retryAfter';

const NOW = Date.parse('2015-10-21T07:28:00Z');

describe('parseRetryAfter', () => {
  it('parses delta-seconds', () => expect(parseRetryAfter('120', NOW)).toBe(120_000));
  it('parses zero', () => expect(parseRetryAfter('0', NOW)).toBe(0));
  it('parses an HTTP-date in the future', () =>
    expect(parseRetryAfter('Wed, 21 Oct 2015 07:29:00 GMT', NOW)).toBe(60_000));
  it('clamps a past HTTP-date to 0', () =>
    expect(parseRetryAfter('Wed, 21 Oct 2015 07:27:00 GMT', NOW)).toBe(0));
  it('returns undefined for junk', () => expect(parseRetryAfter('soon', NOW)).toBeUndefined());
  it('returns undefined for null/empty', () => {
    expect(parseRetryAfter(null, NOW)).toBeUndefined();
    expect(parseRetryAfter('', NOW)).toBeUndefined();
  });
  it('rejects negative delta-seconds', () => expect(parseRetryAfter('-5', NOW)).toBeUndefined());
});

describe('retryAfterFromHeaders', () => {
  it('reads a Headers instance', () =>
    expect(retryAfterFromHeaders(new Headers({ 'retry-after': '30' }), NOW)).toBe(30_000));
  it('reads a plain record case-insensitively', () =>
    expect(retryAfterFromHeaders({ 'Retry-After': '30' }, NOW)).toBe(30_000));
  it('returns undefined when the header is absent (CORS-hidden)', () =>
    expect(retryAfterFromHeaders(new Headers(), NOW)).toBeUndefined());
  it('returns undefined for a non-headers value', () =>
    expect(retryAfterFromHeaders(undefined, NOW)).toBeUndefined());
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run src/utils/translation/__tests__/retryAfter.test.ts`
Expected: FAIL — cannot resolve `../retryAfter`.

- [ ] **Step 3: Implement `retryAfter.ts`**

```ts
/**
 * Parses an HTTP `Retry-After` value into milliseconds to wait.
 *
 * The header is either delta-seconds (`"120"`) or an HTTP-date. Past dates
 * clamp to `0`. Anything unparseable yields `undefined`, which callers must
 * treat as "no hint" and fall back to exponential backoff — cross-origin
 * responses frequently hide this header entirely.
 *
 * @param raw - The raw header value, if any.
 * @param nowMs - Current epoch milliseconds, injected for testability.
 * @returns Milliseconds to wait, or `undefined` when no usable hint exists.
 */
export const parseRetryAfter = (
  raw: string | null | undefined,
  nowMs: number,
): number | undefined => {
  if (!raw) return undefined;
  const trimmed = raw.trim();
  if (trimmed === '') return undefined;

  if (/^\d+$/.test(trimmed)) return Number(trimmed) * 1000;

  const parsed = Date.parse(trimmed);
  if (Number.isNaN(parsed)) return undefined;
  return Math.max(0, parsed - nowMs);
};

/** Reads `retry-after` from a `Headers`, a plain record, or anything else. */
const readHeader = (headers: unknown): string | undefined => {
  if (headers instanceof Headers) return headers.get('retry-after') ?? undefined;
  if (headers && typeof headers === 'object') {
    for (const [key, value] of Object.entries(headers as Record<string, unknown>)) {
      if (key.toLowerCase() === 'retry-after' && typeof value === 'string') return value;
    }
  }
  return undefined;
};

/**
 * Extracts a `Retry-After` wait from a provider response's headers, tolerating
 * every shape our four adapters produce (`Headers`, SDK plain records, absent).
 *
 * @param headers - Whatever the adapter has on hand.
 * @param nowMs - Current epoch milliseconds.
 * @returns Milliseconds to wait, or `undefined`.
 */
export const retryAfterFromHeaders = (
  headers: unknown,
  nowMs: number,
): number | undefined => parseRetryAfter(readHeader(headers), nowMs);
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run src/utils/translation/__tests__/retryAfter.test.ts`
Expected: PASS, 11 assertions.

- [ ] **Step 5: Extend `ProviderError`**

In `src/utils/translation/types.ts`, add a 4th optional constructor param and readonly field. Keep the existing three positional params unchanged so no call site breaks:

```ts
export class ProviderError extends Error {
  /** HTTP status code from the provider response, if applicable. */
  public readonly status?: number;
  /** The vendor that generated this error. */
  public readonly vendor?: VendorId;
  /**
   * Milliseconds the provider asked us to wait, parsed from `Retry-After`.
   * Frequently `undefined`: browser callers can only read this header when the
   * server sets `Access-Control-Expose-Headers`.
   */
  public readonly retryAfterMs?: number;

  constructor(
    message: string,
    status?: number,
    vendor?: VendorId,
    retryAfterMs?: number,
  ) {
    super(message);
    this.name = 'ProviderError';
    this.status = status;
    this.vendor = vendor;
    this.retryAfterMs = retryAfterMs;
  }
}
```

(Preserve whatever the existing constructor body already does — read lines 200-210 first and add to it rather than replacing.)

- [ ] **Step 6: Plumb headers in each adapter**

For each adapter, at every `throw new ProviderError(...)` site that follows a non-OK HTTP response, pass `retryAfterFromHeaders(<headers>, Date.now())` as the 4th argument.

- `AnthropicProvider.ts` (~line 87-118, raw `fetch`): headers are `res.headers`.
- `DeepLProvider.ts` (`throwDeepLError`, ~line 460): thread the `Response` (or its `headers`) into the helper and pass through.
- `OpenAIProvider.ts`: the SDK throws `OpenAI.APIError`, which exposes `.headers`. Where the adapter converts SDK errors into `ProviderError`, read `(error as { headers?: unknown }).headers`.
- `GeminiProvider.ts`: the Google SDK does not consistently expose headers. Use `(error as { response?: { headers?: unknown } }).response?.headers`, which yields `undefined` when absent. Do not invent a value.

- [ ] **Step 7: Verify, commit**

```bash
npm run lint && npx tsc -b --noEmit && npm test
git add src/utils/translation/retryAfter.ts src/utils/translation/types.ts src/utils/translation/providers src/utils/translation/__tests__/retryAfter.test.ts
git commit -m "feat(providers): capture Retry-After into ProviderError"
```

---

## Task 3: `computeRetryDelay` and the adaptive pacer

**Files:**
- Modify: `src/utils/translation/TranslationCore.ts`
- Test: `src/utils/translation/__tests__/retryPacing.test.ts`

**Interfaces:**
- Consumes: `calculateRateLimitBackoff` (`TranslationCore.ts:142`), `ProviderError` (Task 2).
- Produces:
  - `export const computeRetryDelay = (retryAfterMs: number | undefined, attempt: number, jitter: () => number) => number`
  - `export const createPacer = (initialGapMs: number) => Pacer` where
    `type Pacer = { gapMs: () => number; onRateLimit: () => void; onSuccess: () => void }`

`jitter` is injected (a `() => number` in `[0,1)`) so tests are deterministic. Jitter is additive, up to 25% of the base delay, so N locales released from a shared wait do not re-collide in lockstep.

The pacer doubles `gapMs` on each rate limit (capped at `PACER_MAX_GAP_MS = 10_000`) and halves it after `PACER_DECAY_AFTER_SUCCESSES = 5` consecutive successes, never below its initial value.

- [ ] **Step 1: Write the failing test**

```ts
import { describe, expect, it } from 'vitest';
import { computeRetryDelay, createPacer } from '../TranslationCore';

const noJitter = () => 0;

describe('computeRetryDelay', () => {
  it('prefers an explicit Retry-After hint', () =>
    expect(computeRetryDelay(5_000, 1, noJitter)).toBe(5_000));

  it('honors Retry-After: 0', () => expect(computeRetryDelay(0, 3, noJitter)).toBe(0));

  it('falls back to exponential backoff when no hint exists', () => {
    const first = computeRetryDelay(undefined, 1, noJitter);
    const second = computeRetryDelay(undefined, 2, noJitter);
    expect(second).toBeGreaterThan(first);
  });

  it('adds at most 25% jitter to the backoff', () => {
    const base = computeRetryDelay(undefined, 1, () => 0);
    const jittered = computeRetryDelay(undefined, 1, () => 0.999);
    expect(jittered).toBeGreaterThan(base);
    expect(jittered).toBeLessThanOrEqual(base * 1.25);
  });

  it('jitters an explicit hint too, so waiters do not re-collide', () => {
    expect(computeRetryDelay(5_000, 1, () => 0.999)).toBeGreaterThan(5_000);
  });
});

describe('createPacer', () => {
  it('starts at the initial gap', () => expect(createPacer(100).gapMs()).toBe(100));

  it('doubles on each rate limit', () => {
    const pacer = createPacer(100);
    pacer.onRateLimit();
    expect(pacer.gapMs()).toBe(200);
    pacer.onRateLimit();
    expect(pacer.gapMs()).toBe(400);
  });

  it('caps the gap', () => {
    const pacer = createPacer(100);
    for (let i = 0; i < 20; i += 1) pacer.onRateLimit();
    expect(pacer.gapMs()).toBe(10_000);
  });

  it('decays only after five consecutive successes', () => {
    const pacer = createPacer(100);
    pacer.onRateLimit(); // 200
    for (let i = 0; i < 4; i += 1) pacer.onSuccess();
    expect(pacer.gapMs()).toBe(200);
    pacer.onSuccess();
    expect(pacer.gapMs()).toBe(100);
  });

  it('never decays below the initial gap', () => {
    const pacer = createPacer(100);
    for (let i = 0; i < 50; i += 1) pacer.onSuccess();
    expect(pacer.gapMs()).toBe(100);
  });

  it('resets the success streak on a rate limit', () => {
    const pacer = createPacer(100);
    pacer.onRateLimit(); // 200
    pacer.onSuccess();
    pacer.onSuccess();
    pacer.onRateLimit(); // 400, streak reset
    for (let i = 0; i < 4; i += 1) pacer.onSuccess();
    expect(pacer.gapMs()).toBe(400);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run src/utils/translation/__tests__/retryPacing.test.ts`
Expected: FAIL — `computeRetryDelay is not a function`.

- [ ] **Step 3: Implement in `TranslationCore.ts`**

```ts
/** Upper bound on the adaptive inter-request gap. */
const PACER_MAX_GAP_MS = 10_000;
/** Consecutive successes required before the pacer relaxes. */
const PACER_DECAY_AFTER_SUCCESSES = 5;
/** Additive jitter, as a fraction of the base delay. */
const JITTER_FRACTION = 0.25;

/**
 * Resolves how long to wait before retrying a rate-limited call.
 *
 * A provider-supplied `Retry-After` wins when present, but it is only an
 * optimization: cross-origin responses routinely hide the header, so the
 * exponential fallback must be correct on its own. Jitter is added in both
 * cases so that several waiters released from one limit do not re-collide.
 *
 * @param retryAfterMs - Provider hint, or `undefined` when unreadable.
 * @param attempt - 1-based retry attempt.
 * @param jitter - Returns a value in `[0, 1)`. Injected for testability.
 * @returns Milliseconds to wait.
 */
export const computeRetryDelay = (
  retryAfterMs: number | undefined,
  attempt: number,
  jitter: () => number = Math.random,
): number => {
  const base = retryAfterMs ?? calculateRateLimitBackoff(attempt);
  return Math.round(base + base * JITTER_FRACTION * jitter());
};

/** A run-scoped, self-adjusting delay between provider calls. */
export type Pacer = {
  /** Current inter-request gap in milliseconds. */
  gapMs: () => number;
  /** Widen the gap: the provider just rate-limited us. */
  onRateLimit: () => void;
  /** Narrow the gap once the provider has been healthy for a while. */
  onSuccess: () => void;
};

/**
 * Creates an adaptive pacer. Doubling on each rate limit is what prevents one
 * throttled locale from dragging every subsequent locale and record down with
 * it; decaying after a success streak is what stops a single early 429 from
 * slowing an otherwise healthy run to a crawl.
 *
 * @param initialGapMs - Baseline gap, typically `getRequestSpacingMs()`.
 * @returns A stateful pacer.
 */
export const createPacer = (initialGapMs: number): Pacer => {
  let gap = initialGapMs;
  let streak = 0;

  return {
    gapMs: () => gap,
    onRateLimit: () => {
      streak = 0;
      gap = Math.min(gap * 2, PACER_MAX_GAP_MS);
    },
    onSuccess: () => {
      streak += 1;
      if (streak >= PACER_DECAY_AFTER_SUCCESSES) {
        streak = 0;
        gap = Math.max(Math.round(gap / 2), initialGapMs);
      }
    },
  };
};
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run src/utils/translation/__tests__/retryPacing.test.ts`
Expected: PASS, 11 assertions.

- [ ] **Step 5: Verify, commit**

```bash
npm run lint && npx tsc -b --noEmit && npm test
git add src/utils/translation/TranslationCore.ts src/utils/translation/__tests__/retryPacing.test.ts
git commit -m "feat(core): Retry-After-aware delay and adaptive pacer"
```

---

## Task 4: `FieldOutcome` — the core corruption fix

**Files:**
- Modify: `src/utils/translation/ItemsDropdownUtils.ts` (`buildTranslatedUpdatePayload`, ~lines 1020-1210)
- Modify: `src/utils/translation/types.ts` (add `FieldOutcome`)
- Test: `src/utils/translation/__tests__/fieldOutcome.test.ts`

**Interfaces:**
- Consumes: `NormalizedProviderError`, `isSystemicError` (Task 1).
- Produces:
  ```ts
  export type FieldOutcome =
    | { status: 'translated'; value: unknown }
    | { status: 'untranslatable' }
    | { status: 'failed'; error: NormalizedProviderError };
  ```
  and `buildTranslatedUpdatePayload` returns an extra `failedFields: { field: string; error: NormalizedProviderError }[]`.

This is the defect. `translateField` currently swallows an error and leaves `updatePayload[field]` unset; the fallback loop at line 1171 guards on `if (updatePayload[field]) continue;` and cannot tell "untranslatable" from "failed", so it writes `null` (`resolveLocaleSyncFallback`, line 983).

**The fix:** `translateField` returns a `FieldOutcome`. Collect outcomes into a `Map<string, FieldOutcome>`. The fallback loop skips any field whose outcome is `failed` — that field gets **no key** in the payload for this locale.

- [ ] **Step 1: Write the failing regression test**

This is the pin for the reported bug. Extract the fallback decision into a pure, testable helper so it can be tested without a live provider:

```ts
import { describe, expect, it } from 'vitest';
import { shouldApplyLocaleSyncFallback } from '../ItemsDropdownUtils';
import type { FieldOutcome } from '../types';

const failed: FieldOutcome = {
  status: 'failed',
  error: { code: 'rate_limit', source: 'provider', message: 'Rate limit reached.' },
};

describe('shouldApplyLocaleSyncFallback', () => {
  it('never fills a field whose provider call failed', () =>
    expect(shouldApplyLocaleSyncFallback(failed)).toBe(false));

  it('fills an untranslatable field', () =>
    expect(shouldApplyLocaleSyncFallback({ status: 'untranslatable' })).toBe(true));

  it('fills a field with no outcome at all (not in the translatable set)', () =>
    expect(shouldApplyLocaleSyncFallback(undefined)).toBe(true));

  it('does not re-fill an already-translated field', () =>
    expect(shouldApplyLocaleSyncFallback({ status: 'translated', value: 'Bonjour' })).toBe(false));
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run src/utils/translation/__tests__/fieldOutcome.test.ts`
Expected: FAIL — `shouldApplyLocaleSyncFallback` is not exported.

- [ ] **Step 3: Add `FieldOutcome` to `types.ts` and the helper to `ItemsDropdownUtils.ts`**

```ts
/**
 * Why a field does or does not carry a value for the target locale.
 *
 * The distinction between `untranslatable` and `failed` is load-bearing: only
 * the former may receive a locale-sync fallback. Filling a `failed` field would
 * silently overwrite the target locale with `null` because a provider 429'd.
 */
export type FieldOutcome =
  | { status: 'translated'; value: unknown }
  | { status: 'untranslatable' }
  | { status: 'failed'; error: NormalizedProviderError };
```

```ts
/**
 * Decides whether a field may receive a locale-sync fallback value.
 *
 * A field whose provider call FAILED must be left out of the payload entirely,
 * so the target locale keeps whatever it had. Only fields we genuinely cannot
 * translate get filled.
 *
 * @param outcome - The field's outcome, or `undefined` if it was never attempted.
 * @returns True when the fallback may write a value.
 */
export const shouldApplyLocaleSyncFallback = (
  outcome: FieldOutcome | undefined,
): boolean => outcome === undefined || outcome.status === 'untranslatable';
```

- [ ] **Step 4: Rewire `buildTranslatedUpdatePayload`**

1. `translateField` returns `FieldOutcome` instead of mutating `updatePayload` and pushing warnings. On success it returns `{ status: 'translated', value }`; on the early `!hasTranslatableSourceValue` return (line 1101) it returns `{ status: 'untranslatable' }`; in the `catch` (line 1147) it returns `{ status: 'failed', error: normalizeProviderError(error, provider.vendor) }`.
2. The `reduce` chain (line 1161) collects into `const outcomes = new Map<string, FieldOutcome>()`.
3. Only `translated` outcomes write `updatePayload[field]` and increment `translatedFieldCount`.
4. The fallback loop (line 1171) replaces `if (updatePayload[field]) continue;` with:
   ```ts
   if (!shouldApplyLocaleSyncFallback(outcomes.get(field))) continue;
   ```
5. Return `failedFields: [...outcomes].filter(([, o]) => o.status === 'failed').map(([field, o]) => ({ field, error: o.error }))` alongside the existing shape. Keep emitting the existing `warnings` strings (built from `failedFields`) so the CSV report and progress tooltips are unchanged.

Preserve the `checkFieldLength` QC call (line 1133) and `recordQcFlag` wiring exactly as-is.

- [ ] **Step 5: Run tests**

Run: `npx vitest run src/utils/translation/__tests__/fieldOutcome.test.ts && npm test`
Expected: PASS. All pre-existing tests still green.

- [ ] **Step 6: Verify, commit**

```bash
npm run lint && npx tsc -b --noEmit
git add src/utils/translation/ItemsDropdownUtils.ts src/utils/translation/types.ts src/utils/translation/__tests__/fieldOutcome.test.ts
git commit -m "fix(bulk): never write null into a locale whose translation failed"
```

---

## Task 5: Per-locale accounting

**Files:**
- Modify: `src/utils/translation/ItemsDropdownUtils.ts` (`translateAndSaveRecord` ~600-700, `reportTranslationResult` ~700-790)
- Test: `src/utils/translation/__tests__/localeOutcome.test.ts`

**Interfaces:**
- Consumes: `failedFields` from Task 4.
- Produces:
  ```ts
  export type LocaleOutcome = {
    locale: string;
    translated: string[];
    failed: { field: string; error: NormalizedProviderError }[];
  };
  export const summarizeLocaleOutcomes = (
    outcomes: LocaleOutcome[],
  ): { hasDeadLocale: boolean; statusText: string | undefined };
  ```

Today `reportTranslationResult` sums `translatedFieldCount` across **all** locales (line 740), so a healthy Italian masks a wholly-dead French. Roll up per locale instead.

- [ ] **Step 1: Write the failing test**

```ts
import { describe, expect, it } from 'vitest';
import { summarizeLocaleOutcomes } from '../ItemsDropdownUtils';
import type { LocaleOutcome } from '../ItemsDropdownUtils';

const err = { code: 'rate_limit', source: 'provider', message: 'Rate limit reached.' } as const;

describe('summarizeLocaleOutcomes', () => {
  it('flags a record when one locale is wholly dead, even if others succeeded', () => {
    const outcomes: LocaleOutcome[] = [
      { locale: 'it', translated: ['headline', 'subtitle'], failed: [] },
      { locale: 'fr', translated: [], failed: [
        { field: 'headline', error: err }, { field: 'subtitle', error: err },
      ] },
    ];
    const summary = summarizeLocaleOutcomes(outcomes);
    expect(summary.hasDeadLocale).toBe(true);
    expect(summary.statusText).toContain('fr');
    expect(summary.statusText).toContain('0/2');
  });

  it('flags a record with a single failed field among successes', () => {
    const outcomes: LocaleOutcome[] = [
      { locale: 'fr', translated: ['headline'], failed: [{ field: 'subtitle', error: err }] },
    ];
    expect(summarizeLocaleOutcomes(outcomes).hasDeadLocale).toBe(true);
  });

  it('reports a clean run as clean', () => {
    const outcomes: LocaleOutcome[] = [{ locale: 'fr', translated: ['headline'], failed: [] }];
    const summary = summarizeLocaleOutcomes(outcomes);
    expect(summary.hasDeadLocale).toBe(false);
    expect(summary.statusText).toBeUndefined();
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run src/utils/translation/__tests__/localeOutcome.test.ts`
Expected: FAIL — `summarizeLocaleOutcomes` not exported.

- [ ] **Step 3: Implement**

```ts
/** Per-locale roll-up of what a record's translation actually achieved. */
export type LocaleOutcome = {
  locale: string;
  translated: string[];
  failed: { field: string; error: NormalizedProviderError }[];
};

/**
 * Rolls per-locale outcomes into a record-level verdict.
 *
 * Any locale with a failure marks the record as failed. Summing translated
 * counts across locales — as the old per-record accounting did — lets a healthy
 * locale mask a wholly-dead sibling.
 *
 * @param outcomes - One entry per target locale.
 * @returns Whether to fail the record, and a status line naming the locales.
 */
export const summarizeLocaleOutcomes = (
  outcomes: LocaleOutcome[],
): { hasDeadLocale: boolean; statusText: string | undefined } => {
  const damaged = outcomes.filter((o) => o.failed.length > 0);
  if (damaged.length === 0) return { hasDeadLocale: false, statusText: undefined };

  const statusText = damaged
    .map((o) => {
      const total = o.translated.length + o.failed.length;
      return `${formatLocaleWithCode(o.locale)}: ${o.translated.length}/${total} fields translated`;
    })
    .join('; ');

  return { hasDeadLocale: true, statusText };
};
```

- [ ] **Step 4: Wire into the run loop**

1. `translateForLocale` (line 607) returns a `LocaleOutcome` built from `localeResult.translatedFields` and `localeResult.failedFields`; the `reduce` chain (line 648) collects them into `localeOutcomes: LocaleOutcome[]`.
2. `translateAndSaveRecord` returns `localeOutcomes` on its outcome object.
3. In `reportTranslationResult`, insert a branch **before** the existing `updatedFieldCount === 0` check (line 743):
   ```ts
   const { hasDeadLocale, statusText: localeStatus } = summarizeLocaleOutcomes(outcome.localeOutcomes);
   if (hasDeadLocale) {
     updateProgress({
       recordIndex, recordId, status: 'error',
       message: `Translated "${recordLabel}" (#${recordId}) with failures — ${localeStatus}.`,
       statusText: localeStatus,
       ...reportFields,
     });
     return 'continue';
   }
   ```
   Leave the existing `updatedFieldCount === 0` and `hasErrors` branches intact below it.

Per the spec, content-scoped failures fail the record too — this branch achieves that, since every failed field lands in some locale's `failed[]`.

- [ ] **Step 5: Run tests**

Run: `npm test`
Expected: PASS.

- [ ] **Step 6: Verify, commit**

```bash
npm run lint && npx tsc -b --noEmit
git add src/utils/translation/ItemsDropdownUtils.ts src/utils/translation/__tests__/localeOutcome.test.ts
git commit -m "fix(bulk): account for failures per (record, locale) not per record"
```

---

## Task 6: Structural read-back verification

**Files:**
- Create: `src/utils/translation/verifyPersistedWrite.ts`
- Modify: `src/utils/translation/ItemsDropdownUtils.ts:667-671` (the `client.items.update` call)
- Test: `src/utils/translation/__tests__/verifyPersistedWrite.test.ts`

**Interfaces:**
- Produces:
  ```ts
  export type WriteClaim = { field: string; locale: string };
  export type Mismatch = { field: string; locale: string; reason: 'absent' | 'null' | 'empty' };
  export const verifyPersistedWrite = (
    response: Record<string, unknown>,
    claims: WriteClaim[],
  ) => Mismatch[];
  ```

`client.items.update` already returns the full record; today only `meta.updated_at` is read. Assert that every `(field, locale)` we marked `translated` came back present, non-null, and non-empty.

**Critical caveat:** block and structured-text fields may come back as **arrays of block IDs** rather than nested payloads. An array of ID strings is a *successful* write, not an empty one.

- [ ] **Step 1: Write the failing test**

```ts
import { describe, expect, it } from 'vitest';
import { verifyPersistedWrite } from '../verifyPersistedWrite';

describe('verifyPersistedWrite', () => {
  it('passes when every claim persisted', () => {
    const response = { headline: { fr: 'Bonjour' }, body: { fr: '<p>Salut</p>' } };
    expect(verifyPersistedWrite(response, [
      { field: 'headline', locale: 'fr' }, { field: 'body', locale: 'fr' },
    ])).toEqual([]);
  });

  it('catches the reported bug: a claimed field came back null', () => {
    const response = { headline: { fr: 'Bonjour' }, body_text: { fr: null } };
    expect(verifyPersistedWrite(response, [{ field: 'body_text', locale: 'fr' }])).toEqual([
      { field: 'body_text', locale: 'fr', reason: 'null' },
    ]);
  });

  it('catches an absent locale key', () => {
    expect(verifyPersistedWrite({ headline: { it: 'Ciao' } }, [
      { field: 'headline', locale: 'fr' },
    ])).toEqual([{ field: 'headline', locale: 'fr', reason: 'absent' }]);
  });

  it('catches an absent field', () => {
    expect(verifyPersistedWrite({}, [{ field: 'headline', locale: 'fr' }])).toEqual([
      { field: 'headline', locale: 'fr', reason: 'absent' },
    ]);
  });

  it('catches whitespace-only strings', () => {
    expect(verifyPersistedWrite({ cta: { fr: '   ' } }, [{ field: 'cta', locale: 'fr' }])).toEqual([
      { field: 'cta', locale: 'fr', reason: 'empty' },
    ]);
  });

  it('catches empty arrays and empty objects', () => {
    expect(verifyPersistedWrite({ blocks: { fr: [] }, seo: { fr: {} } }, [
      { field: 'blocks', locale: 'fr' }, { field: 'seo', locale: 'fr' },
    ])).toEqual([
      { field: 'blocks', locale: 'fr', reason: 'empty' },
      { field: 'seo', locale: 'fr', reason: 'empty' },
    ]);
  });

  it('accepts an array of bare block IDs as a successful write', () => {
    expect(verifyPersistedWrite({ blocks: { fr: ['123456', '123457'] } }, [
      { field: 'blocks', locale: 'fr' },
    ])).toEqual([]);
  });

  it('accepts a falsy-but-valid value like 0 or false', () => {
    expect(verifyPersistedWrite({ count: { fr: 0 }, flag: { fr: false } }, [
      { field: 'count', locale: 'fr' }, { field: 'flag', locale: 'fr' },
    ])).toEqual([]);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run src/utils/translation/__tests__/verifyPersistedWrite.test.ts`
Expected: FAIL — cannot resolve `../verifyPersistedWrite`.

- [ ] **Step 3: Implement**

```ts
/** A `(field, locale)` pair the run claims it translated and wrote. */
export type WriteClaim = { field: string; locale: string };

/** A claim the CMA response does not corroborate. */
export type Mismatch = {
  field: string;
  locale: string;
  reason: 'absent' | 'null' | 'empty';
};

/**
 * Decides whether a persisted value counts as content.
 *
 * `0` and `false` are legitimate values. An array of bare block IDs is what the
 * CMA returns for block fields when they are not nested, and is a successful
 * write — not an empty one.
 */
const isEmptyValue = (value: unknown): boolean => {
  if (typeof value === 'string') return value.trim().length === 0;
  if (Array.isArray(value)) return value.length === 0;
  if (value !== null && typeof value === 'object') {
    return Object.keys(value as object).length === 0;
  }
  return false;
};

/**
 * Asserts that every write the run claimed to make is corroborated by the CMA
 * update response.
 *
 * This is belt-and-braces behind the `FieldOutcome` type, which is what makes
 * writing a null for a failed field unrepresentable. It exists to catch the
 * CMA silently dropping a value, and any future reintroduction of the bug.
 *
 * @param response - The record returned by `client.items.update`.
 * @param claims - Every `(field, locale)` marked `translated`.
 * @returns One `Mismatch` per uncorroborated claim; empty when all persisted.
 */
export const verifyPersistedWrite = (
  response: Record<string, unknown>,
  claims: WriteClaim[],
): Mismatch[] =>
  claims.flatMap(({ field, locale }) => {
    const fieldValue = response[field];
    if (fieldValue === null || typeof fieldValue !== 'object') {
      return [{ field, locale, reason: 'absent' as const }];
    }
    const localized = fieldValue as Record<string, unknown>;
    if (!(locale in localized)) return [{ field, locale, reason: 'absent' as const }];

    const value = localized[locale];
    if (value === null || value === undefined) return [{ field, locale, reason: 'null' as const }];
    if (isEmptyValue(value)) return [{ field, locale, reason: 'empty' as const }];
    return [];
  });
```

- [ ] **Step 4: Wire into the save**

At `ItemsDropdownUtils.ts:667`, capture the full response rather than only `meta`:

```ts
const updated = (await client.items.update(record.id, mergedPayload)) as Record<
  string,
  unknown
> & { meta?: { updated_at?: string } };
updatedAt = updated?.meta?.updated_at ?? updatedAt;

const claims: WriteClaim[] = localeOutcomes.flatMap((outcome) =>
  outcome.translated.map((field) => ({ field, locale: outcome.locale })),
);
const mismatches = verifyPersistedWrite(updated, claims);
```

Append each mismatch to `aggregatedWarnings` as
`` `Field "${m.field}" to ${formatLocaleWithCode(m.locale)} was reported translated but came back ${m.reason} from the CMA.` ``
and move the corresponding `(field, locale)` from that locale's `translated[]` into its `failed[]` with
`{ code: 'datocms', source: 'datocms', message: ... }`, so Task 5's `summarizeLocaleOutcomes` fails the record.

- [ ] **Step 5: Run tests**

Run: `npm test`
Expected: PASS, including the 8 new assertions.

- [ ] **Step 6: Verify, commit**

```bash
npm run lint && npx tsc -b --noEmit
git add src/utils/translation/verifyPersistedWrite.ts src/utils/translation/ItemsDropdownUtils.ts src/utils/translation/__tests__/verifyPersistedWrite.test.ts
git commit -m "feat(bulk): verify the CMA persisted every claimed translation"
```

---

## Task 7: The `RunGate` async seam

**Files:**
- Modify: `src/utils/translation/types.ts:166` (`checkCancellation`)
- Modify: `src/utils/translation/ItemsDropdownUtils.ts:339,629,813,1033,1119`
- Modify: `src/components/TranslationProgressModal.tsx:157`
- Test: `src/utils/translation/__tests__/runGate.test.ts`

**Interfaces:**
- Produces: `export type RunGate = () => Promise<'continue' | 'cancelled'>;`
- Also: `export type SystemicHandler = (err: NormalizedProviderError) => Promise<'retry' | 'cancelled'>;`

`checkCancellation` is `() => boolean` — synchronous, so it cannot pause. Widen it. Keep `abortSignal` for in-flight request cancellation; the gate governs *between* units of work.

The gate is awaited before each field, each locale, and each record. `SystemicHandler` is invoked when `isSystemicError(err)` is true: it resolves `'retry'` once the user (or the countdown) resumes, or `'cancelled'` if they stop.

- [ ] **Step 1: Write the failing test**

Extract the retry loop as a pure, injectable function:

```ts
import { describe, expect, it, vi } from 'vitest';
import { translateWithSystemicRetry } from '../ItemsDropdownUtils';
import type { NormalizedProviderError } from '../ProviderErrors';

const rateLimit: NormalizedProviderError = {
  code: 'rate_limit', source: 'provider', message: 'Rate limit reached.',
};
const modelError: NormalizedProviderError = {
  code: 'model', source: 'provider', message: 'Context length exceeded.',
};

describe('translateWithSystemicRetry', () => {
  it('returns the value on first success', async () => {
    const attempt = vi.fn().mockResolvedValue('Bonjour');
    const onSystemic = vi.fn();
    await expect(translateWithSystemicRetry(attempt, { onSystemic })).resolves.toBe('Bonjour');
    expect(onSystemic).not.toHaveBeenCalled();
  });

  it('pauses on a systemic error, then retries and succeeds', async () => {
    const attempt = vi.fn()
      .mockRejectedValueOnce(rateLimit)
      .mockResolvedValueOnce('Bonjour');
    const onSystemic = vi.fn().mockResolvedValue('retry');
    await expect(translateWithSystemicRetry(attempt, { onSystemic })).resolves.toBe('Bonjour');
    expect(onSystemic).toHaveBeenCalledOnce();
    expect(attempt).toHaveBeenCalledTimes(2);
  });

  it('aborts when the pause handler says cancelled', async () => {
    const attempt = vi.fn().mockRejectedValue(rateLimit);
    const onSystemic = vi.fn().mockResolvedValue('cancelled');
    await expect(translateWithSystemicRetry(attempt, { onSystemic })).rejects.toMatchObject({
      cancelled: true,
    });
  });

  it('retries a content error twice without pausing, then rethrows', async () => {
    const attempt = vi.fn().mockRejectedValue(modelError);
    const onSystemic = vi.fn();
    await expect(translateWithSystemicRetry(attempt, { onSystemic })).rejects.toMatchObject({
      code: 'model',
    });
    expect(attempt).toHaveBeenCalledTimes(3); // 1 initial + 2 retries
    expect(onSystemic).not.toHaveBeenCalled();
  });
});
```

Note: `attempt` here already rejects with a *normalized* error, so the helper does not need a provider. Normalize at the call site.

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run src/utils/translation/__tests__/runGate.test.ts`
Expected: FAIL — `translateWithSystemicRetry` not exported.

- [ ] **Step 3: Implement `RunGate`, `SystemicHandler`, `translateWithSystemicRetry`**

Add to `types.ts`:

```ts
/**
 * Awaited between units of work. Resolves `'continue'` to proceed, or
 * `'cancelled'` to unwind the run. Unlike the boolean predicate it replaces,
 * this can block — which is what makes a mid-run pause possible.
 */
export type RunGate = () => Promise<'continue' | 'cancelled'>;

/** Invoked on a systemic error; resolves once the run may resume, or cancels. */
export type SystemicHandler = (
  err: NormalizedProviderError,
) => Promise<'retry' | 'cancelled'>;
```

In `ItemsDropdownUtils.ts`:

```ts
/** Sentinel thrown to unwind the run when the user cancels from a pause. */
export const RUN_CANCELLED = { cancelled: true } as const;

/** Retries a content-scoped failure this many times before giving up. */
const CONTENT_RETRY_LIMIT = 2;

/**
 * Runs one translation attempt, handling systemic errors by pausing the whole
 * run and content errors by retrying the field a bounded number of times.
 *
 * @param attempt - Performs one translation; must reject with a normalized error.
 * @param handlers.onSystemic - Pauses the run; resolves when it may resume.
 * @returns The translated value.
 * @throws {NormalizedProviderError} When content retries are exhausted.
 * @throws {typeof RUN_CANCELLED} When the user cancels from the pause screen.
 */
export const translateWithSystemicRetry = async <T>(
  attempt: () => Promise<T>,
  handlers: { onSystemic: SystemicHandler },
): Promise<T> => {
  let contentRetries = 0;

  for (;;) {
    try {
      return await attempt();
    } catch (raw) {
      const err = raw as NormalizedProviderError;

      if (isSystemicError(err)) {
        if ((await handlers.onSystemic(err)) === 'cancelled') throw RUN_CANCELLED;
        continue; // the handler already waited; try the same field again
      }

      if (contentRetries >= CONTENT_RETRY_LIMIT) throw err;
      contentRetries += 1;
    }
  }
};
```

The **rate-limit retry budget of 3** and the backoff wait live in the modal's `onSystemic` implementation (Task 8), because that is where the countdown UI is. `translateWithSystemicRetry` stays pure: it retries whenever the handler says `'retry'`.

- [ ] **Step 4: Replace `checkCancellation` with `RunGate`**

Swap `checkCancellation?: () => boolean` for `gate?: RunGate` in the options types at `ItemsDropdownUtils.ts:339,1033` and `types.ts:166`. At each former call site (`813`, and before each locale and field), replace `if (options.checkCancellation?.())` with `if ((await options.gate?.()) === 'cancelled')`. Provider-level `checkCancellation` passthroughs (`629`, `1119`) become `gate`.

In `TranslationProgressModal.tsx:157`, replace
`checkCancellation: () => isCancelledRef.current` with a `gate` implementation (Task 8).

Wrap the `translateFieldValue` call (line 1106) in `translateWithSystemicRetry`, normalizing the error first so the helper receives a `NormalizedProviderError`.

- [ ] **Step 5: Run tests**

Run: `npm test`
Expected: PASS.

- [ ] **Step 6: Verify, commit**

```bash
npm run lint && npx tsc -b --noEmit
git add src/utils/translation src/components/TranslationProgressModal.tsx src/utils/translation/__tests__/runGate.test.ts
git commit -m "feat(bulk): async RunGate seam replacing sync checkCancellation"
```

---

## Task 8: The pause machine

**Files:**
- Modify: `src/components/TranslationProgressModal.tsx`
- Create: `src/components/BulkTranslations/PausePanel.tsx`
- Test: `src/components/BulkTranslations/__tests__/pauseController.test.ts`

**Interfaces:**
- Consumes: `NormalizedProviderError`, `isSystemicError`, `computeRetryDelay`, `RunGate`, `SystemicHandler`.
- Produces:
  ```ts
  export type RunStatus =
    | { kind: 'running' }
    | { kind: 'paused'; reason: NormalizedProviderError; resumeAt?: number; attempt: number }
    | { kind: 'cancelled' }
    | { kind: 'completed' };
  ```

**Behavior matrix** (drives both the controller and `PausePanel`):

| `reason.code` | Auto-retry? | Resume button | Countdown |
|---|---|---|---|
| `rate_limit` | yes, up to 3 | disabled until countdown ends | yes, from `resumeAt` |
| `auth` | no | enabled immediately | no |
| `quota` | no | enabled immediately | no |
| `network` | no | enabled immediately (manual retry) | no |

After 3 exhausted `rate_limit` auto-retries, the pause persists and Resume becomes **enabled**.

- [ ] **Step 1: Write the failing controller test**

Extract the controller from React so it is testable without rendering:

```ts
import { describe, expect, it, vi } from 'vitest';
import { createPauseController } from '../pauseController';
import type { NormalizedProviderError } from '../../../utils/translation/ProviderErrors';

const rateLimit: NormalizedProviderError = { code: 'rate_limit', source: 'provider', message: 'x' };
const authErr: NormalizedProviderError = { code: 'auth', source: 'provider', message: 'x' };

describe('createPauseController', () => {
  it('auto-resumes a rate limit after the computed delay', async () => {
    const sleep = vi.fn().mockResolvedValue(undefined);
    const onStatus = vi.fn();
    const c = createPauseController({ sleep, onStatus });
    await expect(c.handleSystemic(rateLimit)).resolves.toBe('retry');
    expect(sleep).toHaveBeenCalledOnce();
    expect(onStatus).toHaveBeenCalledWith(expect.objectContaining({ kind: 'paused' }));
  });

  it('exhausts the rate-limit budget after 3 auto-retries, then waits for the user', async () => {
    const sleep = vi.fn().mockResolvedValue(undefined);
    const c = createPauseController({ sleep, onStatus: vi.fn() });
    await c.handleSystemic(rateLimit);
    await c.handleSystemic(rateLimit);
    await c.handleSystemic(rateLimit);
    const fourth = c.handleSystemic(rateLimit);
    expect(sleep).toHaveBeenCalledTimes(3);
    c.resume();
    await expect(fourth).resolves.toBe('retry');
  });

  it('never auto-retries an auth error; waits for a manual resume', async () => {
    const sleep = vi.fn();
    const c = createPauseController({ sleep, onStatus: vi.fn() });
    const pending = c.handleSystemic(authErr);
    expect(sleep).not.toHaveBeenCalled();
    c.resume();
    await expect(pending).resolves.toBe('retry');
  });

  it('resolves cancelled when the user stops', async () => {
    const c = createPauseController({ sleep: vi.fn(), onStatus: vi.fn() });
    const pending = c.handleSystemic(authErr);
    c.cancel();
    await expect(pending).resolves.toBe('cancelled');
  });

  it('resets the rate-limit budget after a success', async () => {
    const sleep = vi.fn().mockResolvedValue(undefined);
    const c = createPauseController({ sleep, onStatus: vi.fn() });
    await c.handleSystemic(rateLimit);
    c.onSuccess();
    await c.handleSystemic(rateLimit);
    await c.handleSystemic(rateLimit);
    expect(sleep).toHaveBeenCalledTimes(3); // budget was reset, none exhausted
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run src/components/BulkTranslations/__tests__/pauseController.test.ts`
Expected: FAIL — cannot resolve `../pauseController`.

- [ ] **Step 3: Implement `src/components/BulkTranslations/pauseController.ts`**

- `RATE_LIMIT_AUTO_RETRY_BUDGET = 3`.
- `handleSystemic(err)`:
  - If `err.code === 'rate_limit'` and budget remains: decrement, compute
    `delay = computeRetryDelay(retryAfterMs, attempt)`, emit
    `{ kind: 'paused', reason: err, resumeAt: nowMs() + delay, attempt }`, `await sleep(delay)`,
    return `'retry'` (unless cancelled meanwhile → `'cancelled'`).
  - Otherwise emit `{ kind: 'paused', reason: err, attempt }` with **no** `resumeAt`, and return a
    promise resolved by `resume()` → `'retry'` or `cancel()` → `'cancelled'`.
- `onSuccess()` resets the budget.
- `resume()` / `cancel()` settle any pending manual pause.
- Inject `sleep` and `nowMs` so tests never wait on real time.
- Expose `gate: RunGate` that resolves `'cancelled'` once `cancel()` has been called, else `'continue'`.

`retryAfterMs` reaches the controller by threading `ProviderError.retryAfterMs` onto `NormalizedProviderError` — add an optional `retryAfterMs?: number` to that type in `ProviderErrors.ts` and populate it in `normalizeProviderError` from `(error as ProviderError).retryAfterMs`.

- [ ] **Step 4: Build `PausePanel.tsx`**

Renders `reason.message` and `reason.hint`. For `rate_limit` with a live `resumeAt`, a disabled Resume plus a `useEffect`-driven per-second countdown: `Retrying automatically in {n}s…`. Otherwise an enabled Resume. Always a Cancel button whose confirmation copy reads exactly:

> Stopping does not undo the records already translated; they will be re-translated on the next bulk run.

Use `datocms-react-ui` `Button` and follow the modal's existing class-name conventions. **Do not** call `ctx.openConfirm` from inside the modal — per project memory, nested modals render behind and hang. Render the warning inline in the panel.

- [ ] **Step 5: Wire into `TranslationProgressModal`**

Replace `isProcessing` / `isCancelledRef` bookkeeping with a `runStatus` state and the controller. Pass `controller.gate` as `gate` and `controller.handleSystemic` as `onSystemic` into `translateAndUpdateRecords`. Render `<PausePanel />` when `runStatus.kind === 'paused'`. Call `controller.onSuccess()` after each successfully translated record.

- [ ] **Step 6: Run tests**

Run: `npm test`
Expected: PASS.

- [ ] **Step 7: Verify, commit**

```bash
npm run lint && npx tsc -b --noEmit
git add src/components src/utils/translation/ProviderErrors.ts
git commit -m "feat(bulk): pause/resume on systemic errors with rate-limit countdown"
```

---

## Task 9: Gate the Export button

**Files:**
- Modify: `src/components/TranslationProgressModal.tsx:358-368`
- Test: `src/components/BulkTranslations/__tests__/exportGating.test.ts`

**Interfaces:**
- Consumes: `RunStatus` (Task 8).
- Produces: `export const isExportEnabled = (status: RunStatus, processedCount: number): boolean`

Export is enabled only when the run is **terminal** — `completed` or `cancelled` — and something was processed. Deliberately disabled while `paused`: a paused run is not a stopped run, and its CSV would be misleadingly partial.

- [ ] **Step 1: Write the failing test**

```ts
import { describe, expect, it } from 'vitest';
import { isExportEnabled } from '../exportGating';
import type { RunStatus } from '../pauseController';

const err = { code: 'rate_limit', source: 'provider', message: 'x' } as const;

describe('isExportEnabled', () => {
  it('is disabled while running', () =>
    expect(isExportEnabled({ kind: 'running' }, 5)).toBe(false));
  it('is disabled while paused', () =>
    expect(isExportEnabled({ kind: 'paused', reason: err, attempt: 1 }, 5)).toBe(false));
  it('is enabled once completed', () =>
    expect(isExportEnabled({ kind: 'completed' }, 5)).toBe(true));
  it('is enabled once cancelled', () =>
    expect(isExportEnabled({ kind: 'cancelled' }, 5)).toBe(true));
  it('is disabled when nothing was processed', () =>
    expect(isExportEnabled({ kind: 'completed' }, 0)).toBe(false));
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run src/components/BulkTranslations/__tests__/exportGating.test.ts`
Expected: FAIL — cannot resolve `../exportGating`.

- [ ] **Step 3: Implement**

```ts
/**
 * Export is offered only once the run reaches a terminal state. A paused run is
 * not a stopped run: exporting mid-pause would hand the user a CSV that looks
 * like a finished report but omits everything after the pause point.
 *
 * @param status - The run's current status.
 * @param processedCount - How many records have produced a report row.
 * @returns True when the Export button should be clickable.
 */
export const isExportEnabled = (status: RunStatus, processedCount: number): boolean =>
  processedCount > 0 && (status.kind === 'completed' || status.kind === 'cancelled');
```

- [ ] **Step 4: Wire it**

At `TranslationProgressModal.tsx:358`, the Export `Button` is always rendered (so its disabled state is visible and explains itself) with:

```tsx
<Button
  type="button"
  buttonType="muted"
  onClick={handleExportCsv}
  buttonSize="s"
  disabled={!isExportEnabled(runStatus, processedRecords.length)}
  className="TranslationProgressModal__export-button"
>
  Export CSV
</Button>
```

- [ ] **Step 5: Run tests, verify, commit**

```bash
npm test && npm run lint && npx tsc -b --noEmit
git add src/components
git commit -m "fix(bulk): disable Export CSV until the run finishes or is stopped"
```

---

## Task 10: E2E fault-injection helpers

**Files:**
- Create: `e2e/tests/steps/fault-injection.ts`

**Interfaces:**
- Produces:
  ```ts
  export const PROVIDER_HOST_PATTERNS: Record<Vendor, string>;
  export const injectRateLimit: (page: Page, opts: {
    vendor: Vendor; retryAfterSeconds?: number; failTimes?: number; matchBody?: RegExp;
  }) => Promise<void>;
  export const injectAuthError: (page: Page, vendor: Vendor) => Promise<void>;
  export const injectCmaFieldStrip: (page: Page, field: string, locale: string) => Promise<void>;
  export const clearFaults: (page: Page) => Promise<void>;
  ```

Provider calls originate **in the browser**, so Playwright's `page.route()` intercepts them. A fault-injection lane therefore needs **no provider API key** and runs in CI even when `.env.testing` is empty.

Host patterns: `openai` → `**/api.openai.com/**`, `google` → `**/generativelanguage.googleapis.com/**`, `anthropic` → `**/api.anthropic.com/**`, `deepl` → `**/*.deepl.com/**`. CMA → `**/site-api.datocms.com/**`.

- [ ] **Step 1: Implement the helpers**

- `injectRateLimit` fulfills matching requests with `status: 429`, a JSON body shaped like the vendor's error envelope, and `headers: { 'retry-after': String(retryAfterSeconds) }` when provided. `failTimes` decrements a closure counter; once exhausted, calls `route.fallback()` so the real provider handles the rest. `matchBody` optionally restricts the fault to requests whose post body matches (used to fail only the `fr` locale's calls).
- `injectAuthError` fulfills with `status: 401`.
- `injectCmaFieldStrip` intercepts the CMA `PUT /items/:id` **response** via `route.fetch()` + `route.fulfill()`, mutating `data.attributes[field][locale] = null` in the returned JSON. This is the only direct test of §6.
- `clearFaults` calls `page.unrouteAll({ behavior: 'ignoreErrors' })`.

Every helper takes `Page` and returns `Promise<void>`; register them **before** navigating.

- [ ] **Step 2: Typecheck, commit**

```bash
npx tsc -b --noEmit
git add e2e/tests/steps/fault-injection.ts
git commit -m "test(e2e): page.route fault-injection helpers"
```

---

## Task 11: E2E reliability lane

**Files:**
- Create: `e2e/tests/bulk-reliability.spec.ts`

**Interfaces:**
- Consumes: `runBulkTranslation`, `parseReport`, `bulkPageUrl` (`e2e/tests/steps/bulk.ts`); helpers from Task 10; `assert-record` steps.

Reuse the existing bulk step helpers. Where a test must inspect the persisted record, use the CMA client from `e2e/tests/setup/cma.ts`.

- [ ] **Step 1: Write the specs**

| Test | Injected fault | Assertion |
|---|---|---|
| `a locale-wide rate limit never writes null` | `429`, `matchBody: /fr/`, `failTimes: 999` | after the run, the record's `fr` value for each field is **absent or unchanged** — assert `!== null`; the pre-run value is preserved |
| `a rate limit pauses with a countdown and auto-resumes` | `429`, `retryAfterSeconds: 2`, `failTimes: 1` | pause panel visible; Resume disabled; `/Retrying automatically in \d+s/` visible; run then completes |
| `an exhausted retry budget waits for a manual resume` | `429`, `failTimes: 4` | pause persists; Resume becomes enabled; clicking it continues the run |
| `an auth error pauses immediately without a countdown` | `401` | pause panel on first failure; Resume enabled; no countdown text |
| `Retry-After is honored` | `429`, `retryAfterSeconds: 5`, `failTimes: 1` | elapsed time between pause appearing and run resuming is `>= 4500ms` |
| `blind backoff applies when Retry-After is absent` | `429`, no header, `failTimes: 1` | run still pauses, waits, and resumes |
| `Export is disabled mid-run and while paused` | `429`, `failTimes: 1` | Export disabled while running; disabled while paused; enabled after completion |
| `Export is enabled after Cancel` | `429`, `failTimes: 999` | Cancel from the pause panel; Export becomes enabled |
| `Cancel warns that written records are not undone` | `429`, `failTimes: 999` | the exact copy from Global Constraints is visible |
| `a dead locale fails the record` | `429`, `matchBody: /fr/` | the report row reads `error` and its status text contains `French [fr]` |
| `a CMA read-back mismatch fails the record` | `injectCmaFieldStrip('headline', 'fr')` | report row reads `error`, status text names `headline` and `fr` |

- [ ] **Step 2: Run against one lane**

```bash
npx playwright test e2e/tests/bulk-reliability.spec.ts --project=deepl
```

Expected: all pass. The fault-injected tests need no real key; the ones that let calls fall through to a real provider do.

- [ ] **Step 3: Commit**

```bash
git add e2e/tests/bulk-reliability.spec.ts
git commit -m "test(e2e): rate-limit pause, Export gating, and read-back verification"
```

---

## Task 12: Documentation

**Files:**
- Modify: `README.md` (bulk translation section)
- Modify: `AGENTS.md` (`## Translation Workflow Notes`, `## Testing Guidelines`)
- Modify: `src/entrypoints/CustomPage/AIBulkTranslationsPage.tsx:16-19` (stale comment)

- [ ] **Step 1: README**

Add a **Reliability** subsection under bulk translation covering: what happens on a rate limit (auto-retry ×3 with backoff, then a pause with countdown); that `auth`/`quota` pause immediately and need a human; that a field whose translation fails is **never** overwritten with an empty value — the target locale keeps what it had; that a record with any failed field is reported as failed and names the locale; that Export is available only once the run finishes or is stopped; and that cancelling does not roll back records already written.

- [ ] **Step 2: AGENTS.md — Translation Workflow Notes**

Record the two invariants a future agent could plausibly violate, because the old sentinel-by-absence pattern reads as intentional:

> - `translateField` returns a `FieldOutcome` (`translated` | `untranslatable` | `failed`). **Only `untranslatable` fields may receive a locale-sync fallback.** Filling a `failed` field writes `null` into the target locale because a provider 429'd — this was a real, shipped bug.
> - Success is accounted per `(record, locale)`, never per record. Summing translated-field counts across locales lets a healthy locale mask a wholly-dead sibling.
> - Provider errors are classified by `isSystemicError`. Systemic (`rate_limit`, `auth`, `quota`, `network`) pauses the run; content-scoped fails the field and its record, then continues.
> - `Retry-After` is an optimization, never a precondition. Browser callers cannot read the header unless the server sets `Access-Control-Expose-Headers`, so the exponential backoff must be correct on its own.

- [ ] **Step 3: AGENTS.md — Testing Guidelines**

> - `e2e/tests/bulk-reliability.spec.ts` injects faults with `page.route()` rather than hitting a real provider. Because provider calls run in the browser (`dangerouslyAllowBrowser: true`), they are interceptable — **this lane needs no API key** and runs with an empty `.env.testing`.

- [ ] **Step 4: Fix the stale comment**

`AIBulkTranslationsPage.tsx:16-19` claims the page opens "one modal per target locale, sequentially." It opens a **single** modal for the whole job (lines 416-429). Correct it.

- [ ] **Step 5: Commit**

```bash
git add README.md AGENTS.md src/entrypoints/CustomPage/AIBulkTranslationsPage.tsx
git commit -m "docs: bulk translation reliability invariants and fault-injection lane"
```

---

## Self-Review

**Spec coverage:** §1 → Task 4. §2 → Task 5. §3 → Tasks 1, 2, 3, 7. §4 → Tasks 7, 8. §5 → Task 9. §6 → Task 6. Testing → Tasks 1–9 (unit), 10–11 (E2E). Documentation → Task 12. Loose thread (stale comment) → Task 12 Step 4. The "DeepSeek" resolution needs no task; it is recorded as a Global Constraint so nobody adds the vendor.

**Type consistency:** `FieldOutcome` (T4) is consumed by `shouldApplyLocaleSyncFallback` (T4) and produces `failedFields`, consumed by `LocaleOutcome` (T5), consumed by `summarizeLocaleOutcomes` (T5) and by the `WriteClaim[]` construction (T6). `RunStatus` (T8) is consumed by `isExportEnabled` (T9). `NormalizedProviderError` gains `retryAfterMs?` in T8 Step 3, sourced from `ProviderError.retryAfterMs` (T2). `computeRetryDelay` (T3) is called only by `pauseController` (T8). `RunGate` / `SystemicHandler` (T7) are implemented by `pauseController` (T8). Consistent.

**Known ordering constraint:** Tasks 4–7 all edit `ItemsDropdownUtils.ts` and must run sequentially. Tasks 1, 2, 3 touch disjoint files and may run in parallel. Tasks 8–9 both edit `TranslationProgressModal.tsx` — sequential. Tasks 10–11 are sequential with each other; Task 12 is independent.
