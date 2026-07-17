# Plan/Apply Integration — Design (the orchestration seam)

> **Design spec.** How the pure plan/apply + RunState layer connects to the LIVE
> translation path. Decision: **hybrid** — keep the existing execution engine as
> the executor, refactor only the record-level orchestration slice, and land the
> new guarantees (atomic per-locale omission, the net-new invariants, the RunState
> report) incrementally with the suite green at every step.
>
> Grounded in a codebase-mapping pass (workflow `wf_73dbbfa4-9f8`) whose line
> references were **re-verified against source** — one material correction folded
> in (see §2, the sidebar path).

**Date:** 2026-07-17
**Branch:** `feature/translation-qc`
**Companions:** `2026-07-16-translation-plan-design.md` (engine), `2026-07-16-resilient-report-persistence-design.md` (report).

---

## 1. Decision: hybrid (wrap the executor, refactor the orchestration)

- **Not a full wrap.** A pure wrap can't deliver the point: today the bulk engine
  merges every locale into one payload and writes it, so an error-tier QC value is
  *still persisted* (`errorCount` only marks the record failed in the report). Atomic
  blocking requires assembling the write body **locale-by-locale from `conform`
  verdicts**, omitting Blocked locales — plus the net-new invariants
  (locale-preservation, locale-completeness, block-structure, block-id-provenance,
  segment-alignment) the engine never emits.
- **Not a full refactor.** `buildTranslatedUpdatePayload` (`src/engine/index.ts:478`)
  is load-bearing provider machinery — the AIMD scheduler, 429 pacer, stall guard,
  systemic-pause, per-field cancel gates, copy-from-source, locale-sync fallback —
  with **no correctness overlap** with the plan layer. Rebuilding it to emit
  `UnitOutcome` risks the engine for zero guarantee it doesn't already provide.
- **The leverage:** the engine is already called **once per (record, locale)** and
  already returns a per-locale `payload` plus per-locale `qcFlags` stamped with
  `fieldPath`+`locale`+`severity` (verified, `index.ts:844`). `conform`'s
  `tierOf(severity)` turns those existing flags into block/write **for free**. So:
  keep the engine as executor + reconstruction source + re-pointed-check emitter;
  move record-level orchestration (payload assembly, the atomic gate, reporting)
  onto `plan`/`conform`/`assembleRecordPayload`/`RunState`.

## 2. Two write paths — the correction

There are **two** live paths, and they are not the same:

| Path | Entry | Write mechanism | Deletion risk |
| --- | --- | --- | --- |
| **Bulk** | `translateAndUpdateRecords:739` → `translateAndSaveRecord:791` | one `client.items.update` per record (`:913`) | **yes** — replace-not-merge; this is where the guarantees matter |
| **Sidebar** | `translateRecordUnits` (`index.ts:976`) → **form sink** (`applyLocaleSync:false`, `formSink.ts`) | stages into the open record form; **no `items.update`** | no — the form merges per-field; nothing is deleted |

**Correction to the mapping pass:** `translateRecordUnits` is **NOT dead code** — it
is the sidebar's entry point (`TranslateSidebar.tsx:207`). It must **not** be deleted.

**Scope of this integration:** the write-flip and the write-body invariants
(`assembleRecordPayload`, `checkLocalePreservation`, locale-completeness) apply to the
**bulk path only**. The sidebar's form-sink path has no `items.update`, so those
guarantees don't apply there. Bringing the two-tier conform + RunState report to the
sidebar is a **later, separate** concern (the QC flags can still surface, but the
write mechanism differs); Phase 1 does not touch `translateRecordUnits`.

## 3. The seam (bulk path)

**Primary:** `translateAndSaveRecord` (`ItemsDropdownUtils.ts:791-978`). The engine call
stays; what happens to its result changes. Replace the per-locale
`mergeLocalePayloadInto(mergedPayload, localeResult.payload)` (`:860`) and the terminal
`buildRecordUpdateBody(mergedPayload, …)` (`:710`/write at `:913`) with the plan pipeline:

1. Once per record (before the locale loop): `buildPlan(toPlanInput(record, dictionary, allLocalesRequired, policy, policyDigest))`.
2. Per locale: build a `flagsByUnit` entry merging **two disjoint sources** under one `unitKey`:
   - **(A) the engine's `localeResult.qcFlags`** — the re-pointed checks it already fires (truncated, length-validator, placeholder, html/md structural, copied-from-source).
   - **(B) `collectUnitFlags(plan, reconstructFromEnginePayload(localeResult.payload, record))`** running **ONLY the net-new invariants** (block-structure, block-id-provenance, segment-alignment).
3. `conform(plan, flagsByUnit)` → a `UnitOutcome` per locale.
4. Written locale → its fields go into a `WrittenLocalePayload`; Blocked locale → omitted entirely.
5. `assembleRecordPayload(record, writtenLocalePayloads)` → the single body; then `checkLocalePreservation` + locale-completeness on that assembled body as the final pre-send gate.
6. `client.items.update(record.id, { ...payload, meta: { current_version: plan.sourceVersion } })`.
7. `verifyPersistedWrite` stays post-send; a mismatch demotes the affected `UnitOutcome` to `written-unverified`.

**Secondary:** the run owner `translateAndUpdateRecords:739` creates the `RunContext` +
`RunState` (`createRunState`) + an in-memory `RunStore`, threads `runId`/`deviceId`/
`checkpoint`, `foldOutcome`s each `UnitOutcome`, and persists on every checkpoint.

## 4. The glue (new, pure, unit-tested first)

- **`toPlanInput` / `toPlanRecord`** — `DatoCMSRecordFromAPI` → `BuildPlanInput`. Maps
  `item_type.id`→`itemTypeId`, `meta.current_version`→`sourceVersion`, plugin params
  (excluded/copy tokens)→`PlanPolicy`; reads `item_type.all_locales_required` (via the
  cached SchemaRepository — no extra round-trip). **Round-trip tested against a real
  fixture**: `preservedLocales` MUST equal the record's actual locale keys (an empty
  `preservedLocales` silently makes `locale-preservation` a no-op — risk).
- **`reconstructFromEnginePayload(payload, record)`** → `(recordId, fieldPath, toLocale) => ReconstructedCell | undefined`.
  Reads `payload[fieldPath][toLocale]`; returns **`undefined` for an absent/failed
  cell** so `collectUnitFlags` skips it (returning a blank would fire a false
  `cannot-be-blank` block — risk).
- **`policyDigest(policy)`** — a stable hash of the locked policy, computed once per run.

## 5. Single ownership per check id (the double-emission guard)

The engine already fires `checkTruncated`/`checkFieldLength`/placeholder/structural via
`onQcFlag`. `checkReconstructedCell` also calls some of these. Feeding **both** into
`flagsByUnit` double-counts reasons and inflates the abort rate. **Rule:** the plan-side
`collectUnitFlags`/`checkReconstructedCell` on this seam runs **only** the net-new
invariants (`block-structure`, `block-id-provenance`, `segment-alignment`); the engine's
`qcFlags` own truncated/length/placeholder/structural/copied. A test **asserts the two
flag sets are disjoint by checkId**. (`cannot-be-blank`, `locale-preservation`,
`locale-completeness` run at assembly time on the body, not per reconstructed cell.)

## 6. Incremental migration (suite green at every step)

- **Step 0 — glue, no live wiring.** Add `toPlanInput`/`toPlanRecord`,
  `reconstructFromEnginePayload`, `policyDigest`, and the `all_locales_required` read.
  Unit-test each. Nothing calls them; green.
- **Step 1 — shadow RunState (additive, zero write change).** In
  `translateAndUpdateRecords` build `RunContext` + `createRunState` + in-memory store; in
  `translateAndSaveRecord` synthesize a `UnitOutcome` per locale from the **existing**
  `localeResult` (bucket via `tierOf` over `localeResult.qcFlags`) and `foldOutcome` into
  RunState, persisting each record. The write is untouched → all tests pass; RunState/
  jsonAdapter/runStore now exercised on the live path in read-only shadow.
- **Step 2 — plan + net-new invariants into the shadow.** Compute `buildPlan` per record;
  feed `conform` from the merged `flagsByUnit`; drive the shadow bucket from `conform`.
  Add a dev-only parity assertion (conform Written/Blocked matches the engine's current
  `errorCount` verdict on the overlapping checks). No write change; green.
- **Step 3 — flip the write (the behavioral change).** Replace `mergeLocalePayloadInto`
  + `buildRecordUpdateBody` with `assembleRecordPayload` over Written units (Blocked
  locales omitted), + `checkLocalePreservation`/locale-completeness as the pre-send gate.
  This is the honest reversal (an error-tier locale is now **Blocked**, never persisted,
  vs today's write-and-flag). Update the `ItemsDropdownUtils` tests that assert a flagged
  value is still written — deliberately, as the intended change. `verifyPersistedWrite`
  mismatches now demote to `written-unverified`. Green after targeted test updates.
- **Step 4 — retire the bulk merge dupe.** Once `assembleRecordPayload` owns the body and
  `buildPlan`'s completeness fill is proven equal to the engine's locale-sync fallback for
  the bulk write, delete the bulk merge accumulation in `translateAndSaveRecord` (keep the
  engine's fallback pass as a value source, or move the fill fully into the plan).
  **Do NOT delete `translateRecordUnits` (sidebar).** Green.
- **Step 5 — reconcile brake + report.** Redefine the runaway abort rate over
  `(record,locale)` decision units counting **Blocked** (not `errorCount`), emit
  `not-attempted` at the boundary, and re-point `buildTranslationReportRows`/`bulkReport`
  to render from `RunState`/`UnitOutcome`. Green.
- **Step 6 — persistence + resume (phase 2, additive).** IndexedDB adapter (feature-detect/
  degrade/quota), then cloud single-flight `replace_asset`, then resume UI via
  `pickLatestRunState`/`unitsToResume` gated by `isPolicyCompatible` + per-record live
  `current_version` re-read for source-drift. The write path never depends on persistence
  succeeding.

## 7. Reused / replaced

**Reused as-is:** `buildTranslatedUpdatePayload` (executor); the whole `engine/plan/*`
and `engine/report/*` pure layers; `verifyPersistedWrite` (post-send; now maps to
`written-unverified`); `resolveFieldFate`+`cannotBeBlank` (single fate source for engine
and `buildCell`); the run infrastructure (SlotScheduler, Pacer, RunGate, stall guard,
systemic-pause, the reduce loops).

**Replaced (bulk path):** `mergeLocalePayloadInto`→`assembleRecordPayload`;
`buildRecordUpdateBody`→`assembleRecordPayload` + the `meta.current_version` stamp from
`RecordPlan.sourceVersion`; the per-locale accumulation block (`:860-880`)→conform →
`WrittenLocalePayload[]` → `foldOutcome`; the `errorCount` verdict → the conform bucket;
`buildTranslationReportRows` source → RunState. **`translateRecordUnits` is preserved.**

## 8. Risks (verified)

1. **Double-emission** of overlapping checks → §5 single-ownership rule + disjoint-by-checkId assert.
2. **Behavioral test breakage** at Step 3 (flagged value no longer written) → isolate to Step 3, update the affected tests as the intended change, keep Steps 1-2 shadow-only so the flip is one reviewable diff.
3. **PlanRecord ↔ API shape drift** (empty `preservedLocales` no-ops locale-preservation) → one exact `toPlanRecord` with round-trip tests asserting `preservedLocales` == the record's locale keys.
4. **`reconstructFromEnginePayload` absent-cell semantics** (blank vs undefined) → return `undefined` for absent; rely on the engine's fallback fill for genuine completeness.
5. **New schema reads** (`all_locales_required`, `policyDigest`) → read via the cached SchemaRepository; digest once per run.
6. **Runaway brake redefinition** → move the brake input to the conform bucket in Step 5, sample-size guard restated in units.
7. **Sidebar untouched but shares the engine** → the engine stays behavior-identical (only the bulk *caller* changes), so the sidebar's `applyLocaleSync:false` form-sink path is unaffected. A test pins that the engine's output for `applyLocaleSync:false` is unchanged.

## 9. Open / to pin during planning

- Exact `DatoCMSRecordFromAPI` shape the bulk path holds (nested `item_type`, `meta`) for the `toPlanRecord` adapter.
- Where `RunContext` fields come from (`runId`/`deviceId` generation — a stable per-browser id; `policyDigest` hash function).
- Whether the sidebar eventually adopts RunState (out of scope now; the design must not preclude it).
