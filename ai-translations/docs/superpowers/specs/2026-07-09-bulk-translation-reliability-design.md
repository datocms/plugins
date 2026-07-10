# Bulk Translation Reliability — Design

**Date:** 2026-07-09
**Status:** Approved, pending implementation plan
**Scope:** `ai-translations` plugin, bulk translation path

## Problem

Three reported defects turned out to be one failure chain plus one unrelated UI omission.

### Defect 1 — a whole locale silently written as `null`

`translateField` (`src/utils/translation/ItemsDropdownUtils.ts:1147`) catches any provider
error, pushes a `"was skipped"` warning, and never assigns `updatePayload[field]`.

The locale-sync fallback loop (`ItemsDropdownUtils.ts:1171`) then guards on key presence:

```ts
if (updatePayload[field]) continue;
```

That guard cannot distinguish *"this field needs no translation"* from *"this field's
translation call just threw."* Both manifest as an absent key. So the fallback runs, and
`resolveLocaleSyncFallback` (`ItemsDropdownUtils.ts:983`) returns `{ value: null }` for any
field that is neither `required` nor a reference. The plugin **writes `null` into the target
locale for every field that failed**, in the same `items.update` that carries the locales
that succeeded — so the write is accepted and looks clean.

Root cause: *sentinel-by-absence*. "Key not present" was used to encode one specific meaning,
and a second code path learned to produce absence.

### Defect 2 — the run reports success anyway

`reportTranslationResult` (`ItemsDropdownUtils.ts:700`) computes success per **record**, while
failures occur per **(field, locale)**:

```ts
const updatedFieldCount = outcome.translatedFieldCount + outcome.referenceFieldsCopied;
if (updatedFieldCount === 0 && outcome.warnings.length > 0) { /* error */ }
```

`translatedFieldCount` is summed across *all* target locales. If Italian and Chinese succeed
while French fails wholesale, the count is well above zero, the error branch is skipped, and
the record reports `Translated` (line 773). A locale can be 100% dead and the record shows
green. Warnings are attached but do not move the counters.

### Defect 3 — no rate-limit handling in the bulk path

`calculateRateLimitBackoff` and `isRateLimitError` exist (`TranslationCore.ts:142,154`) but are
wired **only** into the single-record item-form flow (`translateRecordFields.ts:899`). The bulk
path has no retry, no backoff, and no pacing. Locales run sequentially per record, so exhausting
the quota mid-record fails every remaining locale in that record's chain, and the next record
starts already throttled. This is why French — merely late in the locale order — looked singled
out, and why identical warnings repeat verbatim across records.

`ProviderError` (`src/utils/translation/types.ts:187`) carries only `message`, `status`,
`vendor`. No `Retry-After` is captured anywhere: `grep -rni "retry.after|\.headers"` over
`src/utils/translation/` returns nothing.

### Defect 4 — Export CSV is enabled mid-run

`TranslationProgressModal.tsx:358` gates Export solely on `processedRecords.length > 0`. The
adjacent Close button correctly uses `disabled={isProcessing && !isCompleted}`; Export never
received the same treatment.

## Non-goals

- **Language detection.** Every failure in the reported logs was a provider error we already
  held in hand and discarded. A detector (`franc`, `tinyld`) adds a dependency and produces
  false positives on exactly the fields that fail most (`cta_label`, `headline` — both below the
  ~20-character reliability floor), on brand names, and on regional pairs like `pt` vs `pt-BR`.
  It catches nothing that §1–§5 below miss. Explicitly out of scope.
- **Durable checkpoints.** Run state is modal-scoped and in-memory. A browser refresh loses the
  run; records already written stay written. Plugin parameters are global shared state and would
  let concurrent editors stomp each other.
- **Deep reference-graph traversal.** Unchanged from today.

## Design

### §1 — Per-field outcomes

Make the conflation unrepresentable. `translateField` returns a discriminated union instead of
mutating a payload map:

```ts
type FieldOutcome =
  | { status: 'translated'; value: unknown }
  | { status: 'untranslatable' }   // no source value, or a field type we do not translate
  | { status: 'failed'; error: NormalizedProviderError };
```

The locale-sync fallback loop keys off the *outcome*, not off key presence:

| Outcome | Fallback behavior |
|---|---|
| `untranslatable` | Fallback applies exactly as today: `null`, or the source value for `required` / min-`size` / reference fields, or source blocks with stripped ids for required block fields. |
| `failed` | **Field is excluded from the payload entirely.** No key is written for that locale. Prior content in the target locale is left untouched. |
| `translated` | Value is written. |

This alone makes Defect 1 unreachable: no code path can write `null` in response to a 429.

### §2 — Accounting per (record, locale)

Replace the scalar counter with a per-locale roll-up:

```ts
type LocaleOutcome = {
  locale: string;
  translated: string[];                                       // field api keys written
  failed: { field: string; error: NormalizedProviderError }[];
};
```

Record status rules:

- **Any** locale with a non-empty `failed[]` marks the record `error`.
- Status text names the locale and the ratio: `French [fr]: 0/6 fields translated`.
- Content-scoped failures (`model`, `plugin`, `unknown`) fail the record too — not warning-only.
  Consequence, accepted: a single stubborn oversized field marks its record red on every run
  until the content is fixed.
- Existing `error`-severity QC flag escalation (`ItemsDropdownUtils.ts:759`) is retained.

### §3 — Error classification, backoff, adaptive pacing

Classify on the `code` that `normalizeProviderError` (`ProviderErrors.ts`) already emits.

| `code` | Class | Behavior |
|---|---|---|
| `rate_limit` | systemic | auto-retry with backoff, up to 3 attempts, then pause with countdown |
| `auth` | systemic | pause immediately, no auto-retry (needs a human) |
| `quota` | systemic | pause immediately, no auto-retry (needs a human) |
| `network` | systemic | pause with a manual **Retry** button |
| `model` | content | retry field ×2, then fail the field and the record |
| `plugin` | content | retry field ×2, then fail the field and the record |
| `unknown` | content | retry field ×2, then fail the field and the record |

Systemic means: *the next call will fail the same way, so continuing only burns quota and
manufactures corrupt state.*

#### Retry delay

`computeRetryDelay(err, attempt)`, in priority order, each step degrading safely to the next:

1. `ProviderError.retryAfterMs` — **new field.** Adapters parse `Retry-After` (delta-seconds
   *or* HTTP-date) opportunistically.
2. Otherwise `calculateRateLimitBackoff(attempt)` (`TranslationCore.ts:142`) — exists, tested.
3. Plus jitter, so N locales do not re-collide in lockstep after a shared wait.

**Constraint: the calls are browser-side.** `OpenAIProvider.ts:41` sets
`dangerouslyAllowBrowser: true`; the plugin calls provider APIs directly from the DatoCMS
iframe. Cross-origin JavaScript can read only those response headers the server lists in
`Access-Control-Expose-Headers`. OpenAI exposes `retry-after` and `x-ratelimit-*`; Anthropic and
DeepL are inconsistent; a CORS-preflight rejection or proxy-level block surfaces no headers at
all.

Therefore **the blind exponential path is the contract, and `retryAfterMs` only refines it.** A
header-derived cadence must never be a precondition for waiting, or the feature silently
degrades to "no wait at all" on the providers that withhold the header.

Per-adapter plumbing for `retryAfterMs`:

| Adapter | Source |
|---|---|
| `OpenAIProvider` | SDK `APIError.headers` |
| `AnthropicProvider` (raw `fetch`) | `res.headers.get('retry-after')` |
| `DeepLProvider` (raw `fetch`) | `res.headers.get('retry-after')` |
| `GeminiProvider` (Google SDK) | `error.response?.headers` when present, else `undefined` |

#### Adaptive pacing

A run-scoped `gapMs` between provider calls: doubled on each `rate_limit` (capped), decayed
after N consecutive successes. This is what prevents "French died, so Chinese dies too, so the
next record starts already throttled."

Retry budget for `rate_limit`: **3 auto-retries**. On the 4th failure the run stays paused with
manual resume.

### §4 — The pause machine

`checkCancellation` is currently `() => boolean` (`types.ts:166`) — synchronous. A pause must
*await*. Widen the seam:

```ts
type RunGate = () => Promise<'continue' | 'cancelled'>;
```

Awaited before each field, each locale, and each record. Replaces `checkCancellation` at
`ItemsDropdownUtils.ts:339,629,813,1033,1119`. The existing `abortSignal` is retained for
in-flight request cancellation.

Modal-owned state (`TranslationProgressModal.tsx`), in-memory:

```ts
type RunStatus =
  | { kind: 'running' }
  | { kind: 'paused'; reason: NormalizedProviderError; resumeAt?: number; attempt: number }
  | { kind: 'cancelled' }
  | { kind: 'completed' };
```

Pause screen behavior:

- Renders the normalized error and its per-vendor hint (`getRateLimitHint` / `getQuotaHint`).
- **`rate_limit`:** Resume is *disabled*, with a live countdown — "Retrying automatically in
  12s…" — that fires on its own when it reaches zero. `resumeAt` drives the countdown.
- **`auth` / `quota`:** Resume is enabled immediately; the user leaves, fixes the key, returns.
- **`network`:** Resume enabled immediately (manual retry).
- **Cancel** stops the run and warns verbatim: *stopping does not undo the records already
  translated; they will be re-translated on the next bulk run.*

### §5 — Export CSV gating

```tsx
disabled={runStatus.kind === 'running' || runStatus.kind === 'paused'}
```

Enabled only on `completed` or `cancelled` — "finished or stopped." Deliberately **disabled
while paused**: a paused run is not a stopped run, and its CSV would be misleadingly partial.

Applies to `TranslationProgressModal.tsx:358`. The persisted-report export in
`BulkTranslationReport.tsx:88` is unaffected (it only renders post-run).

### §6 — Structural read-back verification

`client.items.update` already returns the full updated record; today the body is discarded
except for `meta.updated_at` (`ItemsDropdownUtils.ts:667`). Assert every claim against it:

```ts
type Mismatch = { field: string; locale: string; reason: 'absent' | 'null' | 'empty' };

verifyPersistedWrite(
  response: Item,
  claims: { field: string; locale: string }[],
): Mismatch[];
```

For every `(field, locale)` marked `translated`, the persisted value must be **present,
non-null, and non-empty**:

- strings — trimmed length > 0
- arrays — `length > 0`
- objects — key count > 0

Any mismatch flips the record to `error`, naming the exact field and locale.

**Caveat to encode:** for block and structured-text fields the CMA response may return **block
IDs rather than nested payloads**, depending on the `nested` parameter. "Non-empty" must accept
a bare ID array and not mistake it for a dropped write.

This is deliberately a belt-and-braces assertion, not the primary defense — §1 is. Verification
that *substitutes* for correct types tends to rot, because nobody can tell whether a green check
means "we did it right" or "we caught ourselves doing it wrong."

## Testing

### Unit tests

- Classification table: every `code` → systemic | content.
- `computeRetryDelay`: `Retry-After` as delta-seconds; as HTTP-date; absent → exponential;
  jitter bounded.
- Adaptive pacer: `gapMs` doubles on 429, caps, decays after N successes.
- Fallback branch: `untranslatable` → fallback applies; `failed` → key absent from payload.
- `verifyPersistedWrite`: absent / null / empty-string / empty-array / block-ids-only (must pass).
- **Regression pin:** all fields `rate_limit` for one locale → that locale key is absent from the
  payload, and the record reports `error` naming the locale.

### E2E (Playwright)

The suite currently drives **real provider APIs** across four forked environments
(`e2e/tests/fixtures/providers.ts`), and performs no request interception —
`grep -rn "\.route("` over `e2e/tests/` returns nothing.

A real provider cannot be made to return `429` on demand. But because provider calls originate
in the browser (`dangerouslyAllowBrowser: true`), Playwright's `page.route()` can intercept them
at the network layer and synthesize responses. **A fault-injection lane needs no provider key at
all**, so it runs in CI even when `.env.testing` is empty.

New: `e2e/tests/steps/fault-injection.ts`, exposing route helpers that match the provider host
for the active lane and fulfill with a canned response.

| Test | Injected fault | Assertion |
|---|---|---|
| `bulk: locale-wide rate limit never writes null` | `429` on every call for the `fr` locale's fields | after the run, `fr` is **absent/unchanged** on the record via CMA; it is *not* `null` |
| `bulk: rate limit pauses with countdown` | `429` + `Retry-After: 2` | pause screen visible; Resume disabled; countdown text present; run auto-resumes and completes |
| `bulk: retry budget exhausted → manual resume` | `429` on 4 consecutive attempts | pause persists; Resume becomes enabled; clicking it continues the run |
| `bulk: auth error pauses immediately` | `401` | pause screen visible on first failure; Resume enabled; no countdown |
| `bulk: Retry-After honored` | `429` + `Retry-After: 5` | resume occurs no earlier than ~5s (timing assertion with tolerance) |
| `bulk: blind backoff when header absent` | `429`, no `Retry-After` | run still waits (exponential), still resumes |
| `bulk: Export disabled mid-run and while paused` | slow-response route | Export disabled while running; disabled while paused; enabled after completion; enabled after Cancel |
| `bulk: Cancel from pause warns about written records` | `429` | Cancel shows the "does not undo already-translated records" copy; run terminates |
| `bulk: a dead locale fails the record` | `429` for all `fr` fields only | report row for the record reads `error`, and its status text names `French [fr]` |
| `bulk: read-back mismatch fails the record` | intercept the **CMA** `items.update` response and strip one locale value | record reports `error` naming that field + locale |

The last row intercepts the DatoCMS CMA rather than the provider — same `page.route()`
mechanism, different host — and is the only direct test of §6.

Existing green-path lanes in `e2e/tests/ai-translations.spec.ts` are unchanged and continue to
exercise real providers. Reuse `runBulkTranslation` / `parseReport` from `e2e/tests/steps/bulk.ts`.

## Documentation updates

- **`ai-translations/README.md`** — new subsection under the bulk-translation docs: rate-limit
  behavior, what pause/resume does, the guarantee that a failed field is never overwritten with
  `null`, and the fact that cancelling does not roll back already-written records.
- **`AGENTS.md`** — extend `## Translation Workflow Notes` with the `FieldOutcome` contract and
  the systemic-vs-content error rule (both are invariants a future agent could easily violate,
  since the old sentinel-by-absence pattern reads as intentional). Extend `## Testing Guidelines`
  with the `page.route()` fault-injection lane and the fact that it requires no API key.

## Resolved: the "DeepSeek" attribution

The reported logs were attributed to DeepSeek, but **DeepSeek does not exist in this codebase** —
`grep -rni deepseek src/` returns nothing, and `VendorId` (`types.ts:7`) is exactly
`'openai' | 'google' | 'anthropic' | 'deepl'`. The hint text in the logs, *"Reduce request rate or
increase quota in Google Cloud console,"* is emitted only for `vendor === 'google'`
(`ProviderErrors.ts:405`). Those logs came from a **Gemini run**. No vendor tagging bug exists and
no new vendor member is needed; the reported symptoms are fully explained by Defects 1–3.

## Loose thread

Stale, worth fixing in passing: the file header comment at
`AIBulkTranslationsPage.tsx:16-19` describes "one modal per target locale, sequentially," which
the single-modal implementation at lines 416-429 contradicts.

## Files touched

| File | Change |
|---|---|
| `src/utils/translation/ItemsDropdownUtils.ts` | `FieldOutcome`, `LocaleOutcome`, fallback guard, per-locale accounting, `RunGate`, read-back verification |
| `src/utils/translation/types.ts` | `ProviderError.retryAfterMs`; `RunGate` replaces `checkCancellation` |
| `src/utils/translation/ProviderErrors.ts` | classification helper (`isSystemic`) |
| `src/utils/translation/TranslationCore.ts` | `computeRetryDelay`, adaptive pacer |
| `src/utils/translation/providers/*.ts` | parse `Retry-After` into `ProviderError` |
| `src/components/TranslationProgressModal.tsx` | `RunStatus`, pause screen, countdown, Export gating |
| `src/entrypoints/CustomPage/AIBulkTranslationsPage.tsx` | stale header comment |
| `e2e/tests/steps/fault-injection.ts` | **new** — `page.route()` helpers |
| `e2e/tests/ai-translations.spec.ts` | fault-injection lane |
| `README.md`, `AGENTS.md` | documentation |
