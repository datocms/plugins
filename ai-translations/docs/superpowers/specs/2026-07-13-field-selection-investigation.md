# Field Selection in AI Translations — Investigation & Options

**Date:** 2026-07-13
**Status:** For team discussion — no decision made
**Supersedes:** `2026-07-13-field-selection-harmonization-design.md` (written before this research; its diagnosis was wrong — see §3)

---

## TL;DR

We set out to fix a confusing dropdown. We found a bug that silently throws translations away.

Three things, in order of how much they should worry us:

1. **The sidebar loses translations.** When it translates a "frameless" block into a locale that doesn't have that block yet — the normal case — the result is silently discarded on save. No error, no warning, green checkmarks all the way. *Confirmed in code; needs one E2E test to prove it end to end.*
2. **The plugin disagrees with the backend about what a block is.** It treats "frameless" as a different kind of data. The backend says it's a skin — the same field type with a different appearance. All three of our bugs trace to that one wrong belief.
3. **The field picker lies to the user.** The "All fields" shortcut makes picking a field *replace* your selection instead of adding to it. That's the bug that started this whole investigation, and it's the least serious thing we found.

We also found that "exclude this field" quietly means **two different things** depending on whether the field is inside a block, and no user could possibly guess which one they're getting.

None of this is anyone's mistake. The code was correct when it was written. The platform moved, our own refactor moved, and nobody noticed the ground had shifted underneath.

---

## 1. How the plugin works right now

There are **five** places a user can influence which fields get translated. Most of us thought there were three.

| Where | Who uses it | What they choose | Sees inside blocks? |
| --- | --- | --- | --- |
| **Field menu** (kebab on a single field) | Editor | Nothing — the field *is* the choice | Yes, implicitly |
| **Sidebar** (open record) | Editor | Nothing. "Translate all fields" | No |
| **Bulk from the records list** | Editor | Source + target locales, **and which fields, per model** | No |
| **Bulk page** (Settings → AI Translations) | Editor/admin | Same, plus which models | No |
| **Config screen** → "Fields excluded from translation" | Admin, once | A permanent blocklist | **Yes** — lists every field of every block |

Two of these are per-run choices ("just this once, only translate the title"). One is permanent policy ("never translate internal notes, ever"). They were built at different times, for different people, and **they do not talk to each other**:

- The per-run pickers store field **api_keys**. The permanent blocklist stores field **ids**.
- The per-run pickers show a model's **top-level fields only**. The blocklist shows **everything, including fields inside blocks**.
- Neither knows the other exists.

That split is actually reasonable — it's just never been explained to anyone. More on that in §5.

### The bug that started this

In the bulk picker, when every field is selected (the default), the UI collapses all the chips into a single chip that says **"All fields."** Then, if you open the menu and click *Title*, you don't get "all fields plus Title" — you get **only Title**. `1 of 13 fields selected`.

The hint above the box says *"Remove any you want to leave alone"*, which describes an exclusion list. The widget behaves like a replace-what-you-picked list. Both can't be true.

Why it happens: the "All fields" chip is doing two jobs at once — it's a *display shortcut* ("show one chip, not thirteen") **and** an *input shortcut* ("select everything"). The underlying select control can't tell those apart, so they collide on every click. Delete the shortcut and the ambiguity dissolves. Nothing downstream changes, because the selection was always stored as the full list of fields anyway — the chip was only ever a rendering trick.

---

## 2. Does the plugin match the actual backend schema?

We checked against three independent sources: the DatoCMS Rails backend, the admin frontend, the public docs and skills, plus a live read-only inspection of our own E2E project.

### ✅ What we get right

**Per-locale blocks.** When a Modular Content or Single Block field is localized, each language holds its *own independent copy* of the blocks — different block records, different IDs. We handle this correctly. (Verified live: the same field on one record has block `f2Jr6E…` in English and `VCffCW…` in German.)

### ❌ What we get wrong

**"Frameless" is not a data model. It's a skin.**

DatoCMS has one field type here: `single_block`. "Framed" and "frameless" are two *appearances* of it — the same way bold and italic are two appearances of text. The backend proves this three times over:

- The field-type registry lists `single_block`. There is no frameless field type.
- `Dato::Editor::FramelessSingleBlock` is **an empty class with no settings at all.**
- Searching the entire backend, `appearance` appears **only** in schema-editing code — **zero** hits in anything that saves, validates, or serialises a record.
- Live check: a framed and a frameless field on the same model have **identical JSON** except for the editor name.

Our plugin, meanwhile, branches on frameless at the *data* layer. It is making storage decisions based on a CSS choice.

**Fields inside blocks cannot be localized. We have code that assumes they can.**

The backend rejects it with a 422 — an unconditional validation, no exceptions, and blocks can't be converted to models after creation so there's no back door. There's even an old migration named `fix_bug_modular_localized_fields` that cleaned up rows from before the rule existed. The docs say it in one line: *"Block fields per se cannot be localized."* The skills file it under **"Platform rules, not preferences."** Every block field in our E2E project: `localized: false`. All fifteen of them.

We have a whole branch handling the shape the backend refuses to store.

### Why the code looks like this — and it's a good reason

This isn't carelessness. Frameless blocks render *no field header*, so there's no kebab menu, so **there was no translate button at all** — the block was simply untranslatable. Two users reported it. Marcelo fixed it, and wrote down exactly what he was doing:

> *"now you should be able to translate the fields inside the block just like if there where no block at all (but not the whole block at once unfortunately)"*
> — [issue #5](https://github.com/marcelofinamorvieira/datocms-plugin-ai-translations/issues/5), 2025-10-24

That parenthetical is the entire design. And **it was correct at the time** — the engine genuinely could not translate a frameless block as a unit back then; `modularContentVariations` was `['framed_single_block']` and the engine's switch had no frameless case, so a whole block would have fallen through to `default:` and been fed to the AI as if it were prose.

| When | What | Link |
| --- | --- | --- |
| 2025-06-10 | Issue #5 — *"there is no translate button that is visible, which makes it untranslatable"* | [#5](https://github.com/marcelofinamorvieira/datocms-plugin-ai-translations/issues/5) |
| 2025-11-20 | Issue #11 — record-level translation still skips frameless fields | [#11](https://github.com/marcelofinamorvieira/datocms-plugin-ai-translations/issues/11) |
| 2025-11-20 | **`3e78bbb` — the workaround.** One file (`translateRecordFields.ts`, +121/−31): skip the frameless parent, hoist its sub-fields, write leaf paths. Shipped as v2.2.1. | [3e78bbb](https://github.com/marcelofinamorvieira/datocms-plugin-ai-translations/commit/3e78bbb2c074b1e5a6f39a76f1406ce0fd4223a6) |
| 2026-02-25 | **`5381127` — the proper fix.** Adds `frameless_single_block` to `modularContentVariations` *and* to the engine switch, plus `translateFramelessSingleBlockValue`. The engine can now translate the block whole. Commit body: empty. Subject: *"Refactor ai-translations."* | [plugins#134](https://github.com/datocms/plugins/pull/134) |

**The supersession was never noticed.** `5381127` also touched `translateRecordFields.ts` — and *improved* the workaround, adding a `framelessParentsByItemType` lookup map to make the sub-field hunt faster. The same commit built the proper fix and invested in the thing the proper fix made unnecessary. Nobody was choosing to keep both roads; nobody saw there were two.

**Is the workaround dead code? No — and that's the problem.** Dead code is harmless. This runs on *every* sidebar translation. It is **obsolete, not dead**: the constraint that justified it vanished in February 2026, but it kept executing, and it is the direct cause of all three bugs below. We now ship **two implementations of the same feature** — bulk/kebab/nested go through the engine ✅, the sidebar goes through the workaround ❌ — and we've been maintaining the wrong one for nearly five months. Nothing in any commit, PR, changelog, or Basecamp thread records this. The only surviving explanation of *any* of it is that one sentence in issue #5.

### What that costs us — three real bugs

All three were independently verified by adversarial review, with step-by-step repros against our own E2E seed schema.

| # | Bug | Severity |
| --- | --- | --- |
| 1 | **Sidebar silently discards frameless-block translations** into a locale where the block doesn't exist yet. It writes the translated text into a half-built block with no type marker; on save, the CMS sees a malformed block and stores `null`. The translation vanishes. This is the *normal* path — it's what happens when you translate into a new language. | 🔴 **Data loss** |
| 2 | **Excluding a frameless block in Settings does nothing in the sidebar.** The admin's blocklist is silently ignored. (Bulk honours it correctly.) | 🟠 Setting ignored |
| 3 | **Unchecking "Modular Content" in Settings doesn't stop the sidebar** translating frameless blocks either. (Bulk honours it correctly.) | 🟠 Setting ignored |

There's a bitter irony in #1: the decomposition was almost certainly done *defensively*, to avoid writing a malformed block. Writing the leaves individually lands in **the exact same trap**, from the other side. The workaround and the hazard are the same bug.

**All three disappear if the sidebar does what the bulk path already does:** treat the block as one unit and let the engine handle it. That also deletes ~120 lines of machinery whose only purpose was to support the workaround.

---

## 3. The thing nobody has noticed: "exclude" means two different things

This is the most important finding for the UI discussion, and it has nothing to do with frameless blocks.

**Exclude a normal field** → we skip it. Whatever was in the Italian version stays there, untouched.

**Exclude a field inside a block** → we copy the English text into it.

Not a bug — a consequence of how blocks work. The Italian block gets built from the English one, and a block can't have a missing field. So an "excluded" sub-field has to contain *something*, and what it contains is the source text.

So today, one checkbox list gives you either **"leave it alone"** or **"copy it over in English"**, and which one you get depends on how deeply nested the field is. No editor could possibly predict that. We don't warn them. We don't even document it.

**Related, and just as unadvertised:** translating a Modular Content field *replaces* the target language's blocks entirely. If someone hand-tuned the Italian hero block, translating the record throws their work away. There is no merge.

### The good news: we can fix this without inventing anything

The plugin **already has** the right rule — it just doesn't apply it inside blocks. When a normal field is excluded and the target language is brand new, we fill it with the source value if the field is required, or leave it empty if it's optional.

Apply that same rule inside blocks:

- **Target block already exists** → leave the excluded field exactly as it is. *(Matches "skip". Also stops us clobbering hand-tuned content.)*
- **Target block must be created** → source text if the field is required, empty if not. *(Exactly what we already do for top-level fields on a new locale.)*

Now "exclude" means one thing everywhere. No new concepts, no new vocabulary for the editor to learn.

---

## 4. Two UI options

### Option A — Per-run pickers stay top-level. Blocks ride with their parent.

The editor picks from the fields they can actually *see on the record*. A Modular Content field is **one line item**. Tick it and its blocks come along.

```
  Fields to translate
  Everything's selected. Remove anything you'd rather leave alone.

  Article  article
  ┌────────────────────────────────────────────────────────────────┐
  │ [Title ×] [Slug ×] [Intro ×] [Body ×] [Page content ×] [SEO ×] │
  └────────────────────────────────────────────────────────────────┘
  6 of 6 fields selected

        ↑ "Page content" is a Modular Content field.
          Ticking it translates every block inside it.
```

Same widget in the sidebar, collapsed by default, with the button label following the selection:

```
  ┌─ AI Translations ─────────────────┐
  │  From [ English ▾ ]               │
  │  To   [Italian ×] [German ×]      │
  │                                   │
  │  ▸ Choose fields…        (6 of 6) │   ← collapsed; most people never open it
  │                                   │
  │  [    Translate record        ]   │
  └───────────────────────────────────┘

     …opens it, unticks three…

  │  ▾ Choose fields…        (3 of 6) │
  │  [Title ×] [Intro ×] [SEO ×]      │
  │  [  Translate 3 of 6 fields   ]   │
```

Fine-grained control over what's *inside* a block stays where it is today: the admin blocklist in Settings, set once by someone who knows the schema.

**For a casual editor:** the picker lists what they see on the page. Nothing more.

---

### Option B — Per-run pickers go nested. The editor can reach inside blocks.

To offer that, the picker has to become a tree — because that's genuinely what the schema is:

```
  Fields to translate

  ▾ ☑ Article
      ☑ Title
      ☑ Intro
      ▾ ☑ Page content            (Modular Content — 4 block types allowed)
          ▾ ☑ Hero block
              ☑ Heading
              ☑ Tagline
              ☐ Button label      ← will be copied in English
          ▾ ☑ Quote block
              ☑ Quote text
              ☑ Attribution
          ▾ ☑ Callout block
              ☑ Title
              ▾ ☑ Body  (Structured Text — may contain more blocks…)
                  ▾ ☑ CTA block
                      ☑ Label     ← depth 4. DatoCMS allows 5.
          ▾ ☑ Feature list block
              …
      ☑ SEO
```

**Problems, in the order they'd bite us:**

1. **It's a schema tree, not a content tree.** Unticking "Button label" under Hero unticks it for *every* Hero block in the field — including ones the editor can't see and didn't think about. The tree looks like it's describing *this record*. It isn't.
2. **It explodes.** Three modular fields × five block types × eight fields ≈ 120 leaves — for one model. Bulk translation runs across *several* models. This is a settings screen wearing a dialog's clothes.
3. **It has to teach the passthrough rule.** Every unticked leaf inside a block means *"this will be copied in English"*, not *"this won't be touched."* We'd have to say so, per leaf, forever. (§3's fix narrows this — but only when the target block already exists.)
4. **It duplicates the admin blocklist**, which already does exactly this and does it *once* rather than on every single run.
5. **The editor doesn't know what a block is.** They know "the page content section." Asking them to reason about block *types* is asking them to read the schema.

**When Option B would actually be right:** if editors regularly need *different* nested choices run to run — "translate the Hero but not its button, today, on this one record." We have **no evidence anyone has ever wanted this.** Zero tickets, zero Basecamp threads, zero mentions in five months of history.

---

### Comparison

| | **A — Top-level** | **B — Nested tree** |
| --- | --- | --- |
| Matches what the editor sees on the record | ✅ | ❌ (shows schema, not content) |
| Same widget everywhere | ✅ | ⚠️ tree in a sidebar is rough |
| Casual editor can use it without training | ✅ | ❌ |
| Least surprise | ✅ | ❌ — a per-record UI that silently edits *every* record |
| Fine-grained block control possible at all | ✅ via admin Settings | ✅ inline |
| Effort | Small | Large |
| Anyone actually asked for it | n/a | **No evidence** |

---

## 5. Recommendation

**Take Option A** — and make the *split* explicit rather than accidental, because the split is the right one. It just needs to be honest about itself:

> **Editors** decide *what to translate right now*, choosing from the fields they can see on the record. Fast, obvious, no schema knowledge.
>
> **Admins** decide *what should never be translated*, anywhere, including deep inside blocks. Set once, in Settings, by someone who knows the model.

Those are two different people, two different questions, two different lifespans. Merging them into one tree serves neither. Today they're separate by accident — nothing in the product says so, the two screens look nothing alike, and one silently ignores the other's decisions (bugs #2 and #3).

**The work, in priority order:**

1. **Fix the silent data loss.** Make the sidebar translate frameless blocks as a unit, exactly like bulk does. Kills bugs #1, #2, and #3 together, deletes ~120 lines, and aligns us with what the backend actually models. *(Prove it with an E2E test first — I've verified it in code, not yet against a live record.)*
2. **Fix the picker.** Kill the "All fields" chip; show every field as its own removable chip; add a plain "Select all" button for when someone clears the box. This is the bug we came in for.
3. **Give the sidebar a field picker**, collapsed by default, using the same widget as bulk.
4. **Make "exclude" mean one thing** (§3): don't clobber existing target-language block content; only fall back to source text when we're creating a block from scratch.
5. **Say what the blocklist does.** The Settings screen should tell admins, in words, that excluding a field *inside a block* means "copied in the source language," not "skipped" — for the cases where that's still true after (4).
6. **Delete the dead code.** The `localized` branch for block sub-fields handles a shape DatoCMS returns 422 for.

---

## 6. What we're asking the team to decide

1. **Do we accept Option A** (editors pick from top-level fields; nested control stays an admin setting), or does someone have a real user need that demands Option B?
2. **Bug #1 is data loss.** Does it jump the queue ahead of the picker fix? *(Our view: yes.)*
3. **Is the editor/admin split the product model we want** — and if so, should the two screens be visually related at all, or deliberately kept apart?
4. **Item 4 changes behaviour**: translating a Modular Content field would stop wiping hand-edited target-language blocks. That's a fix, but it *is* a behaviour change. Anyone relying on the clobber?

---

## Appendix — Evidence

| Claim | Source |
| --- | --- |
| Frameless is an appearance, not a field type | `api/lib/dato/field_type.rb:5-31`; `api/lib/dato/editor.rb:27-30`; `FramelessSingleBlock` is an empty class; `appearance` has zero hits in any record-persistence path |
| Framed vs frameless are byte-identical | Live diff, site 219952: `article.spotlight` vs `article.inline_note` differ only in `appearance.editor` |
| Block sub-fields cannot be localized | `api/app/models/field.rb:167,235-242` (unconditional validation → 422); migration `fix_bug_modular_localized_fields`; `docs/content-modelling/blocks.md`; all 15 block fields in E2E are `localized: false` |
| A whole-block write at the parent path **works** | `cms/.../useFormFields.ts:110-133` registers `hero.en`, not its leaves; `setFieldValue` is a pass-through to Formik `setIn` |
| Bug #1 (silent null) | `cms/src/utils/prepareItemPayload.ts:343-347` — a block with no `itemTypeId` serialises to `null` |
| Bugs #2 and #3 | `translateRecordFields.ts:728` returns before `shouldProcessField` at `:735`; both confirmed with repros against `e2e/seed/1-schema.mjs:125-127,188-191` |
| Original rationale | Upstream issues [#5](https://github.com/marcelofinamorvieira/datocms-plugin-ai-translations/issues/5) + [#11](https://github.com/marcelofinamorvieira/datocms-plugin-ai-translations/issues/11); workaround commit [`3e78bbb`](https://github.com/marcelofinamorvieira/datocms-plugin-ai-translations/commit/3e78bbb2c074b1e5a6f39a76f1406ce0fd4223a6) (2025-11-20, v2.2.1). Obsoleted by `5381127` (2026-02-25) in [datocms/plugins#134](https://github.com/datocms/plugins/pull/134) — which also *improved* the workaround in the same commit, never noticing it had made it redundant |
| No rationale was ever recorded for the rest | No README/changelog/PR/Basecamp coverage. Basecamp swept 7,836 records across 21 projects — clean negative (caveat: Basecamp search is broken; Slack not swept) |
