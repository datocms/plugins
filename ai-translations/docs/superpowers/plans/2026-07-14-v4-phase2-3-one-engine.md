# v4 Phases 2+3 — One Engine + the Exclusion Rule — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Delete `translateRecordFields.ts` (964 lines) and route every flow through one engine with rev-7 semantics: always overwrite, two-list exclusion fates, no matching anywhere — without losing any run-control capability the deleted path carried (spec §2.3 is this plan's acceptance checklist).

**Architecture:** Extract the bulk path's `buildTranslatedUpdatePayload` machinery into an `src/engine/` module; add the AIMD parallel executor, the stall guard, and the two-list field-fate resolver to it; feed it from two adapters (form-shape via `ctx.formValuesToItem` + a tested normalization layer; CMA simple-shape as today); write through two sinks (per-field `ctx.setFieldValue` with a cancel discard point; `items.update` with `meta.current_version`).

**Tech Stack:** TypeScript, DatoCMS plugin SDK 2.2.2, Vitest (`npm test`), Playwright E2E (`npx playwright test`).

**Spec:** `docs/superpowers/specs/2026-07-13-v4-unified-translation-design.md` — §2 (architecture + §2.3 re-homing inventory), §3 (frameless is a view concern), §4 (exclusion rule, rev 7), §7.2 (payload safety), §9.3 (dead code). Read §2.3 and §4 in full before starting any task.

## Global Constraints

- **Prerequisites:** the phase-0 plan has been executed (the `test.fail()` pins exist — this plan flips them), and v3.8's Task 1 (max_tokens factory fix) is merged (spec §8.1 ordering: the QC layer must not be chasing our own truncation bug).
- **Spec §4.3, verbatim policy:** *"translating a field always overwrites its target value with the translation of the source. No matching. No merging. No skip-and-flag."* Any code path that reads the target locale's existing blocks to decide what to write is a spec violation — except the §6.2 kebab (phase 4) and the optional structure-changed info flag.
- **Spec §4.2 fates:** `exclude` → top-level never written / empty inside rebuilt blocks; `copy` → source value verbatim everywhere; only `cannotBeBlank`-false fields may be excluded. Legacy single-list configs are auto-split at read time (Task 4) until phase 4's real migration.
- **Spec §2.3 items 1–8 are acceptance criteria, not suggestions.** The final task audits each one explicitly.
- **§7.2 invariants:** every CMA payload entry spreads the record's full locale hash; never strip a locale; skips are decided before assembly; a skipped locale is recorded in the accounting.
- **AGENTS.md rules apply** (cancellation flags in `useRef`, QC severity tiers, null-guard via `existingTargetKey`, per-(record,locale) accounting, NormalizedError preservation, no nested modals, `--color--*` tokens, grapheme-safe truncation).
- **E2E contract:** `.TranslationProgressModal__*` selectors and the stats-line format are pinned (spec §6.4); this plan must not touch them. Bulk behavior for a default-configured run must be byte-compatible with today except where a spec section names the change.
- After every implementation step: `npm test`. Before every commit: `npm run build`. E2E on the DeepL debug lane at each task that says so.

## File Structure

| File | Responsibility |
| --- | --- |
| `src/engine/index.ts` (new) | Public engine surface: `translateRecordUnits`, types |
| `src/engine/fieldFate.ts` (new) | Two-list fate resolution (`translate` / `exclude` / `copy`) + legacy split |
| `src/engine/slotScheduler.ts` (new) | AIMD parallel executor (ported from `translateRecordFields.ts:846-960`) |
| `src/engine/stallGuard.ts` (new) | Per-call timeout tied to an `AbortController` |
| `src/engine/formAdapter.ts` (new) | `ctx.formValues` → simple client shape (JSON:API normalization, both directions) |
| `src/engine/formSink.ts` (new) | Per-(field,locale) `ctx.setFieldValue` writer: rAF yield, cancel discard point, read-back |
| `src/utils/translation/ItemsDropdownUtils.ts` | Shrinks: payload build moves to engine; gains `meta.current_version`; keeps orchestration |
| `src/utils/translation/TranslateField.ts` | Exclusion fixes (:367 fate-aware, :860 order, :934 dictionary), rebuild fates |
| `src/entrypoints/Sidebar/TranslateSidebar.tsx` | Rerouted through engine + form sink; bubbles replaced by status line |
| `src/utils/translateRecordFields.ts` | **Deleted** (with `translateFieldValueDirect`, `isLocalizedField` branch) |
| `src/entrypoints/Config/ConfigScreen.tsx` | + `fieldsToCopyFromSource?: string[]` param (UI in phase 4) |
| `e2e/tests/frameless-pins.spec.ts` | Pins flipped from `test.fail()` to green |

---

### Task 1: Extract the payload engine (pure move, zero behavior change)

**Files:**
- Create: `src/engine/index.ts`
- Modify: `src/utils/translation/ItemsDropdownUtils.ts` (move `buildTranslatedUpdatePayload` ~:1356-1620, `translateField` inner machinery ~:1420-1563, `mergeLocalePayloadInto` :791-798, `shouldApplyLocaleSyncFallback` :1302-1304, and their types; re-export from the old path so no caller changes)
- Test: existing suites must pass unchanged

**Interfaces:**
- Produces: `translateRecordUnits(record, toLocales, deps): Promise<RecordUnitsResult>` — for now a thin named export wrapping the moved `buildTranslatedUpdatePayload` per-locale loop, with `deps = { provider, pluginParams, fieldDictionary, options }`. Exact current signatures preserved; later tasks widen `deps`.

- [ ] **Step 1:** Run `npm test` and note the green baseline count.
- [ ] **Step 2:** Move the functions listed above into `src/engine/index.ts` verbatim (imports adjusted). In `ItemsDropdownUtils.ts`, replace each moved body with `export { … } from '../../engine'` re-exports. No logic edits — `git diff` on the moved bodies should show only import lines.
- [ ] **Step 3:** `npm test` — identical green count. `npm run build` — clean.
- [ ] **Step 4:** Commit: `git commit -m "refactor(engine): extract payload build into src/engine (pure move)"`

---

### Task 2: Stall guard in the shared attempt path (§2.3 item 4)

**Files:**
- Create: `src/engine/stallGuard.ts`, `src/engine/stallGuard.test.ts`
- Modify: `src/utils/translation/ItemsDropdownUtils.ts` — `translateWithSystemicRetry`'s `attempt` (~:544-576) and the bare-`attempt()` branch (:1498-1504) both wrap through the guard

**Interfaces:**
- Produces: `withStallGuard<T>(run: (signal: AbortSignal) => Promise<T>, opts: { timeoutMs: number; parentSignal?: AbortSignal }): Promise<T>` — rejects with `new StallError(timeoutMs)` after `timeoutMs`, **aborts its own controller** (so the underlying fetch dies — unlike the deleted `Promise.race` at `translateRecordFields.ts:325-374`, which orphaned it), and chains `parentSignal` aborts through. Reuse `FIELD_TRANSLATION_TIMEOUT_MS = 300000` from `constants.ts:99`.

- [ ] **Step 1: Failing tests** (`vi.useFakeTimers()`):

```ts
it('rejects with StallError and aborts the inner signal after timeoutMs', async () => {
  let innerSignal: AbortSignal | undefined;
  const hang = (signal: AbortSignal) => { innerSignal = signal; return new Promise<never>(() => {}); };
  const p = withStallGuard(hang, { timeoutMs: 1000 });
  const assertion = expect(p).rejects.toBeInstanceOf(StallError);
  await vi.advanceTimersByTimeAsync(1001);
  await assertion;
  expect(innerSignal?.aborted).toBe(true);
});
it('resolves normally under the limit and clears its timer', async () => { /* run resolves at t=10 → value returned; advance past timeout → no unhandled rejection */ });
it('propagates a parent abort immediately', async () => { /* abort parentSignal at t=5 → inner signal aborted, rejects with the parent's reason */ });
```

- [ ] **Step 2:** Run `npm test -- stallGuard` → FAIL (module missing).
- [ ] **Step 3:** Implement (an `AbortController` + `setTimeout` + `parentSignal.addEventListener('abort', …)`, `finally` clears the timer). ~40 lines.
- [ ] **Step 4:** Wire both call paths: inside `translateWithSystemicRetry`, `attempt` becomes `withStallGuard((signal) => attemptWith(signal), { timeoutMs: FIELD_TRANSLATION_TIMEOUT_MS, parentSignal: opts.abortSignal })`; a `StallError` classifies as a content-tier failure (retryable under `CONTENT_RETRY_LIMIT`), **not** systemic. The provider call must actually receive the guard's signal — thread it into the `streamCallbacks.abortSignal` the attempt already passes.
- [ ] **Step 5:** `npm test` full → green. Commit: `"feat(engine): stall guard — a hung provider call can no longer block a run (spec §2.3-4)"`

---

### Task 3: AIMD parallel executor (§2.3 item 3)

**Files:**
- Create: `src/engine/slotScheduler.ts`, `src/engine/slotScheduler.test.ts`
- Source to port from (read first, then delete in Task 8): `src/utils/translateRecordFields.ts:846-960`

**Interfaces:**
- Produces: `createSlotScheduler(opts: { maxConcurrency: number; spacingMs: number; sleep?: (ms: number) => Promise<void> }): SlotScheduler` with `run<T>(jobs: Array<() => Promise<T>>, hooks: { isRateLimitError(e: unknown): boolean; checkCancellation(): boolean }): Promise<Array<PromiseSettledResult<T>>>`.
- Invariants ported exactly from the deleted scheduler (each is a test): start at the cap; **+1 slot after 3 consecutive successes** up to `maxConcurrency`; **halve (floor 1)** on a rate-limit error; `spacingMs` between launches; cancellation stops filling slots and resolves when active jobs settle; a rate-limited job is **requeued at the tail** (budget handling stays in `translateWithSystemicRetry` — the scheduler only reorders).

- [ ] **Step 1: Failing tests** — fake timers; jobs are controllable deferreds. Cover each invariant above plus: "6 jobs, cap 3, no errors → never more than 3 in flight, all settle"; "429 on job 2 → concurrency drops to ⌈3/2⌉ and job 2 runs again at the tail"; "cancel after job 1 launches → jobs 3+ never start, result has exactly the settled ones".
- [ ] **Step 2:** `npm test -- slotScheduler` → FAIL.
- [ ] **Step 3:** Implement by porting `translateRecordFields.ts:846-960` (same counters, same halving arithmetic), parameterized as above. `maxConcurrency` comes from the existing `getMaxConcurrency(pluginParams)` (`TranslationCore.ts:88-115`); `spacingMs` from `getRequestSpacingMs`.
- [ ] **Step 4:** Integrate: in the engine's per-(record,locale) field loop (the sequential `reduce` moved in Task 1, ~old `ItemsDropdownUtils.ts:1533-1563`), replace sequential iteration with `scheduler.run(fieldJobs, …)` — **one scheduler instance per run, created next to the pacer** and threaded through `deps`, so bulk cannot multiply concurrency by record count (spec §2.3-3). Records and locales stay ordered. ⚠️ The payload-entry writes currently interleave with translation; keep the writes inside each job's completion (they touch disjoint `payload[field]` keys — no shared-state race), but verify `localeOutcomes` accounting is push-only (it is — arrays appended per field).
- [ ] **Step 5:** `npm test` full; then one DeepL-lane E2E run (`npx playwright test --project=deepl`) — the stats-line counts must be unchanged from baseline. Commit: `"feat(engine): AIMD slot scheduler — field-level parallelism within each record-locale (spec §2.3-3)"`

---

### Task 4: Field fates — the two-list exclusion rule (§4.2)

**Files:**
- Create: `src/engine/fieldFate.ts`, `src/engine/fieldFate.test.ts`
- Modify: `src/entrypoints/Config/ConfigScreen.tsx` (`ctxParamsType` + `fieldsToCopyFromSource?: string[]` — param only; picker UI is phase 4)
- Modify: `src/utils/translation/SharedFieldUtils.ts` (add `hasMinLength` — mirror `hasMinItemsValidator` :175-185 over `validators.length`; add `cannotBeBlank(validators)` per spec §4.1)

**Interfaces:**
- Produces:

```ts
export type FieldFate = 'translate' | 'exclude' | 'copy';
/**
 * Rev-7 fate resolution. Legacy configs predate the two-list split, so a
 * legacy "excluded" field that cannot be blank is treated as copy-from-source
 * — which is what v3's locale-sync fallback actually did to it (spec §4.2).
 * Phase 4's migration makes the split persistent; this keeps the engine
 * correct either way.
 */
export function resolveFieldFate(args: {
  fieldId: string;
  fieldApiKey: string;
  validators: Record<string, unknown>;
  excludedTokens: string[];       // pluginParams.apiKeysToBeExcludedFromThisPlugin
  copyTokens: string[];           // pluginParams.fieldsToCopyFromSource ?? []
  runSkipIds?: string[];          // phase 5 buckets; undefined today
  runCopyIds?: string[];
}): FieldFate;
export function cannotBeBlank(validators: Record<string, unknown>): boolean; // in SharedFieldUtils
```

Matching uses the existing `isFieldExcluded`-style token semantics (id first, api_key fallback — `SharedFieldUtils.ts:113-131`). Copy list wins over exclude list if a field somehow sits on both (defensive; the phase-4 UI forbids it).

- [ ] **Step 1: Failing tests.** Cases: plain excluded optional field → `exclude`; excluded field with `required` → `copy` (legacy auto-split); excluded field with `length.min: 1` and no `required` → `copy` (the §4.1 predicate, not `required` alone); field on `copyTokens` → `copy` regardless of validators; on neither list → `translate`; api_key-token fallback matches; run-time buckets (when provided) override admin lists for `skip`, never for admin-`copy`… **stop — check the spec:** §7 says admin-listed fields are *locked* in the buckets, so run overrides never apply to admin-listed fields; encode that and test it.
- [ ] **Step 2:** `npm test -- fieldFate` → FAIL. **Step 3:** Implement (~60 lines). **Step 4:** green. Commit: `"feat(engine): two-list field fates with legacy auto-split (spec §4.2)"`

---

### Task 5: Rev-7 block semantics — always overwrite, fates inside blocks (§4.3)

This is the behavioral heart. Today (`TranslateField.ts`): an excluded sub-field's early-return (:367-383) writes the **source clone verbatim** (wrong on both counts: content and nested block ids); `frameless_single_block` sub-fields short-circuit (:860-862) **before** the exclusion check; sub-fields missing from the block dictionary get `fieldId: ''` (:934-936) so id-tokens can't match.

**Files:**
- Modify: `src/utils/translation/TranslateField.ts` (:367-406, :860-883, :903-936, `stripBlockWrapperIdentifiers` :226-239)
- Test: `src/utils/translation/TranslateField.test.ts` (extend; the file's existing block-fixture builders show the block payload shape — reuse them)

**Interfaces:**
- Consumes: `resolveFieldFate` (Task 4).
- Produces (behavioral contract, asserted by tests and by the phase-0 E2E pins):
  1. Sub-field fate `exclude` → the rebuilt block carries **`null`** for that sub-field (never the source value, never anything read from the target).
  2. Sub-field fate `copy` → the rebuilt block carries the **source value verbatim** (after id-stripping recursion — see 4).
  3. The fate check runs **before** any editor-specific routing (fixes the :860 frameless bypass — a frameless container sub-field with fate `exclude` yields `null` like any other).
  4. `stripBlockWrapperIdentifiers` (or the rebuild path around it) strips ids **recursively at every nesting level**, including inside `copy`-fate sub-field values — closing the nested source-block-id leak (§4.3). Test: a copy-fate modular-content sub-field whose blocks carry `id`/`itemId` yields a value with **zero** id keys at any depth (walk the result with a recursive collector).
  5. A sub-field absent from the block field dictionary is a **thrown engine error** naming the block model and api_key — not a silent `fieldId: ''` fallback. (The engine always has the schema; a missing entry is a bug upstream, and silent api_key-only matching defeats §5.1's id-keyed enforcement.)
  6. *(Optional, only-if-cheap — spec §4.3)*: when the target locale's previous value existed and its block-type multiset differs from the source's, emit `onQcFlag({ checkId: 'structure-replaced', severity: 'info', … })`. One comparison, before the write; drop the sub-task if it needs more than ~30 lines.

- [ ] **Step 1: Failing tests** — one per contract item above, plus the regression guard: a `translate`-fate sub-field still translates (existing tests keep passing).
- [ ] **Step 2:** `npm test -- TranslateField` → new tests FAIL, old ones PASS.
- [ ] **Step 3:** Implement: hoist the fate check to the top of `translateFieldValue`'s sub-field entry (`translateBlockFieldValue` :868-883) with `fate === 'exclude' → null`, `fate === 'copy' → deepStripIds(clonedValue)`; move the :860 frameless routing below it; replace the :934 dictionary fallback with the thrown error; make id-stripping a recursive walk.
- [ ] **Step 4:** `npm test` full → green. **Step 5:** Commit: `"feat(engine): rev-7 block fates — exclude=empty, copy=verbatim, no id leaks, no fate bypasses (spec §4.2/§4.3)"`

---

### Task 6: Form adapter + normalization layer (§2.1)

**Files:**
- Create: `src/engine/formAdapter.ts`, `src/engine/formAdapter.test.ts`

**Interfaces:**
- Produces:

```ts
/** JSON:API item (from ctx.formValuesToItem) → the simple client shape the engine speaks. */
export function itemToSimpleShape(item: { attributes: Record<string, unknown>; relationships: { item_type: { data: { id: string } } } }): { itemTypeId: string; fields: Record<string, unknown> };
/** Engine payload (per-field locale hashes) → per-(fieldPath, value) form writes. */
export function payloadToFormWrites(payload: Record<string, Record<string, unknown>>): Array<{ fieldPath: string; locale: string; value: unknown }>; // fieldPath = `${apiKey}.${locale}`
/** Guard from §2.1: a zero-field block serialised as a bare id string cannot round-trip. */
export function assertNoBareBlockIds(item: unknown): void; // throws EngineInputError naming the path
```

- [ ] **Step 1: Failing tests.** Round-trip fixtures: a scalar localized field; a `single_block` value; nested modular content; a bare-id string where a block object is expected → `assertNoBareBlockIds` throws with the path in the message; `payloadToFormWrites` emits one write per (field, locale) with dot-joined paths and **skips locales whose value is the spread-in original** (only newly-translated locales become writes — the sink must never rewrite untouched locales into the form).

⚠️ That last requirement means the engine must mark which locale keys in each payload entry are *new*. Check the moved payload builder: the translated loop writes exactly `[toLocale]` per build (old `:1544-1548`) — thread a parallel `writtenLocales: Record<field, string[]>` out of it rather than diffing values.

- [ ] **Step 2:** FAIL → **Step 3:** implement → **Step 4:** green, commit: `"feat(engine): form adapter — JSON:API normalization + new-locale write extraction (spec §2.1)"`

---

### Task 7: Form sink (§2.3 items 2, 6, 7)

**Files:**
- Create: `src/engine/formSink.ts`, `src/engine/formSink.test.ts` (jsdom; `ctx` mocked with the real method names)

**Interfaces:**
- Produces:

```ts
export async function writeToForm(args: {
  writes: Array<{ fieldPath: string; locale: string; value: unknown }>;
  ctx: { setFieldValue(path: string, value: unknown): Promise<void>; formValues: Record<string, unknown> };
  isCancelled(): boolean;   // read a useRef mirror, never state (AGENTS.md)
}): Promise<{ written: number; discarded: number; verifiedMissing: string[] }>;
```

Behavioral contract (each a test): awaits `requestAnimationFrame` between writes (§2.3-6 — stub rAF in jsdom); **checks `isCancelled()` immediately before each write and discards the rest** (§2.3-2's discard point — a value completing after cancel is never written); after each write, reads the path back from `ctx.formValues` and collects silently-dropped paths into `verifiedMissing` (§6.3 form-side verification); never invokes locale-sync or `verifyPersistedWrite` (§2.3-7 — nothing to import, assert by module imports if you like).

- [ ] **Step 1:** failing tests → **Step 2:** FAIL → **Step 3:** implement (~50 lines) → **Step 4:** green, commit: `"feat(engine): form sink — rAF-yielded, cancel-discarding, read-back-verified (spec §2.3)"`

---

### Task 8: Reroute the sidebar; delete `translateRecordFields.ts`

**Files:**
- Modify: `src/entrypoints/Sidebar/TranslateSidebar.tsx` (run flow ~:230-340; bubble state can go — see below)
- Delete: `src/utils/translateRecordFields.ts`, `src/utils/translateRecordFields.test.ts`
- Delete: `translateFieldValueDirect` (`TranslateField.ts:1256-1289`) and the `isLocalizedField` branch (`TranslateField.ts:935` + `resolveFieldValueForTranslation`'s localized arm) — spec §9.3/§3.1
- Modify: `src/main.tsx` — the field-kebab execute path, if it imports anything from the deleted file, routes through the engine equivalents

**Interfaces:**
- Consumes: everything above. The sidebar run becomes: `ctx.formValuesToItem(ctx.formValues, false)` → `assertNoBareBlockIds` → `itemToSimpleShape` → `translateRecordUnits(unit, targets, deps)` → `payloadToFormWrites` → `writeToForm`.
- **§2.3-1 acceptance (the one that silently loses everything if missed):** `deps.options` MUST include `onSystemic` wired to a `PauseController` (construct one exactly as `TranslationProgressModal.tsx:203-205` does) **and** `gate`/`abortSignal`. Add a unit assertion: constructing the sidebar deps without `onSystemic` is a type error (make it required on the sidebar-facing deps type).
- **§2.3-2:** keep `isCancellingRef` + `abortControllerRef` exactly per AGENTS.md; `isCancelled` for the sink reads the ref; the AbortController aborts in-flight provider calls (already threaded via Task 2's parent signal).
- **UI (transitional until phase 4):** the streaming chat bubbles have no data source in the engine (spec §2.3-5 — decided dead). Replace the bubble list with the panel's eventual **status line** ("Translating… n/m fields", then "Translated 1 record (X fields × Y locales)" / "Completed with warnings" / "Failed") fed from per-field *outcomes*, plus the existing end-of-run QC alert/notice aggregation (TranslateSidebar :306-323 pattern). Phase 4 adds the modal; this panel line is the piece that survives.
- **Retry-semantics release note (§2.3-8):** capture in the commit message — 429s now 3-auto-retry-then-pause (was 10 silent), fatal auth errors now pause instead of hard-abort.

- [ ] **Step 1:** Write the new run flow behind the existing button handler; delete the bubble rendering + `translationBubbles` state + `onStream` plumbing.
- [ ] **Step 2:** Delete the files/branches listed; fix every import (`grep -rn "translateRecordFields\|translateFieldValueDirect" src/` must return nothing).
- [ ] **Step 3:** `npm test` — the deleted file's tests are gone; everything else green. `npm run build` clean.
- [ ] **Step 4:** E2E, DeepL lane: the per-record sidebar tests (`per-record:` group) must pass with the new flow — `translateRecordViaSidebar` waits on completion signals; update `e2e/tests/steps/per-record.ts` to the status line **in the same commit** if its selectors watched the bubbles.
- [ ] **Step 5:** Commit: `"feat!: sidebar runs through the unified engine; translateRecordFields.ts deleted (spec §2/§2.3)"` — body carries the §2.3-8 release notes.

---

### Task 9: Bulk hardening — `meta.current_version` (§7.2)

**Files:**
- Modify: `src/utils/translation/ItemsDropdownUtils.ts` — the single `items.update` call (~:915) and the record fetch that feeds it
- Test: extend the bulk suite with a mocked `STALE_ITEM_VERSION` 422

- [ ] **Step 1: Failing test:** the update call receives `meta: { current_version: <fetched version> }`; a mocked `STALE_ITEM_VERSION` error marks that record `error` with statusText matching `/changed while translating/i` and the run continues to the next record.
- [ ] **Step 2:** FAIL → **Step 3:** implement (fetch already returns `meta.current_version` on nested rawFind — verify, and thread it through the record shape) → **Step 4:** green, commit: `"fix(bulk): optimistic locking — concurrent edits 422 instead of being silently reverted (spec §7.2)"`

---

### Task 10: Flip the phase-0 pins; add the copy-fate E2E

**Files:**
- Modify: `e2e/tests/frameless-pins.spec.ts`

- [ ] **Step 1:** Remove `test.fail()` from the bug-#1 probe and the exclusion pin. Run DeepL lane → both must now pass **for the new reasons** (block materialised; excluded `callout.body` **empty** in the rebuilt target block).
- [ ] **Step 2:** Add the §9.4-4 companion: set `fieldsToCopyFromSource: [<callout.body field id>]` in the fork's plugin params (same CMA pattern as the exclusion pin, restore in `finally`), sidebar-translate, assert the target sub-field equals the **source** value verbatim.
- [ ] **Step 3:** Full matrix run (`npx playwright test`) green. Commit: `"test(e2e): phase-0 pins flipped green + copy-from-source fate covered"`

---

### Task 11: §2.3 acceptance audit + release notes

- [ ] **Step 1:** Walk spec §2.3 items 1–8 and record, in the PR description, the file:line where each is satisfied (1 `onSystemic` required-typed; 2 discard point in `formSink`; 3 `slotScheduler` + single instance per run; 4 `stallGuard` on both attempt paths; 5 status line, bubbles deleted; 6 rAF in sink; 7 sink imports audit; 8 release-note text). Any item without a concrete pointer is unfinished work, not a documentation gap.
- [ ] **Step 2:** `npm test && npm run build && npx playwright test` — all green.
- [ ] **Step 3:** Version bump to `4.0.0-beta.1` (phases 4–7 land before a stable 4.0). Commit: `"chore(release): v4.0.0-beta.1 — one engine"`

---

## Self-Review Notes

- **Spec coverage:** §2 engine/adapters → Tasks 1, 6; §2.1 guards → Task 6; §2.2 form sink retained → Task 7; §2.3 items 1-8 → Tasks 2, 3, 7, 8, 11 (audited explicitly); §3.1/§9.3 dead code → Task 8; §4.1 predicate → Task 4; §4.2 fates + legacy split → Tasks 4, 5; §4.3 always-overwrite + id-leak + optional info flag → Task 5; §7.2 current_version → Task 9; phase-0 pin flips → Task 10. **Not here by design:** §5/§6/§7 UI (phase 4/5 plans), §9.2 validation (phase 7).
- **Ordering:** Tasks 2-5 are engine-internal and land before any caller changes; Task 8 (the deletion) comes only after the sink/adapter/scheduler exist and are unit-green; pins flip last.
- **Type consistency:** `resolveFieldFate`/`cannotBeBlank` (Task 4) consumed in Task 5; `payloadToFormWrites` output shape = `writeToForm` input shape (Tasks 6→7); `withStallGuard` signal threading matches Task 3's scheduler hooks.
- **Known deliberate transition state:** between this plan and phase 4, the sidebar shows the status line without the modal report — stated in Task 8 and in the spec (§6.1 sequence lands in phase 4).
