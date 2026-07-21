# Cross-session resume — remaining implementation plan

**Decision (2026-07-21):** full cross-session resume (IndexedDB), per the
report/persistence spec (`2026-07-16-resilient-report-persistence-design.md`).

The whole report engine (`src/engine/report/`) is built and unit-tested. This
plan covers only the wiring that makes it *live*. Steps are ordered so each lands
green on its own.

## Status

| Step | What | Status |
|---|---|---|
| 1 | IndexedDB `RunStore` (durable tier) | ✅ done — `src/engine/report/indexedDBRunStore.ts` (+ tests, `fake-indexeddb`) |
| 6a | Stable per-browser `deviceId` | ✅ done — `src/utils/deviceId.ts`, wired at `ItemsDropdownUtils.ts` (`createRunState`) |
| 3 | Persist a checkpoint per record | ⬜ TODO |
| 4 | Detect an incomplete prior run on open | ⬜ TODO |
| 5 | Resume vs start-fresh UI | ⬜ TODO |
| 6b | Engine resume-set (re-run only unfinished units) | ⬜ TODO |

Everything below the wiring is already built + tested: `serialize/deserializeRunState`,
`machineTokenForUnit`, `pickLatestRunState` / `unitsToResume` / `isPolicyCompatible`,
`createRunState` / `bumpCheckpoint` / `foldOutcome`, `policyDigest`.

## Step 3 — persist a checkpoint per record (incremental)

Today `translateAndUpdateRecords` emits a single terminal `onRunState` at
`ItemsDropdownUtils.ts:1441` and nobody subscribes. For resume, persist after
**each** record fold.

- Add a `persist?: (state: RunState) => Promise<void>` (or a `store?: RunStore`)
  to `TranslateBatchOptions` (`ItemsDropdownUtils.ts:431-437`).
- After each per-record `foldOutcome` (`ItemsDropdownUtils.ts:~1101`): `runState =
  bumpCheckpoint(runState)` then `await options.persist?.(runState)`. Keep the
  terminal `onRunState` too (shadow report is unchanged).
- `TranslationProgressModal.tsx` (the run owner) constructs `createIndexedDBRunStore()`
  once and passes `persist: (s) => store.save(s)` in the options object at
  `TranslationProgressModal.tsx:341-351`.
- On successful terminal completion, `store.delete(runState.runId)` so completed
  runs don't linger. (Cancelled/failed runs stay for resume.)
- Test: a fake `RunStore`/persist spy sees ≥ recordCount saves with monotonically
  increasing `checkpoint`.

## Step 4 — detect an incomplete prior run on open

In the two modal openers — `AIBulkTranslationsPage.tsx:~417` and `main.tsx:~510`
— **before** opening the progress modal:

- `const prior = await store.latest()` (or `list()` + `pickLatestRunState`).
- Guard compatibility: recompute `policyDigest(currentPolicy)` and require
  `isPolicyCompatible(prior, digest)` — a mismatch means the admin flipped a fate
  / de-selected a locale, so the prior run is stale (offer start-fresh only).
- Consider it resumable only if `unitsToResume(prior).length > 0`.

## Step 5 — resume vs start-fresh UI

- If a compatible incomplete prior run exists, prompt (openConfirm) Resume vs
  Start fresh **before** opening the modal (avoid a nested modal — see the
  no-nested-modals rule).
- On Resume: pass `prior.runId` + `unitsToResume(prior)` into the modal → engine.
- On Start fresh: `store.delete(prior.runId)` and proceed as today.

## Step 6b — engine resume-set

- `translateAndUpdateRecords` takes an optional `resume?: { runId: string; targets:
  ResumeTarget[] }`.
- When present: seed `runState` from `store.load(runId)` instead of `createRunState`,
  and filter the `records`/`toLocales` work down to `targets` (a `Set` of
  `` `${recordId}:${toLocale}` ``). Re-reading + idempotent replace-not-merge write
  is safe (`recovery.ts:35-49`).
- Everything else (conform gate, verify, fold) is unchanged.

## Notes / risks

- IndexedDB is unavailable in some contexts (private mode); `createIndexedDBRunStore`
  should be constructed lazily and its failure must degrade to "no resume", never
  break a normal run. Consider a `try` around `store.latest()` in step 4.
- `RUN_SCHEMA_VERSION` gate: `deserializeRunState` rejects a stale schema — a prior
  run from an older plugin version is simply treated as non-resumable. Good.
- Keep the shadow `onRunState` path intact; step 3 is additive.
