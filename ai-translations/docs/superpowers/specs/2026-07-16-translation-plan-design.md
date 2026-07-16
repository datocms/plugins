# Translation Plan / Apply — Correctness Architecture

> **Design spec.** Reifies the translation engine's implicit decision-making into
> an explicit, typed **TranslationPlan** (an intermediate representation), and
> makes final correctness a **provable postcondition** checked against that plan
> before any write. This is the correctness spine of v4.0.
>
> **Revision 2 (2026-07-16)** — incorporates a 17-finding adversarial review.
> Key corrections: the **write unit is the record** (one `items.update`), while
> `(record, locale)` is the *decision/report* unit; `buildPlan` absorbs the
> new-locale completeness fill and the model-level `all_locales_required` flag;
> provider-signalled truncation and length-validator are **invariants**; the plan
> has a **single** contract source (`expected`), not parallel arrays.

**Date:** 2026-07-16
**Branch:** `feature/translation-qc`
**Related:** `2026-07-13-v4-unified-translation-design.md` (engine, §8.1 runaway net, §4.1 cannot-be-blank), `2026-07-15-remaining-work.md` (policy UI, out of scope here)
**Chosen approach:** **B — reification refactor.** The plan becomes the engine's backbone; existing checks are re-pointed at it where they exist, and the genuinely new invariants are built.

---

## 1. The problem, and why a plan

**The pain:** customers run an unattended bulk translation and return to
**half-translated records that are impossible to reconcile** — they can't tell
which records/fields are done, partial, or wrong. Everything else in v4.0 serves
one goal: *nothing fails silently, and no run ever leaves a record in a state the
editor can't reason about.*

Today the engine's "plan" is implicit — smeared across `resolveFieldFate`, the
`outcomes` map, and per-field control flow. The code that *does* the translation
and the code that *checks* it are separate, so they can silently disagree.

**The fix:** compute one explicit `TranslationPlan` *before* any provider call,
execute against it, and verify the reconstructed result against **the same
object** before writing. One source of truth for both "what to do" and "what
correct means."

Framings this follows: **plan/apply** (Terraform), **parse-don't-validate** (loose
input → precise typed plan once, at the boundary), a compiler-style **IR**
(decouple intent from provider mechanics), **design-by-contract** (precondition on
the plan, postcondition on the result).

## 2. The reframe: two tiers, two outcomes ("unknown" is a category error)

A deterministic verifier enforces a **contract**. Semantic fidelity (is the
translation *good*) was never in that contract and cannot be, absent a second LLM
judge — which we explicitly reject. A field that passes every structural check has
**passed the only verification that can exist**; calling it "unknown" and blocking
it would define the product's success rate as zero.

So there are **two tiers of checks** producing **two outcomes**:

| Tier | Property | Outcome |
| --- | --- | --- |
| **Invariant** | deterministic; a violation is real corruption, data loss, or a certain CMA rejection | **BLOCK** — the affected `(record,locale)` is never written; loud failure |
| **Heuristic** | fallible signal; a violation is *maybe* wrong | **WRITE + FLAG** — written; loud in the report |

"Nothing fails silently" holds both ways: an invariant violation fails hard; a
heuristic trip is reported hard. **Writing structurally-conformant output is the
product working, not a silent failure.**

This overturns the old blanket "content problems never stop the run" for the
**data-destroying / certain-rejection** classes only. Fallible smells still
write-and-flag.

## 3. Two units: the write unit and the decision unit

This distinction is load-bearing (it was the #1 review finding):

- **Write unit = the record.** Exactly **one `items.update` per record**, carrying
  every target locale that passed, exactly as the engine does today
  (`mergeLocalePayloadInto` → single `client.items.update`). This preserves the
  single optimistic-lock version bump per record.
- **Decision & report unit = `(record, target-locale)`.** Conformance verdicts,
  Blocked/Written buckets, and retry all key on the `(record, locale)` pair —
  the granularity an editor reasons about ("the Italian version of this record").

**How they compose:** `conform` produces a verdict per `(record, locale)`. When
assembling the single per-record payload, a `(record, locale)` unit with **any**
invariant violation contributes **nothing** — its locale is omitted from the
merged payload (never a partial locale). Passing locales are merged and written
together. So one record can end a run with *some* locales Written and *some*
Blocked, from **one** write.

> **CMA constraints that force this shape:**
> - A localized field's locale-object is **replace-not-merge** on `items.update`:
>   omitting a previously-present locale **deletes** it. Every field therefore
>   spreads its full existing locale set and overlays only the target locale(s).
> - **Locale Sync Rule:** adding a *new* locale to a record requires **every**
>   localized field to carry it, or the update 422s with `VALIDATION_INVALID_LOCALES`.
>   → the new-locale **completeness fill** (§5, §6).
> - **`meta.current_version`** is per-record optimistic locking. One write per
>   record ⇒ one version, no self-collision.

## 4. Data flow

```
buildPlan(policy, selection, schema, sourceContent)   →  TranslationPlan     (pure, pre-flight)
        │
        ▼
execute(plan, provider)                               →  raw provider responses (retries, pause, brake)
        │
        ▼
reconstruct(responses, plan)                          →  candidate values, per (record, locale, field)
        │
        ▼
conform(plan, candidate)                              →  Verdict per (record,locale): pass | invariant-violation(s) | heuristic-flag(s)
        │                                                (PRE-SEND — the gate)
        ▼
for each RECORD:
    assemble ONE payload from every (record,locale) unit with zero invariant violations
      (spread existing locales; include the new-locale completeness fill; omit Blocked locales)
    if payload non-empty → client.items.update(record, body + meta.current_version=recordSourceVersion)
        │
        ▼
verifyPersistedWrite(readback, plan)                  →  post-send confirmation (belt-and-suspenders)
        │
        ▼
Report: per (record,locale) → Written(+flags) | Blocked(reason codes, retry) | Not-attempted | Written-unverified
```

## 5. The plan as data

`TranslationPlan` is a typed IR; illegal plans should be unrepresentable
(discriminated unions, factory construction).

```ts
// Matches the engine's existing FieldFate (engine/fieldFate.ts). UI labels
// 'exclude' as "Skip"; the IR keeps 'exclude' to avoid a silent rename.
type Fate = 'translate' | 'copy' | 'exclude';

type CheckId =
  | 'locale-preservation' | 'locale-completeness' | 'cannot-be-blank'
  | 'length-validator' | 'block-structure' | 'block-id-provenance'
  | 'placeholder-preservation' | 'html-structure' | 'md-structure'
  | 'segment-alignment' | 'truncated'                         // ← invariants
  | 'length-ratio' | 'no-op' | 'paragraph-count';             // ← heuristics

// SINGLE source of truth. `expected` holds the contract DATA; `checks` names
// which checks apply and their tier. conform() dispatches each check id against
// `expected` via a registry; the tier decides block vs flag. No parallel arrays
// duplicating the same facts.
interface CheckSpec { id: CheckId; tier: 'invariant' | 'heuristic'; }

interface CellPlan {                                  // one field, one target locale
  fieldPath: string;                                  // schema-resolved, never ctx.field identity
  fieldType: string;
  toLocale: string;
  fate: Fate;
  cannotBeBlank: boolean;                             // cannotBeBlank(validators) — NOT the `required` validator (v4 §4.1)
  checks: CheckSpec[];
  expected: {
    preservedLocales: string[];                       // locales that must survive on this field
    blockSignature?: BlockSignature;                  // modular/structured block count + nesting shape
    htmlBlocks?: TagMultiset;                          // structural block tags — <p> EXCLUDED (heuristic)
    mdBlocks?: MdSignature;                            // structural md blocks — paragraphs EXCLUDED
    placeholders?: string[];                          // ⟦PH_n⟧ tokens that must round-trip
    lengthBounds?: { min?: number; eq?: number; max?: number };  // CMA length/size validators → 422 if violated
    segmentCount?: number;                            // for array/multi-block fields: elements sent == received
    segmentAnchors?: string[];                        // per-segment source id/hash to detect positional drift
  };
}

interface RecordPlan {                                // the WRITE unit
  recordId: string;
  itemTypeId: string;
  fromLocale: string;
  sourceVersion: string;                              // ONE meta.current_version per record (drift fence)
  allLocalesRequired: boolean;                        // item_type.all_locales_required (model flag)
  units: RecordLocaleUnit[];                          // one per target locale (decision/report unit)
}
interface RecordLocaleUnit { toLocale: string; isNewLocale: boolean; cells: CellPlan[]; }

interface TranslationPlan { records: RecordPlan[]; policyDigest: string; }
```

`buildPlan` is pure, runs before any network call, and **absorbs three existing
concerns**, not just `resolveFieldFate`:

1. **Fate** per field from the locked policy (`resolveFieldFate`, incl. its
   auto-split of a required `exclude` → `copy`).
2. **New-locale completeness fill.** When `isNewLocale`, emit a cell for **every**
   localized field of the model (not just translate/copy/selected ones) — copy
   from source, or the `resolveLocaleSyncFallback` value — so the Locale Sync Rule
   is satisfied. This is the current fallback pass (`engine/index.ts:792-829`)
   reified into the plan.
3. **Model constraints.** Read `item_type.all_locales_required`; when true, every
   localized cell is treated as `cannotBeBlank` (force copy-source, never null).

### Invariant catalog (violation → BLOCK the `(record,locale)`)

| CheckId | Guards | Existing? |
| --- | --- | --- |
| `locale-preservation` | no previously-present locale dropped from a field | **new** (spread is only *trusted* today) |
| `locale-completeness` | new locale present on every localized field (Locale Sync Rule) | **new** |
| `cannot-be-blank` | a `cannotBeBlank` field (incl. `all_locales_required`) never empty/null | partial (`validatorChecks`) |
| `length-validator` | length/size bounds that would 422 (min/eq/max) | re-point `checkFieldLength` |
| `block-structure` | modular/structured block **count + nesting** match | **new** |
| `block-id-provenance` | no source-locale block id survives into the target (rebuilt blocks carry no id) | prevention exists (`deepStripBlockIdentifiers`); add as a *verifying* backstop |
| `placeholder-preservation` | every `⟦PH_n⟧` round-trips | re-point placeholder check |
| `html-structure` / `md-structure` | headings, lists, tables, images, hr, blockquote, code fences, links — **structural blocks only** | re-point (see reclassification) |
| `segment-alignment` | array/multi-block fields: element count sent == received, and per-segment anchor matches (catches Anthropic mid-drop positional shift) | **new** |
| `truncated` | provider `finish_reason` = length/max_tokens (deterministic incompleteness) | re-point `checkTruncated` (was error tier) |

### Heuristic catalog (violation → WRITE + FLAG)

- `length-ratio` — script-aware character-fraction smell (one-sided, unbounded above). **Only the ratio smell is heuristic — provider-signalled `truncated` blocks.**
- `no-op` — majority of segments unchanged from source.
- `paragraph-count` — `<p>` / MD paragraph drift. **Reclassified from invariant to heuristic:** LLMs legitimately merge/split paragraphs; this aligns HTML to what `checkMarkdownStructure` already does. Pull `<p>` out of the block-invariant multiset.

## 6. Atomicity, retry, and drift

- **All-or-nothing per `(record,locale)`.** A unit with any invariant violation
  contributes no locale to its record's payload → **Blocked**. Never a partial locale.
- **One version per record.** `sourceVersion` is captured once per record and sent
  as `meta.current_version` on the single write. A genuine external edit mid-run →
  `STALE_ITEM_VERSION` → `source-drifted` (the whole record; re-run picks up the new
  version). No sibling self-collision, because there is one write.
- **Retry caches known-good cells.** The run artifact stores passing cell outputs;
  retry re-calls the provider only for failed cells, re-runs `conform` on the whole
  record, and applies atomically. On retry the record's version is **re-read**
  (safe — it's a fresh snapshot for a fresh write, still guarded by
  `locale-preservation` against dropping anything).
- **Drafts only, never auto-publish.** `items.update` writes draft content;
  "published-with-pending-changes" is the staging layer for free. Publishing is a
  separate, explicit, opt-in bulk action from the report. No auto-publish toggle.

## 7. The report is the product

Persisted (survives a closed tab). Typed outcome model (the *result* half of the
IR, mirroring the plan half; reconciles with the canonical report row model v4
§6.4 already called for — `bulkReport.ts` / `buildTranslationReportRows`):

```ts
type Bucket = 'written' | 'blocked' | 'not-attempted' | 'written-unverified';
type ReasonCode =
  | 'locale-would-drop' | 'locales-incomplete' | 'required-blank'
  | 'length-validator' | 'block-count-mismatch' | 'block-id-leak'
  | 'placeholder-lost' | 'html-block-lost' | 'md-block-lost'
  | 'segment-misalignment' | 'truncated' | 'source-drifted';
interface CellFlag { checkId: CheckId; message: string; }           // heuristic, on Written
interface UnitOutcome {
  recordId: string; toLocale: string; bucket: Bucket;
  reasons: { fieldPath: string; code: ReasonCode; message: string }[];  // Blocked
  flags: CellFlag[];                                                     // Written
  preVersion?: string; postVersion?: string;                            // rollback pointer
}
```

Buckets: **Written** (per-cell heuristic flags + version pair for rollback);
**Blocked** (per-cell reason codes, deep link, "retry these N units" re-runs only
failed cells); **Not-attempted** (runaway brake / abort boundary);
**Written-unverified** (post-send read-back mismatch — the one failure after
mutation; open item §12: auto-retry once vs manual only).

## 8. Runaway abort, reconciled with the tiers

The v4 §8.1 runaway brake (a spend-protection control) counted **error-tier** QC
flags. After the reclassification its input must be redefined:

- The abort rate is computed over **`(record,locale)` decision units** (the new
  atom), with the existing sample-size guard restated in those units.
- A **Blocked** unit **counts** toward the abort rate (an invariant violation is
  the strongest "this run is going wrong" signal). A **heuristic flag on a Written**
  unit does **not** count (off-by-default, as before).
- Because provider-signalled `truncated` is now an **invariant** (§5), the flagship
  "our own `max_tokens` bug" scenario still drives the abort — via Blocked, not via
  a warning. The char-ratio smell (`length-ratio`) does not.

## 9. Relationship to existing code (re-pointed vs net-new)

Honest scoping — not everything is reuse:

**Re-pointed (exists; disposition unified under the plan):** `resolveFieldFate` →
fate; `qc/` `error`→invariant, `warning`→heuristic; `checkFieldLength` →
`length-validator`; `checkTruncated` → `truncated` invariant; placeholder / html /
md structural checks; `verifyPersistedWrite` **stays** as the post-send read-back.

**Net-new subsystems:** `locale-preservation` (the spread is only *trusted* today —
`assertNoLocaleLoss` does **not** exist yet), `locale-completeness`,
`block-structure`, `block-id-provenance`, `segment-alignment`, and the typed
outcome/report model.

**Behavioral change to land honestly:** data-destroying / certain-rejection
invariant violations now **block** the affected locale instead of flag-and-write;
this overturns the old "structural divergence … flag and continue" for those
classes only (the `length-ratio` smell stays a flag).

## 10. Testing strategy

Everything correctness-critical is a pure function, unit-testable with no provider
and no CMA:

- `buildPlan` — fixtures per field type; **new-locale completeness** (skip/unselected
  fields still get cells); `all_locales_required` forces copy over null.
- `conform` — a pass/fail table per check id; explicit cases: merged paragraphs →
  flag not block; provider `finish_reason:length` → block; over-`max` length → block;
  array mid-drop → `segment-misalignment` block.
- Atomicity — a record with one invariant-failed locale writes the *other* locales
  and Blocks that one, from one `items.update`.
- E2E — a poisoned provider response (dropped locale / mid-array drop) lands the
  affected `(record,locale)` in **Blocked**, never a partial write.

## 11. Explicitly NOT doing

No blocking on heuristics; no field-level partial writes (and no partial-locale
writes); no LLM judge in the write path; no auto-publish ever; no "unknown" in the
UI (editors get Written / Blocked / Flagged).

## 12. Scope boundary & open items

**Scope:** the correctness / plan-apply system. Out of scope (own specs, tracked in
`2026-07-15-remaining-work.md`): the locked-policy config UI + styling, the `onBoot`
settings migration, the permission-filtered language list, the per-run picker.
Those *feed* `buildPlan` but do not change this core.

**To pin during planning:**
- `BlockSignature` shape for deeply nested modular/structured content (schema-crawl
  depth cap already exists).
- Where the run artifact persists (plugin parameters vs. downloadable JSON) so the
  report survives a closed tab — reconcile with `BulkTranslationReport` and the
  canonical row model (v4 §6.4).
- `written-unverified`: auto-retry once vs. surface for manual retry only.
- `segment-alignment` anchor: exact id/hash scheme per array/block kind, and whether
  count-equality can be *pinned* (OpenAI/Gemini schema) vs. only *checked* (Anthropic).
