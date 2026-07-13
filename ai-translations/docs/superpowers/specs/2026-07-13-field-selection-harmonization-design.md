# Field Selection Harmonization — Design

**Date:** 2026-07-13
**Status:** Approved, pending implementation plan
**Scope:** `ai-translations` plugin — `ModelFieldPicker` (shared) and the single-record sidebar

## Problem

The plugin exposes four translation pathways. Three of them let the editor choose *which
fields* to translate; one does not, and the picker the other three share actively misleads.

| Pathway | Entry point | Field selection today |
| --- | --- | --- |
| Individual field | `fieldDropdownActions` (`src/main.tsx:639`) | Implicit — the field *is* the selection |
| Whole record | `TranslateSidebar` → `translateRecordFields` | **None.** Button reads "Translate all fields" |
| Bulk, from records table | `itemsDropdownActions` → `AITranslationsPickerModal` | Per-model `ModelFieldPicker` |
| Bulk, standalone page | `AIBulkTranslationsPage` (Settings) | Per-model `ModelFieldPicker` |

### Defect 1 — the picker lies about what it is

`ModelFieldPicker` renders an `ALL_FIELDS_VALUE` sentinel option, and collapses the chip list
to a single "All fields" chip whenever everything is selected (`ModelFieldPicker.tsx:100-104`).

Two consequences, both wrong:

1. The section hint reads *"Defaults to every translatable field. Remove any you want to leave
   alone, per model."* — but in the default state there is exactly one chip ("All fields"), so
   there is nothing to remove. The hint describes an exclusion list; the UI does not offer one.

2. Picking a field from the menu while "All fields" is active **narrows the selection to that
   one field**. `handleChange` (`:114-125`) receives `[AllFields, Title]` from react-select,
   finds `allSelected` already true, skips the expand branch, filters the sentinel out, and
   emits `['title']`. The user reaches for "also translate Title" and lands on "translate
   *only* Title" — `1 of 13 fields selected`.

Root cause: the sentinel conflates a **display collapse** ("render one chip, not 13") with an
**input shortcut** ("select everything"). react-select's multi-value `onChange` cannot
distinguish *"the user just clicked the sentinel"* from *"the sentinel was already in `value`"*,
so the two meanings collide on every pick.

### Defect 2 — the sidebar cannot scope a run

`translateRecordFields` translates every field that clears the *global* gates
(`shouldProcessField`: editor type in `translationFields`, field not in
`apiKeysToBeExcludedFromThisPlugin`). The editor sitting in the record — the person best
placed to say "I only touched the title and the intro" — has no per-run control at all.

## Design

### 1. `ModelFieldPicker` becomes an honest multi-select

Delete `ALL_FIELDS_VALUE`, `ALL_FIELDS_OPTION`, the collapse (`:100-104`), and the narrowing
branch (`:114-122`). What remains is a plain multi-select: options are the model's translatable
fields, `value` is the concrete selected chips, `onChange` passes api_keys straight through.

The default selection is **unchanged** — `defaultFieldSelection` already returns every api_key.
Only the *rendering* changes: 13 chips instead of one lying chip, each with a working `×`.

Because the resolved value was always the full api_key list, **nothing downstream changes.**
`isFieldIncludedInSelection`, `shouldTranslateField`, and the confirm modal's per-model
breakdown are untouched. The sentinel is local to this one file (verified: no other `src/`
reference).

**Escape hatch.** Removing the sentinel costs the one-click path back to "everything" after a
clear. Add a **"Select all"** text button in the hint row, shown only when the selection is
partial:

```
3 of 13 fields selected · Select all
```

It is an *action*, not an option in the menu. That separation is precisely what the sentinel
collapsed, and keeping it is what stops the bug from growing back.

**Hint copy** becomes prop-driven — the bulk surfaces' "per model" wording is wrong in the
single-model sidebar.

The component's docstring already claims it is *"Shared by the bulk page, the records-action
picker modal, and the single-record sidebar"* — aspirational today, true after §2. Its
description of the sentinel goes with the sentinel.

### 2. The sidebar gets the picker inline, in a collapsed `Section`

```
┌─ AI Translations ─────────────────┐
│  From  [ en ▾ ]   To              │
│  [ it ×] [ fr ×] [ de ×]          │
│                                   │
│  ▸ Select fields…        (13/13)  │  ← <Section collapsible>, closed by default
│                                   │
│  [    Translate record        ]   │  ← all selected
└───────────────────────────────────┘

  …editor opens it, removes 10 chips…

│  ▾ Select fields…         (3/13)  │
│  [Title ×] [Intro ×] [SEO ×]      │
│  [   Translate 3/13 fields    ]   │  ← label follows the selection
```

`datocms-react-ui`'s `Section` takes `collapsible={{ isOpen, onToggle }}`; the sidebar holds the
open/closed flag in local state.

**One CTA, label derived from the selection:**

| Selection | Label | Enabled |
| --- | --- | --- |
| All fields | `Translate record` | yes |
| Subset (n of m) | `Translate 3/13 fields` | yes |
| Empty (0 of m) | `Translate 0/13 fields` | **no** |

An empty selection is just the `n of m` case with `n = 0`, so it keeps that label rather than
falling back to `Translate record` — a disabled button must not name an action it would not
perform.

Deliberately **not** a second button opening the bulk modal chain. Bulk writes via CMA
`items.update` — it commits immediately. The sidebar writes via `ctx.setFieldValue` — it stages
changes in the open form for the editor to review and Save. Routing a sidebar button into the
bulk pipeline would put two incompatible write semantics in one panel, leave the open form
holding stale values, and let the editor's next Save clobber the translation. The sidebar keeps
its own flow; only the field scope is new.

### 3. Field universe and allowlist keying

The sidebar picker must list **the same universe the bulk picker lists**: the top-level fields
*owned by this item type*.

```ts
Object.values(ctx.fields)
  .filter((f) => f.relationships.item_type.data.id === ctx.itemType.id)
  → sortFieldsByLayoutOrder → filterTranslatableFields
```

Both helpers already exist in `BulkTranslationHelpers.ts` and are what the bulk surfaces call.
No `loadItemTypeFields` request is needed — `ctx.fields` already holds the schema.

Thread an optional `selectedFieldApiKeys?: string[]` through `TranslateOptions` into
`resolveTranslatableFieldData` (`translateRecordFields.ts:722`), gating each candidate on:

```ts
const ownerApiKey = framelessParentKey ?? fieldApiKey;
if (selectedFieldApiKeys && !selectedFieldApiKeys.includes(ownerApiKey)) return null;
```

**The `??` is load-bearing.** The sidebar's job builder is not field-shaped the way bulk's is:
it *skips* `frameless_single_block` parents (`translateRecordFields.ts:728`) and emits jobs for
their **sub-fields** instead, at paths like `hero.it.headline`. A naive api_key allowlist would
drop every one of those jobs — they are sub-fields, and sub-fields are never on the list.
Mapping each job back to its `framelessParentKey` (already computed by
`findFieldValueAndPathImpl`) makes the single "Hero" chip govern the whole block, which is
exactly how bulk behaves.

Sub-fields of `rich_text` and `framed_single_block` need no special handling: they are
translated recursively *inside* the parent's value, so the parent's chip already governs them.
The frameless case is the only leak, because it is the only one the sidebar hoists to the top
level.

Gating happens **after** `findFieldValueAndPathImpl` (which is what resolves
`framelessParentKey`), not before.

**Keying stays on `api_key`**, matching bulk (`shouldTranslateField` gates on the record's field
key). The global exclusion list keys on field **id** with api_key as fallback — that mismatch
predates this work and is out of scope; we do not touch it.

## Testing

- **Unit — `ModelFieldPicker`** (no test file exists today; add one): removing a chip removes
  exactly that field and nothing else; "Select all" after a clear restores the full set;
  "Select all" is absent when the selection is already complete.
- **Unit — `translateRecordFields`**: with an allowlist, an omitted plain field produces no job;
  an included plain field does; a frameless sub-field survives via its parent's api_key; with
  `selectedFieldApiKeys` undefined, every previously-translated field still translates
  (regression guard for the bulk/legacy callers).
- **Unit — `TranslateSidebar`**: CTA label tracks the selection (`Translate record` ↔
  `Translate 3/13 fields`), and is disabled on an empty selection.
- **E2E**: `e2e/tests/steps/bulk.ts:134-166` encodes the sentinel's narrowing behavior in both
  its comments and its click sequence — update it to the plain-multi-select interaction.

## Out of scope

- The `api_key` (selection) vs field `id` (exclusion) keying mismatch.
- The directionality gap — only the field dropdown offers "Translate **from**" another locale.
- Listing block sub-fields individually in any picker; they continue to ride with their parent.
