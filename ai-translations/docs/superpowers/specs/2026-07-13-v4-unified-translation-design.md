# AI Translations v4 — Unified Translation Flow

**Date:** 2026-07-13
**Status:** Approved design — implementation plan pending
**Scope:** Major version. Touches every entry point, the engine, the config screen, and the E2E seed.
**Background:** [`2026-07-13-field-selection-investigation.md`](./2026-07-13-field-selection-investigation.md) — the research this rests on.

---

## The plugin, in four sentences

> **Translating makes the target language match the source.**
> **Fields you excluded are left exactly as they are.**
> **If something required can't be translated, we ask you once, before we start.**
> **Everything else is a report, never a question.**

If a change can't be justified against those four lines, it doesn't belong in v4.

---

## 1. Why a major version

Five entry points grew independently and now disagree with each other and with the backend.

**The three bugs** (all verified, with repros — see the investigation doc):
1. The sidebar **silently discards** frameless-block translations into a locale where the block doesn't exist yet.
2. Excluding a frameless block in Settings **does nothing** in the sidebar.
3. Unchecking "Modular Content" **doesn't stop** the sidebar translating frameless blocks.

**The three incoherences:**
4. "Exclude" means *skip* for a top-level field but *copy the English text in* for a field inside a block. One checkbox, two incompatible meanings, chosen by nesting depth.
5. The admin exclusion list keys on field **id**; the run-time picker keys on **api_key** — so a bare `title` in the exclusion list can match `title` on every model and every block.
6. The "All fields" chip in the picker makes selecting a field **replace** your selection instead of adding to it.

All six share one root: **the plugin has two translation engines that don't agree.** v4 has one.

---

## 2. Architecture — one engine, two adapters

```
  RECORD CONTEXT                                   BULK CONTEXT
  ctx.formValues                                   CMA items.list
        │ ctx.formValuesToItem()                          │
        ▼                                                 ▼
  ┌──────────────────────── ONE ENGINE ────────────────────────┐
  │  field walk · exclusion · merge · QC flags · locale-sync    │
  └────────────────────────────────────────────────────────────┘
        │ ctx.itemToFormValues()                           │
        ▼                                                  ▼
  ctx.setFieldValue                                  items.update
  (staged — user reviews, then Saves)                (committed)
```

**`formValuesToItem` / `itemToFormValues` already exist on the item-form ctx.** They are DatoCMS's own form↔CMA converters. Do not hand-roll the conversion: a malformed block object is silently serialised to `null` by `prepareItemPayload.ts:343-347` and the block is **deleted** with no error. That hazard is exactly what made the original author defensive; the SDK solved it and we never noticed.

**`translateRecordFields.ts` (964 lines) is deleted.** With it go `resolveIsFieldLocalized`, `searchFramelessParents`, `searchNestedInLocaleBlock`, `buildFramelessParentsByItemType`, and the frameless decomposition.

### Why the write path is NOT unified

The item-form ctx exposes `isFormDirty` and `isSubmitting` but **no reload method**. A CMA write from inside an open record form leaves that form holding stale values with no way to reconcile — the editor's next Save clobbers the translation. So the record context keeps the **form sink**. That also preserves review-before-save, which is a feature, not an accident.

---

## 3. Frameless single blocks — a view concern, not a data concern

`frameless_single_block` is an **`appearance.editor`** on the `single_block` field type. The stored value is byte-identical to `framed_single_block`. Every place the plugin branches on it at the data layer is branching on a CSS choice.

Worse, the CMS decides framed-vs-frameless **at render time** and silently falls back to framed unless *all* of (`validators.required` present) ∧ (exactly one allowed block model) ∧ (no live validation error). The plugin checks only the editor name — so plugin and CMS can **disagree about whether a field is frameless**, which is where bug #1 lives.

**v4: the engine never asks.** A `single_block` is a `single_block`. `translateFieldValue` already routes `frameless_single_block` → `translateBlockValue` (since `5381127`).

`isRenderedFrameless(field)` survives as a **pure view predicate** — `editor === 'frameless_single_block' && validators.required && blockModelIds.length === 1` — used for exactly three things:

- what the **picker** lists (a frameless block's parent field is invisible to the editor; show its sub-fields instead)
- where **`scrollToField`** points
- how a **progress row** is labelled

It touches **zero bytes** of the data path.

**The field dropdown keeps per-sub-field actions.** In true frameless mode DatoCMS renders *no field header and no kebab* on the parent, so `fieldDropdownActions` can only ever fire on sub-fields. That is platform-forced and permanent. It is also the only part of the original workaround that was ever load-bearing.

---

## 4. Exclusion — one rule, every depth

> **An excluded field:**
> 1. **has content in the target already** → left exactly as it is
> 2. **is optional** → left blank
> 3. **is required** → **cannot be excluded**

Rule 3 is what makes the other two honest. Banning the exclusion of required fields removes the only case where the plugin would have to say *"sorry, we had to put English in it."* Required fields render **disabled** in both trees: *"required — can't be excluded."*

### Merge, don't rebuild

Today `translateBlockValue` clones the **source** block, strips its ids, translates, and overwrites the target — so an excluded sub-field receives the **source text** and any hand-edited target content is destroyed.

v4 **merges into the existing target block**, preserving its `itemId` and every sub-field we were told not to touch. Where no target block exists (the common case — a new locale), we create it, and rules 2/3 apply naturally.

### Pairing blocks, and when we can't

Correspondence is only needed **where an exclusion lives inside the subtree.** If nothing in a block is excluded, we rebuild it from the source and nobody cares — that *is* "make Italian match English." The pairing logic runs only where an admin has deliberately excluded something inside a block.

| Field type | Pairing |
| --- | --- |
| top-level | trivial |
| `single_block` | trivial — zero-or-one block |
| `structured_text` | positional |
| **Modular Content** | **positional, verified by block type** |

When a Modular Content structure has **diverged** (different count, different types, editor reordered the target), we cannot know which target block is which. **We do not guess.** We **skip that field**, flag it, and report it:

> ⚠️ *Page content (it) was left unchanged — its block structure differs from the source.*

Skipping is recoverable; rebuilding is not. Prefer the reversible failure.

**The deliberate override is the field kebab**, which is the one place a prompt is affordable because the user is acting on a single field:

```
  ┌────────────────────────────────────────────────────┐
  │  Page content (Italian) has a different block      │
  │  structure than English — 2 blocks vs 3.           │
  │  Translating will rebuild it from English and      │
  │  replace the Italian blocks.                       │
  │                                                    │
  │              [ Cancel ]  [ Rebuild from English ]  │
  └────────────────────────────────────────────────────┘
```

**Not in v4:** derived block IDs. DatoCMS now accepts customer-supplied block ids (`api` `b7e466f9b`, 2026-05-04), which would make correspondence survive reordering. It is a real capability and a real follow-on — it is not needed for the rule above, and it carries a migration story. Park it.

### Block sub-fields are never localized

DatoCMS **422s** `localized: true` on any field of a `modular_block` item type (`api/app/models/field.rb:167,235-242` — unconditional). The `isLocalizedField` branch in `processBlockFields` (`TranslateField.ts:935`) handles a shape the API refuses to store. **Delete it.** `filterTranslatableFields` may keep its `localized` filter *only* because it lists top-level fields; pushing that filter into blocks would silently drop every block field.

---

## 5. Field selection — one tree, two homes

**Build the tree in-house.** ~350 LOC, **1.65 kB gz** JS + 0.77 kB CSS (+0.8% of the 285 kB bundle). Every library on the market (Mantine 23 kB, headless-tree 6.6 kB, react-arborist 34 kB) still leaves us hand-writing the row DOM, the Canvas-token checkbox (`datocms-react-ui` ships none), and disabled-with-reason — which none of them model. The only thing on sale is tri-state propagation: **89 lines.**

Requirements: tri-state checkboxes with parent↔child propagation; **collapsed to top level by default**; disabled nodes carry a reason; styled *only* with `--color--*` semantic tokens (light + dark).

**Two traps, both mandatory:**
- **The field graph is cyclic.** A block can allow itself; DatoCMS caps nesting at 5 levels for *content*, not *schema*. Depth cap + visited-set, or the crawl hangs.
- **Value key = field `id`. Tree/expansion key = path.** One block item type hangs under many parents, so one id legitimately occupies many tree positions. Conflating them produces desynced ghost checkboxes.

### Keying: field `id`, everywhere

Admin exclusions **and** per-run selection both key on field **id** (display label + api_key, as today). This kills the api_key collision footgun.

**Consequence, and it must be shown:** a block's sub-field has one id regardless of how many parents embed it, so excluding it applies **wherever that block is used**.

```
  ▾ ☑ Article
      ▾ ☑ Structured body
          ▾ ☑ Callout block
              ☑ Title
              ☐ Body       ⓘ excluded wherever Callout is used (3 places)
      ☑ Title              🔒 required — can't be excluded
```

### The two homes

| | Admin config screen | Run-time picker (unified modal) |
| --- | --- | --- |
| Question | *"What must **never** be translated?"* | *"What do I want to translate **now**?"* |
| Lifespan | permanent policy | one run |
| Audience | admin who knows the schema | editor |
| Required fields | disabled 🔒 | disabled 🔒 |
| Admin-excluded fields | — | disabled, *"excluded by admin"* |

The **"All fields" sentinel is deleted.** It conflated a display collapse with an input shortcut, which is why picking a field *replaced* your selection. A "Select all" text button in the hint row replaces it — an action, not a menu option.

### One schema crawl, four consumers

Crawl the field tree **once per model** (schema, cached). It produces:
1. the picker tree,
2. which nodes are `required` → disabled,
3. which nodes are admin-excluded → disabled,
4. **which block subtrees contain any exclusion** → the one bit that tells the merge walk whether it needs to pair blocks at all.

---

## 6. Entry points

| Entry point | Behaviour |
| --- | --- |
| **Field kebab** | **Stays direct.** `Translate to → [locale]` / `Translate from → [locale]`. Two clicks. Plus a new **`Translate with options…`** that opens the unified modal pre-scoped to that field. Also the deliberate-override path for structural divergence. |
| **Sidebar** | The panel's button opens the **unified modal**, scoped to this record, all fields pre-selected. The run uses the **form sink** — values are staged, the editor reviews and Saves. Afterwards the panel shows the run summary with clickable field links (`scrollToField`). |
| **Bulk (records table)** | Unified modal, scoped to the selected records. CMA sink. |
| **Bulk (settings page)** | Unified modal, plus model selection. CMA sink. |

**The modal is `width: 'fullWidth'`.** Note the SDK ignores the `title` on fullWidth modals — render our own header (record/model context + locale summary).

Every path shares: the same picker, the same pre-flight, the same QC flags, the same progress rows, the same report. **Only the sink differs.**

### Locale scope differs by context — and must

The form has a fixed set of locales (`ctx.formValues.internalLocales`). `setFieldValue` cannot *add* one — writing `title.it` to a record that has no `it` locale does not register it. So:

| Context | Target locales offered |
| --- | --- |
| **Record** (kebab, sidebar) | **only the record's existing locales.** No new locales. *(This is already today's behaviour — not a regression.)* |
| **Bulk** | any site locale; new locales are **added** via `items.update` + the locale-sync fallback |

The picker must therefore source its locale list from the context, not from a global. This is the one place the two sinks are genuinely not interchangeable, and it is a platform constraint, not a design choice.

---

## 7. The one question we ever ask

At the start of every **record** and **bulk** run, re-crawl the schema and find every **required** field we won't be able to fill:
- excluded **and** required (config drift: someone added `required` *after* the exclusion was set — the config-time ban is a snapshot, and schemas move)
- required, but its field type is switched off globally

This is pure schema arithmetic. It costs nothing and it happens **before a single provider call.**

**The plain kebab is exempt**, and deliberately so: it translates exactly one field, into a locale that already exists, and that field is translatable by definition — the dropdown would not have rendered otherwise. There is no conflict to surface, so there is no dialog. (`Translate with options…` opens the modal and *is* subject to the pre-flight, because it can select more fields.)

```
  ┌──────────────────────────────────────────────────────────────┐
  │  3 required fields can't be translated                       │
  │                                                              │
  │  Article → Title            excluded by admin                │
  │  Article → Featured data    JSON translation is turned off   │
  │  Product → Name             excluded by admin                │
  │                                                              │
  │  DatoCMS won't save a record with these empty. What should   │
  │  we do where a target language doesn't already have a value? │
  │                                                              │
  │  [ Go back ]  [ Skip those languages ]                       │
  │                        [ Use untranslated English value ]    │
  └──────────────────────────────────────────────────────────────┘
```

- **"Go back"**, not "Cancel" — Cancel is ambiguous (the dialog, or the run?).
- **"Skip those languages"** — you cannot skip a *required field*; the write 422s. You can only skip the **locale**. The button must say so.
- **"Use untranslated *English* value"** — resolve the source-language name via `getLocaleName()`. Naming the language is the whole point: it tells you what's about to land in your Italian record.

### The policy is a setting; the dialog is the override

A provider can also blank a required field at runtime — **not** pre-flightable. If the policy only lived in a dialog that appears when we detect a *known* conflict, a run with no known conflicts would have **no policy** when a provider blanks, and we'd invent one. That's the magic we're removing.

So: **a plugin setting with a default**, surfaced and overridable by the pre-flight dialog when it's about to bite.

> **When a required field can't be translated → ▾**
> • **Use the untranslated source value** *(default)*
> • Skip that language

Default **"use the source"** because in the common case it is not a failure at all — a required field is excluded precisely *because* it's a brand name or a product code that must not be translated. Copying it through is the **intent**.

The report keeps the causes apart:

| Cause | Severity | Report line |
| --- | --- | --- |
| Excluded by design | info | *"Title kept in English — excluded from translation."* |
| Provider returned nothing | warning | *"Title kept in English — the provider returned an empty response."* |

### Skipping a locale must not fail the record

The bulk path builds **one payload across all target locales and writes it in a single `items.update`** (`ItemsDropdownUtils.ts:740`). Today one unsatisfiable locale 422s the **whole record**. v4 **drops the doomed locale's keys from the merged payload** before the write — one update, partial success. (`VALIDATION_INVALID_LOCALES` only fires when a locale is *added* incompletely; omitting it entirely is fine.)

---

## 8. Nothing content-related ever stops a run

Only **auth, quota, and network** pause — the existing behaviour, and correct: every remaining call is guaranteed waste.

**No quality circuit breaker.** `truncated`, `source-fallback`, `no-op`, `length-ratio`, structural divergence — all of them flag, report, and continue. A high truncation rate does not mean the run is dead; it means long fields are failing while short ones succeed. Stopping would throw away real value to prevent a **flagged, visible, overwritable** outcome.

And no heuristic may ever stop a run. `no-op` and `length-ratio` fire legitimately on brand names and product catalogs. The plugin does not guess at whether a translation *looks* right.

### Runaway failure prevention (new admin setting)

The residual risk is **money**, not correctness — a broken overnight run can burn ~120,000 provider calls. The answer to a cost problem is a limit **the user sets**, not a guess the plugin makes.

```
  Runaway failure prevention                          [ On ▾ ]

    Abort the run when the record error rate reaches  [ 50 ]%
    …but only after at least                          [ 50 ] records

    ☐  Count warnings as failures too
       ⓘ Warnings include suspicion-only checks (output identical to the
         source, unusual length) that fire legitimately on brand names and
         product codes. Recommended: leave off.
```

- **On by default**, at those numbers. A safety net that ships off protects nobody, and the case it exists for is the unattended run.
- **Records processed, not elapsed minutes.** Records *are* the spend, and the same number doubles as the statistical minimum that stops a 2-record fluke aborting.
- **Errors only.** Counting warnings would let a product catalog abort a healthy run — the plugin guessing at quality, laundered through a setting.
- **Abort, not pause.** A paused overnight job helps nobody; an abort writes the report and stops.

**This must not ship before §9.1.** The first thing the net would catch today is our own bug.

---

## 9. Also in scope

### 9.1 Fix the `max_tokens` bug 🔴

```ts
// AnthropicProvider.ts:45
this.maxOutputTokens = cfg.maxOutputTokens ?? 1024;
// ProviderFactory.ts:218 — maxOutputTokens is never passed
provider = new AnthropicProvider({ apiKey: credentials.apiKey, model: credentials.model });
```

Anthropic translations are hard-capped at **1024 output tokens (~750 words)** with no way to change it. Any longer field truncates → `truncated` is **error** severity → **the record fails.** Expose it per-vendor in the config screen with a sane default for the selected model, and audit the other providers for the same omission.

### 9.2 Generalise `length-validator` → deterministic pre-write validation

`checkFieldLength` catches values that DatoCMS's `length` validator would 422. **It should catch everything we can deterministically know will be rejected.**

*Instruction for the implementing agent:* enumerate DatoCMS's field validators and their exact semantics — `format`, `enum`, `number_range`, `date_range`, `slug_format`, `size`, `required_alt_title`, `image_dimensions`, `unique`, … — and implement a check for every one that is **deterministically decidable client-side** from the translated value plus the field's schema. Sources, in order: `~/sites/datocms/api` (`lib/dato/validator/*.rb` is the authoritative list), then the `datocms-cma` skill's `references/schema.md`, then `https://www.datocms.com/docs/llms-full.txt`. Anything **not** deterministically decidable (e.g. `unique`, which needs a query) stays out — a false pre-write failure is worse than a real 422.

### 9.3 Dead code

- `isLocalizedField` branch in `processBlockFields` (block sub-fields can't be localized — 422).
- `json-validity` in the `QcCheckId` union — declared, never emitted.

### 9.4 E2E — the suite has never tested a frameless block

`e2e/seed/1-schema.mjs` declares `inline_note` frameless with **no `required` validator**, so the CMS has been rendering it **framed** all along. Every "frameless" assertion in the suite tested the framed renderer — including a parent-kebab "Translate to" that real frameless users **can never reach**.

**Seed** (WIP, uncommitted — `1-schema.mjs` already carries these edits):
- `article.inline_note` — kept, relabelled, as the **misconfigured** case (frameless editor, no `required` → renders framed). This is where bug #1 is reachable.
- New model **`block_variants`**, isolated because a `required` localized single_block forces *every locale of every record of its model* to carry a block:
  - `true_frameless` — `required` + one block model → **renders frameless**
  - `pseudo_frameless` — no `required` → **renders framed** (data-loss case)
  - `framed_control` — framed editor, same nullability → the A/B control

**Empirically established** (throwaway fork, read-only elsewhere): `required` **is** enforced per-locale on write (`VALIDATION_REQUIRED` on `<field>.<locale>`). So a true-frameless field can never have a missing target block — **bug #1 is unreachable there, and reachable only in the misconfigured case.**

**Tests:**
1. **Rendering contract** — `true_frameless` renders with no field header/kebab; `pseudo_frameless` renders framed *despite* declaring the frameless editor. Pins the CMS behaviour; fails loudly if DatoCMS changes it.
2. **Bug #1 probe** — sidebar-translate into a locale where `pseudo_frameless` is null; assert the block persists. Mark `test.fail()` until §3 lands, so the suite stays green *and* screams when the bug is fixed.
3. **Control** — same for `framed_control`; must pass today.
4. **Exclusion semantics** — exclude a block sub-field, translate into a locale that already has content; assert the target value is **preserved**, not overwritten with source text.

---

## 10. Explicitly out of scope

- **Derived block IDs** (§4). Real, useful, separate.
- **Per-instance block selection** — *"translate this Hero but not that one."* Needs id-based targeting inside arrays; nobody has asked.
- **Path-scoped exclusion** — *"exclude Callout's body under Structured body but not under Inline note."* Same.
- **Language detection** (`franc`/`tinyld`) as a QC check. Would catch `en → it` returning French. Real dependency; v4.1.
- **"Retry failed"** — re-run a bulk job scoped to the failed `(record, locale)` pairs. Genuinely useful; v4.1.

---

## 11. Phasing

This is too large for one implementation plan. Each phase below is independently shippable and independently verifiable; the ordering is dependency-driven, not preference.

| # | Phase | Why here |
| --- | --- | --- |
| **0** | **E2E seed + frameless fixtures** (§9.4) | Nothing downstream can be *proven* until the suite can produce a real frameless block. Phase 2 deletes the most-used code path in the plugin; this is the only safety net we'll have. Bug #1's probe lands as `test.fail()`. |
| **1** | **`max_tokens` fix** (§9.1) | Hard-blocks phase 6 — the runaway net would otherwise catch our own bug. Small, isolated, ships alone. |
| **2** | **One engine** (§2, §3) | Delete `translateRecordFields.ts`; route the record path through the SDK converters + form sink. **Fixes bugs #1, #2, #3.** Phase 0's `test.fail()` should flip to passing — remove the annotation. |
| **3** | **The exclusion rule** (§4) | Merge-don't-rebuild; required-field ban; positional pairing; skip-and-flag on divergence. Depends on phase 2's single engine. |
| **4** | **The tree + unified modal** (§5, §6) | Build the tree; unify the modal; switch selection to field `id`; delete the "All fields" sentinel. Depends on phase 3's semantics being settled. |
| **5** | **Pre-flight + policy setting** (§7) | Needs phase 4's schema crawl and phase 3's required-field ban. |
| **6** | **Runaway failure prevention** (§8) | Needs phase 1. Independent of everything else. |
| **7** | **Deterministic pre-write validation** (§9.2) | Pure addition to the QC layer. Can land any time after phase 2; sequenced last because it's research-heavy and blocks nothing. |

Phases 1 and 6 could ship as a **v3.8 patch** ahead of the v4 work if the `max_tokens` bug is judged urgent — it fails records today.

---

## 12. Open risks

| Risk | Mitigation |
| --- | --- |
| Deleting `translateRecordFields.ts` is a big blast radius on the most-used path | Land §9.4's E2E fixtures **first**; they are the only proof we have that the record path works |
| `formValuesToItem` / `itemToFormValues` are unexercised by us | Prove them in E2E before relying on them; a malformed block silently nulls with no error |
| Users may rely on the current clobber-on-retranslate behaviour | Behaviour change — call it out in the release notes |
| The cyclic field graph can hang the crawl | Depth cap + visited-set, unit-tested against a self-referential block |
| The runaway-abort net catching our own `max_tokens` bug | §9.1 lands before §8's setting |
