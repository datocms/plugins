# AI Translations — Remaining Work Spec

> **Status doc, not an implementation plan.** It scopes what is left on the
> [Byway verification card](https://3.basecamp.com/5656352/buckets/33592869/card_tables/cards/10030318843)
> after the `feature/translation-qc` branch, anchors each item to the governing
> design section, and names the design decisions still open. Per-subsystem
> implementation plans (bite-sized TDD) come *after* the open decisions land —
> writing TDD steps for undecided UX would be guesswork.

**Date:** 2026-07-15
**Branch audited:** `feature/translation-qc` (117 commits ahead of `master`)
**Governing spec:** `docs/superpowers/specs/2026-07-13-v4-unified-translation-design.md` (the v4 design; section refs below are to it)

---

## 1. Where the branch stands

The card carries **16 checklist items** (a 17th — lightweight language detection — was removed as out-of-scope, 2026-07-15). The audit (code-level, against `src/` and the test suites — not just the design docs) puts **13 done, 3 remaining**.

### Done — checked on the card (13)

| # | Item | Landed as | Governing phase |
| --- | --- | --- | --- |
| 1 | Bulk verification report workflow | `src/utils/translation/bulkReport.ts`, `src/components/BulkTranslations/BulkTranslationReport.tsx` | §6.4 |
| 2 | Report export (CSV + JSON + clipboard) | `bulkReport.ts` (RFC-4180 + OWASP formula-injection guard), `src/utils/csvExport.ts`, `exportGating.ts` | §6.4 |
| 3 | Unify single-record + bulk pathways | `src/engine/` engine; `translateRecordFields.ts` (964 lines) **deleted** (`4810a99`); sidebar delegates via `formAdapter`/`formSink` | Phase 2+3 (§2) |
| 5 | Conflict resolution (always overwrite) | Unconditional overwrite of translated/copied values; null-guard only for *failure* fallbacks | §4.3 |
| 6 | Exclude required fields/subfields | `resolveFieldFate` auto-splits `exclude`→`copy` when `cannotBeBlank`, top-level + block sub-fields (`src/engine/fieldFate.ts`) | §4.1/§4.2 |
| 7 | Error handling (systemic vs content, pause, brake) | `ProviderErrors.ts` classification, `stallGuard.ts`, `pauseController.ts` | §8, §2.3 |
| 8 | E2E tests | 3 specs / 45 tests, 4-provider Playwright suite (`e2e/`) | Phase 0 (§9.4) |
| 11 | Field validation errors on save | 422 → field-named reason (`ProviderErrors.ts`); proactive length guard (`qc/validatorChecks.ts`); read-back verify | §9.2 (partial) |
| 12 | Single-quote / escaping | `jsonArrayRecovery.ts`, wired at `translateArray.ts:243`, covers the customer's exact case | — |
| 13 | Post-response QC layer | `src/utils/translation/qc/` — length, truncation, HTML/markdown structure, placeholders | §6.4 |
| 14 | "Too short" heuristic (warning-only) | `checkLengthRatio` — script-aware floor, one-sided, `severity: 'warning'` | §6.4 |
| 16 | Rate-limit auto-retry | `retryAfter.ts` + adaptive pacer (`TranslationCore.ts`) + budget/countdown (`pauseController.ts`) | §8 |
| 17 | Warning/error severity levels | `qc/types.ts` — `error` / `warning` / `info`; drives record escalation + report/export | §6.4 |

### Remaining — left unchecked (3)

| # | Item | State | Maps to |
| --- | --- | --- | --- |
| 4 | Config-level vs record-level exclusion | **PARTIAL** — engine honors both; config UI and per-run layer unbuilt | Phase 4 + Phase 5 |
| 9 | Public E2E project template (not a Support-owned fork) | **PARTIAL** — reproducible seed exists; still forks project `219952` | (not in v4 phasing) |
| 10 | Pre-commit hooks for the E2E system | **NOT DONE** — gated on "after Marcelo tries it" | (not in v4 phasing) |

> Item 15 (lightweight language detection) was **removed from the card** on
> 2026-07-15 as out-of-scope — no "smart" guessing (design §10).

The v4 design's own phasing (§11) confirms the split: **Phases 0, 1, 2+3 are done**; **Phases 4, 5, 7** and the two E2E-tooling items are what's left. **No implementation plan file exists yet for Phases 4 or 5** — they live only in the design spec.

---

## 2. Remaining Item 4 — the exclusion/selection UI (Phases 4 + 5)

**This is the bulk of the remaining product work.** The engine already resolves
every field fate (`translate` / `exclude` / `copy`) and honors both a
config-level exclusion list and a `fieldsToCopyFromSource` list. What's missing
is everything *above* the engine: the UI to set those lists honestly, the
id-migration, and the per-run override layer.

### 2a. Phase 4 — the field tree, the unified modal, the id migration (design §5, §6)

Scope, verbatim from §11:

- **`fieldsToCopyFromSource` config picker** — the engine reads it today, but
  `ConfigScreen.tsx:79` explicitly defers the UI ("picker UI ships in phase 4").
  Until then the "always copy from source" list is settable only via raw plugin
  params. (§4.2)
- **api_key → id config migration** with an ambiguity prompt (§5.1), and the
  legacy single exclusion list split into the two explicit lists (§4.2).
- **`ModelFieldPicker` becomes an honest multi-select** — replace the "magic
  pill" selectors with explicit chips + an "n/n selected" count + Select-all
  (`docs/superpowers/specs/2026-07-13-field-selection-harmonization-design.md`).
- **Sidebar → modal progress channel + status line** (§6.1/§6.4) — the sidebar
  currently shows a status line without the modal report; phase 4 adds the
  `BroadcastChannel` (or degrades to the panel line if the CMS ever sandboxes
  the iframe — risk in §12).
- **Block sub-field kebab** — offer per-field translate inside single-block
  containers where safe; greyed-out explainer where not (§6.2). Must
  schema-resolve `fieldPath` and never trust `ctx.field`/`parentField` for
  identity (risk in §12).
- **Both sentinel deletions** (All-fields / All-locales) + uniform selector
  affordances, incl. the `e2e/tests/steps/bulk.ts` step migration (§5.3).

**Open decisions before this can become a TDD plan:**

1. **What "exclude a required field" surfaces to the user.** The engine's answer
   is auto-split-to-copy (§4.1). Roger's 2026-07-14 comment + mockup proposed
   being *explicit* about it in the UI; Marcelo's reply pushed for the *simplest
   possible* UI even at a feature cost. This is the open UX tension — resolve it
   before building the picker.
2. **Config-screen surface area.** Two lists (Exclude + Always-copy) plus the
   field tree is a lot of UI. Decide the layout and whether copy-from-source is
   a first-class list or an advanced/collapsed option.
3. **Migration ergonomics.** How aggressive is the api_key→id prompt — silent
   where unambiguous, prompt only on collision?

### 2b. Phase 5 — run-picker buckets + runtime policy (design §7)

- **Per-run exclusion / copy buckets.** `resolveFieldFate` already accepts
  `runSkipIds` / `runCopyIds` (plumbed, `undefined` today); no caller passes
  them. Phase 5 wires the run picker's three buckets with eligibility
  validation. (§7)
- **"Skip that language" done safely** — §7.2 warns a naive implementation
  deletes data; it must send `meta.current_version` and record skipped locales
  in the accounting (the optimistic-locking work in `b255f6a` is the
  foundation).
- **Runtime-blank policy** incl. the `draft_saving_active` branch (§4.0/§7.1) —
  what happens when a required field would end up blank at *runtime*, not just
  by config.
- **Permitted-language filtering** — offer only locales the user's role can
  write (the meeting brief's "wrong-permission languages" row). Bulk writes are
  already verified post-save; this closes the gap at selection time.

**Dependency:** Phase 5 needs Phase 4's schema crawl and Phase 3's
`cannotBeBlank` predicate (both landed). So Phase 4 → Phase 5 is the order.

---

## 3. Remaining Item 9 — public E2E project template

**Current state:** the suite forks one fixed, credential-gated project
(`E2E_PROJECT_ID = 219952`, subdomain `ai-translation-e2e`) owned by Support.
A full reproducible seed exists (`e2e/seed/1-schema.mjs` … `7-restricted-role.mjs`)
that can rebuild the schema + 12 locales + records into any project you point a
CMA token at — so the *content* is portable, but the *provisioning* still binds
to the owned project and its dashboard credentials.

**Goal:** a public / self-serve project template a third-party plugin author can
clone to run this E2E suite against their own project, with no dependency on a
Support-owned environment.

**Open decisions:**

1. **Delivery mechanism.** DatoCMS project *template* (the CLI supports
   `templates construct`), a committed migration/seed the author runs against a
   fresh project, or a published shareable project link? The seed scripts favor
   option 2; a template favors one-click.
2. **Credentials story.** The suite needs a CMA token + a dashboard login for
   the browser lane. A public template must document how an author supplies
   *their own* — no shared secrets in the repo.
3. **Provider keys.** The 4-provider matrix needs OpenAI/Gemini/Claude/DeepL
   keys in `.env.testing`; the template must degrade gracefully to whichever
   keys the author has.

**Note:** not in the v4 phasing — this is E2E-tooling, independent of the
product phases. Can proceed in parallel.

---

## 4. Remaining Item 10 — pre-commit hooks for the E2E system

**Current state:** none. No `.husky/`, no `lint-staged`, no `prepare`/`pre-commit`
in `package.json`, `core.hooksPath` unset. The only automation is the manual
`self-heal` npm script.

**Explicitly sequenced:** the card says "*after Marcelo tries it*." This is
blocked on Marcelo exercising the E2E system and giving feedback — do not build
hooks before that, since the hook design (what runs pre-commit: lint + unit only,
or a fast E2E lane?) depends on what proves painful in practice.

**Likely shape once unblocked:** husky + lint-staged running `npm run build`
(forced `tsc`) and `npm test` on staged changes; the full multi-provider E2E
stays manual/CI (too slow and key-dependent for a commit gate).

---

## 5. Recommended sequencing

```
Done ──▶ Phase 4 (item 4a) ──▶ Phase 5 (item 4b)      ← product path, sequential
                                                        (blocked on §2a open UX decisions)

Public template (item 9) ─────────────────────────    ← tooling, parallel, independent

E2E pre-commit hooks (item 10) ── blocked on Marcelo's E2E trial
```

- **Product path (item 4)** is the critical chain and needs the meeting to
  settle the §2a UX decisions *first*; then Phase 4 gets its own bite-sized TDD
  plan (`docs/superpowers/plans/YYYY-MM-DD-v4-phase4-*.md`), then Phase 5.
- **Item 9** can run in parallel — it's tooling, no dependency on the product
  phases.
- **Item 10** stays parked until Marcelo has tried the E2E system.

## 6. Next action

Before turning §2a into a plan, hold the design decisions in §2a.1–3 at the
Support meeting (Roger's mockup + Marcelo's "simplest UI" note are the two poles).
Once the exclusion/required-field UX is settled, this spec's §2a becomes a
standard writing-plans TDD plan; §2b (Phase 5) follows it; §3 (public template)
can be planned independently at any time.
