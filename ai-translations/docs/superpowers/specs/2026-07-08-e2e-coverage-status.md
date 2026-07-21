# AI Translations — E2E coverage status (post master-merge)

**Date:** 2026-07-08 (exhaustiveness audit + second wave: 2026-07-09)
**Context:** after merging master 3.6.0 into `feature/translation-qc`, an audit
mapped every "latest feature" (master's linked-record/bulk-warnings work + the QC
engine) against the E2E suite. This records what was found, what has since been
closed, and the prioritized gaps that remain.

## Audit result

38 feature-behaviours audited across four clusters (master report/UX, QC engine +
its two surfaces, provider matrix + input recovery, seed-record matrix). Baseline:
**2 covered, 7 partial, 29 none.** The suite proved the *happy path* (populate +
save + a bulk report existing) but exercised almost none of the actual 3.6.0 / QC
behaviours end-to-end — they were unit-only.

## Closed since the audit

All deterministic on the DeepL lane (both the reference-copy and length checks are
provider-independent — a link field is never sent to a provider, the length check
is schema-side — so one lane suffices).

- **Reference-copy + min-linked-records validation fix + completed-with-warnings**
  (audit 1–3). New isolated `catalog_entry` seed model with a required localized
  `related_articles` (`links`, `size:{min:1}`). Bulk test asserts the record surfaces
  as `completed-with-warnings`, the CSV names the copied field + states the reason,
  and — via CMA — that `related_articles.es` equals the source ids (shallow copy, no
  422 on the min-count constraint). This is the regression guard for 3.6.0's headline.
- **Length-validator → failure with a reason** (audit 4, 5). A tiny-limit `badge`
  field on `catalog_entry`, overflowed by any translation, produces a failed report
  row with a stated reason (card #1: not a silent truncation).
- **Single-record editor surfacing** (audit 6, 8). A per-record test translates the
  badge record via the sidebar and asserts a translate-time length/QC **alert toast**
  (design §6a) — previously the captured `run.toasts` were never asserted.
- **Non-localized / numeric fields left untouched** (audit 10). The A1 kitchen-sink
  test now snapshots `author_name`/`view_count`/`is_premium` before translating and
  asserts them byte-for-byte unchanged after save (the design's negative coverage).
- **Bulk report reasons / CSV warning+failure rows** (audit 17, 28, partial 18): the
  `catalog_entry` run exercises warning *and* failure rows with populated
  `copied_link_field_api_keys` + `notes`, not just bucket counts.
- **Non-Latin / RTL / CJK source** (audit 13, 15): a per-record test translates A6
  FROM `zh-Hans` and asserts the run finishes and surfaces the untranslatable slug.
  Fixing this exposed a real **E2E-harness bug** (below) — the translation itself was
  never slow.
- **Pre-filled target locale + JSON-field placeholders** (audit 14, 27): A7 translates
  `en → ru` (where `ru` title/seo are pre-filled) and asserts the run finishes, the
  overwrite populates the previously-empty `ru` JSON field, and the placeholder tokens
  (`{{nights}}`, `{{brand}}`, `%s`, `:slug`) survive into the Cyrillic target.
- **Article-model bulk into an empty target** (audit 16, and part of 9/11/29): a bulk
  `article → es` run accounts for every record and asserts (CMA) that at least one
  article now has an `es` title that *differs* from its `en` source — real translation
  into an empty locale, not just an overwrite or a copy.
- **Translated editors, not just presence** (audit 9, 11, 29 — closed): the DeepL
  lane now pins **every** editor into `translationFields` (structured_text /
  rich_text / single_block included — DeepL's batch API absorbs the fan-out that
  made these unaffordable on the chat lanes), and the article bulk test asserts
  A1's heavy editors landed in the EMPTY `es` target: `body_html` keeps its
  top-level element count (the 3.5.6 over-split crop regression, Basecamp "AI
  Translate truncating HTML response arrays"), `content_blocks.es` carries every
  source block, `structured_body.es` is populated and differs from `en`, and
  `cover_image`/`media_gallery` land per-asset.
- **Source-locale integrity** (new; Basecamp "Fixing corrupted AI Translation SEO
  Fields", the ≤3.4.5 in-place mutation bug): the A1 kitchen-sink test snapshots
  the `en` slice of every localized field before translating and asserts it
  byte-identical after save — a translation run must never corrupt its source.
- **Retained on-page review list** (audit 20, 21): after the catalog bulk modal
  closes, the persisted `BulkTranslationReport` region must still list the
  reference-copy warning rows (naming `related_articles`) and the badge
  length-failure row.
- **Provider-appropriate outcomes** (audit 24, scoped): on DeepL the product bulk
  may fail at most the source-less record and must translate every en-sourced
  product; chat lanes stay unpinned (QC warnings are legitimate there).
- **Field-dropdown surface** (new — found by a surface sweep, not in the original
  audit): `fieldDropdownActions`/`executeFieldDropdownAction` ("Translate to →")
  had ZERO coverage. A DeepL-lane test CMA-clears A2's `excerpt.es`, drives the
  field kebab → "Translate to → [es]", asserts the completion notice, saves, and
  proves the empty target was really written.
- **Items-dropdown surface** (new — same sweep): `itemsDropdownActions` ("AI
  Translate these records" → picker modal → confirm → progress) had ZERO
  coverage. A DeepL-lane test flips the product model to the `table` collection
  appearance (the only appearance with multi-select), selects all records,
  drives the picker (en → pt-BR), and asserts the per-record report accounts for
  all three products — including the record with no `en` source — plus a real
  pt-BR translation via CMA.

Plus, from the merge itself: a `csvExport` bug (warned records dropped from the CSV)
was fixed, and the E2E login flake (`networkidle`) was removed. Suite internals are
now documented in [`e2e/AGENTS.md`](../../../e2e/AGENTS.md).

## Remaining gaps (prioritized)

### Found while closing these: two latent E2E-suite hazards (both fixed)

- **Editing-session locks leaked into the bulk tests.** Per-record tests lock the
  records they open for minutes past the test's end, so the later bulk runs hit
  "record is locked" on exactly those records. Worse, the catalog test's
  `errors ≥ 1` was being satisfied by that lock error — the badge **length**
  failure it claims to prove may never have been exercised in a full-suite run.
  Fixed by ordering bulk tests before every editor test and asserting the
  failure's stated reason (length/validation) in the CSV, not just its count.
- **A6's slug outcome is DeepL-weather.** zh-Hans → ar sometimes yields a
  Latin-ish slug (normalizes fine → wholesale success) and sometimes Arabic
  script (normalizes empty → surfaced failure). The test now accepts either
  surfaced outcome; what it pins is that the run finishes and never ends
  silently.

### Resolved: the A6 "hang" was an E2E-harness bug, not a plugin bug
The first attempt at an A6 (`zh-Hans` source) per-record test appeared to hang for
>10 min. Systematic investigation ruled out every external factor (DeepL API and the
CORS proxy are ~300–900ms for `zh→ar`, even at 12× concurrency; no rate-limiting;
A6 is *lighter* than A1; both translate one target locale). Root cause: A6's `slug`
can't translate into Arabic — a `webpage_slug` normalizes non-Latin script to empty,
so the field throws "empty after normalization" (correct, and surfaced via
`ctx.alert`). `TranslateSidebar` intentionally withholds the "Translations were
applied" success banner whenever any field errors — and the E2E helper
`translateRecordViaSidebar` waited *only* for that banner, so a partial failure
burned the full 10-min timeout. Fixed by making the helper key off the "Cancel"
button (shown only while actively translating; hidden on both success and error) and
accumulate auto-dismissing toasts. A6 now runs in ~7.5s and asserts the run finishes
and surfaces the untranslatable slug. No plugin change was needed.
### Low / hard to make deterministic
- **Provider-dependent QC checks** (audit 19, 22, 25, 30–35): `truncated`,
  `no-op`, `html-structure`, `markdown-structure`, `length-ratio`, `length-mismatch`.
  These need a chat provider to *produce* a degraded response and are non-
  deterministic; they are well covered by unit tests grounded in real provider
  response fixtures (`test/fixtures/provider-responses/`). E2E-ing them reliably
  would need canned/proxied provider responses — a larger piece of work.
- **JSON-array recovery / single-quote** (audit 36, card #2): same — needs a provider
  to return a malformed array; unit-tested via `jsonArrayRecovery.test.ts`.
- **Anthropic lane** (audit 23): wired and correct; currently blocked only by the
  test key's Anthropic credit balance (an environment issue, not code).
- **Over-limit SEO save error** (audit 7, 12): SEO meta lengths are best-practice
  hints, not hard `length` validators, so they don't reliably 422; the `badge`
  length-validator field is the deterministic stand-in for card #1.

## Second wave (2026-07-09): exhaustiveness audit

A multi-agent behavior-map of every hook/flow/param vs. what the (then) 10 tests
actually asserted produced 32 candidate gaps plus a critique that found two
**product bugs** (both fixed): the ConfigScreen's `deeplFormality`/`deepl*Tags`
settings had no runtime effect, and `modelsToBeExcludedFromThisPlugin` was not
enforced on the Bulk Translations page (an "excluded" model stayed
bulk-translatable there; the settings-area menu item also now honors role
exclusion).

**Added (second wave, all DeepL lane):** partial field selection (allowlist +
untouched-unselected negative), the field-dropdown empty-source guard /
Translate-from direction / All-locales flows, a config-screen smoke (vendor
switch swaps credential blocks, Save gated on dirtiness, nothing saved),
surface gating (translateWholeRecord / translateBulkRecords / model exclusion
incl. the bulk-page fix / field exclusion / translationFields removal — all
zero-credit CMA param flips with restore), unconfigured-provider degradation
(sidebar placeholder + Open Settings, not-configured field action), a
broken-key bulk run (every record fails WITH the auth reason — the outage
story), single-block (`spotlight`/`inline_note`) empty-target assertions,
sandbox-prefixed record-link hrefs, and the retained report's Download JSON.

**Resolved: the pt-BR 422 was a JSON-field product bug (third one found).** The
sparse locale was a red herring — the captured PUT body named
`featured_data.pt-BR: INVALID_FORMAT`. `json` fields had no dedicated
translation path: the whole raw document went to the provider as prose, which
translated the KEYS and mangled syntax (DeepL: `"estimatedMinutes": 8` →
`"tempo estimado": 8 minutos`, no longer JSON). Which locale broke was provider
roulette — it/es survived, pt-BR didn't. Fixed structurally
(`JsonFieldTranslation.ts`: parse → translate only non-empty string leaf values
→ re-serialize; valid by construction, keys/numbers/booleans byte-exact,
placeholders still protected), with a `json-validity` warning flag on the
unparseable-draft fallback. Verified by re-running the exact failing repro
(save now 200) and the kitchen-sink/A7 E2E flows.

**Third wave (2026-07-09, overnight): the add-later list, worked down.** Now
also covered: no-records and no-translatable-fields dead-ends (fixture models
created in the fork), bulk-page readiness blockers + the target-select
"All other locales" mutex, the single-locale record guard (sidebar message +
no field actions), onBoot default re-seeding, a non-default source locale
driving a bulk run (de → fr), sidebar target narrowing with the unselected
locale proven byte-untouched, and a non-default source locale bulk run.

Also covered since: picker + confirm-modal Cancel bail-outs (no run starts, no
modals linger) and CSV row-body depth (every row leads with a known status;
embedded editor URLs target the forked env).

**Known-remaining (add-later):** MID-RUN Cancel in the bulk progress modal
(timing-sensitive on the fast lane), retained-report Copy button (clipboard
perms), role exclusion (needs a collaborator login — the harness session is
the project owner), and the badge length overflow through the FIELD-action
path (attempted: the kebab flow on the catalog record never fired
the action in E2E — zero toasts, likely a submenu-interaction quirk on that
record's menu; the sidebar badge test still covers translate-time length
surfacing). **Role exclusion turns out to be untestable
from this harness's session:** the dashboard login is the project OWNER, whose
`ctx.currentRole.id` is a virtual role not present in `roles.list()` — even
excluding every enumerable role leaves the surfaces visible. Exercising it
needs a collaborator login (second dashboard account) in the harness.

**Deliberately skipped (with rationale):** provider-dependent QC outcomes and
error buckets beyond auth (nondeterministic; unit-tested on real fixtures),
`ja`/`hi`/`sw` as targets (no locale-specific code path; CJK-source covered by
A6, CJK-target ratio logic unit-tested), missing-access-token branches
(unreachable with the installed plugin's granted permission), primary-env URL
branch (this suite always runs in sandboxes; unit-tested), LoadingAddon + TOTP
login (env-dependent), multi-model items-picker (unreachable: the record list
is single-model, so a selection never spans models), a11y/keyboard sweeps and
cross-flow overwrite interactions (valuable but a separate initiative).

## Third wave (2026-07-21): reconciliation follow-ups

Three v4 decisions landed after the master reconciliation (see the branch commits and
`docs/superpowers/plans/2026-07-21-cross-session-resume.md`). Their **logic is covered
by unit tests**; the E2E plans below follow this suite's rule — E2E proves whole flows,
pure logic stays in unit tests, and any new spec is validated on `--project=deepl`
before it's assumed green.

### Conform block gate on the form paths (sidebar + per-field dropdown) — unit-covered; E2E planned
An error-tier QC value is now **withheld** from the open form on the sidebar and the
per-field dropdown (not just dropped from the bulk write). Unit coverage:
`formAdapter.test.ts` (`partitionWritesByQcErrors`, `hasBlockingQcError`) and
`TranslateSidebar.test.tsx` ("withholds an error-tier cell from the form"). E2E plan
(DeepL lane): translate a record whose `badge` overflows its `length` validator via the
sidebar → assert the badge input keeps its prior value (the translation is withheld) and
the alert names it. `badge` is already the deterministic length-error stand-in used by
the bulk length test, so this is E2E-able — a scaffold pending a first live run.

### Cross-session resume — unit-covered; E2E planned
Bulk runs checkpoint to IndexedDB per record; an interrupted run can be resumed. Unit
coverage: `indexedDBRunStore.test.ts`, `resumeDecision.test.ts`, `resumePrompt.test.ts`,
`deviceId.test.ts`, and the `ItemsDropdownUtils.test.ts` "persists an incremental
checkpoint" / "resumes only the unfinished units" tests. E2E plan (DeepL lane, ≥2
records): let record 1 complete (persisted), interrupt at record 2 (429 pause → Cancel),
reopen the bulk flow → assert the **Resume** `openConfirm` appears; on Resume assert only
record 2 is (re)written; on Start over assert the checkpoint is dropped and everything
reruns. Note `injectRateLimit` faults the *first* N calls, so targeting record 2 needs a
`failTimes` tuned to record 1's call count (provider/field-dependent) — hence deferred to
a live authoring pass rather than committed blind.

### Suite interaction (harness)
The resume prompt now appears in the bulk openers whenever a compatible **interrupted**
prior run is found in the browser's IndexedDB. Playwright isolates storage per test so it
does not leak across tests; but a single test that cancels a partially-completed run and
then reopens the bulk flow **will** hit the prompt — handle it (Resume / Start over) or
clear IndexedDB. A fully-completed run deletes its own checkpoint, so the prompt never
follows a clean run.

## How to extend

See [`e2e/AGENTS.md`](../../../e2e/AGENTS.md) — especially applying seed schema
changes to `main` (idempotent `1-schema.mjs` + an idempotent top-up record script,
then `4-verify` + `5-manifest`), and gating provider-independent tests to the DeepL
lane. Validate any addition with `--project=deepl` before assuming the matrix is green.
