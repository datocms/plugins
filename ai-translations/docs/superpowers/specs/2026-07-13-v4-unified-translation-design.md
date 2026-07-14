# AI Translations v4 — Unified Translation Flow

**Date:** 2026-07-13 · **Rev 4** (2026-07-14 pm: stakeholder decisions folded in — ALL cross-language block matching removed (§4.4); the progress modal becomes the single report surface, sidebar reduced to launcher + status line (§6.1/§6.4); fill-with-source affordance cut to v4.1 (§10); engine gains a true bounded-parallel mode (§2.3); customer-block-id mechanics verified against the API source (§4.4). Rev 3 earlier the same day: second adversarial review, §2.3 re-homing inventory, §6.2/§6.4 corrections.)
**Status:** Approved design — implementation plan in progress
**Scope:** Major version. Every entry point, the engine, the config screen, the E2E seed.
**Background:** [`2026-07-13-field-selection-investigation.md`](./2026-07-13-field-selection-investigation.md)

---

## The plugin, in five sentences

> **Translating makes the target language match the source.**
> **Fields you excluded are left exactly as they are.**
> **We never invent content — we leave the gap and show you, unless your model refuses to save a gap.**
> **Where it refuses, we apply the policy you set — and warn you before we start whenever we can see it coming.**
> **Everything else is a report, never a question.**

Sentence 3 is load-bearing. **The plugin fabricates content in exactly one situation** (§4.0): a model that refuses invalid drafts, where the user chose "use the source." The Formik form always accepts a gap; the CMA accepts one whenever the model has `draft_saving_active`. Everywhere else, we leave the gap and report it.

Sentence 4 is deliberately weaker than "we ask you once": a provider can blank a required field at run time, which we cannot foresee, so there we apply a **pre-set policy** rather than ask.

Sentence 1 has **one declared exception** (§4.5): a field whose existing target blocks we cannot unambiguously match to the source is **left untranslated** and reported, rather than guessed at.

---

## 1. Why a major version

**Three bugs** (verified, with repros — see the investigation):
1. The sidebar **silently discards** frameless-block translations into a locale where the block doesn't exist.
2. Excluding a frameless block in Settings **does nothing** in the sidebar.
3. Unchecking "Modular Content" **doesn't stop** the sidebar translating frameless blocks.

**Three incoherences:**
4. "Exclude" means *skip* at top level but *copy the English in* inside a block.
5. Admin exclusions key on field **id**; the run-time picker keys on **api_key**.
6. The "All fields" chip makes selecting a field **replace** your selection.

**One gap nobody noticed:**
7. A **true frameless block has no *working* field-level translate action.** The parent renders no kebab (the CMS hides it), and scalar sub-fields are gated out by `isLocalized` (`main.tsx:673,678`) — block fields are never localized. (Container sub-fields are the mis-scoped exception: their kebab *does* show actions, against a misreported ctx — §6.2.) Upstream issue #5 was never actually fixed for the dropdown.

All of it shares one root: **the plugin has two translation engines that don't agree.** v4 has one.

---

## 2. Architecture — one engine, two adapters

```
  RECORD CONTEXT                                   BULK CONTEXT
  ctx.formValues                                   CMA items.list (nested: true)
        │ ctx.formValuesToItem()                          │
        ▼                                                 ▼
  ┌──────── NORMALIZE (JSON:API ⇄ simple client shape) ────────┐
  ├──────────────────────── ONE ENGINE ────────────────────────┤
  │  field walk · exclusion · merge · QC flags · locale-sync    │
  └────────────────────────────────────────────────────────────┘
        │ ctx.itemToFormValues()                           │
        ▼                                                  ▼
  ctx.setFieldValue                                  items.update
  (staged — user reviews, then Saves)                (committed)
```

**Use the SDK's own converters.** Hand-rolling form↔CMA conversion is how the original author got burned: a block object missing `itemTypeId` is silently serialised to `null` by `prepareItemPayload.ts:343-347` and **the block is deleted, with no error.**

### 2.1 Converter fine print — all of it load-bearing

- **`itemToFormValues` passes `nestedRecords = []`** (`cms/src/components/sub/plugins/useItemFormAdditionalMethods.tsx`). Any block referenced **by id** throws `MissingBlockRecords` (the error message itself says: use `client.items.rawFind(recordId, { nested: true })`). **Never feed it a CMA item fetched without `nested: true`.** One edge case survives even then: a block model with **zero fields** serialises to a bare id (`prepareItemPayload.ts:77-79` — emitted whenever a block payload has no attributes and an id) and the round-trip throws. Guard it.
- **The CMS bridge drops `skipUnchangedFields` entirely** — its handler is `(formValues) => itemFormContext.formValuesToItem(formValues)`, so `skipFieldValuesIfEqual` is always `undefined`. Two consequences: do not design against the SDK's documented signature; and plugin-initiated conversions are always **full-fidelity** — unchanged fields are never omitted, and (zero-field block models aside) blocks are never bare-id serialised. The engine can rely on receiving complete block payloads.
- **The two paths speak different item shapes.** The converters emit raw JSON:API (`item.relationships.item_type.data.id`); the bulk path uses the simple client shape (fields at top level). The **adapters own a real normalization layer** — it is not free, and it must be unit-tested in both directions.

### 2.2 The write path is NOT unified

The item-form ctx's additional-methods surface is exactly `{toggleField, disableField, scrollToField, setFieldValue, saveCurrentItem, formValuesToItem, itemToFormValues}` — **no reload method** (verified exhaustively against `useItemFormAdditionalMethods.tsx`). A CMA write from inside an open form leaves it stale with no way to reconcile — the editor's next Save clobbers the translation. The record context keeps the **form sink**, which also preserves review-before-save.

**`translateRecordFields.ts` (964 lines) is deleted**, along with `resolveIsFieldLocalized`, `searchFramelessParents`, `searchNestedInLocaleBlock`, `buildFramelessParentsByItemType`.

### 2.3 What the deletion must re-home — the audit the open-questions list asked for

The record path being deleted is not just a field walk; it carries run-control machinery the bulk engine either lacks or gates differently. Rerouting the sidebar through the bulk engine without this inventory would ship a quiet downgrade of the plugin's most-used path.

1. **🔴 Wire `onSystemic` (a `PauseController`), or lose everything at once.** The bulk engine's pacing *and* retry are conditional plumbing: `opts.onSystemic ? translateWithSystemicRetry(...) : await attempt()` (`ItemsDropdownUtils.ts:1498-1504`). A caller that omits it gets a bare attempt — **no pacer gap, no systemic pause, no 429 retry, no content retries**. Today only `TranslationProgressModal.tsx:203-205` wires it. The sidebar reroute MUST.
2. **Cancellation is dual; port both halves.** The record path pairs a useRef-polled `checkCancellation` (gating the scheduler and each job at four checkpoints, incl. a **post-translate, pre-form-write discard point** at `translateRecordFields.ts:228-230`) with an `AbortController` that kills in-flight streams. The bulk engine's `RunGate` is finer between units (records/locales/fields/pre-CMA-write) but the **form sink must keep an equivalent discard point: never write a value whose translation completed after cancel.** Cancel semantics shift, intentionally: bulk's pre-write gate means cancel = nothing persisted for the current record; the form sink writes per field, so cancel mid-record leaves earlier fields staged in the (unsaved) form — matching today's sidebar.
3. **Throughput — DECIDED (stakeholder, 2026-07-14): the engine gains a true bounded-parallel mode, for every flow.** Port the record path's AIMD concurrency scheduler into the unified engine as its provider-call executor: per-vendor slot cap from the existing `getMaxConcurrency` tiers, +1 slot per 3 consecutive successes, halve on 429 (floor 1), the existing inter-launch spacing, `Retry-After` honored, and the `PauseController` pausing *all* slots on a systemic error — the existing rate-limit logic, recomposed around slots instead of a single lane. **Parallelism applies at the field-translation (provider-call) level within a `(record, locale)` unit; records and locales stay ordered** — per-(record, locale) accounting, locale-sync, payload assembly, the §7.2 skip decisions, the runaway guard, and pause semantics are all built on that ordering, and reworking them for cross-record parallelism buys little (the deleted path's parallelism was per-field too). One shared scheduler per run, so bulk cannot multiply concurrency by record count. *(The old pacer's adapt-the-gap behavior becomes the spacing component of the scheduler; the code comment "sequential per-locale to keep within provider rate-limit budgets" describes the design this item replaces.)*
4. **The stall guard exists only in the deleted file.** `translateFieldWithTimeout` races each field call against 300 s so a hung provider call frees its slot. The bulk engine has **none** — sequential means one hung call blocks the entire run forever, and the between-unit gates never fire while the await is pending. Re-home the timeout into the shared attempt path, and tie it to an `AbortController` so the stalled request actually dies (today's `Promise.race` orphans it).
5. **Per-field streaming — DECIDED (stakeholder, 2026-07-14): the chat-bubble streaming UX is dead.** The sidebar becomes a launcher + status line; progress and the report live in the modal (§6.1/§6.4). No `onStream` channel is ported. The engine's existing per-field *outcomes* (`failedFields`, `qcFlags` in the payload result) are all the record-path report adapter needs; click-to-scroll survives as a report-row action signalled back to the sidebar frame (§6.4).
6. **Keep the rAF yield.** The record path awaits `requestAnimationFrame` between translation completion and `ctx.setFieldValue` so up to six concurrent writes don't jank the form. The form sink re-introduces write bursts into the engine's flow; carry the yield (or batch the writes).
7. **The form sink consumes some of the payload machinery and must bypass the rest.** Consume: translated payload, `qcFlags`, failed-field outcomes. Bypass: **locale-sync fallback** (a CMA-write concept — §6.3 shows the form needs none; running it would write fallback nulls into a live form) and **`verifyPersistedWrite`** (there is no persisted write until the user saves — see §6.3 for what form-side verification means instead).
8. **Retry semantics change visibly.** Raw-429 handling goes from 10 silent exponential retries to 3 auto-retries + a manual pause screen (a UX change to document, arguably an upgrade); content-error retries (2×) are gained; the sidebar's two hard-abort fatal errors (DeepL wrong endpoint, OpenAI unverified-stream) normalize to `auth` → systemic → **pausable and resumable** instead of run-killing. Strict improvements, but only with item 1 wired.

---

## 3. Frameless is a view concern

`frameless_single_block` is an `appearance.editor` on the `single_block` field type. Stored value identical to framed. The CMS decides at **render time** and silently falls back to framed unless *all* of: `validators.required` ∧ exactly one allowed block model ∧ no live validation error (`FramelessSingleBlock.tsx:89-95`; `hasErrors` additionally requires the record to be persisted or the field touched, so a never-touched new record stays frameless until then).

Even in true frameless mode the parent still renders its `field--<path>` container div — so `ctx.scrollToField` to the parent path works — and field addons still mount. Only the label and kebab are absent, and `fieldDropdownActions` is never broadcast for the parent path.

**The engine never asks.** A `single_block` is a `single_block`.

`isRenderedFrameless(field)` survives as a **view predicate only** — `editor === 'frameless_single_block' && validators.required && blockModelIds.length === 1`. It is **deliberately approximate**: it cannot see the CMS's live-error condition, so while a record has validation errors the picker/labels may disagree with the screen. That is acceptable — it touches **zero bytes** of the data path, and an editor's mental model shouldn't flip on a transient error.

### 3.1 Block sub-fields are never localized

DatoCMS **422s** `localized: true` on any field of a `modular_block` item type (`api/app/models/field.rb:167,235-242`, unconditional). No back door exists: the validation has run since modular blocks were introduced (2017), `modular_block` cannot be flipped after model creation, and no `update_columns`/`validate: false` path touches `localized` — so no legacy localized block field can exist either. Delete the `isLocalizedField` branch in `processBlockFields` (`TranslateField.ts:935`) — it handles a shape the API refuses to store.

`filterTranslatableFields` keeps its `localized` filter **only** because it lists top-level fields. Pushing that filter into blocks would silently drop every block field.

---

## 4. The exclusion rule

> **An excluded (or deselected) field:**
> 1. **has content in the target already** → left exactly as it is
> 2. **can be blank** → left blank
> 3. **cannot be blank** → **depends on the sink.** See §4.0.

### 4.0 The rule that shapes everything: **never invent content unless the platform forces you to**

Where can a gap be left?

| | Can hold an invalid record? |
| --- | --- |
| **The Formik form** (kebab, sidebar) | **Always.** Nothing is persisted until Save; the CMS surfaces every gap inline and blocks the save. |
| **The CMA** — model with `draft_mode_active` **∧** `draft_saving_active` | **Yes.** `allows_saving_invalid_drafts?` = `draft_mode_active? && draft_saving_active?` (`api/app/models/item_type.rb:277-280`); `Item::Update` **catches** `InvalidButPersistableRecordError` and persists the record flagged invalid (`update.rb:349-350`; same in `create.rb:107-108`). Schema: *"Whether draft records can be saved without satisfying the validations."* An invalid draft **cannot be published** until fixed (`publish.rb:226` blocks while the current version is invalid). |
| **The CMA** — any other model | **No.** 422. `required_on_publish?` is `false` by default (`base_validator.rb`); **only `Unique` defers to publish** (`unique.rb:12-14`). `skip_validations` exists only on `Item::Publish`. Empirically confirmed: `items.update` with `{en: <block>, fr: null}` on a required field → **422 `VALIDATION_REQUIRED`**. |

⚠️ **`draft_saving_active` is forbidden on block models** (`item_type.rb:374-375` — a model validation, so it can never be set) — but the flag that governs a write is the **top-container item type's** (`create.rb:108`, `update.rb:350`), so a record with draft-saving on saves invalid *including its blocks*. The plugin reads both flags off `ctx.itemTypes[id].attributes` (both are serialised — `item_type_serializer.rb:5`).

⚠️ **"Invalid" has a floor even in draft-saving mode.** `InvalidButPersistableRecordError` is raised only when *every* error is a `PersistableApiError` (`validate.rb:294`), and seven validators are `always_enforced?` — the block/link **structural** validators (`rich_text_blocks`, `single_block_blocks`, `structured_text_blocks`, `structured_text_inline_blocks`, `structured_text_links`, `item_item_type`, `items_item_type`). A draft-saving model accepts a *blank* required field; it never accepts a structurally broken block or link payload. Blank-value gaps are always persistable; malformed block assembly never is.

So rule 3 becomes:

| Sink | A `cannotBeBlank` field with no translation |
| --- | --- |
| **Form** | **Leave it blank.** The CMS shows the error; Save is blocked until the editor acts. **We never invent content.** |
| **CMA, draft-saving model** | **Leave it blank** — the record persists as an **invalid draft**, unpublishable until fixed. Reported. *(Chosen via §7's third option.)* |
| **CMA, strict model** | **Must** be filled or the write 422s. Only here does §7's policy apply: *use the untranslated source*, or *skip that language*. |

> **The plugin fabricates content in exactly one situation: a model that refuses invalid drafts, where the user chose "use the source."** Everywhere else it leaves the gap and says so.

*(Rev 4: the one-click "fill them with the English text" report affordance for the form path was **cut from v4** — stakeholder decision, 2026-07-14. The gap + the CMS's own inline errors are the whole story; the convenience button is a v4.1 candidate, §10.)*

### 4.1 "Cannot be blank" ≠ "required"

**DatoCMS enforces `length` independently of `required`** — this repo already got burned by it (commit `9862c3e`; it's in `AGENTS.md`). And links/gallery fields have **no `required` validator at all**; their minimum is `size`, enforced per-locale.

So the predicate is:

```ts
cannotBeBlank(validators) =
     isFieldRequired(validators)          // `required`
  || hasMinItemsValidator(validators)     // `size.min` / `size.eq`  ≥ 1  (links, gallery)
  || hasMinLength(validators)             // `length.min` / `length.eq` ≥ 1
```

`isFieldRequired` and `hasMinItemsValidator` exist in `SharedFieldUtils.ts` today; **`hasMinLength` must be added** (mirror `hasMinItemsValidator` over `validators.length`). The predicate is **complete**: in the Rails source, `length` literally delegates to `Size.call` (nil → size 0 → fails `min/eq ≥ 1` independently of `required`), and every other validator fast-returns valid on a blank value (`format`, `enum`, `slug_format` all do). **Every ban, lock, and pre-flight check in this spec keys on `cannotBeBlank`, never on `required` alone.** The same applies one level down when creating target blocks with excluded sub-fields.

### 4.2 ⚠️ REVERSED: `cannotBeBlank` fields are **excludable**. Do not ban them.

**An earlier draft banned excluding `cannotBeBlank` fields in the admin tree. That was wrong, and it blocked the single most legitimate use of exclusion.**

A brand name. A product code. An SKU. A model name. These are the fields an admin most wants to say *"never translate this"* about — **and they are almost always `required`.** Banning their exclusion means the plugin translates "Nike Air Max" into Italian forever, with no way to stop it.

The ban's original rationale was *"it removes the case where the plugin has to say sorry, we had to put English in it."* But for a brand name **that is not an apology — it is the intent.** There is nothing to be sorry about.

| | Question it answers | `cannotBeBlank` fields |
| --- | --- | --- |
| **Admin config tree** | *"What must **never** be translated?"* | **Excludable**, with an inline consequence hint |
| **Run-time picker** | *"What do I want to translate **now**?"* | **Selectable** — untick freely |

The admin tree **informs** rather than prohibits:

```
  ☐ Title    ⓘ This field can't be left empty. Excluding it means new languages
              will receive the untranslated source text. That's usually what you
              want for brand names and product codes.
```

Locking them in the **picker** would additionally force-include every such field in every run — you could not "re-translate just the body" without also paying for, and **overwriting**, a hand-polished target Title.

So: **both trees allow it.** The consequence is explained at config time, surfaced again by the §7 pre-flight before any spend, and reported afterwards.

### 4.3 Merge, don't rebuild — where pairing is defined

Today `translateBlockValue` clones the **source** block, strips its ids, translates, and overwrites the target — so an excluded sub-field receives the **source text** and hand-edited target content is destroyed. (Worse: the early-return for an excluded or type-disabled sub-field returns the clone *verbatim*, so blocks nested **inside** that sub-field keep their **source block ids** in the target locale — a block id referenced from two locales is invalid, risking a 422 or block reassignment on save. Two defects, one root.)

v4 **merges into the existing target block only where the target is definitionally known** — a `single_block` slot or an explicit kebab path (§4.4 rules 3–4) — preserving its `itemId` and every sub-field we were told not to touch. Block lists are never merged: they rebuild or skip (§4.4 rules 1–2). Where no target block exists (the common case — a new locale), we create it and rules 2/3 apply.

### 4.4 No matching, ever

> **Stakeholder decisions (2026-07-14): no positional diff, and no cross-language block matching of any kind — "minimize the magic; fail loud and fast."** An earlier revision paired blocks "positionally + by type"; rev 3 kept an order-independent type-keyed match for Modular Content; **both are gone.** The plugin never tries to figure out which target block corresponds to which source block.

The whole rule set, in plain words:

1. **Blocks in a list (`Modular Content`, `structured_text`) are never matched across languages.** Re-translating such a field always **rebuilds** the target from the translated source — fresh block instances, exactly mirroring the source. That is manifesto sentence 1 doing its job, not a divergence; no flag.
2. **Exception — fail loud:** if an **exclusion/deselection lives inside** that field's subtree **and the target already has content**, rebuilding would either destroy what the exclusion protects or copy source text into it. We refuse: **skip the field, flag it, touch nothing.**

```
⚠️ Page content (it) was left unchanged — you excluded "Callout → Body" and its
   existing Italian blocks can't be safely rebuilt around that. Nothing was overwritten.
```

3. **A `single_block` field is not matching** — it has exactly one slot, so "which block?" has only one possible answer. When the target slot holds a block of the same type, we merge into it (preserving its `itemId` and excluded sub-fields); a different type is treated like rule 2 (no exclusion inside → rebuild; exclusion inside → skip + flag). *Reviewer's interpretation of "remove all matching," flagged for veto: the single slot involves no correspondence guessing, and killing it would break exclusion-preservation inside frameless blocks — the flagship §1 use case. If you want rebuild-always here too, delete this rule and rule 2 governs.*
4. **The §6.2 kebab is likewise not matching**: the editor points at one concrete block path; the merge target is definitionally known.

On a new locale there is nothing to preserve, so none of this bites — blocks are created fresh and rules 2/3 of §4 apply to excluded sub-fields.

**Why matching died — the same-type reorder problem, generalized.** `[Quote A, Quote B]` reordered to `[Quote B′, Quote A′]` defeats position *and* type signatures; every heuristic short of identity mis-pairs some real edit, and a mis-pair is **silent content corruption** married to the wrong `itemId`. Identity is the only honest signal, and today blocks have none that spans locales.

**The identity fix is real and verified, timing pending (§9.5 q2).** Block ids can never be *shared* across locales — every block is a record with an environment-globally-unique id (`persist_and_replace_ids.rb` rejects an id already in use). But DatoCMS accepts **customer-supplied ids for new blocks** (`api` commit `b7e466f9b`, 2026-05-04, on master), and the format check is purely structural — `rfc4122_random_base64_uuid?` verifies 16 bytes + version-4 nibble + RFC 4122 variant bits, nothing about actual randomness (`lib/public_id.rb:100-110`). So the plugin can *derive* the target block's id deterministically — hash `(source block id, target locale)` into a v4-shaped UUID — and correlation becomes **computation, not matching**: given any source block, the id its Italian sibling *must* have is calculable, and rule 2's skip only remains for blocks that predate the scheme (their random ids carry no derivation — the migration story). Whether this ships in v4 or v4.1 is the open stakeholder call.

### 4.5 One decision table, no hidden modes

The remedy never hinges invisibly on an unrelated admin checkbox — the same table runs for every block-bearing field:

| | No exclusion in subtree | Exclusion in subtree **and** target has content |
| --- | --- | --- |
| **Block lists** (Modular Content, `structured_text`) | **rebuild from translated source** — the normal mode, no flag | **skip the field** + `warning` flag *(we would have to guess)* |
| **`single_block`**, same type in the slot | translate, merge in place | translate, merge, preserve the excluded |
| **`single_block`**, different type in the slot | **rebuild** + `warning` flag *(the editor's target-side choice was discarded)* | **skip the field** + `warning` flag |

**Declared exception to sentence 1 of the manifesto:** in the skip cases, the field's *non-excluded* siblings also go untranslated. The target does **not** match the source, and we say so in the report. That is the price of not guessing; the kebab is the deliberate override (§6.2).

---

## 5. Field selection — one tree, two homes

**Build the tree in-house.** ~350 LOC, **1.65 kB gz** JS + 0.77 kB CSS (+0.6% of the ~286 kB-**gzip** bundle — 986 kB raw JS; be explicit about the measure). `datocms-react-ui` ships **no Checkbox**, so every library still leaves us hand-writing the row DOM, the Canvas-token checkbox, and disabled-with-reason — which **none of them model**. The only thing on sale is tri-state propagation: 89 lines.

Requirements: tri-state with parent↔child propagation; **collapsed to top level by default**; disabled nodes carry a reason; `--color--*` tokens only (light + dark).

**Two traps, mandatory:**
- **The field graph is cyclic.** A block can allow itself; DatoCMS caps nesting at 5 for *content*, not *schema*. Depth cap + visited-set, or the crawl hangs.
- **Value key = field `id`; tree/expansion key = path.** One block item type hangs under many parents. Conflating them gives desynced ghost checkboxes.

### 5.1 Keying — and the migration, right-sized

Admin exclusions **and** per-run selection key on field **`id`** (display label + api_key, as today).

Enforcement today accepts ids *with an api_key fallback* (`isFieldExcluded([id, apiKey, path])`, `main.tsx:195-198`). **Correction (an earlier revision overstated this): the exclusion picker has stored `field.id` since the day it was introduced upstream** (commit `bc842d3b`, 2025-01-08) — no released version ever wrote api_key tokens. The fallback is *defensive*, covering hand-edited plugin parameters and dot-path tokens; the param's misleading name (`apiKeysToBeExcludedFromThisPlugin`) is a misnomer, not evidence of api_key data.

Hand-edited configs still cannot be ruled out, and the collision footgun (a bare `title` matching four fields) is real wherever an api_key token *does* exist:

- **Drop the fallback with no migration** → any hand-edited exclusion silently stops matching, and the plugin starts translating fields an admin explicitly banned. **The worst regression this product can ship.**
- **Keep the fallback** → the collision footgun survives.

So v4 migrates — same mechanism, honestly labelled as defensive normalization rather than a known-data rescue:
1. On config-screen load, run the schema crawl and resolve every non-id token to a field **id**.
2. **Unambiguous** (one match) → rewrite the param silently.
3. **Ambiguous** (`title` matches 4 fields) → surface it: *"`title` matches 4 fields. Which did you mean?"* with checkboxes. Do not guess.
4. Keep the api_key fallback in **enforcement** until the config has been migrated (a `paramsVersion` flag), then drop it.

### 5.2 Excluding a block sub-field is global to that block

A block's sub-field has **one id** regardless of how many parents embed it. Excluding it applies **wherever that block is used** — this must be shown, not discovered:

```
  ▾ ☑ Article
      ▾ ☑ Structured body
          ▾ ☑ Callout block
              ☑ Title
              ☐ Body       ⓘ excluded wherever Callout is used (3 places)
      ☐ Title              ⓘ can't be left empty — excluding it means new
                             languages get the untranslated source text (§4.2)
```

Two enforcement holes in the current engine that v4's single choke point must close, not inherit:

- **A block sub-field whose editor is `frameless_single_block` cannot be excluded today**: `translateFieldValue` short-circuits into `translateFramelessSingleBlockValue` (`TranslateField.ts:860-862`) *before* the `isFieldExcluded` check runs. Its leaves are still individually checkable; the container itself is not.
- **Sub-fields missing from a block's fetched field dictionary default to `fieldId: ''`** (`TranslateField.ts:934-936`), so exclusion for them can only ever match by api_key token — relevant because v4 keys enforcement on ids (§5.1). The engine must guarantee block field metadata is always resolved (it has the schema crawl; there is no excuse for a missing dictionary entry).

### 5.3 One schema crawl, four consumers

Crawled **once per model, cached per session**. It is cheap but **not free** — `AGENTS.md`'s ConfigScreen load-once rule exists because a `loadItemTypeFields` sweep can hit rate limits. Apply the same discipline.

Outputs: (1) the picker tree; (2) `cannotBeBlank` nodes; (3) admin-excluded nodes; (4) which block subtrees contain an exclusion.

**The "All fields" sentinel is deleted** — it conflated a display collapse with an input shortcut. A "Select all" text button replaces it: an action, not a menu option.

---

## 6. Entry points

| Entry point | Behaviour |
| --- | --- |
| **Field kebab** | Direct and minimal. `Translate to → [locale]` / `Translate from → [locale]`. Two clicks, existing locales only. Also the deliberate override for §4.5 divergence. **New: works on block sub-fields — see §6.2.** |
| **Sidebar** | **A dumb launcher + one status line.** Button opens the unified modal (this record, all fields pre-selected); the config resolves, the run executes in the sidebar frame (form sink — §6.1), and **progress + report render in the progress modal**, the single source of truth for every flow (§6.4). The panel shows only a status line afterwards. |
| **Bulk (records table)** | Unified modal, CMA sink. Progress + report in the modal. |
| **Bulk (settings page)** | Same, plus model selection. |

### 6.1 The modal cannot run the record translation — `RenderModalCtx` has no form access

`renderModal.d.ts` gives the modal `parameters` + `resolve` and nothing else. **No `formValues`, no `setFieldValue`, no converters** — those live only on the item-form ctx.

So the **run** must execute in the sidebar frame — that constraint is physics. But **displaying** progress needs no form access, so it does not follow that the report must live in the panel. Stakeholder decision (2026-07-14): **the progress modal is the single progress/report surface for every flow; the sidebar is a dumb launcher.**

The record-path sequence:

1. Sidebar button → config modal (config collector, resolves with the choices — satisfying `AGENTS.md`'s no-nested-modals rule: resolve first, open the next thing from the top-level handler).
2. Sidebar starts the run against the form sink and opens the **progress modal**.
3. The sidebar streams progress into the modal over a **`BroadcastChannel`** — both iframes load the same plugin origin, and the CMS renders plugin frames **unsandboxed** (`PluginFrame.tsx:889-896`, no `sandbox` attribute), so the channel works. The modal displays; it never touches the run.
4. The panel afterwards holds one status line — *"Translated 1 record (15 fields × 3 locales)"*, or *"Completed with warnings — see report"* / *"Failed — see report"* with a button that reopens the report modal from the retained run data.

Closing the progress modal does **not** cancel the run (the run lives in the sidebar); cancel lives in the modal UI but signals over the same channel. Navigating away from the record kills the run exactly as it does today — the status line is not a promise of persistence.

This deletes rev 3's ~300 px compact-layout problem wholesale: no inline-expandable tooltip rework, no stacked footers — the report renders at modal width everywhere.

### 6.2 Block sub-field kebab — the platform offers it; today we *mostly* decline it

**The CMS serves a kebab for block sub-fields today, at every depth** — but not uniformly, and the non-uniformity is load-bearing:

- **Scalar sub-fields** go through `cms/src/utils/propsForBlockField.tsx:49-53`, which builds a fresh `FieldExtra` — `block.blockModelId`, `parentFieldId`, `fieldId` — and `DropdownMenu.tsx` broadcasts `fieldDropdownActions` with `field`, `parentField`, and `block` correctly populated. Framed, frameless, block-in-block, and blocks embedded in structured text alike.
- **Container sub-fields** (`rich_text`/`single_block` fields *inside* a block) **bypass `propsForBlockField`** (`BlockFields.tsx:75-108`; same in structured text's `ComplexField.tsx`): their kebab reuses the **containing context's** `FieldExtra`. So on those kebabs **`ctx.field` is the top-level container field — whose `localized` may be `true` — while `ctx.fieldPath` points inside the block**, and `parentField`/`block` are absent.

**Which breaks the previous revision's story twice:**

1. *"We decline it"* is false for container sub-fields. The v3 gate (`main.tsx:673` on `ctx.field.attributes.localized`) **passes** for those kebabs — ctx.field is the localized top-level field — so v3 already renders Translate to/from there, with a `fieldPath` the execute path was never designed for. An unaccounted live surface, not a cleanly-gated-out one.
2. The proposed v4 gate `ctx.parentField?.attributes.localized` is **inconsistent on exactly the same kebabs**: `undefined` under a top-level block (no actions) but truthy for the same container type inside a structured-text block (actions render).

**The v4 rule therefore cannot key on `ctx.field`/`ctx.parentField` identity at all. Resolve `ctx.fieldPath` against the schema** — walk its segments from the top-level field — and derive everything (the owning block, the sub-field, the localized gate, ST ancestry) from that resolution. It is the only signal the CMS reports correctly on every kebab class.

**And one class is suppressed outright: any sub-field with a `structured_text` ancestor gets no translate actions (`return []`).** Three independent reasons, each sufficient:
- ST block kebabs mount inside `HijackFormik` (`cms/…/SlateInput/elements/Block/HijackFormik.tsx`), whose `setFieldValue` override converts writes to Slate `set_node` ops — a whole-block write at the block path computes an empty first-level key and **silently corrupts the node**. (Its `startsWith(prefix)` test also captures numeric-prefix siblings: a write near `content.en.1` can hit `content.en.10.…`.)
- The value at an ST block path is a **Slate node** (`{type, blockModelId, id, children, …fields}`), not the `{itemId, itemTypeId, …}` shape the whole-block merge writes.
- The path's index segment is a Slate *document child* index, and each locale's ST value is an independent document with different blocks — "same path, swap the locale segment" targets an unrelated or nonexistent node in the target locale. **No cross-locale write target is derivable from the fieldPath.**

Leaf writes *within the current locale* do work under `HijackFormik`, so a same-locale feature is possible later; v4 suppresses and documents.

Consequence today: **a true frameless block has no translate affordance anywhere except the sidebar**, and no block sub-field can be *correctly* translated on its own. (One cosmetic nuance: when no provider is configured, the "configure credentials" dropdown item bypasses every gate and shows even on block sub-fields.)

**v4 closes it uniformly (ST excepted, above), with no leaf writes:**

1. **Gate on the schema-resolved top-level field's `localized`** — the top-level container is where the locale key lives. (`parentField`, where the CMS populates it, resolves to the top-level field, not the immediate block — `parentFieldId: parentExtra.parentFieldId || parentExtra.fieldId` — which corroborates the gate but, per the above, cannot be trusted to be present.)
2. **The write is a whole-block merge at the *block's* path**, which is **`ctx.fieldPath` minus its last segment**:

| | Sub-field `fieldPath` | Block path to write |
| --- | --- | --- |
| Frameless single block | `inline_note.en.title` | `inline_note.en` |
| Modular content | `content_blocks.en.0.heading` | `content_blocks.en.0` |
| Block in a block | `content_blocks.en.0.cards.1.label` | `content_blocks.en.0.cards.1` |
| Structured text at any depth | `content.en.5.heading` | **no write — actions suppressed** |

(`LightFieldArray.tsx:85` builds array items as `${name}.${index}` — dot notation; `BlockFields.tsx:72` appends `.${api_key}`; a non-localized top-level container has no locale segment — `content_blocks.0.heading` — which the schema resolution handles naturally.)

Read the target block, set the one translated sub-field, write **the whole block** back at that path. **Never a leaf write** — a leaf write into a not-yet-materialised block *is* bug #1, and it would otherwise survive v4 through this brand-new surface.

**Precondition (cross-reference §6.3, deliberately load-bearing):** the whole-block write persists only if the target locale is in `formValues.internalLocales` **∩** the user's `localizationScope`. The kebab offers **existing locales only**, which satisfies the first half by construction; the permission half still needs §6.3's mitigations.

3. **The action MAY create the target block — and leaves its invalid siblings empty.**

A block is validated as a unit: each sub-field carries its own validators (`propsForBlockField.tsx:62`) and the payload validates together. So creating an Italian Callout to hold one translated `title` leaves its required `body` empty.

**In the form, that is fine — and it is the right answer** (§4.0). We write `{ itemTypeId, title: 'Titolo' }` into `inline_note.it`, leave `body` empty, and **the CMS's own validation surfaces it inline and blocks Save.** We do *not* fabricate an English `body`. Nothing is persisted; nothing is hidden.

Then **`ctx.scrollToField(fieldPath, targetLocale)`** — which switches the locale tab *and* scrolls — lands the editor directly on the new block with its errors highlighted. They asked for an Italian title; they get an Italian title and an unmissable TODO. ⚠️ This call is safe **only because the kebab targets existing locales** (§6.3): passed a not-yet-enabled locale, `scrollToField` silently *adds* it to `internalLocales` — without populating default values, so every other localized field would serialise `null` in that locale at the next save. The locale restriction is a dependency, not a coincidence. (The scroll itself is best-effort: it runs before the new tab re-renders, so it may not land — acceptable.)

> Nice confirmation from the platform: `FramelessSingleBlock.tsx:89` renders **framed** whenever `hasErrors`. The freshly-created, still-invalid Italian block therefore appears **with its block chrome and a red required field** — not as a bare inline input. The CMS is already designed for this moment.

*"Translate from"* is always safe: it merges into the **current** locale's block, which exists by definition — the user is looking at it.

This is **not a frameless special case** — every block sub-field, at every depth, gets the same treatment, with one carve-out stated once and enforced everywhere: structured-text ancestry suppresses the actions. Framed blocks gain per-sub-field translation too (today they can only be translated whole, via the parent kebab).

### 6.3 Locale scope

`setFieldValue('internalLocales', [...])` **does** register a new locale — `internalLocales` is a `formValues` path, and `prepareItemPayload.ts:397` derives the save payload's locale set from it. (`scrollToField(path, locale)` also adds one as an undocumented side effect, but it switches tabs and scrolls — don't.)

🔴 **`prepareItemPayload.ts:398` then filters that set through `context.localizationScope.locales`, which is permission-derived** (`cms/src/utils/permissions.ts:649-707`). For an editor whose role restricts editable locales, **the locale add and every `field.newLocale` value are silently dropped from the save** — green checkmarks, no error, translation gone. Exactly the silent failure v4 exists to kill.

**Mitigations, all three required:**
1. **Intersect the offered target locales with the user's scope.** `ctx.currentRole.attributes.positive_item_type_permissions[]` carries `localization_scope: 'all' | 'localized' | 'not_localized'` and `locale` — the editable-locale set is computable client-side (mirror `localizationScopeForItem`, `cms/src/utils/permissions.ts:654-707`: `'all'` → all site locales, `'localized'` → the rule's `locale`). This is the *real* defense — the only one that prevents rather than detects.
2. **Verify the write, per sink.** Bulk/CMA: `verifyPersistedWrite.ts` already exists and inspects the `items.update` response — use it; flag loudly if a locale didn't land. Form: **it cannot apply** (there is no update response; nothing persists until Save) — form-side verification means reading back `ctx.formValues` after `setFieldValue` to catch form-level drops; save-time drops are unhookable by a plugin, which is why mitigation 1 carries the weight.
3. **The phase-0 E2E pin must run as a locale-restricted role, not an admin** — an admin run cannot catch this.

**The form path needs NO locale-sync fallback.** `repeatForLocales` (`prepareItemPayload.ts:89-107`) emits a key for **every** locale in `internalLocales`, whether or not the form holds a value — missing values simply serialise to `null`. So adding a locale in the form automatically gives every localized field that locale; `cannotBeBlank` ones then fail validation **visibly, in the form, before Save** (§4.0). That is the desired behaviour, not a bug to paper over.

*(An earlier draft claimed the fallback "must run in the form path too." It must not — and doesn't need to.)*

Locale-sync remains **CMA-only**, where a missing key really does 422.

| Context | Target locales offered |
| --- | --- |
| Sidebar / record modal | any site locale **∩ the user's editable locales** |
| Bulk | same intersection (the CMA also rejects out-of-scope writes server-side, loudly) |
| Field kebab | the record's **existing** locales only — deliberate: adding a locale obliges every *other* localized field to be filled, which is a record-level operation |

### 6.4 One report surface — the modal — fed by two adapters

**History, kept for the audit trail.** Rev 2 claimed "same component, `compact` prop" — refuted (the record path emits per-field `QcFlag`s, not `ProgressUpdate`s; `buildTranslationReportRows` serves only the modal's CSV export while the settings page uses a second, incompatible builder in `bulkReport.ts`; and `TranslationProgressModal`'s mount effect *runs the whole bulk job*, typed to `RenderModalCtx`). Rev 3 answered with a presentational core rendered in two hosts, including a ~300 px compact sidebar layout. **Rev 4 (stakeholder decision): there is only one host.** The modal is the source of truth for progress and reports in every flow; nothing report-shaped renders in the panel.

What remains to build:

- **Split `TranslationProgressModal` into orchestration and display.** Today the modal runs the bulk job itself. In v4 it must also display a run it does *not* own (the sidebar's form-sink run, streamed over the §6.1 `BroadcastChannel`). So: a presentational `TranslationReport` (stats line, row list, export) fed by a run-source abstraction — "my own bulk run" or "a remote channel."
- **One canonical row model.** Reconciling the two existing builders is part of this work, not incidental: pick per-issue rows as canonical (they carry `record/field/locale/severity/checkId/reason`; record-level CSV rows are derivable by grouping, the reverse is not). The engine already emits per-field outcomes and `QcFlag`s in its payload results — the record adapter consumes those; **no streaming-preview channel is needed** (§2.3 item 5).
- `onNavigate` remains the sink-specific bit: bulk `window.open(recordEditorUrl)`; record-path rows signal the sidebar over the channel to `ctx.scrollToField(fieldPath, locale)` (the modal itself has no form access).

**Pinned E2E contract:** `e2e/tests/steps/bulk.ts` regex-parses `.TranslationProgressModal__progress-text` ("of N records"), `.TranslationProgressModal__stats` ("X successful, Y with warnings, Z failed"), `a.TranslationProgressModal__record-link`, the /export csv/i button, and exact-name "Close" gating. Keep those selectors and formats, or migrate the step file **in the same PR**.

---

## 7. The pre-flight — **bulk only**

**The record path has no pre-flight and asks nothing.** It writes to a draft form, so it never has to invent content (§4.0): a `cannotBeBlank` field with no translation is simply left empty, the CMS flags it, and Save is blocked until the editor acts. There is no policy question to ask, because there is no fabrication to authorise.

**The bulk path must ask**, because the CMA rejects an invalid record outright and there is no draft to fall back on.

Before any provider call, cross the schema crawl with **the run's actual selection** and find every field that (a) will **not** be translated — admin-excluded, **deselected in this run**, or its type switched off — and (b) is **`cannotBeBlank`**, and (c) has **no value in a target locale**.

Pure schema + snapshot arithmetic. Costs no tokens.

```
  ┌──────────────────────────────────────────────────────────────────────┐
  │  3 fields can't be left empty and won't be translated                │
  │                                                                      │
  │  Article → Title            excluded by admin                        │
  │  Article → Featured data    JSON translation is turned off           │
  │  Product → Tags             deselected in this run (min 1)           │
  │                                                                      │
  │  What should we do where a target language has no value yet?         │
  │                                                                      │
  │  [ Go back ]  [ Leave them empty ]  [ Skip those languages ]         │
  │                                [ Use untranslated English value ]    │
  └──────────────────────────────────────────────────────────────────────┘
```

- **"Go back"**, not "Cancel" — Cancel is ambiguous (the dialog, or the run?).
- **"Leave them empty"** — the record saves as an **invalid draft**, unpublishable until someone fills the gap. **Offered only when *every* affected model has `draft_mode_active ∧ draft_saving_active`** (§4.0). Otherwise it renders **disabled**, with the reason: *"Article doesn't allow saving invalid drafts."* This is the bulk equivalent of what the form does, and it is the option that invents nothing.
- **"Skip those languages"** — you cannot skip a cannot-be-blank *field* on a strict model; the write 422s. Only the **locale**.
- **"Use untranslated *English* value"** — resolve via `getLocaleName()`. Naming the language is the point: it tells you what is about to land in your Italian record.

### 7.1 The policy is a setting; the dialog is the override

A provider can blank a cannot-be-blank field at run time — **not** foreseeable. If the policy lived only in a dialog shown for *known* conflicts, a clean run would have **no policy** when that happens and we'd invent one.

> **When a field that can't be empty has no translation → ▾**
> • **Leave it empty** *(default where the model allows invalid drafts)*
> • **Use the untranslated source value** *(default otherwise)*
> • Skip that language

The default is **the option that invents the least** and that the model actually permits. On a draft-saving model that is "leave it empty" — identical to what the record path does, and the record is simply unpublishable until fixed. On a strict model that option doesn't exist, so the default falls back to "use the source."

Default "use the source" because in the common case it is **not a failure**: such a field is excluded precisely *because* it's a brand name or product code. Copying it through is the **intent**.

The report keeps the causes apart:

| Cause | Severity |
| --- | --- |
| Excluded/deselected by design | **info** — *"Title kept in English — excluded from translation."* |
| Provider returned nothing | **warning** — *"Title kept in English — the provider returned an empty response."* |

### 7.2 "Skip that language" — build it right, or it deletes data

🔴 **The previous draft's mechanism was wrong and would have destroyed content.**

Every payload entry is the field's **full locale hash** — `{ ...record[field], [toLocale]: value }` (`ItemsDropdownUtils.ts:1545,1601`) — and the server merges at *field* level: a submitted field's locale hash replaces the stored hash wholesale (`update.rb:528`; the only server-side locale merge is `InsertNotEditableLocales`, which reinstates content solely for locales the caller's *role* cannot edit — no protection for a full-access token). "Strip the doomed locale's keys from the merged payload" therefore does one of two catastrophic things, depending on payload shape (`validate.rb:150-198`):

- payload carries **every localized field** (the new-locale case, where locale-sync fills all fields) → the stripped locale is **silently deleted record-wide**;
- payload is **partial** (all targets already existed) → the whole update **422s with `INVALID_LOCALES`** ("removing a locale requires all localized fields present"), losing every translated sibling in that write.

An existing locale absolutely can be doomed: a legacy record with a blank cannot-be-blank field in a locale it already has (invisible to a schema-only pre-flight), or a run-time provider blank.

**Correct mechanism — decide before assembling, never strip after:**

1. The skip decision is **per `(record, locale)`**, not per run. In bulk the same target locale is *new* for record A and *existing* for record B.
2. When locale L is doomed for a record, **no newly-translated or fallback value for L is ever written.** A *new* L appears in no entry at all. An *existing* L's keys — spread from the fetched record value — stay **verbatim**: that spread is what "keeps its original value" means, and it must never be stripped, because the full-hash spread is also load-bearing for *validation* — with a partial payload, each entry's locale set must equal the record's existing set, so an entry shaped `{[toLocale]: value}` alone would 422 even though it deletes nothing.
3. A field whose *only* target was L drops out of the payload entirely; a record whose *every* locale is skipped gets **no `items.update` call at all** (the existing empty-payload guard provides this for free).
4. Locale-sync must likewise not add L.
5. The implementation hooks already exist: skip the per-locale build inside the `toLocales` loop, or discard that locale's payload at the per-field merge (`ItemsDropdownUtils.ts:873/:889`). Either way, **the accounting must record the skipped locale explicitly** — a skipped language the report never mentions is a silent failure with better manners.

⚠️ **Related hazard the run inherits regardless of skips — the stale spread.** Every entry spreads `record[field]` *as fetched at run start*, and the single `items.update` rewrites every locale of every submitted field with those values. A concurrent edit landing mid-run is silently reverted: `ITEM_LOCKED` only fires for an active editing-session lock, and the plugin never sends `meta.current_version`, so the optimistic-lock guard (`STALE_ITEM_VERSION`) is dormant. **Cheap fix, do it in v4: pass `meta.current_version` from the fetched record so a concurrent edit 422s instead of being clobbered**, and surface that 422 as a per-record failure ("record changed while translating — re-run it").

---

## 8. What stops a run

**The plugin never stops a run on its own judgement of content quality.** No heuristic — `no-op` and `length-ratio` fire legitimately on brand names and product catalogs.

**Systemic errors stop it** (existing behaviour, correct): auth, quota, network. Every remaining call is guaranteed waste.

**Content problems never stop it by themselves.** `truncated`, `source-fallback`, structural divergence, ambiguous pairing — all flag, report, and continue. A high truncation rate means *long fields* are failing while short ones succeed; stopping would discard real value to prevent a **flagged, visible, overwritable** outcome.

### 8.1 Runaway failure prevention — and an honest label for it

The residual risk is **money**: a broken overnight run can burn six figures of provider calls.

```
  Runaway failure prevention                          [ On ▾ ]

    Abort the run when the record error rate reaches  [ 50 ]%
    …but only after at least                          [ 50 ] records

    ☐  Count warnings as failures too
       ⓘ Warnings include suspicion-only checks (output identical to the
         source, unusual length) that fire legitimately on brand names and
         product codes. Recommended: leave off.
```

**Be honest about what this is.** A record's `error` status derives from **error-tier QC flags** — `truncated`, `placeholder-loss`, `html-structure`, `markdown-structure`, `length-validator` — which *are* content checks. So this **is** a content-triggered abort. The distinction that matters is not *content vs systemic*; it is:

> **The plugin never decides on its own that your content looks wrong. It enforces a threshold *you* set.**

That is a policy, like §7.1 — not magic. The earlier draft's "nothing content-related ever stops a run" was false and is withdrawn.

- **On by default**, at those numbers. A net that ships off protects nobody, and the case it exists for is the unattended run.
- **Records, not minutes** — but note honestly that **records are not the spend** (50 records of a 100-field model ≠ 50 of a 3-field model). The record count is a **sample-size guard**, not a budget.
- **Errors only.** Counting warnings would let a product catalog abort a healthy run.
- **Abort, not pause.** A paused overnight job helps nobody.

⚠️ **Must not ship before §9.1** — the first thing this net would catch today is our own bug.

---

## 9. Also in scope

### 9.1 Fix the `max_tokens` bug 🔴

```ts
// AnthropicProvider.ts:45 — sent at :174
this.maxOutputTokens = cfg.maxOutputTokens ?? 1024;
// ProviderFactory.ts:218 — never passed
new AnthropicProvider({ apiKey: credentials.apiKey, model: credentials.model });
```

Anthropic is hard-capped at **1024 output tokens (~750 words)**, unconfigurable. Longer fields truncate → `truncated` is **error** severity → **the record fails.** Gemini and OpenAI leave it undefined (no cap), so Anthropic is uniquely broken. Expose it per-vendor with a model-appropriate default.

Two sharpening facts: the bug is **detectable in QC output today**, not silent — Anthropic surfaces `stop_reason` as `finishReason` and the truncation check treats `max_tokens` as a truncation marker, so it manifests as systematic truncation errors on long fields, Anthropic only. And `GeminiProvider` has the **same wiring gap** (its `maxOutputTokens` knob is fully plumbed into every request; only `ProviderFactory` never supplies it — its "unused for now" comment is stale), so the factory fix should cover both vendors in one stroke.

### 9.2 Generalise `length-validator` → deterministic pre-write validation

`checkFieldLength` catches values DatoCMS's `length` validator would 422. **It should catch everything we can deterministically know will be rejected.**

*Instruction for the implementer:* enumerate DatoCMS's validators and implement a check for every one **deterministically decidable client-side** from the translated value + the field's schema. Authoritative source: `~/sites/datocms/api/lib/dato/validator/*.rb`; then the `datocms-cma` skill's `references/schema.md`; then `llms-full.txt`. Anything **not** deterministically decidable (e.g. `unique`, which needs a query) stays out — a false pre-write failure is worse than a real 422.

The inventory (verified against the Rails source, 2026-07-14) shapes the work:

- **Deterministic from value + validator params** — implement: `required` (note its structured-text special case: a lone empty paragraph counts as blank), `length`/`size` (one implementation — `length` *delegates to* `Size.call` in Rails; string length vs array size vs ST text length by field type, `min`/`max`/`eq`/`multiple_of`), `format`/`slug_format` (regex + predefined patterns; blank fast-returns valid), `enum`, `number_range`, `date_range`/`date_time_range`, `title_length`/`description_length` (SEO).
- **Not deterministic client-side** — stay out: `unique` (DB query; also the only `required_on_publish?` validator), `item_item_type`/`items_item_type` (needs referenced items), upload-family validators (need upload metadata), `sanitized_html` (needs sanitizer parity — treat as non-deterministic).
- **Highest-value and often forgotten:** the seven **always-enforced structural validators** (§4.0) can never be unlocked by draft-saving mode, and they are exactly what the plugin's own *block assembly* could violate — a client-side structural check on assembled block payloads (right item types in the right slots) guards against the one 422 class no policy option can absorb.
- **Validators run per-locale** for localized fields; the pre-write check must too.

This feeds `cannotBeBlank` (§4.1) directly.

### 9.3 Dead code

- The `isLocalizedField` branch in `processBlockFields` (`TranslateField.ts:935`) — block sub-fields cannot be localized (422).
- `translateFieldValueDirect` (`TranslateField.ts:1256-1289`) — zero callers left in `src/`; its docstring's claim that `ItemsDropdownUtils.ts` uses it is stale (bulk calls `translateFieldValue` directly), and it passes no `fieldApiKey`, so any future caller would silently get id-only exclusion matching. Delete it before someone believes the docstring.

*(`json-validity` is **NOT** dead — it is emitted at `JsonFieldTranslation.ts:101`, tested at `:138`, and reachable from both flows. The previous draft was wrong.)*

### 9.4 E2E — the suite has never tested a frameless block

`e2e/seed/1-schema.mjs` declares `inline_note` frameless with **no `required`**, so the CMS has rendered it **framed** all along. Every "frameless" assertion has been exercising the framed renderer.

**Seed** (WIP, uncommitted — already in the working tree):
- `article.inline_note` — kept, relabelled, as the **misconfigured** case (frameless editor, no `required` → renders framed). Bug #1 is reachable here.
- New model **`block_variants`** (isolated: a cannot-be-blank localized single_block forces *every locale of every record of its model* to carry a block):
  - `true_frameless` — `required` + one block model → **renders frameless**
  - `pseudo_frameless` — no `required` → **renders framed** (data-loss case)
  - `framed_control` — framed editor, same nullability → the A/B control

**Empirically established** (throwaway fork): `required` **is** enforced per-locale on write (`VALIDATION_REQUIRED` on `<field>.<locale>`). So a true-frameless field can never have a missing target block — **bug #1 is unreachable there, reachable only in the misconfigured case.**

**Tests:**
1. **Rendering contract** — `true_frameless` renders with no field header/kebab; `pseudo_frameless` renders framed despite the frameless editor.
2. **Bug #1 probe** — sidebar-translate into a locale where `pseudo_frameless` is null; assert the block persists. `test.fail()` until the fix lands.
3. **Control** — same for `framed_control`; passes today.
4. **Exclusion semantics** — exclude a block sub-field; translate into a locale that already has content; assert the target value is **preserved**.
5. **`internalLocales` pin** — writing it registers a locale and the save honours it. **Run as a locale-restricted role** (§6.3), not an admin.
6. **Converter round-trip** — `formValuesToItem` → `itemToFormValues` preserves blocks, block ids, and every field type in the seed. Phase 2 depends on this.
7. **Same-type reorder** — a Modular field with 2+ same-type blocks, reordered in the target, with an exclusion inside → assert we **skip and flag**, never mispair (§4.4: repeated types are unpairable by definition now).
8. **`draft_saving_active`** — the seed needs **two** models: one strict (default) and one with `draft_mode_active ∧ draft_saving_active`. Assert that on the draft-saving model, a bulk run with "Leave them empty" **persists an invalid, unpublishable draft**; and that on the strict model the option is **disabled** and the write would 422 (§4.0, §7). ⚠️ **The uncommitted seed edits do not include this model yet** — it is missing work, not done work.

**Three feasibility constraints the plan must design around, not discover:**
- **Test 5's restricted role collides with the suite's single-login architecture** (one dashboard session, one `storageState`). It needs a second authenticated context — a second storageState (or an API-token-scoped path where dashboard login isn't required) — and the E2E docs' teardown/ordering rules apply to it too.
- **Test 6 (converter round-trip) cannot run in Node** — `formValuesToItem`/`itemToFormValues` exist only inside a live plugin iframe with the CMS booted around it. The proof must execute *in the browser*: a test-only surface in the plugin (or a `manual-e2e-*` harness) that runs the round-trip against seeded records and reports the diff.
- **Test 2 uses `test.fail()`** — verify how that interacts with the suite's result-gated teardown before relying on it (a `test.fail()` that "passes by failing" must not hold the env fork alive or mark the run red).

---

## 9.5 Open questions — status after the 2026-07-14 stakeholder round

**Still needing a human decision:**

1. **§4.2's ban reversal.** Plainly: the current proposal lets admins mark *any* field — including required ones — as "never translate"; when such a field then needs a value in a new language, the source text is copied in (per §7's policy). The alternative (the originally-approved rule) forbids marking required fields never-translate, so the plugin always translates them — meaning a required brand-name field gets machine-translated forever. Reviewer's recommendation: adopt the proposal (allow it, with the config-time consequence hint). Awaiting the stakeholder's plain yes/no.
2. **Customer-supplied block ids: v4 or v4.1?** Mechanics verified against the API source (§4.4): ids can never be shared across locales, but the plugin can *derive* each target block's id from `(source id, locale)` as a v4-shaped UUID the format check accepts — correlation becomes computation, and §4.4's fail-loud skip would remain only for pre-scheme blocks. Pulling it into v4 shrinks the skip case dramatically; deferring keeps v4 smaller.
3. **§4.4 rule 3 (single-slot merge) — reviewer's interpretation, open to veto.** "Remove all matching" was applied to block *lists*; the single-block slot merge was kept because one slot involves no correspondence guessing and killing it breaks exclusion-preservation inside frameless blocks. Veto ⇒ delete rule 3; rebuild-or-skip governs everywhere.

**Decided by the stakeholder, 2026-07-14:**

- ~~Block matching~~ — **none, anywhere** ("minimize the magic; fail loud and fast"): lists always rebuild-or-skip (§4.4).
- ~~Sidebar streaming UX~~ — **dead**; the progress modal is the single progress/report surface, the sidebar a launcher + status line (§6.1, §6.4, §2.3 item 5).
- ~~Fill-with-source affordance~~ — **cut from v4**; v4.1 candidate (§4.0, §10).
- ~~Throughput~~ — **build the true bounded-parallel mode** in the engine, per-provider, reusing the existing rate-limit logic (§2.3 item 3).

**Resolved by the rev 3 review:**

- ~~Structured-text merge semantics~~ — mooted: never paired or merged (§4.4).
- ~~Cancellation/concurrency audit~~ — done; obligations in §2.3.
- ~~`compact` report viability~~ — superseded twice over: the claim was refuted, then the second host itself was removed (§6.4).

---

## 10. Explicitly out of scope

- **Customer-supplied block IDs** (§4.4) — the identity fix that turns block correlation into computation. Real, verified. **Timing is §9.5 question 2 — v4 or v4.1.**
- **"Fill with source" one-click affordance** on the record path (§4.0) — cut from v4 by stakeholder decision (2026-07-14). v4.1 candidate.
- **Per-instance block selection**; **path-scoped exclusion** — no demand, new engine plumbing.
- **Language detection** (`franc`/`tinyld`) as a QC check — real dependency. v4.1.
- **"Retry failed"** — re-run scoped to failed `(record, locale)` pairs. v4.1.

---

## 11. Phasing

| # | Phase | Notes |
| --- | --- | --- |
| **0** | **E2E foundations** (§9.4) | Seed fixtures **including the missing draft-saving model**; bug-#1 probe as `test.fail()`; **`internalLocales` pin under a restricted role** (needs a second auth context); **converter round-trip proof** (needs an in-browser harness). Phase 2's safety rests entirely on this. |
| **1** | **`max_tokens` fix** (§9.1) | Hard-blocks phase 6. Small, isolated. **Shippable now as v3.8** — it fails records today. Fix the factory for Anthropic *and* Gemini in one pass. |
| **2+3** | **One engine + the exclusion rule** (§2, §3, §4) | **Must ship together.** Today's leaf-writes accidentally *preserve* target blocks; an engine that rebuilds from source (phase 2 alone) would trade bug #1 for a clobber regression on the very same fields. Fixes bugs #1–#3 and incoherence #4. **The §2.3 re-homing inventory is this phase's checklist** — `onSystemic` wiring, dual cancellation with a form-sink discard point, the stall timeout, the rAF yield, and the **bounded-parallel scheduler (§2.3 item 3, decided)** are acceptance criteria, not nice-to-haves. |
| **4** | **The tree + unified modal + id migration** (§5, §6) | Includes the api_key→id config migration (§5.1), the block sub-field kebab (§6.2), and the **sidebar→modal progress channel + status line** (§6.1/§6.4). |
| **5** | **Pre-flight + policy** (§7) — **bulk only** | Needs phase 4's crawl and phase 3's `cannotBeBlank`. Includes the `draft_saving_active` branch (§4.0) and the "Leave them empty" option. |
| **6** | **Runaway prevention** (§8.1) | Needs phase 1. Otherwise independent. |
| **7** | **Deterministic pre-write validation** (§9.2) | Research-heavy; blocks nothing. Feeds `cannotBeBlank` retroactively. |

Phases 1 and 6 can ship as **v3.8** ahead of v4.

---

## 12. Open risks

| Risk | Mitigation |
| --- | --- |
| Deleting `translateRecordFields.ts` is a big blast radius on the most-used path | Phase 0 lands first; phases 2+3 ship together; §2.3 is the re-homing checklist |
| **Sidebar reroute lands in the engine's degraded no-`onSystemic` branch — no pacing, no retry, silently** | §2.3 item 1: wiring a `PauseController` is an acceptance criterion of phase 2 |
| **A hung provider call blocks a sequential run forever** | §2.3 item 4: re-home the stall timeout, tied to an `AbortController` |
| The bounded-parallel scheduler mis-composes with pause/skip/runaway accounting | §2.3 item 3: parallelism confined to field level within a (record, locale) unit; ordering-dependent machinery untouched |
| The sidebar→modal `BroadcastChannel` breaks if the CMS ever sandboxes plugin iframes | §6.1: verified unsandboxed today (`PluginFrame.tsx:889`); add an E2E pin with the phase-4 work; degrade to the panel status line if the channel dies |
| Converters are unexercised by us; a malformed block **silently nulls** | Phase 0 round-trip proof (§9.4 test 6) + the `nested: true` and zero-field-block guards (§2.1) |
| Role locale scope silently drops writes | §6.3's three mitigations, incl. a restricted-role E2E |
| **Concurrent edits silently reverted by the stale full-hash spread** | §7.2: send `meta.current_version`; surface `STALE_ITEM_VERSION` as a per-record failure |
| **Kebab ctx misreports identity on container sub-fields; ST-embedded writes corrupt Slate nodes** | §6.2: schema-resolve `fieldPath`, never trust `ctx.field`/`parentField` for identity; suppress ST-embedded actions |
| Legacy/hand-edited api_key exclusion tokens stop matching | §5.1 migration with an ambiguity prompt; keep the fallback until migrated |
| Same-type reordering | §4.4: repeated types are unpairable — skip-and-flag; customer-supplied ids in v4.1 |
| Users relied on clobber-on-retranslate | Behaviour change — release notes |
| Cyclic field graph hangs the crawl | Depth cap + visited-set, unit-tested against a self-referential block |
| The runaway net catching our own `max_tokens` bug | §9.1 before §8.1 |
| Report/CSV selectors are a pinned E2E contract | §6.4: keep selectors & stats format, or migrate `bulk.ts` in the same PR |
