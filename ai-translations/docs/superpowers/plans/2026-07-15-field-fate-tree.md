# Field-Fate Tree Implementation Plan

> **STATUS (2026-07-15): IMPLEMENTED.** All 9 tasks landed (commits `0faad60`…`14c2024`).
> 934 unit/component tests pass, Biome lint clean, `npm run build` clean. Verified at
> the unit level; **live dashboard verification still recommended** (render the config
> screen against a real project via the e2e:manual harness) since the ConfigScreen
> wiring is covered by typecheck + the component/pure suites but not an end-to-end render.
> Deferred polish (non-blocking): collapse empty/no-translatable models into a single
> line (spec §5); a label on the per-model filter input; the per-run modal is Phase 5.

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace the flat "Fields to be excluded" multi-select (and the never-built copy-from-source picker) on the config screen with a model→field→block **fate tree**: every translatable field carries exactly one of Translate / Copy / Skip, over the two existing plugin-param arrays.

**Architecture:** A pure core (schema crawl → tree, fate derivation/mutation over the two arrays, cascade, summaries) plus React components (three-state radio control → recursive node → per-model container), integrated into `ConfigScreen`. No new storage: fate is derived from `apiKeysToBeExcludedFromThisPlugin` (Skip) + `fieldsToCopyFromSource` (Copy); Translate is the sparse default. The engine's `resolveFieldFate` already reads these, so the runtime half is done.

**Tech Stack:** TypeScript, React, `datocms-react-ui`, `datocms-plugin-sdk` (`RenderConfigScreenCtx`), Vitest (`npm test`), plugin build (`npm run build`).

## Global Constraints

- **Storage is the two existing arrays, sparse.** Only Copy/Skip persist; a field in neither array is Translate. A field is NEVER in both arrays — `setFate` enforces mutual exclusivity (spec §1, §9).
- **Fate keys on field `id`, api_key fallback.** Match `resolveFieldFate` / `isFieldExcluded([id, apiKey])`. Do not change enforcement keying; the id-migration (v4 §5.1) is out of scope.
- **Required = `cannotBeBlank(validators)`** (`src/utils/translation/SharedFieldUtils`). Required fields cannot be Skipped (spec §2); the engine already auto-splits an excluded required field to Copy, so the UI must never *store* Skip for a required field.
- **Translatable field types** = keys of `translateFieldTypes` (`src/entrypoints/Config/configConstants.ts`). Block-container fields to expand: `rich_text`, `structured_text`, `single_block`. Non-translatable fields are footer-listed, not nodes (spec §3.3).
- **Block sub-field fate is global to the block type** (one id, many parents) — annotate, don't hide (spec §3.1).
- **Cascade + override, leaf-only storage.** A block row is a computed rollup; setting it cascades to descendant leaves; no persisted parent fate (spec §3.2).
- **Load-once schema crawl.** Guard `loadItemTypeFields` with a ref exactly like today's `fieldListLoaded` (rate-limit discipline, `AGENTS.md`). Depth cap 5 + visited-set for cycles (spec §3.4).
- **A11y:** the control is a native `<fieldset>`/radio group; keyboard + SR behavior must not be hand-rolled (spec §2).
- **AGENTS.md rules apply** (`--color--*` tokens, no nested modals, load-once).
- After every implementation step: `npm test`. Before every commit: `npm run build`.

## File Structure

All new files under `src/entrypoints/Config/fieldFateTree/`. See spec §8.

---

### Task 1: Fate types + derivation/mutation core (pure)

**Files:**
- Create: `src/entrypoints/Config/fieldFateTree/types.ts`
- Create: `src/entrypoints/Config/fieldFateTree/fate.ts`
- Test: `src/entrypoints/Config/fieldFateTree/fate.test.ts`

**Interfaces:**
- Produces:
  - `type FieldFate = 'translate' | 'copy' | 'skip'` (UI vocab; maps to engine `'exclude'` at the storage layer — Skip ⇒ exclude token).
  - `interface FateLists { excludedTokens: string[]; copyTokens: string[] }`
  - `fateOf(node: { id: string; apiKey: string; required: boolean }, lists: FateLists): FieldFate` — derives; a required field that carries a stored exclude token resolves to `'translate'` (never `'skip'`), matching the engine's copy auto-split intent but shown as translate unless also copy-listed. (Required + copy token ⇒ `'copy'`.)
  - `setFate(id: string, apiKey: string, fate: FieldFate, lists: FateLists): FateLists` — returns new arrays; removes `id`+`apiKey` from both, then adds to the one implied by `fate` (translate adds to neither). Pure, immutable.
  - `summarize(fates: FieldFate[]): { translate: number; copy: number; skip: number }`

- [ ] **Step 1: Write the failing test** (`fate.test.ts`)

```ts
import { describe, expect, it } from 'vitest';
import { fateOf, setFate, summarize } from './fate';

const lists = (excludedTokens: string[] = [], copyTokens: string[] = []) => ({
  excludedTokens,
  copyTokens,
});

describe('fateOf', () => {
  it('defaults to translate when in neither list', () => {
    expect(fateOf({ id: 'f1', apiKey: 'title', required: false }, lists())).toBe('translate');
  });
  it('resolves copy when the id is copy-listed', () => {
    expect(fateOf({ id: 'f1', apiKey: 'title', required: false }, lists([], ['f1']))).toBe('copy');
  });
  it('resolves skip when excluded and optional', () => {
    expect(fateOf({ id: 'f1', apiKey: 'title', required: false }, lists(['f1']))).toBe('skip');
  });
  it('a required field never resolves to skip even if excluded', () => {
    expect(fateOf({ id: 'f1', apiKey: 'title', required: true }, lists(['f1']))).toBe('translate');
  });
  it('copy wins over exclude if a field is somehow on both', () => {
    expect(fateOf({ id: 'f1', apiKey: 'title', required: false }, lists(['f1'], ['f1']))).toBe('copy');
  });
  it('matches by api_key fallback', () => {
    expect(fateOf({ id: 'f1', apiKey: 'title', required: false }, lists(['title']))).toBe('skip');
  });
});

describe('setFate', () => {
  it('adds to copy and removes from exclude (never both)', () => {
    const next = setFate('f1', 'title', 'copy', lists(['f1']));
    expect(next.copyTokens).toContain('f1');
    expect(next.excludedTokens).not.toContain('f1');
  });
  it('translate removes from both', () => {
    const next = setFate('f1', 'title', 'translate', lists(['f1'], ['f1']));
    expect(next.excludedTokens).not.toContain('f1');
    expect(next.copyTokens).not.toContain('f1');
  });
  it('skip removes any api_key token too (dedupes id + apiKey)', () => {
    const next = setFate('f1', 'title', 'skip', lists([], ['title']));
    expect(next.copyTokens).not.toContain('title');
    expect(next.excludedTokens).toContain('f1');
  });
  it('does not mutate the input arrays', () => {
    const input = lists(['f1']);
    setFate('f1', 'title', 'copy', input);
    expect(input.excludedTokens).toEqual(['f1']);
  });
});

describe('summarize', () => {
  it('counts each fate', () => {
    expect(summarize(['translate', 'translate', 'copy', 'skip'])).toEqual({ translate: 2, copy: 1, skip: 1 });
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npm test -- fate.test`
Expected: FAIL — module not found / functions undefined.

- [ ] **Step 3: Implement `types.ts` then `fate.ts`**

`types.ts`:
```ts
/** UI-layer fate vocabulary. Skip maps to the engine's `exclude` token at storage. */
export type FieldFate = 'translate' | 'copy' | 'skip';

export interface FateLists {
  /** pluginParams.apiKeysToBeExcludedFromThisPlugin (Skip). */
  excludedTokens: string[];
  /** pluginParams.fieldsToCopyFromSource (Copy). */
  copyTokens: string[];
}

export interface FateSummary {
  translate: number;
  copy: number;
  skip: number;
}
```

`fate.ts`:
```ts
import { isFieldExcluded } from '../../../utils/translation/SharedFieldUtils';
import type { FateLists, FateSummary, FieldFate } from './types';

interface FateNodeRef {
  id: string;
  apiKey: string;
  required: boolean;
}

/**
 * Derives a field's fate from the two sparse token lists.
 * Copy wins over exclude. A required field can never resolve to `skip`
 * (the engine auto-splits an excluded required field to copy); shown as
 * `translate` unless it is also copy-listed.
 */
export const fateOf = (node: FateNodeRef, lists: FateLists): FieldFate => {
  const ids = [node.id, node.apiKey];
  if (isFieldExcluded(lists.copyTokens, ids)) return 'copy';
  if (isFieldExcluded(lists.excludedTokens, ids)) {
    return node.required ? 'translate' : 'skip';
  }
  return 'translate';
};

const without = (tokens: string[], id: string, apiKey: string): string[] =>
  tokens.filter((t) => t !== id && t !== apiKey);

/**
 * Returns new token lists with this field set to `fate`. Removes the field
 * (by id AND api_key) from both lists first, so a field is never in both.
 * `translate` leaves it in neither. Immutable.
 */
export const setFate = (
  id: string,
  apiKey: string,
  fate: FieldFate,
  lists: FateLists,
): FateLists => {
  const excludedTokens = without(lists.excludedTokens, id, apiKey);
  const copyTokens = without(lists.copyTokens, id, apiKey);
  if (fate === 'skip') excludedTokens.push(id);
  if (fate === 'copy') copyTokens.push(id);
  return { excludedTokens, copyTokens };
};

export const summarize = (fates: FieldFate[]): FateSummary =>
  fates.reduce<FateSummary>(
    (acc, f) => ({ ...acc, [f]: acc[f] + 1 }),
    { translate: 0, copy: 0, skip: 0 },
  );
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npm test -- fate.test`
Expected: PASS (all cases).

- [ ] **Step 5: `npm run build`**, then commit

```bash
git add src/entrypoints/Config/fieldFateTree/
git commit -m "feat(config): field-fate derivation + sparse two-list mutation core (spec §1)"
```

---

### Task 2: Cascade + rollup over a subtree (pure)

**Files:**
- Modify: `src/entrypoints/Config/fieldFateTree/fate.ts`
- Test: `src/entrypoints/Config/fieldFateTree/fate.test.ts` (extend)

**Interfaces:**
- Consumes: `setFate`, `fateOf`, `FieldFate`, `FateLists` (Task 1).
- Produces:
  - `rollup(fates: FieldFate[]): FieldFate | 'mixed'` — single fate if all agree (empty ⇒ `'translate'`), else `'mixed'`.
  - `cascadeFate(leaves: FateNodeRef[], fate: FieldFate, lists: FateLists): { lists: FateLists; keptRequired: number }` — stamps every leaf to `fate`; a required leaf that would become `skip` is left as `translate` instead and counted in `keptRequired`. Immutable.
  - Export `type FateNodeRef = { id: string; apiKey: string; required: boolean }`.

- [ ] **Step 1: Write the failing test** (append)

```ts
import { cascadeFate, rollup } from './fate';

describe('rollup', () => {
  it('returns the shared fate when all agree', () => {
    expect(rollup(['copy', 'copy'])).toBe('copy');
  });
  it('returns translate for an empty set', () => {
    expect(rollup([])).toBe('translate');
  });
  it('returns mixed when fates differ', () => {
    expect(rollup(['translate', 'copy'])).toBe('mixed');
  });
});

describe('cascadeFate', () => {
  const leaf = (id: string, required = false) => ({ id, apiKey: id, required });
  it('stamps every leaf to the chosen fate', () => {
    const { lists } = cascadeFate([leaf('a'), leaf('b')], 'copy', { excludedTokens: [], copyTokens: [] });
    expect(lists.copyTokens.sort()).toEqual(['a', 'b']);
  });
  it('keeps required leaves out of skip and counts them', () => {
    const res = cascadeFate([leaf('a'), leaf('b', true)], 'skip', { excludedTokens: [], copyTokens: [] });
    expect(res.lists.excludedTokens).toEqual(['a']);
    expect(res.keptRequired).toBe(1);
  });
});
```

- [ ] **Step 2: Run — verify fail** (`npm test -- fate.test`) — `cascadeFate`/`rollup` undefined.

- [ ] **Step 3: Implement** (append to `fate.ts`)

```ts
export type FateNodeRef = { id: string; apiKey: string; required: boolean };

export const rollup = (fates: FieldFate[]): FieldFate | 'mixed' => {
  if (fates.length === 0) return 'translate';
  const first = fates[0];
  return fates.every((f) => f === first) ? first : 'mixed';
};

export const cascadeFate = (
  leaves: FateNodeRef[],
  fate: FieldFate,
  lists: FateLists,
): { lists: FateLists; keptRequired: number } => {
  let next = lists;
  let keptRequired = 0;
  for (const leaf of leaves) {
    if (fate === 'skip' && leaf.required) {
      next = setFate(leaf.id, leaf.apiKey, 'translate', next);
      keptRequired += 1;
    } else {
      next = setFate(leaf.id, leaf.apiKey, fate, next);
    }
  }
  return { lists: next, keptRequired };
};
```

(Refactor the `FateNodeRef` in `fateOf` to import from this single declaration.)

- [ ] **Step 4: Run — verify pass** (`npm test -- fate.test`).

- [ ] **Step 5: `npm run build`**, commit

```bash
git add src/entrypoints/Config/fieldFateTree/
git commit -m "feat(config): cascade + rollup with required-skip carve-out (spec §3.2)"
```

---

### Task 3: Schema crawl → fate tree (pure)

**Files:**
- Create: `src/entrypoints/Config/fieldFateTree/buildTree.ts`
- Modify: `src/entrypoints/Config/fieldFateTree/types.ts`
- Test: `src/entrypoints/Config/fieldFateTree/buildTree.test.ts`

**Interfaces:**
- Consumes: `translateFieldTypes` (`../configConstants`), `cannotBeBlank` (`SharedFieldUtils`).
- Produces (in `types.ts`):
  ```ts
  export interface FateFieldNode {
    id: string;
    apiKey: string;
    label: string;
    required: boolean;
    fieldType: string;
    /** Present when this field embeds blocks; its sub-field nodes. */
    children?: FateFieldNode[];
  }
  export interface FateModelNode {
    id: string;
    name: string;
    fields: FateFieldNode[];
    /** Translatable-type filter removed these — shown as a footer. */
    nonTranslatable: { label: string }[];
  }
  ```
- Produces (in `buildTree.ts`):
  - `type LoadedField = { id: string; attributes: { label: string; api_key: string; field_type: string; validators: Record<string, unknown> } }`
  - `type LoadedItemType = { id: string; attributes: { name: string; modular_block: boolean } }`
  - `blockTypeIdsOf(validators): string[]` — reads `rich_text_blocks.item_types`, `structured_text_blocks.item_types`, `single_block_blocks.item_types`.
  - `buildModelNode(itemType, fieldsByItemType, itemTypesById, opts?): FateModelNode` — pure; `fieldsByItemType: Map<string, LoadedField[]>`, `itemTypesById: Map<string, LoadedItemType>`; recurses into block types with a `visited` set and `depth` cap (default 5).

- [ ] **Step 1: Write the failing test** (`buildTree.test.ts`) — cover: translatable top-level fields become nodes; a non-translatable field lands in `nonTranslatable`; a `rich_text` field with `rich_text_blocks.item_types` gets `children` from the block's fields; a self-referential block stops at the depth cap without infinite recursion; `required` reflects `cannotBeBlank`.

```ts
import { describe, expect, it } from 'vitest';
import { buildModelNode, blockTypeIdsOf } from './buildTree';

const field = (id: string, api_key: string, field_type: string, validators: any = {}) => ({
  id, attributes: { label: api_key, api_key, field_type, validators },
});
const model = (id: string, name: string, modular_block = false) => ({
  id, attributes: { name, modular_block },
});

describe('blockTypeIdsOf', () => {
  it('reads rich_text_blocks item_types', () => {
    expect(blockTypeIdsOf({ rich_text_blocks: { item_types: ['b1'] } })).toEqual(['b1']);
  });
  it('reads single_block_blocks item_types', () => {
    expect(blockTypeIdsOf({ single_block_blocks: { item_types: ['b2'] } })).toEqual(['b2']);
  });
});

describe('buildModelNode', () => {
  it('keeps translatable fields and footers the rest', () => {
    const fields = new Map([['m1', [field('f1', 'title', 'single_line'), field('f2', 'flag', 'boolean')]]]);
    const node = buildModelNode(model('m1', 'Article'), fields, new Map(), {});
    expect(node.fields.map((f) => f.apiKey)).toEqual(['title']);
    expect(node.nonTranslatable.map((f) => f.label)).toEqual(['flag']);
  });
  it('nests a block field’s sub-fields', () => {
    const fields = new Map([
      ['m1', [field('f1', 'body', 'rich_text', { rich_text_blocks: { item_types: ['b1'] } })]],
      ['b1', [field('bf1', 'heading', 'single_line')]],
    ]);
    const itemTypes = new Map([['b1', model('b1', 'Callout', true)]]);
    const node = buildModelNode(model('m1', 'Article'), fields, itemTypes, {});
    expect(node.fields[0].children?.[0].apiKey).toBe('heading');
  });
  it('stops a self-referential block at the depth cap', () => {
    const fields = new Map([
      ['m1', [field('f1', 'body', 'rich_text', { rich_text_blocks: { item_types: ['b1'] } })]],
      ['b1', [field('bf1', 'nested', 'rich_text', { rich_text_blocks: { item_types: ['b1'] } })]],
    ]);
    const itemTypes = new Map([['b1', model('b1', 'Self', true)]]);
    const node = buildModelNode(model('m1', 'Article'), fields, itemTypes, { depth: 2 });
    expect(node).toBeDefined(); // did not throw / hang
  });
  it('marks required via cannotBeBlank', () => {
    const fields = new Map([['m1', [field('f1', 'title', 'single_line', { required: {} })]]]);
    const node = buildModelNode(model('m1', 'Article'), fields, new Map(), {});
    expect(node.fields[0].required).toBe(true);
  });
});
```

- [ ] **Step 2: Run — verify fail** (`npm test -- buildTree.test`).

- [ ] **Step 3: Implement `buildTree.ts`** — translatable filter on `translateFieldTypes`, block detection via `blockTypeIdsOf`, recursion with `visited: Set<string>` and `depth` decrement (default 5), `required: cannotBeBlank(validators)`. Add the two node interfaces to `types.ts`.

- [ ] **Step 4: Run — verify pass** (`npm test -- buildTree.test`).

- [ ] **Step 5: `npm run build`**, commit

```bash
git add src/entrypoints/Config/fieldFateTree/
git commit -m "feat(config): schema crawl → fate tree with block nesting + cycle guard (spec §3)"
```

---

### Task 4: The three-state fate control (component)

**Files:**
- Create: `src/entrypoints/Config/fieldFateTree/FieldFateControl.tsx`
- Create: `src/entrypoints/Config/fieldFateTree/fieldFateTree.module.css`
- Test: `src/entrypoints/Config/fieldFateTree/FieldFateControl.test.tsx`

**Interfaces:**
- Consumes: `FieldFate` (types).
- Produces:
  ```ts
  interface FieldFateControlProps {
    legend: string;               // field label (accessible legend)
    value: FieldFate | 'mixed';   // 'mixed' renders no segment pressed, shows "mixed…"
    skipDisabled?: boolean;       // required fields
    onChange: (fate: FieldFate) => void;
  }
  export default function FieldFateControl(props: FieldFateControlProps): JSX.Element;
  ```
- A `<fieldset>` with a visually-hidden `<legend>`, three `<label><input type="radio" name={unique}></label>` segments (Translate / Copy / Skip). Skip radio `disabled` when `skipDisabled`. `--color--*` tokens for segment styling.

- [ ] **Step 1: Write the failing test** — renders three radios; the `value` radio is checked; `skipDisabled` disables the Skip radio; clicking Copy calls `onChange('copy')`; `value='mixed'` leaves all unchecked.

```tsx
import { describe, expect, it, vi } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import FieldFateControl from './FieldFateControl';

it('checks the current fate and disables skip when required', () => {
  render(<FieldFateControl legend="Title" value="copy" skipDisabled onChange={() => {}} />);
  expect((screen.getByRole('radio', { name: /copy/i }) as HTMLInputElement).checked).toBe(true);
  expect((screen.getByRole('radio', { name: /skip/i }) as HTMLInputElement).disabled).toBe(true);
});

it('emits the new fate on change', () => {
  const onChange = vi.fn();
  render(<FieldFateControl legend="Title" value="translate" onChange={onChange} />);
  fireEvent.click(screen.getByRole('radio', { name: /copy/i }));
  expect(onChange).toHaveBeenCalledWith('copy');
});
```

- [ ] **Step 2: Run — verify fail** (`npm test -- FieldFateControl`).

- [ ] **Step 3: Implement** the fieldset/radio control + CSS module. Use `React.useId()` for the radio group `name`.

- [ ] **Step 4: Run — verify pass** (`npm test -- FieldFateControl`).

- [ ] **Step 5: `npm run build`**, commit

```bash
git add src/entrypoints/Config/fieldFateTree/
git commit -m "feat(config): three-state Translate/Copy/Skip radio control (spec §2)"
```

---

### Task 5: The recursive tree node (component)

**Files:**
- Create: `src/entrypoints/Config/fieldFateTree/FieldFateTreeNode.tsx`
- Test: `src/entrypoints/Config/fieldFateTree/FieldFateTreeNode.test.tsx`

**Interfaces:**
- Consumes: `FateFieldNode` (types), `FieldFateControl` (Task 4), `fateOf`/`rollup`/`setFate`/`cascadeFate` (Tasks 1-2), `flattenLeaves` (below).
- Produces:
  ```ts
  export const flattenLeaves = (node: FateFieldNode): FateFieldNode[]; // leaf descendants (no children)
  interface FieldFateTreeNodeProps {
    node: FateFieldNode;
    lists: FateLists;
    /** id → count of models embedding this block field's owner, for the §3.1 annotation. */
    usageCountById?: Map<string, number>;
    depth: number;
    onChange: (nextLists: FateLists, note?: string) => void;
  }
  ```
- A leaf node renders `<FieldFateControl>` with `value = fateOf(node, lists)`, `skipDisabled = node.required`, `onChange = (f) => onChange(setFate(node.id, node.apiKey, f, lists))`.
- A block node (has `children`) renders an expand toggle + `<FieldFateControl value={rollup(childFates)}>`; its `onChange` uses `cascadeFate(flattenLeaves(node).filter(has-no-children), fate, lists)` and passes the `keptRequired` note; renders children when expanded. Non-default child leaves show the global-scope annotation from `usageCountById`.

- [ ] **Step 1: Write the failing test** — a leaf emits `setFate` output on change; a block node cascades to descendants; `flattenLeaves` returns only childless descendants.

- [ ] **Step 2: Run — verify fail.**

- [ ] **Step 3: Implement** node + `flattenLeaves`.

- [ ] **Step 4: Run — verify pass.**

- [ ] **Step 5: `npm run build`**, commit

```bash
git commit -m "feat(config): recursive fate-tree node — cascade, rollup, global-scope note (spec §3.1-3.2)"
```

---

### Task 6: The per-model container (component)

**Files:**
- Create: `src/entrypoints/Config/fieldFateTree/FieldFateTree.tsx`
- Test: `src/entrypoints/Config/fieldFateTree/FieldFateTree.test.tsx`

**Interfaces:**
- Consumes: `FateModelNode` (types), `FieldFateTreeNode`, `summarize`, `fateOf`, `flattenLeaves`.
- Produces:
  ```ts
  interface FieldFateTreeProps {
    models: FateModelNode[];
    lists: FateLists;
    onChange: (nextLists: FateLists) => void;
  }
  export default function FieldFateTree(props: FieldFateTreeProps): JSX.Element;
  ```
- Each model = a `datocms-react-ui` `Section` `collapsible`, **closed by default**, header shows `summarize` counts over the model's leaf fates. Inside: a "Set all: [Translate][Copy][Skip]" row (cascades over all model leaves, surfaces `keptRequired` via a small note), a per-model filter input, the field nodes, and the non-translatable footer line. A top-level "Show non-default only" toggle filters models/fields to those with any Copy/Skip.

- [ ] **Step 1: Write the failing test** — renders a `Section` per model with counts in the header; collapsed by default (child rows not in the DOM until toggled, or hidden); "Set all → Copy" calls `onChange` with all model leaves copy-listed; the non-translatable footer shows.

- [ ] **Step 2: Run — verify fail.**

- [ ] **Step 3: Implement** container.

- [ ] **Step 4: Run — verify pass.**

- [ ] **Step 5: `npm run build`**, commit

```bash
git commit -m "feat(config): per-model fate-tree container — sections, counts, set-all, filter (spec §3)"
```

---

### Task 7: Extend the schema load to feed the tree

**Files:**
- Modify: `src/entrypoints/Config/fieldExclusionList.ts` (widen `FieldListEntry` OR add a parallel builder that keeps `field_type` + `validators` + `api_key`)
- Modify: `src/entrypoints/Config/ConfigScreen.tsx` (`loadFieldsForItemType` + the load-once effect to also cache raw fields per item type for `buildModelNode`)
- Test: extend `fieldExclusionList.test.ts` / add coverage that the loader captures the new attributes.

**Interfaces:**
- Consumes: `buildModelNode` (Task 3).
- Produces: `ConfigScreen` holds `fieldsByItemType: Map<string, LoadedField[]>` and `itemTypesById: Map<string, LoadedItemType>` state, and a memoized `models: FateModelNode[] = topLevelModels.map((it) => buildModelNode(it, fieldsByItemType, itemTypesById))`.

- [ ] **Step 1:** Add a test asserting the loader stores raw fields (`field_type`, `validators`, `api_key`) keyed by item type.
- [ ] **Step 2:** Run — verify fail.
- [ ] **Step 3:** Extend `loadFieldsForItemType` to also populate a `setFieldsByItemType` map (dedupe by item type id). Build `itemTypesById` from `ctx.itemTypes`. Memoize `models` (top-level = non-`modular_block` item types) via `buildModelNode`.
- [ ] **Step 4:** Run — verify pass. `npm run build`.
- [ ] **Step 5:** Commit

```bash
git commit -m "feat(config): cache raw fields + item types; derive fate-tree models (spec §3.4)"
```

---

### Task 8: Integrate the tree into the config screen

**Files:**
- Modify: `src/entrypoints/Config/ConfigScreen.tsx` (render `<FieldFateTree>`, retitle section "Projectwide translation rules", wire `fieldsToCopyFromSource` into state, `isFormDirty`, `updatePluginParams`, Restore-to-defaults)
- Modify: `src/entrypoints/Config/ExclusionRulesSection.tsx` (remove the field multi-select — models/roles stay)
- Modify: `src/entrypoints/Config/ConfigScreen.tsx` `checkFormDirty` + `isValidCtxParams` already tolerate `fieldsToCopyFromSource` (verify)
- Test: `ConfigScreen` integration — editing a fate dirties the form; Save writes both arrays; Restore clears both; a previously block-excluded sub-field still resolves to Skip (regression guard vs the old flat picker).

**Interfaces:**
- Consumes: `FieldFateTree` (Task 6). Local state `const [fateLists, setFateLists] = useState<FateLists>({ excludedTokens: apiKeysToBeExcluded, copyTokens: pluginParams.fieldsToCopyFromSource ?? [] })`.

- [ ] **Step 1: Write the failing test** (`ConfigScreen.test.tsx` or a focused harness) — mount with seeded params; assert the tree renders a model section; simulate a fate change and assert Save persists `apiKeysToBeExcludedFromThisPlugin` + `fieldsToCopyFromSource`.
- [ ] **Step 2:** Run — verify fail.
- [ ] **Step 3: Implement:**
  - Replace the field multi-select in `ExclusionRulesSection` usage with `<FieldFateTree models={models} lists={fateLists} onChange={setFateLists} />`.
  - Retitle the section to **"Projectwide translation rules"** (the model/role visibility pickers remain, under a "Where the plugin appears" sub-heading).
  - Thread `fieldsToCopyFromSource: fateLists.copyTokens` and `apiKeysToBeExcludedFromThisPlugin: fateLists.excludedTokens` into the Save `params`.
  - Add `fateLists` to `checkFormDirty` (compare both arrays against saved params via `normalizeList`).
  - Restore-to-defaults: `setFateLists({ excludedTokens: [], copyTokens: [] })`.
- [ ] **Step 4:** Run full suite `npm test`. `npm run build`. Manual: `npm run dev`, open config, verify a model expands, a fate flips, Save persists (check `ctx.plugin.attributes.parameters`).
- [ ] **Step 5:** Commit

```bash
git commit -m "feat(config): projectwide translation-rules tree replaces the exclusion multi-select (spec §4)"
```

---

### Task 9: Full-suite + build gate, self-review

- [ ] **Step 1:** `npm test` — entire suite green.
- [ ] **Step 2:** `npm run build` — clean.
- [ ] **Step 3:** Regression check: seed a config with a legacy `apiKeysToBeExcludedFromThisPlugin` containing a block sub-field id; confirm the tree shows it as Skip and Save round-trips it unchanged (no data loss vs the old flat picker).
- [ ] **Step 4:** Commit any fixes.

```bash
git commit -m "test(config): fate-tree suite green + legacy-exclusion round-trip regression guard"
```

---

## Self-Review

- **Spec coverage:** §1 fates/storage → Tasks 1, 8; §2 control → Task 4; §3 tree/crawl → Tasks 3, 5, 6, 7; §3.1 global scope → Task 5; §3.2 cascade/rollup → Tasks 2, 5; §3.3 non-translatable → Tasks 3, 6; §3.4 guards → Tasks 3, 7; §4 config home → Task 8 (run home = Phase 5, out of scope); §5 edge cases → Tasks 1-3, 6; §9 testing → every task. **Deferred by design:** run modal, id-migration, sentinel deletions (spec §7).
- **Placeholder scan:** Tasks 5-8 describe steps without full code blocks for the larger React components — these are component-assembly tasks where the interface block + test fully pin behavior; implement against the tests. Tasks 1-3 (the load-bearing pure logic) carry complete code.
- **Type consistency:** `FateLists`, `FieldFate`, `FateFieldNode`, `FateModelNode`, `FateNodeRef` defined in Tasks 1/3, consumed unchanged in 5-8. UI `'skip'` ↔ engine `'exclude'` boundary is isolated to `setFate`/`fateOf` (Task 1).
