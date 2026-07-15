# Field-Fate Tree — Design

**Date:** 2026-07-15
**Status:** Approved (brainstorming, 2026-07-15) — implementation-ready
**Scope:** `ai-translations` plugin — the projectwide "translation rules" picker on the config screen. Replaces the flat "Fields to be excluded" + (unbuilt) copy-from-source multi-selects with a model→field→block **tree**, every node carrying exactly one of three fates.
**Relation to v4:** implements §4.2 (two-list fates), §5 (one tree, two homes), §5.2 (block sub-field scope). The per-run modal ("second home") is designed here but built in Phase 5.

---

## 1. The reframe

Field selection is an **attribute** problem, not a grouping problem. Every translatable field has exactly one *fate*, the way it has a type. Fields have fates; fates don't have fields. Render fate as a per-row attribute of each field and two failure modes become structurally impossible: a field can never be in "invisible limbo" (every field shows its fate) and never in two fates at once (one control, radio semantics).

Three fates, mutually exclusive and exhaustive (`src/engine/fieldFate.ts`):

| Fate | Runtime behavior | Storage |
| --- | --- | --- |
| **Translate** | send to AI, write into target locale | default — in neither list |
| **Copy** | write source value verbatim (brand names, SKUs, dates) | `fieldsToCopyFromSource` |
| **Skip** | leave target empty — **optional fields only** (`cannotBeBlank` fields cannot skip) | `apiKeysToBeExcludedFromThisPlugin` |

**No new storage.** The two arrays already exist in `ctxParamsType` and are already honored by `resolveFieldFate`. Storage is sparse by construction: only non-default (Copy/Skip) fates are persisted; a field in neither array is Translate. The tree is a better UI over data that already drives the engine.

## 2. The control — a three-state segmented radio group

Each field node ends in a compact 3-segment control: **`Translate | Copy | Skip`**, built as a **styled native radio group** (`<fieldset>` per node, field label as accessible legend, three `<input type="radio">` styled as segments with `--color--*` design tokens). Native radios give keyboard + screen-reader behavior for free — critical because `datocms-react-ui` has no segmented control and hand-rolled toggle-button groups are where plugin a11y dies. Radio semantics enforce exclusivity at the control level, not by validation.

- **Required fields** (`cannotBeBlank`): the **Skip** segment is disabled with a tooltip — "Required — can't be skipped; use Copy to keep the source value." Teaches the rule at the point of decision.
- The resolved fate is always visible on every row without interaction.

## 3. The tree — model → field → block → sub-field

Built from one schema crawl (cached per session — reuse the existing load-once discipline in `ConfigScreen`). Each **model** is a collapsible `Section`, **collapsed by default**, its header showing honest **summary counts** (`10 translate · 2 copy · 1 skip`) so the collapsed state still tells the truth. Block-container fields (`rich_text` / `structured_text` / `single_block`) expand to their block types' sub-fields, recursively.

```
▸ Article                                    10 translate · 2 copy · 1 skip
▾ Landing Page                                6 translate · 1 copy · 1 skip
   Set all: [Translate] [Copy] [Skip]                     🔍 filter fields
   ──────────────────────────────────────────────────────────────────────
   Title            required   [ ●Translate ][  Copy  ][  Skip ⊘ ]
   Slug             required   [  Translate ][ ●Copy  ][  Skip ⊘ ]
   SEO description             [  Translate ][  Copy  ][ ●Skip   ]
   ▾ Body           block      [ mixed…     ][  Copy  ][  Skip   ]   ← rollup + cascade
       Heading                 [ ●Translate ][  Copy  ][  Skip   ]
       Caption                 [  Translate ][ ●Copy  ][  Skip   ]   ⓘ Copy wherever
                                                                       Callout is used (3 places)
   ──────────────────────────────────────────────────────────────────────
   2 fields aren't translatable (Author, Published at) — always ignored
```

### 3.1 Block sub-field scope is global to the block type (§5.2)

A block sub-field has **one field `id`** regardless of how many models embed it, so its fate applies **wherever that block is used**. This is shown, not discovered: a non-default sub-field carries an inline annotation — *"Copy wherever Callout is used (N places)."* We nest blocks under their embedding field (for discoverability) rather than relocating them to a separate group; the annotation makes the shared scope honest.

### 3.2 Cascade + override (the approved reconciliation)

A block-container field's own row is a **computed rollup**, not stored state:

- Its control **displays** the rollup of its descendants: a single fate if all descendants agree, else **`mixed`**.
- Setting the block's control **cascades**: stamps every descendant leaf to that fate (respecting the required-field carve-out — required descendants that would be Skipped stay at their prior non-Skip fate, reported).
- Individual sub-fields can then **override**, flipping the parent back to `mixed`.
- **Only leaf fates are stored** (sparse). There is no persisted "parent fate" that could contradict its children; the rollup is always derived. This preserves "resolved state is a rendering guarantee, not a storage schema."

### 3.3 Non-translatable fields

Field types outside `translateFieldTypes` (and non-localized fields) are **not** tree nodes. They appear as a de-emphasized per-model footer line ("N fields aren't translatable — always ignored") so an editor hunting for a missing field isn't left wondering whether the plugin is broken. Honesty covers absence too.

### 3.4 Guards

- **Depth cap + visited-set** on the crawl (blocks can nest, and a block can embed itself) — v4 §12 risk. Cap at a sane depth (e.g. 5, DatoCMS's own nesting limit); a cycle stops recursion and the repeated block is not re-expanded.
- **Load-once**: the crawl issues `loadItemTypeFields` per item type; guard it exactly like today's `fieldListLoaded` ref (rate-limit discipline, `AGENTS.md`).

## 4. Two homes, one component (§5)

The same `FieldFateTree` renders on both surfaces; the difference is disclosure and deltas, not layout.

- **Config screen (`mode="config"`) — built now.** The tree *is* the section, retitled **"Projectwide translation rules."** Reads/writes `apiKeysToBeExcludedFromThisPlugin` + `fieldsToCopyFromSource`; persists via the existing Save button (wired into `isFormDirty`, `updatePluginParams`, and Restore-to-defaults).
- **Per-run modal (`mode="run"`) — Phase 5, designed not built.** Leads with locale pickers + one summary line ("Using project defaults: 10 translate · 2 copy · 1 skip ▸ Adjust for this run"); expanding reveals the identical tree seeded from defaults; overridden rows get a dot + per-row reset; overrides are **ephemeral** (die with the run, never persisted as sticky editor prefs). Wires the plumbed-but-unused `runSkipIds`/`runCopyIds` in `resolveFieldFate`.

Model/role exclusion (plugin *visibility*, not field fate) is a separate concern and stays as-is under the retitled section.

## 5. Edge cases (resolved)

| Case | Resolution |
| --- | --- |
| Field becomes required after being stored as Skip | Don't mutate storage. Resolve at render to Translate; badge "Skip no longer allowed — will translate." Storage keeps the stale token; UI shows resolved truth. |
| "Set all → Skip" with required fields present | Apply partially; report "Set N of M to Skip — K required fields kept." Never silently apply or no-op. |
| Non-translatable fields | Footer line per model (§3.3). |
| Block sub-fields | Nested + global-scope annotation (§3.1). |
| New field added to a model later | Falls to Translate (sparse default). No migration needed. |
| Empty models (nothing translatable) | Collapsed into one line: "N models with nothing to translate." |
| Huge / many models | Collapse-by-default + per-model filter + a global "show non-default only" toggle (doubles as the admin's audit view). |
| Legacy api_key exclusion tokens | Enforcement keeps the api_key fallback (`isFieldExcluded`); the id-migration (§5.1) is out of scope for this PR. |

## 6. Biggest risk & mitigation

**The wall** — many models × many fields of radio rows is the overwhelming surface the org directive prohibits. Mitigations in leverage order: collapse-by-default with honest summary counts (most admins read counts, never expand); "show non-default only" filter; per-model search; sparse storage (untouched models cost nothing to render as one collapsed line); and the run modal's progressive disclosure (Phase 5). Pressure valve: the row control can degrade to a per-row `SelectField` without touching the tree architecture, mode split, or delta rendering — that reversibility is itself a reason to prefer this shape.

## 7. Out of scope (this PR)

- Per-run modal (`mode="run"`) — Phase 5.
- api_key→id config migration (§5.1) — enforcement fallback stays.
- Sentinel deletions on the bulk page / locale pickers (§5.3) — separate Phase-4 slice.
- Per-sub-field assignment beyond what the engine already keys by id (blocks nest; the model is unchanged).

## 8. File structure

| File | Responsibility |
| --- | --- |
| `src/entrypoints/Config/fieldFateTree/types.ts` | `FieldFate` re-export, `FateTreeNode`, `FateSummary` |
| `src/entrypoints/Config/fieldFateTree/buildTree.ts` | Pure schema crawl → `FateTreeNode[]` (depth cap, cycle guard, translatable filter, block nesting) |
| `src/entrypoints/Config/fieldFateTree/fate.ts` | Pure: `fateOf`, `setFate` (array mutation), `cascadeFate`, `summarize`, `rollup`, required-guard |
| `src/entrypoints/Config/fieldFateTree/FieldFateControl.tsx` | Three-state segmented radio group |
| `src/entrypoints/Config/fieldFateTree/FieldFateTreeNode.tsx` | Recursive node/row: label, badges, control, expand, annotations |
| `src/entrypoints/Config/fieldFateTree/FieldFateTree.tsx` | Container: per-model `Section`s, summary counts, filter, set-all, non-default toggle |
| `src/entrypoints/Config/fieldFateTree/*.test.ts(x)` | Colocated unit tests |
| `src/entrypoints/Config/ConfigScreen.tsx` | Integrate the tree; retitle section; wire save/dirty/restore; extend the schema load to capture validators + field_type + block relationships |
| `src/entrypoints/Config/ExclusionRulesSection.tsx` | Keeps model/role exclusion; the field multi-select is removed (superseded by the tree) |

## 9. Testing

- **Pure (`buildTree`, `fate`):** fate derivation from the two arrays; sparse `setFate` (adding Copy removes any Skip token for that id and vice versa — a field is never in both); cascade stamps descendants and respects the required carve-out; `summarize`/`rollup` including `mixed`; crawl depth cap + self-referential block cycle guard; non-translatable filtering; required detection.
- **Components:** control renders the resolved fate, disables Skip when required, emits the new fate on change; node expands blocks and shows the global-scope annotation on non-default sub-fields; tree collapses by default, header counts match, filter narrows, "set all" reports the required carve-out.
- **Integration (`ConfigScreen`):** editing a fate dirties the form; Save writes both arrays; Restore-to-defaults clears them; block sub-field exclusion is not lost relative to the old flat picker (regression guard).
