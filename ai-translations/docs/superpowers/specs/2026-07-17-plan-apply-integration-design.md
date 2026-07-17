# Plan/Apply Integration — Design (the orchestration seam)

> **Design spec.** How the pure plan/apply + RunState layer connects to the LIVE
> translation path. Decision: **hybrid** — keep the existing execution engine as
> the executor, refactor only the record-level orchestration slice, land the new
> guarantees incrementally with the suite green at every step.
>
> **Revision 2 (2026-07-17)** — incorporates an 11-finding adversarial review that
> verified the seam against source. Material refinements: **split reconstruct from
> write-body** (provenance); a **net-new-only collector** (block-structure +
> block-id-provenance only); **segment-alignment struck from the seam** (undeliverable
> from the engine's positionally-repaired arrays); an **assembly-time gate pass** that
> runs locale-preservation + cannot-be-blank + a **new `checkLocaleCompleteness`** on
> the body; the `meta.current_version` omit-when-absent fix; and Step-3 verify/gate
> rewiring folded in. The hybrid decision itself survived unchanged.

**Date:** 2026-07-17
**Branch:** `feature/translation-qc`
**Companions:** `2026-07-16-translation-plan-design.md` (engine), `2026-07-16-resilient-report-persistence-design.md` (report).

---

## 1. Decision: hybrid (wrap the executor, refactor the orchestration)

Unchanged from rev1. A pure wrap can't deliver atomic per-locale omission (today an
error-tier locale is still persisted); a full refactor needlessly risks the 370-line,
heavily-tested `buildTranslatedUpdatePayload`. The leverage: the engine is already
called once per (record, locale) and returns a per-locale `payload` plus per-locale
`qcFlags` with `severity` (verified `index.ts:844`), so `conform`'s `tierOf` reclassifies
them into block/write for free. Keep the engine as executor; move record-level
orchestration onto `plan`/`conform`/assembly/`RunState`.

## 2. Two write paths (bulk = items.update; sidebar = form sink)

| Path | Entry | Write | Deletion risk | In scope? |
| --- | --- | --- | --- | --- |
| **Bulk** | `translateAndUpdateRecords:739` → `translateAndSaveRecord:791` | one `items.update`/record (`:913`) | **yes** (replace-not-merge) | **yes** |
| **Sidebar** | `translateRecordUnits` (`index.ts:976`) → form sink (`applyLocaleSync:false`) | stages into the open form; no `items.update` | no | **no** (later) |

`translateRecordUnits` is **live sidebar code** (`TranslateSidebar.tsx:207`), NOT dead.
The write-flip and body invariants apply to the **bulk path only**; the sidebar's
form-sink path is untouched (a test pins that the engine's `applyLocaleSync:false` output
is unchanged).

## 3. The seam (bulk path) — two roles, split

The engine's per-locale result serves **two distinct roles that must not be conflated**
(review finding): the **write body** and the **conformance judgment**. They read different
things.

Per record, per locale, replacing the `:860` merge and `:710/:913` write:

1. **Plan** (once/record, before the loop): `buildPlan(toPlanInput(record, dictionary, allLocalesRequired, policy, policyDigest))`.
2. **Execute** (unchanged): `localeResult = buildTranslatedUpdatePayload(...)` — its `payload` already carries the engine's completeness fill (fallback nulls for optional/new-locale fields) and its `qcFlags` carry severity.
3. **Judgment source A — the engine's `qcFlags`**: the re-pointed checks it already fires (truncated, length-validator, placeholder, html/md structural, copied-from-source), keyed by `fieldPath`+`locale`.
4. **Judgment source B — the net-new collector**: `collectNetNewFlags(plan, reconstructTranslatedCells(localeResult))` running **ONLY `block-structure` + `block-id-provenance`** over **genuinely-translated cells** (see §4/§5). Disjoint by checkId from source A.
5. **Assembly-time gate (on the body, not per cell)**: build `WrittenLocalePayload[]` for locales with no invariant violation, sourcing each field's value **directly from `localeResult.payload[field]`** (preserving the engine's fill byte-for-byte). `assembleRecordPayload` → the single body. Then run the **body pass**: `checkLocalePreservation` (per field) + `checkCannotBeBlank` (over the body) + `checkLocaleCompleteness` (new) → QcFlags keyed to `unitKey`.
6. **Conform**: merge sources A + B + the body-pass flags into `flagsByUnit`; `conform(plan, flagsByUnit)` → a `UnitOutcome` per locale. A Blocked locale is omitted from the body entirely (re-assemble after the body pass demotes, or gate the assembly on the pre-body verdict then re-check — see §6 Step 3 for the ordering).
7. **Write**: `client.items.update(record.id, buildBody(payload, recordPlan.sourceVersion))` — stamp `meta.current_version` **only when `sourceVersion` is a non-empty string** (omit-when-absent, matching today).
8. **Verify**: `verifyPersistedWrite` post-send, with claims built **only from Written units** (§6 Step 3); a mismatch demotes to `written-unverified`.

**Run owner** `translateAndUpdateRecords:739`: creates `RunContext` + `createRunState` +
in-memory `RunStore`; `foldOutcome`s each `UnitOutcome`; persists per checkpoint.

## 4. The glue (new, pure, unit-tested first)

- **`toPlanInput` / `toPlanRecord`** — `DatoCMSRecordFromAPI` → `BuildPlanInput`. Round-trip
  tested: `preservedLocales` MUST equal the record's actual locale keys.
- **`reconstructTranslatedCells(localeResult)`** → `(recordId, fieldPath, toLocale) => ReconstructedCell | undefined`.
  Returns a cell **only for fields in `localeResult.translatedFields`** (genuine provider
  output); **`undefined` for copied / fallback-filled / failed fields** so the net-new
  invariants never judge a fallback null. (This is the provenance fix — the write body,
  by contrast, uses `localeResult.payload` verbatim.)
- **`policyDigest(policy)`** — a **canonical, order-independent** hash: sort
  `excludedTokens`/`copyTokens`, stable-stringify, hash. It is the resume gate
  (`isPolicyCompatible`), so a semantically-identical policy MUST produce the same digest.
- **`RunContext` origins:** `runId = crypto.randomUUID()`; `deviceId` = a stable
  per-browser id persisted in IndexedDB (persistence §9); `policyDigest` as above.

### 4.1 Pure-layer changes this seam requires (build in Step 0)

- **`collectNetNewFlags`** — a new collector (or a `checkReconstructedCell` scoped variant)
  that runs **only** `checkBlockStructure` + `checkBlockIdProvenance`. `collectUnitFlags`/
  `checkReconstructedCell` (which run 5 checks incl. truncated/length/cannot-be-blank) are
  **not** used on this seam. Their existing tests (`checkCell.test.ts`,
  `collectUnitFlags.test.ts`) stay valid for their own use but the seam uses the new
  collector.
- **`checkLocaleCompleteness`** — **does not exist yet**; build it. Given the assembled body
  + the `RecordPlan`, for a new locale assert every localized field carries the locale
  (Locale Sync Rule). Emits `checkId: 'locale-completeness'` (`error`) → `locales-incomplete`.
- **`buildPlan` fallback fix** — change `sourceVersion: record.meta?.current_version ?? ''`
  to `?? undefined`, so a versionless record omits `meta` on write (update `buildPlan.test.ts`).
- **Body-pass assembly** — a pure `checkAssembledBody(payload, recordPlan)` that runs
  `checkLocalePreservation` + `checkCannotBeBlank` (over the body) + `checkLocaleCompleteness`,
  returning QcFlags keyed to `unitKey`. **`cannot-be-blank` moves here** from `checkReconstructedCell`'s
  per-cell path for the seam.

## 5. Check ownership (the partition, corrected)

| Check | Owner | Tier |
| --- | --- | --- |
| truncated, length-validator, placeholder-loss, html/md-structure, copied-from-source | **engine `qcFlags`** | as emitted |
| block-structure, block-id-provenance | **plan-side `collectNetNewFlags`** (over translated cells) | error → block |
| locale-preservation, cannot-be-blank, locale-completeness | **assembly body-pass** (over the assembled body) | error → block |
| **segment-alignment** | **NObody on this seam** — struck | — |

- **segment-alignment is struck** (review finding): it needs sent-vs-received counts +
  anchors that the seam has no source for, and the engine positionally repairs arrays
  (`reconcileArrayLength`) so the reconstructed value always matches sent length — no drop
  signal exists. The engine's `length-mismatch`/`source-fallback` (warnings) already flag
  array oddities. Wiring true segment-alignment (anchor id/hash scheme, plan-design §12 open
  item) is deferred; **the spec no longer claims it as delivered coverage.**
- **Disjoint test:** assert `intersection(engine-emitted checkIds, collectNetNewFlags checkIds) === ∅`.

## 6. Incremental migration (suite green at every step)

- **Step 0 — pure glue + pure-layer changes (no live wiring).** Build: `toPlanInput`/
  `toPlanRecord`, `reconstructTranslatedCells` (provenance), `policyDigest` (canonical),
  `collectNetNewFlags`, `checkLocaleCompleteness`, `checkAssembledBody`, the `buildPlan`
  `undefined` fallback, and the `all_locales_required` read. Unit-test each. Green.
- **Step 1 — shadow RunState (additive).** In `translateAndUpdateRecords` build `RunContext`
  + `createRunState` + in-memory store; in `translateAndSaveRecord` synthesize a `UnitOutcome`
  per locale from the **existing** `localeResult` (bucket via `tierOf` over `localeResult.qcFlags`)
  and `foldOutcome`. Write untouched → green.
- **Step 2 — plan + net-new + body-pass into the shadow.** Compute `buildPlan`; drive the
  shadow bucket from `conform(plan, engine-qcFlags ⊕ collectNetNewFlags ⊕ body-pass)`. Add a
  dev-only parity note (conform will *legitimately* block more than `errorCount` did — the new
  invariants — so parity is "conform ⊇ errorCount blocks", not equality). No write change; green.
- **Step 3 — flip the write (the behavioral change; ONE reviewable diff).** Replace the merge
  body with `assembleRecordPayload` over Written units (Blocked omitted). **In the same step**
  rewire: (a) the write gate reads the **assembled body** (`Object.keys(payload).length`), not
  the old `mergedPayload`; (b) `verifyPersistedWrite` claims are built **only from Written
  units** so a deliberately-omitted Blocked locale is never reported as a CMA drop; (c) mismatch
  → `written-unverified`. Update the `ItemsDropdownUtils` tests that asserted a flagged value is
  still written — the intended §-honest reversal. Green after targeted updates.
- **Step 4 — retire the bulk merge dupe.** Delete the `:860-880` accumulation once
  `assembleRecordPayload` + the plan completeness fill own the body. **Keep `translateRecordUnits`
  (sidebar).** Green.
- **Step 5 — reconcile brake + report.** Runaway abort counts **Blocked (record,locale) units**
  (not `errorCount`); emit `not-attempted` at the boundary; re-point `buildTranslationReportRows`/
  `bulkReport` to render from `RunState`. Green.
- **Step 6 — persistence + resume (phase 2, additive).** IndexedDB (feature-detect/degrade/quota),
  cloud single-flight `replace_asset`, resume UI via `pickLatestRunState`/`unitsToResume` gated by
  `isPolicyCompatible` + per-record live `current_version` re-read. The write path never depends on
  persistence succeeding.

## 7. Reused / replaced

**Reused as-is:** `buildTranslatedUpdatePayload` (executor + its `payload` as the write-body
source + its `qcFlags`); `resolveFieldFate`+`cannotBeBlank`; `verifyPersistedWrite` (post-send);
the run infrastructure (scheduler/pacer/gate/stall/pause/loops); the `engine/report/*` layer;
`buildPlan`/`conform`/`assembleRecordPayload`/`checkBlockStructure`/`checkBlockIdProvenance`/
`checkLocalePreservation`.

**New pure work (Step 0):** `collectNetNewFlags`, `checkLocaleCompleteness`, `checkAssembledBody`,
`reconstructTranslatedCells`, `toPlanInput`/`toPlanRecord`, canonical `policyDigest`, the `buildPlan`
`undefined` fallback. **Not reused as-claimed in rev1:** `checkReconstructedCell`/`collectUnitFlags`
(5-check) are NOT the seam collector; `checkLocaleCompleteness` did not exist.

**Replaced (bulk path):** `mergeLocalePayloadInto`→`assembleRecordPayload`; `buildRecordUpdateBody`→
assembly + conditional `meta` stamp from `RecordPlan.sourceVersion`; the `:860-880` accumulation →
conform + `foldOutcome`; the `errorCount` verdict → the conform bucket; report source → `RunState`.
**`translateRecordUnits` is preserved.**

## 8. Risks (verified, rev2)

1. **Fallback-null vs translated-null** → §4 `reconstructTranslatedCells` uses `translatedFields`
   provenance (cell only for genuine output); the write body uses `localeResult.payload` verbatim.
   Fixture test: new locale + optional block field + exclude fate stays Written and its null survives.
2. **Double-emission** → §5 `collectNetNewFlags` runs only block-structure/block-id-provenance;
   disjoint-by-checkId test.
3. **Step-3 half-migration** (verify claims / write gate conform-unaware) → §6 Step 3 folds the
   claims-from-Written-only + assembled-body-gate rewiring into the same step.
4. **`meta.current_version` empty-string** → `buildPlan` `undefined` fallback + conditional stamp.
5. **segment-alignment claimed but undeliverable** → struck from the seam; deferred with the anchor
   scheme.
6. **`policyDigest` non-canonical** → sorted-token stable hash (it gates resume).
7. **Runaway brake meaning drift** → move to Blocked-unit count in Step 5.
8. **Sidebar shares the engine** → engine behavior is unchanged (only the bulk caller changes); pin
   with an `applyLocaleSync:false` output test.

## 9. Open / to pin during planning

- Exact `DatoCMSRecordFromAPI` shape (nested `item_type`, `meta`, field locale objects) for `toPlanRecord`.
- `checkLocaleCompleteness` exact contract (which fields count as "must carry the new locale" — mirror the engine's `applyLocaleSync` field set).
- True segment-alignment (anchor id/hash) — deferred; plan-design §12.
