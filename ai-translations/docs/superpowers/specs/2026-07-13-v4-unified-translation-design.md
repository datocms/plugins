# AI Translations v4 — Unified Translation Flow

**Date:** 2026-07-13 · **Rev 2** (all 14 findings of the adversarial review folded in)
**Status:** Approved design — implementation plan in progress
**Scope:** Major version. Every entry point, the engine, the config screen, the E2E seed.
**Background:** [`2026-07-13-field-selection-investigation.md`](./2026-07-13-field-selection-investigation.md)

---

## The plugin, in four sentences

> **Translating makes the target language match the source.**
> **Fields you excluded are left exactly as they are.**
> **We never invent content — we leave the gap and show you, unless your model refuses to save a gap.**
> **Where it refuses, we apply the policy you set — and warn you before we start whenever we can see it coming.**
> **Everything else is a report, never a question.**

Five now, because sentence 3 is load-bearing and was missing. **The plugin fabricates content in exactly one situation** (§4.0): a model that refuses invalid drafts, where the user chose "use the source." The Formik form always accepts a gap; the CMA accepts one whenever the model has `draft_saving_active`. Everywhere else, we leave the gap and report it.

Sentence 4 is deliberately weaker than "we ask you once": a provider can blank a required field at run time, which we cannot foresee, so there we apply a **pre-set policy** rather than ask.

Sentence 1 has **one declared exception** (§4.5): a Modular Content field whose target structure we cannot unambiguously match is **left untranslated** and reported, rather than guessed at.

Sentence 1 has **one declared exception** (§4.4): a Modular Content field whose target structure we cannot unambiguously match is **left untranslated** and reported, rather than guessed at.

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
7. A **true frameless block has no field-level translate action at all.** The parent renders no kebab (the CMS hides it), and sub-fields are gated out by `isLocalized` (`main.tsx:673,678`) — block fields are never localized. Upstream issue #5 was never actually fixed for the dropdown. See §6.2.

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

- **`itemToFormValues` passes `nestedRecords = []`** (`useItemFormAdditionalMethods.tsx:157-180`). Any block referenced **by id** throws `MissingBlockRecords`. **Never feed it a CMA item fetched without `nested: true`.** One edge case survives even then: a *zero-field* block model inside structured text serialises to a bare id (`prepareItemPayload.ts:77-79`) and the round-trip throws. Guard it.
- **The CMS wrapper ignores `skipUnchangedFields`** (`useItemFormAdditionalMethods.tsx:146-151` drops the argument). Do not design against the SDK's documented signature.
- **The two paths speak different item shapes.** The converters emit raw JSON:API (`item.relationships.item_type.data.id`); the bulk path uses the simple client shape (fields at top level). The **adapters own a real normalization layer** — it is not free, and it must be unit-tested in both directions.

### 2.2 The write path is NOT unified

The item-form ctx exposes `isFormDirty` and `isSubmitting` but **no reload method**. A CMA write from inside an open form leaves it stale with no way to reconcile — the editor's next Save clobbers the translation. The record context keeps the **form sink**, which also preserves review-before-save.

**`translateRecordFields.ts` (964 lines) is deleted**, along with `resolveIsFieldLocalized`, `searchFramelessParents`, `searchNestedInLocaleBlock`, `buildFramelessParentsByItemType`.

---

## 3. Frameless is a view concern

`frameless_single_block` is an `appearance.editor` on the `single_block` field type. Stored value identical to framed. The CMS decides at **render time** and silently falls back to framed unless *all* of: `validators.required` ∧ exactly one allowed block model ∧ no live validation error (`FramelessSingleBlock.tsx:88-94`).

**The engine never asks.** A `single_block` is a `single_block`.

`isRenderedFrameless(field)` survives as a **view predicate only** — `editor === 'frameless_single_block' && validators.required && blockModelIds.length === 1`. It is **deliberately approximate**: it cannot see the CMS's live-error condition, so while a record has validation errors the picker/labels may disagree with the screen. That is acceptable — it touches **zero bytes** of the data path, and an editor's mental model shouldn't flip on a transient error.

### 3.1 Block sub-fields are never localized

DatoCMS **422s** `localized: true` on any field of a `modular_block` item type (`api/app/models/field.rb:167,235-242`, unconditional). Delete the `isLocalizedField` branch in `processBlockFields` (`TranslateField.ts:935`) — it handles a shape the API refuses to store.

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
| **The CMA** — model with `draft_mode_active` **∧** `draft_saving_active` | **Yes.** `allows_saving_invalid_drafts?` (`api/app/models/item_type.rb:277-281`); `Item::Update` **catches** `InvalidButPersistableRecordError` and persists the record flagged invalid (`update.rb:348-352`; same in `create.rb:108`). Schema: *"Whether draft records can be saved without satisfying the validations."* An invalid draft **cannot be published** until fixed. |
| **The CMA** — any other model | **No.** 422. `required_on_publish?` is `false` by default (`base_validator.rb:21`); **only `Unique` defers to publish** (`unique.rb:12`). `skip_validations` exists only on `Item::Publish`. Empirically confirmed: `items.update` with `{en: <block>, fr: null}` on a required field → **422 `VALIDATION_REQUIRED`**. |

⚠️ **`draft_saving_active` defaults to `false`** (`item_type/upsert.rb:58`) and **must be false for block models** — but the check is on the **top-container item type** (the record's model), so a record with draft-saving on saves invalid *including its blocks*. The plugin reads both flags off `ctx.itemTypes[id].attributes` (both are serialised — `item_type_serializer.rb:5`).

So rule 3 becomes:

| Sink | A `cannotBeBlank` field with no translation |
| --- | --- |
| **Form** | **Leave it blank.** The CMS shows the error; Save is blocked until the editor acts. **We never invent content.** |
| **CMA, draft-saving model** | **Leave it blank** — the record persists as an **invalid draft**, unpublishable until fixed. Reported. *(Chosen via §7's third option.)* |
| **CMA, strict model** | **Must** be filled or the write 422s. Only here does §7's policy apply: *use the untranslated source*, or *skip that language*. |

> **The plugin fabricates content in exactly one situation: a model that refuses invalid drafts, where the user chose "use the source."** Everywhere else it leaves the gap and says so.

To keep the form path convenient without making it magical, the **report offers a one-click affordance**: *"3 fields were left empty because they're excluded from translation. **[Fill them with the English text]**"* — opt-in, visible, reversible. The editor chooses; the plugin doesn't.

### 4.1 "Cannot be blank" ≠ "required"

**DatoCMS enforces `length` independently of `required`** — this repo already got burned by it (commit `9862c3e`; it's in `AGENTS.md`). And links/gallery fields have **no `required` validator at all**; their minimum is `size`, enforced per-locale.

So the predicate is:

```ts
cannotBeBlank(validators) =
     isFieldRequired(validators)          // `required`
  || hasMinItemsValidator(validators)     // `size.min` / `size.eq`  ≥ 1  (links, gallery)
  || hasMinLength(validators)             // `length.min` / `length.eq` ≥ 1
```

All three helpers exist or are trivial (`SharedFieldUtils.ts`). **Every ban, lock, and pre-flight check in this spec keys on `cannotBeBlank`, never on `required` alone.** The same applies one level down when creating target blocks with excluded sub-fields.

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

### 4.3 Merge, don't rebuild

Today `translateBlockValue` clones the **source** block, strips its ids, translates, and overwrites the target — so an excluded sub-field receives the **source text** and hand-edited target content is destroyed.

v4 **merges into the existing target block**, preserving its `itemId` and every sub-field we were told not to touch. Where no target block exists (the common case — a new locale), we create it and rules 2/3 apply.

### 4.4 Pairing — and the honest limits of it

Correspondence is only *needed* where an exclusion/deselection lives inside the subtree **and** the target already has blocks. On a new locale there is nothing to preserve, so no pairing is required.

**Divergence detection runs unconditionally** (see §4.5). What changes with an exclusion is the *remedy*, not the *detection*.

| Field type | Pairing | Ambiguous when |
| --- | --- | --- |
| top-level | trivial | never |
| `single_block` | zero-or-one block — **but the block *types* must match** | source Hero vs target Quote (multi-model fields) |
| `structured_text` | positional + type | as below |
| **Modular Content** | positional + type | **any block type appears more than once in the field** |

**The same-type reorder problem is real and we do not pretend otherwise.** `[Quote A, Quote B]` reordered to `[Quote B′, Quote A′]` has the same count *and* the same type sequence. Positional pairing would marry A's translation to B′'s `itemId` and B′'s preserved excluded sub-fields — **silent content corruption.**

So: **when preservation is required and any block type repeats within the field, correspondence is ambiguous → skip the field and flag it.** We do not guess.

```
⚠️ Page content (it) was left unchanged — its blocks can't be matched to the
   source unambiguously (3 Quote blocks). Nothing was overwritten.
```

This bites only on **re-translating a field that already has blocks, where an exclusion sits inside a repeated block type.** Narrow, and always reversible.

**The permanent fix is parked, not denied.** DatoCMS accepts customer-supplied block ids as of `api` commit `b7e466f9b` (2026-05-04, on master; format-checked only, so deterministic ids pass). Deriving the target block's id from `(source id, locale)` makes correspondence definitional and survives reordering. It carries a migration story (pre-v4 blocks have unrecoverable correspondence). **v4.1.**

### 4.5 Divergence is always detected, never silently rebuilt

Detection runs whether or not an exclusion is present, so behaviour never hinges invisibly on an unrelated admin checkbox:

| | No exclusion in subtree | Exclusion in subtree |
| --- | --- | --- |
| Structures match | translate, merge in place | translate, merge, preserve the excluded |
| **Structures diverged** | **rebuild from source** + `warning` flag *(nothing to preserve)* | **skip the field** + `warning` flag *(we would have to guess)* |

**Declared exception to sentence 1 of the manifesto:** in the skip case, the field's *non-excluded* siblings also go untranslated. The target does **not** match the source, and we say so in the report. That is the price of not guessing; the kebab is the deliberate override (§6.2).

---

## 5. Field selection — one tree, two homes

**Build the tree in-house.** ~350 LOC, **1.65 kB gz** JS + 0.77 kB CSS (+0.8% of a 285 kB bundle). `datocms-react-ui` ships **no Checkbox**, so every library still leaves us hand-writing the row DOM, the Canvas-token checkbox, and disabled-with-reason — which **none of them model**. The only thing on sale is tri-state propagation: 89 lines.

Requirements: tri-state with parent↔child propagation; **collapsed to top level by default**; disabled nodes carry a reason; `--color--*` tokens only (light + dark).

**Two traps, mandatory:**
- **The field graph is cyclic.** A block can allow itself; DatoCMS caps nesting at 5 for *content*, not *schema*. Depth cap + visited-set, or the crawl hangs.
- **Value key = field `id`; tree/expansion key = path.** One block item type hangs under many parents. Conflating them gives desynced ghost checkboxes.

### 5.1 Keying — and the migration the last draft forgot

Admin exclusions **and** per-run selection key on field **`id`** (display label + api_key, as today).

**But enforcement today accepts ids *with an api_key fallback*** (`isFieldExcluded([id, apiKey, path])`, `main.tsx:195-198`), and installed configs in the wild **contain api_key tokens** — that is exactly where incoherence #5's bare `title` comes from.

- **Drop the fallback with no migration** → those exclusions silently stop matching, and the plugin starts translating fields an admin explicitly banned. **The worst regression this product can ship.**
- **Keep the fallback** → the collision footgun survives.

So v4 **must migrate**:
1. On config-screen load, run the schema crawl and resolve every legacy api_key token to a field **id**.
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

### 5.3 One schema crawl, four consumers

Crawled **once per model, cached per session**. It is cheap but **not free** — `AGENTS.md`'s ConfigScreen load-once rule exists because a `loadItemTypeFields` sweep can hit rate limits. Apply the same discipline.

Outputs: (1) the picker tree; (2) `cannotBeBlank` nodes; (3) admin-excluded nodes; (4) which block subtrees contain an exclusion.

**The "All fields" sentinel is deleted** — it conflated a display collapse with an input shortcut. A "Select all" text button replaces it: an action, not a menu option.

---

## 6. Entry points

| Entry point | Behaviour |
| --- | --- |
| **Field kebab** | Direct and minimal. `Translate to → [locale]` / `Translate from → [locale]`. Two clicks, existing locales only. Also the deliberate override for §4.5 divergence. **New: works on block sub-fields — see §6.2.** |
| **Sidebar** | Button opens the unified modal (this record, all fields pre-selected). Modal **collects config only** (§6.1). The run executes in the sidebar frame, form sink, and the report renders in the panel. |
| **Bulk (records table)** | Unified modal, CMA sink. Progress + report in the modal. |
| **Bulk (settings page)** | Same, plus model selection. |

### 6.1 The modal cannot run the record translation — `RenderModalCtx` has no form access

`renderModal.d.ts` gives the modal `parameters` + `resolve` and nothing else. **No `formValues`, no `setFieldValue`, no converters** — those live only on the item-form ctx.

So for the record path the modal is a **config collector**: it resolves with the chosen config, and the **sidebar** runs the translation and renders progress + report in the panel. (This also satisfies `AGENTS.md`'s no-nested-modals rule — resolve first, then open any follow-up from the top-level handler.)

Consequence: progress renders in a ~300 px panel, not a fullWidth modal. **Same component, `compact` variant.** A prop, not a fork.

### 6.2 Block sub-field kebab — the platform offers it; we decline it

**The SDK exposes this today, at every depth.** `cms/src/utils/propsForBlockField.tsx:49-52` builds a `FieldExtra` for every field inside every block — `block.blockModelId`, `parentFieldId`, `fieldId` — and calls `buildRenderLabelDropdown({ fieldPath: name })`; `DropdownMenu.tsx:42` broadcasts `fieldDropdownActions` with `field`, `parentField`, and `blockModel` populated. Framed, frameless, nested — all of it.

**We decline it.** `main.tsx:673` gates every action on `ctx.field.attributes.localized`, which is **always false** for a block sub-field (§3.1's 422 rule). We return `[]`, so no items render. A self-inflicted gate, not a platform limit — upstream issue #5 was fixable in `main.tsx` the whole time.

Consequence today: **a true frameless block has no translate affordance anywhere except the sidebar**, and *no* block sub-field can be translated on its own.

**v4 closes it uniformly, with no leaf writes:**

1. **Gate on `ctx.parentField?.attributes.localized`** — the top-level container *is* localized. (Note `parentField` walks all the way to the **top-level** field, not the immediate block: `parentFieldId: parentExtra.parentFieldId || parentExtra.fieldId`. Correct for the `localized` gate; **useless for deriving a write path** — see below.)
2. **The write is a whole-block merge at the *block's* path**, which is **`ctx.fieldPath` minus its last segment**:

| | Sub-field `fieldPath` | Block path to write |
| --- | --- | --- |
| Frameless single block | `inline_note.en.title` | `inline_note.en` |
| Modular content | `content_blocks.en.0.heading` | `content_blocks.en.0` |
| Block in a block | `content_blocks.en.0.cards.1.label` | `content_blocks.en.0.cards.1` |

(`LightFieldArray.tsx:85` builds array items as `${name}.${index}` — dot notation; `BlockFields.tsx:72` appends `.${api_key}`.)

Read the target block, set the one translated sub-field, write **the whole block** back at that path. **Never a leaf write** — a leaf write into a not-yet-materialised block *is* bug #1, and it would otherwise survive v4 through this brand-new surface.

3. **The action MAY create the target block — and leaves its invalid siblings empty.**

A block is validated as a unit: each sub-field carries its own validators (`propsForBlockField.tsx:62`) and the payload validates together. So creating an Italian Callout to hold one translated `title` leaves its required `body` empty.

**In the form, that is fine — and it is the right answer** (§4.0). We write `{ itemTypeId, title: 'Titolo' }` into `inline_note.it`, leave `body` empty, and **the CMS's own validation surfaces it inline and blocks Save.** We do *not* fabricate an English `body`. Nothing is persisted; nothing is hidden.

Then **`ctx.scrollToField(fieldPath, targetLocale)`** — which switches the locale tab *and* scrolls — lands the editor directly on the new block with its errors highlighted. They asked for an Italian title; they get an Italian title and an unmissable TODO.

> Nice confirmation from the platform: `FramelessSingleBlock.tsx:89` renders **framed** whenever `hasErrors`. The freshly-created, still-invalid Italian block therefore appears **with its block chrome and a red required field** — not as a bare inline input. The CMS is already designed for this moment.

*"Translate from"* is always safe: it merges into the **current** locale's block, which exists by definition — the user is looking at it.

This is **not a frameless special case** — every block sub-field, at every depth, gets the same treatment. Framed blocks gain per-sub-field translation too (today they can only be translated whole, via the parent kebab).

### 6.3 Locale scope

`setFieldValue('internalLocales', [...])` **does** register a new locale — `internalLocales` is a `formValues` path, and `prepareItemPayload.ts:397` derives the save payload's locale set from it. (`scrollToField(path, locale)` also adds one as an undocumented side effect, but it switches tabs and scrolls — don't.)

🔴 **`prepareItemPayload.ts:398` then filters that set through `context.localizationScope.locales`, which is permission-derived** (`cms/src/utils/permissions.ts:649-707`). For an editor whose role restricts editable locales, **the locale add and every `field.newLocale` value are silently dropped from the save** — green checkmarks, no error, translation gone. Exactly the silent failure v4 exists to kill.

**Mitigations, all three required:**
1. **Intersect the offered target locales with the user's scope.** `ctx.currentRole.attributes.positive_item_type_permissions[]` carries `localization_scope: 'all' | 'localized' | 'not_localized'` and `locale` — the editable-locale set is computable client-side.
2. **Verify the persisted write.** `verifyPersistedWrite.ts` already exists. Use it; flag loudly if a locale didn't land.
3. **The phase-0 E2E pin must run as a locale-restricted role, not an admin** — an admin run cannot catch this.

**The form path needs NO locale-sync fallback.** `repeatForLocales` (`prepareItemPayload.ts:89-107`) emits a key for **every** locale in `internalLocales`, whether or not the form holds a value — missing values simply serialise to `null`. So adding a locale in the form automatically gives every localized field that locale; `cannotBeBlank` ones then fail validation **visibly, in the form, before Save** (§4.0). That is the desired behaviour, not a bug to paper over.

*(An earlier draft claimed the fallback "must run in the form path too." It must not — and doesn't need to.)*

Locale-sync remains **CMA-only**, where a missing key really does 422.

| Context | Target locales offered |
| --- | --- |
| Sidebar / record modal | any site locale **∩ the user's editable locales** |
| Bulk | same intersection (the CMA also rejects out-of-scope writes server-side, loudly) |
| Field kebab | the record's **existing** locales only — deliberate: adding a locale obliges every *other* localized field to be filled, which is a record-level operation |

### 6.4 One report component, two hosts

Both flows emit the same `ProgressUpdate` rows with the same `qcFlags`; `buildTranslationReportRows` already serves both. **No second data model ⇒ no second component.**

```tsx
<TranslationReport
  rows={progress}
  groupBy={records.length > 1 ? 'record' : 'field'}
  compact={host === 'sidebar'}
  onNavigate={navigate}        // ← the ONLY sink-specific bit
/>
// bulk:   (row) => window.open(buildRecordEditorUrl(row), '_blank')
// record: (row) => ctx.scrollToField(row.fieldPath, row.locale)
```

**If the difference isn't in the data, don't fork the component.** This plugin already has two of something that should have been one; that is how the five-month drift happened.

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

Every payload entry is the field's **full locale hash** — `{ ...record[field], [toLocale]: value }` (`ItemsDropdownUtils.ts:1545,1601`) — and **the submitted hash is authoritative**. "Strip the doomed locale's keys from the merged payload" therefore:

- **new locale** → harmless (the key wasn't in the snapshot);
- **existing locale** → **deletes that locale's stored content for every field in the payload.**

An existing locale absolutely can be doomed: a legacy record with a blank cannot-be-blank field in a locale it already has (invisible to a schema-only pre-flight), or a run-time provider blank.

**Correct mechanism — decide before assembling, never strip after:**

1. The skip decision is **per `(record, locale)`**, not per run. In bulk the same target locale is *new* for record A and *existing* for record B.
2. When locale L is doomed for a record, **never write L's value into that record's payload at all.** The entry stays `{ ...record[field], [otherLocales]: … }` — so L keeps its original value (or its original absence). Nothing is deleted.
3. A field whose *only* target was L drops out of the payload entirely.
4. Locale-sync must likewise not add L.

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

### 9.2 Generalise `length-validator` → deterministic pre-write validation

`checkFieldLength` catches values DatoCMS's `length` validator would 422. **It should catch everything we can deterministically know will be rejected.**

*Instruction for the implementer:* enumerate DatoCMS's validators and implement a check for every one **deterministically decidable client-side** from the translated value + the field's schema. Authoritative source: `~/sites/datocms/api/lib/dato/validator/*.rb`; then the `datocms-cma` skill's `references/schema.md`; then `llms-full.txt`. Anything **not** deterministically decidable (e.g. `unique`, which needs a query) stays out — a false pre-write failure is worse than a real 422.

This feeds `cannotBeBlank` (§4.1) directly.

### 9.3 Dead code

- The `isLocalizedField` branch in `processBlockFields` (`TranslateField.ts:935`) — block sub-fields cannot be localized (422).

*(`json-validity` is **NOT** dead — it is emitted at `JsonFieldTranslation.ts:101` and tested at `:138`. The previous draft was wrong.)*

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
7. **Same-type reorder** — a Modular field with 2+ same-type blocks, reordered in the target, with an exclusion inside → assert we **skip and flag**, never mispair.
8. **`draft_saving_active`** — the seed needs **two** models: one strict (default) and one with `draft_mode_active ∧ draft_saving_active`. Assert that on the draft-saving model, a bulk run with "Leave them empty" **persists an invalid, unpublishable draft**; and that on the strict model the option is **disabled** and the write would 422 (§4.0, §7).

---

## 9.5 Known-open questions (for the reviewer)

1. **§4.2's ban reversal** was made on the author's judgement *after* the stakeholder had approved the ban. It needs a second opinion: is allowing exclusion of `cannotBeBlank` fields (with an inline consequence hint) right?
2. **§4.4's ambiguity rule** — "skip when any block type repeats and preservation is required" — is conservative. Is it *too* conservative in a project full of repeated Card blocks? Would pulling customer-supplied block ids (`b7e466f9b`) forward into v4 be better than deferring to v4.1?
3. **§4.3 merge for `structured_text`** is under-specified. Blocks live inside a DAST document tree; "positional" may not be coherent there. **This has never been reviewed.**
4. **Cancellation/concurrency.** `translateRecordFields.ts` (deleted by phase 2) carries an adaptive AIMD scheduler and an `AbortController`. Does the bulk engine offer equivalent cancellation for the record path? **What is lost has never been audited.**
5. **The `compact` `TranslationReport`** in a ~300 px sidebar — viable, or hand-waving?
6. **Should the record path also offer the "fill with source" one-click affordance** (§4.0), or is that scope creep?

---

## 10. Explicitly out of scope

- **Customer-supplied block IDs** (§4.4) — the permanent fix for same-type reordering. Real, verified, migration-bearing. **v4.1.**
- **Per-instance block selection**; **path-scoped exclusion** — no demand, new engine plumbing.
- **Language detection** (`franc`/`tinyld`) as a QC check — real dependency. v4.1.
- **"Retry failed"** — re-run scoped to failed `(record, locale)` pairs. v4.1.

---

## 11. Phasing

| # | Phase | Notes |
| --- | --- | --- |
| **0** | **E2E foundations** (§9.4) | Seed fixtures; bug-#1 probe as `test.fail()`; **`internalLocales` pin under a restricted role**; **converter round-trip proof**. Phase 2's safety rests entirely on this. |
| **1** | **`max_tokens` fix** (§9.1) | Hard-blocks phase 6. Small, isolated. **Shippable now as v3.8** — it fails records today. |
| **2+3** | **One engine + the exclusion rule** (§2, §3, §4) | **Must ship together.** Today's leaf-writes accidentally *preserve* target blocks; an engine that rebuilds from source (phase 2 alone) would trade bug #1 for a clobber regression on the very same fields. Fixes bugs #1–#3 and incoherence #4. |
| **4** | **The tree + unified modal + id migration** (§5, §6) | Includes the api_key→id config migration (§5.1) and the block sub-field kebab (§6.2). |
| **5** | **Pre-flight + policy** (§7) — **bulk only** | Needs phase 4's crawl and phase 3's `cannotBeBlank`. Includes the `draft_saving_active` branch (§4.0) and the "Leave them empty" option. |
| **6** | **Runaway prevention** (§8.1) | Needs phase 1. Otherwise independent. |
| **7** | **Deterministic pre-write validation** (§9.2) | Research-heavy; blocks nothing. Feeds `cannotBeBlank` retroactively. |

Phases 1 and 6 can ship as **v3.8** ahead of v4.

---

## 12. Open risks

| Risk | Mitigation |
| --- | --- |
| Deleting `translateRecordFields.ts` is a big blast radius on the most-used path | Phase 0 lands first; phases 2+3 ship together |
| Converters are unexercised by us; a malformed block **silently nulls** | Phase 0 round-trip proof (§9.4 test 6) + the `nested: true` and zero-field-block guards (§2.1) |
| Role locale scope silently drops writes | §6.3's three mitigations, incl. a restricted-role E2E |
| Legacy api_key exclusion tokens stop matching | §5.1 migration with an ambiguity prompt; keep the fallback until migrated |
| Same-type reordering | §4.4 skip-and-flag; customer-supplied ids in v4.1 |
| Users relied on clobber-on-retranslate | Behaviour change — release notes |
| Cyclic field graph hangs the crawl | Depth cap + visited-set, unit-tested against a self-referential block |
| The runaway net catching our own `max_tokens` bug | §9.1 before §8.1 |
