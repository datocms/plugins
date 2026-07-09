# AI Translations — E2E coverage status (post master-merge)

**Date:** 2026-07-08
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

Plus, from the merge itself: a `csvExport` bug (warned records dropped from the CSV)
was fixed, and the E2E login flake (`networkidle`) was removed. Suite internals are
now documented in [`e2e/AGENTS.md`](../../../e2e/AGENTS.md).

## Remaining gaps (prioritized)

### High — worth doing next
- **⚠ A6 non-Latin/RTL/CJK source — attempted, exposed a possible perf/hang bug**
  (audit 13, 15, 26). A per-record sidebar test translating A6 FROM `zh-Hans`
  (kitchen-sink record) **timed out at >10 min**, whereas the equivalent A1
  kitchen-sink translating from `en` finishes in ~10s — a ~60× gap for a
  same-shape record and a single target locale. This is either a pathological
  slowdown or a hang specific to a hyphenated/CJK **source** locale (the exact
  `from-to` splitter path the audit flagged). The test was reverted (impractical
  as written); the failing env `e2e-deepl-1783563632` was left up for debugging.
  Next: reproduce against a **light** non-Latin record (title + one field only) to
  isolate locale-vs-content-volume, then investigate the sidebar's per-field
  translate loop for a `zh-Hans` source (retry storm? never-resolving await?).
- **A7 pre-filled target locale** (audit 14, 27): translate `en → ru` where `ru` is
  partially pre-filled → the overwrite-vs-preserve branch; JSON-field placeholder
  survival. No seed change (A7 exists).
- **Assert translated editors, not just presence** (audit 9, 11, 29): the bulk/per-
  record CMA assertions confirm a locale is *populated*; strengthen them to confirm
  `structured_text`/`rich_text`/`single_block`/`file`/`gallery` values actually
  changed vs source and into an *empty* target locale (A1 currently checks `it`, a
  source locale).

### Medium
- **Bulk on the `article` model** (audit 16): only `product` + `catalog_entry` are
  bulk-tested; the design intends article too.
- **Warning-severity QC bucket + retained review list** (audit 20, 21): the on-page
  `BulkTranslationReport` table surviving modal close.
- **Provider-appropriate outcomes** (audit 24): assert DeepL takes the happy path
  while a chat vendor surfaces the defect-path warnings.

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

## How to extend

See [`e2e/AGENTS.md`](../../../e2e/AGENTS.md) — especially applying seed schema
changes to `main` (idempotent `1-schema.mjs` + an idempotent top-up record script,
then `4-verify` + `5-manifest`), and gating provider-independent tests to the DeepL
lane. Validate any addition with `--project=deepl` before assuming the matrix is green.
