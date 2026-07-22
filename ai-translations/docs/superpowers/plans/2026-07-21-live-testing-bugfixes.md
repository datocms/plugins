# Live-testing bugfixes — bulk translation UX & reliability

**Branch:** `feature/translation-qc-v4-reconcile`
**Started:** 2026-07-21 (found by Roger during live manual testing of the bulk flow)
**Owner:** in progress

This tracks twelve issues found while manually testing the bulk Translation Progress
flow, plus parked items from the prior E2E pass. Root causes are grounded in code
(cited `file:line`) from two parallel research passes (workflow `wf_e8b96212-4b9` for
#1–#6, agent for #7). **Update the Status + Progress log as each lands.**

## Product decisions (2026-07-21, Roger) — CLOSED
- **No record-level field exclusion via the sidebar** — already covered by the multi-record
  workflow (even for a single selected record). Not building sidebar per-record exclusion.
- **No skip-if-populated — always overwrite** the translated fields of the selected locales
  (that's what a translation IS). Current behavior is intended; no overwrite/skip prompt.

## E2E design correction (2026-07-21 session 3)
The #12 report CSV/JSON export was wrongly *replacing* the human report with the RunState
(`serializeRunStateCsv`/`serializeRunState`), losing the reference-copy detail. Corrected to
the intended design: **human report rows + a `Machine readable status` column** (each row's
checksummed token, filled by new `withMachineTokens(rows, runState)`; `toBulkReportCsv` gained
the column; JSON auto-carries it). Import is now row-based (`fromBulkReportCsv` / `JSON.parse`);
`lastReportStore` stores rows only. Removed the superseded `importReport.ts` +
`bulkReportFromRunState`. (`serializeRunStateCsv`/`deserializeRunStateCsv` remain as engine
artifacts.) E2E tests added/fixed (see log).

## STATUS: all 12 issues ✅ (as of 2026-07-21 session 2)
#1–#12 + D2 all landed and tested. Full suite **1275 green**, `tsc -b` clean, lint clean,
`vite build` OK. Nothing committed/pushed (working tree, `feature/translation-qc-v4-reconcile`).
Only optional tails remain: #7 edit-before-resume (one-click resume works today); the parked
conform-gate form-path E2E withholding assertion. See Progress log at the bottom.

## How to resume
1. Read this file.
2. `git log --oneline -15` to see which fixes are committed.
3. Pick the next `TODO` item below; each has a root cause, fix, and TDD plan.
4. Run the relevant vitest file(s) named in the item. Full suite: `npx vitest run`.

## Status legend
✅ done (GREEN + verified) · 🔨 in progress · ⏳ TODO · 🅿️ parked

---

## #1 — Field picker loses click order ✅
**Symptom:** selecting fields re-sorts them into schema-layout order, not click order.
**Root cause:** `ModelFieldPicker.tsx:102-104` derived react-select `value` by filtering
the layout-ordered `fieldOptions`, re-imposing layout order every render (and corrupting
the stored `selectedFieldsByModel` on round-trip). Downstream is a pure membership check
(`isFieldIncludedInSelection` `.includes`), so preserving order is functionally safe.
**Fix:** new pure `orderSelectedFields(selectedApiKeys, fields)` in
`BulkTranslationHelpers.ts`; `ModelFieldPicker` maps stored (click-ordered) keys → options.
**Tests:** `BulkTranslationHelpers.test.ts` › `orderSelectedFields` (order + drop-unknown). GREEN.

## #5a — ⭐ Per-record error alert renders BEHIND the open modal ✅
**Symptom:** "does not have the source locale [en]" (and others) pop as `ctx.alert` toasts
hidden behind the progress modal (unreadable; violates no-nested-modals).
**Root cause:** `ItemsDropdownUtils.ts:1439` `ctx.alert(...)` fired mid-run — but the
immediately-following `updateProgress({status:'error', warnings:[errorMsg]})` already
streams the same detail into the modal. The alert was pure redundancy.
**Fix:** delete the `ctx.alert` line (kept `console.error` + the progress update).
**Tests:** `ItemsDropdownUtils.test.ts` › "reports a missing source locale as an in-modal
error, not a background alert" (asserts `alert` not called + error row carries the reason). GREEN.
**Follow-up (5b, ✅):** the run's `ctx` param type now drops `alert` (`ItemsDropdownUtils.ts`),
so messaging from inside the run is a COMPILE error. Sole caller (modal) passes the real ctx
(structural typing OK); stripped `alert: vi.fn()` from 14 test sites.

## #5c — Per-record detail: replace hover tooltip with a per-line accordion ✅
**Symptom:** error/warning reasons live only in a `position:fixed` hover tooltip
(`ProgressRow.tsx:125-140`) that overflows badly when long (Roger's screenshot). Can't stack
a modal on top (no-nested-modals → renders behind & hangs, per `[[datocms-no-nested-modals]]`).
**Fix:** make each flagged row (error OR completed-with-warnings) a **click-to-expand
accordion**: compact header (status icon + label + status text + caret) that toggles an inline
detail panel listing each warning line (scrollable `max-height` for long lists). Remove the
hover tooltip. Caret = react-ui `CaretDownIcon`/`CaretUpIcon` (#11).
**Tests:** `ProgressRow.test.tsx` — RED: flagged row shows an expand button, detail hidden
until click (not hover); clicking reveals the text; clean row has no control. Replaces the
existing hover-tooltip test.
**Files:** `ProgressRow.tsx`, `TranslationProgressModal.css`, `ProgressRow.test.tsx`.

## #2 — Export CSV button shows mid-run ✅
**Symptom:** Export CSV visible (greyed) during the run; should be hidden until terminal.
**Root cause:** `TranslationProgressModal.tsx:641-650` renders it unconditionally, only
`disabled` via `isExportEnabled`.
**Fix:** add pure `isExportVisible(status)` to `exportGating.ts` (`completed`||`cancelled`);
gate the render. Keep `disabled={!isExportEnabled(...)}` for the empty-cancel case.
**Tests:** `exportGating.test.ts` › `isExportVisible` (hidden running/paused, visible
completed/cancelled).
**Files:** `exportGating.ts`, `exportGating.test.ts`, `TranslationProgressModal.tsx`.

## #3 — "Please wait…" button is confusing ✅
**Symptom:** the primary Close button relabels to a disabled "Please wait…" mid-run.
**Root cause:** `TranslationProgressModal.tsx:674-682` renders it always; label ternary.
**Fix:** hide the primary button while `isProcessing` (leave only Cancel; PausePanel owns
paused actions). Label is always "Close" when terminal. Extract `footerPrimary(runStatus,
{isPublishing})` → `{isVisible,label,isDisabled}` into `footerState.ts` for testability.
**Tests:** `footerState.test.ts` (running/paused → hidden; completed/cancelled → Close).
**Files:** `footerState.ts`(+test), `TranslationProgressModal.tsx`.

## D2 (#4-part2) — Cancel discards partial results ✅
**Symptom:** Cancel immediately closes the modal; partial per-record results lost in view.
**Root cause:** `handleCancel` (`:554-565`) calls `ctx.resolve(...)` right after
`controller.cancel()`, so the just-set `cancelled` state never renders.
**Fix:** in `handleCancel` drop the `ctx.resolve` (keep `controller.cancel()` +
`abortRef.abort()`) → modal stays open in terminal `cancelled` state showing rows;
`handleClose` derives `canceled: runStatus.kind === 'cancelled'`. Combined with #2/#3 the
cancelled footer shows Export CSV + Close. Safe: cancel returns normally (no fatal row).
**Tests:** new `TranslationProgressModal.test.tsx` (mock heavy mount deps): Cancel keeps
modal open (`ctx.resolve` not called) with rows; Close-after-cancel resolves `canceled:true`.
**Files:** `TranslationProgressModal.tsx`(+test).

## #4-part1 — No manual Pause button ✅
**Symptom:** pause is auto-only (systemic errors); user expected a manual Pause.
**Root cause:** `pauseController.ts` exposes no `pause()`; the between-unit `gate` has no
pause branch; `RunStatus.paused` requires a `reason: NormalizedProviderError`.
**Fix:** add `pause()` + a `releasePause` promise the `gate` awaits; make `reason` optional
and add `trigger:'systemic'|'manual'`; `resume()`/`cancel()` release it; PausePanel manual
copy; footer Pause button while `running`. Note: takes effect at the next unit boundary.
**Tests:** `pauseController.test.ts` — manual pause blocks gate until resume; cancel unwinds.
**Files:** `pauseController.ts`(+test), `PausePanel.tsx`, `TranslationProgressModal.tsx`.

## #6 — Missing machine-readable CSV column (record-state hash) ✅ wired
**Wired end-to-end:** modal captures `finalRunState` (ref) → resolves it to the page
(`TranslationModalResult.runState`) → page holds `lastRunState` → `BulkTranslationReport`
uses `serializeRunStateCsv`/`serializeRunState` for CSV/JSON (machine column) when a
RunState is present. See #12 for the dropdown UX. Details below.

**Serializer built + tested** (`engine/report/csvAdapter.ts` `serializeRunStateCsv`, exported;
`csvAdapter.test.ts` round-trips the token via `runUnitFromMachineToken`). Fixed the
misleading `machineToken.ts` comment that claimed the column was live. **Remaining: wiring**
into the export surfaces (which grain — per-record human CSV + joined tokens, vs the per-unit
machine artifact) is done in **#12** once `RunState` reaches the UI (#7). The JSON half already
ships the `mrc` anchor. Original plan below.

**Finding:** NOT lost in the merge — the column was **specified** (resilient-report spec §6)
and the primitive built (`machineTokenForUnit` → CRC-32-checksummed `v1:base64url(...)`),
but only the JSON half shipped (`jsonAdapter.ts:30` `mrc`). The CSV projection was never
wired; `machineToken.ts:1-8` wrongly claims it's live.
**Fix (Option A, spec-faithful):** new `engine/report/csvAdapter.ts`
`serializeRunStateCsv(state)` → run-header row + `record_id,locale,bucket,
machine_readable_status` using `machineTokenForUnit` (guard empty ids). Export from
`report/index.ts`. Lift `finalRunState` to modal state; `handleExportCsv` downloads it.
Fix the `machineToken.ts` comment.
**Tests:** `csvAdapter.test.ts` — token round-trips via `runUnitFromMachineToken`; header row.
**Files:** `csvAdapter.ts`(+test), `report/index.ts`, `TranslationProgressModal.tsx`, `machineToken.ts`.

## #7 — "Resume previous run" is too late + no restore UI 🔨 banner + resume done
**DONE:** (a) foundation (schema + `runSummary.ts`, tested). (b) `detectResumableRun` in
`resumePrompt.ts` (non-interactive early detection, tested). (c) `ResumeBanner` component
(per-model progress, tested). (d) `AIBulkTranslationsPage`: mount-effect detects a resumable
run and shows the banner ABOVE the picker; **one-click Resume** restores the selection
(`restoreSelectionFromRunState`) and re-runs only the unfinished units via the extracted
`launchProgressModal`; the OLD late `resolveResumeSelection` prompt is removed from the page
(no more double-prompt / last-minute offer). **Full suite 1262 green, tsc + lint clean.**
**Remaining:** (1) the **records-dropdown path** (`main.tsx`) still uses the late
`resolveResumeSelection` — give it the same early treatment (or a picker-prefill). (2) Optional:
let the user EDIT the restored selection in the picker before resuming (today Resume is one-click
direct). Original plan below.

**Foundation DONE (pure, tested):** `RunState` now persists `selectedFieldsByModel` (top level)
+ per-record `itemTypeId` (`runState.ts`, `plan/types.ts` `UnitOutcome.itemTypeId`, captured in
`ItemsDropdownUtils.ts` createRunState + seeding loop); `jsonAdapter` round-trips both (the
deserialize record-mapping was the drop risk — fixed + test). New pure `engine/report/runSummary.ts`:
`summarizeRunByModel(state)` (per-model written/remaining + resumeFrom) and
`restoreSelectionFromRunState(state)` (fromLocale/toLocales/itemIds/fields). Exported.
Schema stays v1 (additive optional). **Full suite 1255 green.**
**Remaining (UI):** modal→page `RunState` plumbing; early-detect banner on
`AIBulkTranslationsPage` mount + before the picker (`main.tsx`); restore into the picker +
render the summary card. Original plan below.

**Symptom:** resume prompt fires LAST (after record+field selection):
`AIBulkTranslationsPage.tsx:418`, `main.tsx:532`. On resume, prior settings aren't restored.
**Findings:** `RunState` persists `fromLocale`/`toLocales`/record-ids (implicit via seeded
not-attempted units) but is MISSING `selectedFieldsByModel` and per-record `itemTypeId`
(needed for faithful restore + per-model summary). Side jobs (sidebar, field dropdown)
never persist a RunState (grep-confirmed) → early detection on the two bulk seams
auto-excludes them.
**Fix:**
- Extend `RunState`: `selectedFieldsByModel?` (top-level) + `itemTypeId` on `RunRecordState`;
  capture in `ItemsDropdownUtils.ts` (createRunState ~866, seeding ~881-895); carry
  `itemTypeId` through `jsonAdapter.deserializeRunState` (`:60-64`) — the likely drop point.
  Keep `RUN_SCHEMA_VERSION`=1 (additive optional fields; tolerate `undefined` on legacy).
- Early detect on `AIBulkTranslationsPage` mount (inline banner) + before the picker in
  `main.tsx executeItemsDropdownAction` (before `openModal` ~493), via
  `createIndexedDBRunStore().latest()` + `decideResume(policyDigest(...))`.
- New pure `summarizeRunByModel(state)` (written/total/remaining/resumeFrom per model) +
  `restoreSelectionFromRunState(state)`; render a "Resume where you left off" card that
  repopulates the picker (locales/records/fields).
- Keep narrowing the RUN to `resume.targets` while the restore UI shows the ORIGINAL set
  (don't conflate; progress counts depend on it).
**Tests:** extend `runState.test.ts`, `jsonAdapter.test.ts`; new `runSummary.test.ts`,
restore-mapper test; early-detection helper test.
**Files:** `runState.ts`, `jsonAdapter.ts`, `report/index.ts`, `ItemsDropdownUtils.ts`,
`resumePrompt.ts`, `AIBulkTranslationsPage.tsx`, `main.tsx`, `AITranslationsPickerModal.tsx`.

## #8 — Live translation snippet under in-progress status ✅
**DONE.** New engine `onFieldProgress` hook (`engine/index.ts`, fired in `runField` with a
`previewOf` source snippet before translating + a target snippet after) → threaded through
`ItemsDropdownUtils` (`makeFieldProgressReporter`, module-level to stay lint-flat) → new
`ProgressUpdate.activeField` → `ProgressRow` renders a transient sub-line (`code` field key +
source → spinner/target snippet) only on `processing` rows. Tests: engine emit (integration in
`ItemsDropdownUtils.test.ts`) + `ProgressRow` render. Full suite green; the per-record
orchestrator's pre-existing complexity got a documented `biome-ignore`. Original ask below.
**Ask:** under a record's "Translating to Russian [ru]…" line, show a transient secondary
line: `product['en']: "This is an example"` → spinner → the target snippet once returned,
updating in real time as the record is rebuilt, then collapsing back to the single line.
**Needs:** a finer-grained progress channel from the engine (per-field source→target
snippet events) surfaced through `onProgress`/a new callback into a transient `ProgressRow`
sub-line. Scope alongside #7 (both touch the engine progress plumbing).
**Status:** not yet scoped in code.

## #10 — Guard against closing the tab / navigating away mid-run ✅
**Ask:** the whole bulk run depends on the modal + plugin staying open. While a run is in
progress, warn the user before they close the tab or navigate away (prevent accidental loss).
**Fix:** `beforeunload` listener in `TranslationProgressModal` active while `isProcessing`
(running||paused); set `e.returnValue` to trigger the browser's native "Leave site?" prompt.
Remove the listener on terminal state/unmount. Pairs with #7 (a lost run becomes resumable).
**Tests:** effect add/remove by runStatus (component test, or extract a tiny
`shouldGuardUnload(runStatus)` pure helper to unit-test).
**Files:** `TranslationProgressModal.tsx`.

## #9 — Error/warning copy is cryptic 🔨 QC messages done
**Done:** rewrote to the "what happened → what to check/do" shape: slug-empty
(`TranslateField.ts`), no-op + length-ratio + HTML/Markdown structure + paragraph-count
(`qc/structuralChecks.ts`), segment-repair + placeholder-loss + truncated (`qc/checks.ts`),
SEO title/description truncation (`SeoTranslation.ts`). Full suite green (structural/checks
tests assert checkId/severity, not strings; slug string synced in 3 test sites).
**Follow-up done:** `"Plugin error:"` → `"Translation issue:"` (`ProviderErrors.ts`
SOURCE_LABEL_ENTRIES) so content situations don't read as plugin bugs; `hasSourcePrefix`
stays consistent (same table); 2 assertions updated. Sidebar error status line no longer
says "Completed with warnings" (`TranslateSidebar.tsx` failures branch → "Completed with
errors"). Provider/CMA-422 copy already decent per `ProviderErrors.ts`. Original below.

**Ask:** every error/warning must explain in plain language (1) what was expected & the
mismatch, (2) what to check/do. Examples flagged: "Translated slug is empty after
normalization" (worst), "N of N segment(s) are unchanged from the source", "SEO description
… truncated". Sources: QC checks in `utils/translation/qc/*`, `SeoTranslation.ts`,
skip reasons in `engine/index.ts`/`ItemsDropdownUtils.ts`, slug normalization path.
**Fix:** copy pass to a consistent "what happened → what to do" shape. Collect all message
strings, rewrite, keep messages structured (they already flow into report rows).
**Status:** queued as a dedicated pass.

---

## #11 — Use the DatoCMS icon set, not emoji/react-icons ✅
**Ask:** replace ad-hoc icons (emoji `✓`/`✗`/`⚠`, `react-icons` `BsExclamationTriangleFill`
in `ProgressRow.tsx:3`, `MdCelebration` in `TranslateSidebar.tsx:22`) with DatoCMS icons.
**Finding:** `datocms-react-ui` only exports UI-chrome icons (Back/Caret/Chevrons/Sidebar) —
no status icons. The status icon set is the SDK `Icon` type
(github.com/datocms/plugins-sdk `packages/sdk/src/icon.ts`) = FontAwesome-6 free icon
names. `Button` (react-ui) `leftIcon`/`rightIcon` take a `ReactNode`, so render the FA SVG.
**Decision:** the SDK `Icon` set IS FontAwesome 6 (names like `circle-check`,
`triangle-exclamation`, `circle-xmark`). react-ui only ships chrome icons + carets, so render
FA6 via `react-icons/fa6` (`FaCircleCheck`/`FaTriangleExclamation`/`FaCircleXmark`) — the same
glyphs DatoCMS uses — and use react-ui `CaretDownIcon`/`CaretUpIcon` for the accordion. Swap
Bootstrap (`BsExclamationTriangleFill`) + emoji (`✓`/`✗`). Keep `react-icons` (fa6), drop `/bs`.
**Status:** applied in #5c (ProgressRow); audit `TranslateSidebar` `MdCelebration` separately.

## #12 — On-page report: two dropdowns + last-run persistence + import ✅
**ALL DONE.** (a) Copy/Export dropdowns (Plaintext/CSV/JSON, machine column). (b) **Last-run
auto-show on reload:** `lastReportStore.ts` (localStorage, tested) — page persists {rows,
runState} after a run and re-shows on mount. (c) **Import:** `parseImportedRunState`
(JSON via `deserializeRunState`, CSV via new `deserializeRunStateCsv`, tested) +
`bulkReportFromRunState` (RunState→rows, tested) + a file-input on the page. Full suite green.
*(Note: last-run persistence uses localStorage keyed once, not the IndexedDB RunStore — the
report survives reload without touching the resume-checkpoint lifecycle.)* Original below.

**Dropdowns DONE:** `BulkTranslationReport` now has **"Copy report as ▾"** and **"Export
report as ▾"** (react-ui `Dropdown`), each offering **Plaintext / CSV / JSON**. Plaintext =
`toBulkReportPlaintext` (new, tested); CSV = `serializeRunStateCsv(runState)` (machine column)
with row-CSV fallback; JSON = `serializeRunState(runState)` (mrc) with row-JSON fallback.
Test mock gained `Dropdown`/`DropdownMenu`/`DropdownOption`; report test rewritten. GREEN.
**Remaining:** IndexedDB **last-run auto-show** on page reload + **CSV/JSON import** (parse a
prior run via `runUnitFromMachineToken`). Needs a RunState→report-rows transform + a persisted
"last completed run" (today `finalize()` deletes a fully-complete run's checkpoint). Original below.

**Ask (BulkTranslationReport, `AIBulkTranslationsPage`):**
1. Collapse Copy / Download CSV / Download JSON into **two** dropdowns: "Copy report as ▾"
   and "Export report as ▾", each offering **Plaintext** (current Copy), **CSV**, **JSON**.
2. CSV *and* JSON must include the machine-readable record-state column (ties to #6).
3. Persist the **last run status** in IndexedDB; auto-show it on the bulk screen on reload;
   allow **importing** a prior run from CSV/JSON. This also seeds the resume workflow (#7).
**Notes:** `bulkReport.ts` already has `toBulkReportCsv`/`toBulkReportJson`; add a plaintext
serializer + a `Dropdown` (react-ui) per action. For (2), CSV/JSON must carry the machine
token — depends on #6's `machineTokenForUnit` wiring + `RunState` reaching the report.
For (3), we already persist `RunState` per-record to IndexedDB during a run
(`setupResumePersistence`); add a "latest completed run" load on `AIBulkTranslationsPage`
mount + an import parser (`runUnitFromMachineToken` decodes CSV/JSON rows back to units).
**Files:** `BulkTranslationReport.tsx`, `bulkReport.ts`(+test), `AIBulkTranslationsPage.tsx`,
`engine/report/*` (import/decode). Overlaps #6 + #7.

## E2E tests (2026-07-21 session 3) — added + fixed, validated on real DeepL
**Conform-gate withholding (the parked item) — DONE:** the badge sidebar test
(`ai-translations.spec.ts`) now saves + reads back via CMA that NO badge locale exceeds its
5-char limit and the source is untouched — proving the over-length translation was *withheld
from the form* (not staged-then-truncated). ✅ passes on DeepL.
**Fixed existing tests my UI changes broke:** new `progressModalFrame` locator (`.TranslationProgressModal`
class, replaces the "Close/Please wait" button locator in `steps/bulk.ts` + `bulk-reliability.spec.ts`);
"Export CSV **hidden** mid-run/paused" (was disabled); "Cancel **keeps the modal open**" (D2);
resume test uses the **banner's one-click Resume** (native prompt removed); on-page report test
uses **Copy/Export dropdowns** + asserts row JSON with the machine column. All ✅ on DeepL.
**Validation:** focused subset (6 tests incl. all the above) — 6/6 passed on DeepL.
Full 43-test DeepL lane: **39 passed, 3 failed** — the 3 are PRE-EXISTING, not regressions:
  1. `content-scoped field failure leaves its locale untouched` — order-dependent (needs
     unmutated product records; **passes in isolation**). Shared-env pollution in the full lane.
  2/3. `config screen: vendor switch … gates Save on dirtiness` + `field-exclusion picker
     resolves model and block fields` — **fail even on a fresh env**, in config code this session
     did NOT touch (git-confirmed zero Config/fieldExclusion/fieldFate changes). #2 = Save loads
     `enabled` (form dirty on load, onBoot/seed interaction), consistent across 63 retries; #3 =
     block fields don't render on DeepL (test comment: "regressed for non-OpenAI vendors").
     Both are pre-existing DeepL config-screen issues — worth a separate fix.
**Parked conform-gate item is now CLOSED (done).** All session-3 changed/new tests pass on DeepL.
E2E infra note: config-screen + record-mutating tests need per-test env/config reset for a clean
full-lane run (pre-existing).

## Parked (from the prior E2E pass, pre-live-testing)
- 🅿️ **Sidebar status-line mislabel:** `TranslateSidebar.tsx:121` shows "Completed with
  warnings" even for an error-tier outcome; should say "errors". (Relates to #9.)
- 🅿️ **Conform-gate form-path E2E:** add the withholding assertion to the `badge` sidebar
  test (`ai-translations.spec.ts:625`) — save + CMA readback proving the over-length value
  never landed. Real DeepL, deterministic via `badge` `length.max:5`. No mock needed.

## Progress log
- 2026-07-21: research complete (2 parallel passes). #1 field-order ✅ GREEN.
  #5a behind-modal alert ✅ GREEN (full `ItemsDropdownUtils` suite 65/65).
- 2026-07-21 (cont.): #5c accordion + #11 FA6 icons ✅; #2 export-visible ✅; #3 please-wait ✅;
  D2 cancel-retains-results ✅; #10 unload guard ✅ (new `TranslationProgressModal.test.tsx`).
  #6 `serializeRunStateCsv` serializer ✅ (wiring → #12). #9 QC/slug/SEO copy pass ✅.
  #4 manual Pause ✅ (`pauseController.pause()` + PausePanel manual copy + footer button).
- 2026-07-21 (session 2 — autonomous): #5b ctx-seam ✅; #11 sidebar icon + sidebar error
  status-line ✅; #9 "Plugin error:"→"Translation issue:" ✅. #7/#12 FOUNDATION ✅ (RunState
  `selectedFieldsByModel` + `itemTypeId`, `jsonAdapter` round-trip, `runSummary.ts`). #6 WIRED
  ✅ (modal→page `runState` → report CSV/JSON machine column). #12 report **Copy/Export as**
  dropdowns ✅ (Plaintext/CSV/JSON, `toBulkReportPlaintext`). #7 **early-detect banner +
  one-click Resume** ✅ (`detectResumableRun`, `ResumeBanner`, page mount + `launchProgressModal`).
  **Full suite 1262 green, tsc + lint clean.**
  **STILL REMAINING (at that point):** #8 live snippet; #12 last-run auto-show + import;
  #7 records-dropdown early detect.
- 2026-07-21 (session 2 — final): **#12 COMPLETE** — `bulkReportFromRunState` +
  `deserializeRunStateCsv` (import) + `lastReportStore` (localStorage last-run) +
  `parseImportedRunState`, all TDD'd; page auto-shows last run on reload + a file-input import
  control. **#7 dropdown-path** — `main.tsx` now detects resume BEFORE the picker (`detectResumableRun`
  + `openConfirm`, extracted `runProgress`), and the wall-of-text completion alert (#5d) downgraded
  to a brief notice. **#8 COMPLETE** — live per-field `onFieldProgress` snippet sub-line.
  **ALL 12 ISSUES DONE. Full suite 1275 green, tsc + lint clean, vite build OK.** Nothing pushed.
  Optional tails: #7 edit-before-resume; parked conform-gate E2E withholding.
