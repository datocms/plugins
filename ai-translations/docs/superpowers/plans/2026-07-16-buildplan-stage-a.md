# buildPlan (Stage A) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: superpowers:subagent-driven-development or executing-plans. Steps use `- [ ]`.

**Goal:** Build the pure `buildPlan` function — schema + policy + source records → `TranslationPlan` IR — the producer half of the plan/apply architecture, feeding the already-built `conform` (Stage B).

**Architecture:** New file `src/engine/plan/buildPlan.ts` (+ small helpers), pure/synchronous. Consumes the existing `resolveFieldFate`, `cannotBeBlank`, locale helpers, and the `blockSignatureOf` from `checks/blockStructure`. Produces the `TranslationPlan`/`RecordPlan`/`RecordLocaleUnit`/`CellPlan` types from `./types`. No CMA, no providers, no engine wiring (write-path is a later plan).

**Tech Stack:** TypeScript ESNext, Vitest (`npm test`), pure functions.

## Global Constraints

- **Design spec:** `docs/superpowers/specs/2026-07-16-translation-plan-design.md` §5 (buildPlan absorbs three concerns: fate, new-locale completeness fill, model `all_locales_required`).
- **Pre-flight only:** `expected.placeholders`, `segmentCount`, `segmentAnchors` are populated later (reconstruct-time). This plan leaves them `undefined`.
- **CMA rule (spec §3):** an *existing* locale includes only `translate`/`copy` fields (omitting an `exclude` field preserves its existing value). A *new* locale includes **every** localized field as a cell (Locale Sync Rule).
- **`cannotBeBlank`, not `required`** (spec §5, v4 §4.1). `all_locales_required` forces every localized cell to `cannotBeBlank: true` and flips a would-be `exclude` fate to `copy` (never null).
- **Purity:** no I/O, no `Date.now`, no randomness. `sourceVersion`/`allLocalesRequired` are supplied as inputs (caller reads them from `ctx`).
- TSDoc on exports; `import type` for types; React-style booleans.

---

### Task A1: Input types + `existingLocalesOf` helper

**Files:** Create `src/engine/plan/buildPlanTypes.ts`, `src/engine/plan/existingLocales.ts`; Test `src/engine/plan/existingLocales.test.ts`.

**Produces:**
- `PlanField { id: string; apiKey: string; fieldType: string; isLocalized: boolean; validators: FieldValidators }`
- `PlanRecord { id: string; itemTypeId: string; meta?: { current_version?: string }; [apiKey: string]: unknown }`
- `PlanPolicy { excludedTokens: string[]; copyTokens: string[] }`
- `BuildPlanInput { records: PlanRecord[]; fieldsByItemType: Map<string, PlanField[]>; allLocalesRequiredByItemType: Map<string, boolean>; policy: PlanPolicy; fromLocale: string; toLocales: string[]; policyDigest: string }`
- `existingLocalesOf(record: PlanRecord, fields: PlanField[]): Set<string>` — union of locale keys present across the record's localized field values (lowercased for comparison).

- [ ] **Step 1: failing test** (`existingLocales.test.ts`)

```ts
import { describe, expect, it } from 'vitest';
import { existingLocalesOf } from './existingLocales';
import type { PlanField, PlanRecord } from './buildPlanTypes';

const field = (apiKey: string, isLocalized: boolean): PlanField =>
  ({ id: apiKey, apiKey, fieldType: 'string', isLocalized, validators: {} });

describe('existingLocalesOf', () => {
  it('unions locale keys across localized fields, lowercased', () => {
    const record: PlanRecord = {
      id: '1', itemTypeId: 'article',
      title: { en: 'Hi', it: 'Ciao' },
      slug: { en: 'hi' },
      views: 5,
    };
    const locales = existingLocalesOf(record, [field('title', true), field('slug', true), field('views', false)]);
    expect([...locales].sort()).toEqual(['en', 'it']);
  });
  it('returns empty when no localized field carries data', () => {
    expect(existingLocalesOf({ id: '1', itemTypeId: 'a' }, [field('title', true)]).size).toBe(0);
  });
});
```

- [ ] **Step 2:** `npm test -- existingLocales` → FAIL (module missing).
- [ ] **Step 3:** implement `buildPlanTypes.ts` (the interfaces above; `import type { FieldValidators } from '../../utils/translation/SharedFieldUtils'`) and `existingLocales.ts`:

```ts
import { findExactLocaleKey } from '../../utils/translation/SharedFieldUtils';
import type { PlanField, PlanRecord } from './buildPlanTypes';

/** Union (lowercased) of locale keys present on the record's localized fields. */
export function existingLocalesOf(record: PlanRecord, fields: PlanField[]): Set<string> {
  const locales = new Set<string>();
  for (const field of fields) {
    if (!field.isLocalized) continue;
    const value = record[field.apiKey];
    if (value && typeof value === 'object' && !Array.isArray(value)) {
      for (const key of Object.keys(value as Record<string, unknown>)) locales.add(key.toLowerCase());
    }
  }
  return locales;
}
```
(`findExactLocaleKey` import kept for parity with sibling code if needed; remove if unused to satisfy lint.)

- [ ] **Step 4:** `npm test -- existingLocales` → PASS.
- [ ] **Step 5:** commit `feat(plan): buildPlan input types + existingLocalesOf helper`.

---

### Task A2: `lengthBoundsOf` helper

**Files:** Create `src/engine/plan/lengthBounds.ts`; Test `src/engine/plan/lengthBounds.test.ts`.

**Produces:** `lengthBoundsOf(validators: FieldValidators): { min?: number; eq?: number; max?: number } | undefined` — extracts the `length` validator's numeric bounds, or `undefined` when absent.

- [ ] **Step 1: failing test**

```ts
import { describe, expect, it } from 'vitest';
import { lengthBoundsOf } from './lengthBounds';

describe('lengthBoundsOf', () => {
  it('extracts min/eq/max from a length validator', () => {
    expect(lengthBoundsOf({ length: { max: 100 } } as never)).toEqual({ max: 100 });
    expect(lengthBoundsOf({ length: { min: 3, max: 9 } } as never)).toEqual({ min: 3, max: 9 });
  });
  it('returns undefined when no length validator', () => {
    expect(lengthBoundsOf({} as never)).toBeUndefined();
    expect(lengthBoundsOf({ required: {} } as never)).toBeUndefined();
  });
});
```

- [ ] **Step 2:** `npm test -- lengthBounds` → FAIL.
- [ ] **Step 3:** implement:

```ts
import type { FieldValidators } from '../../utils/translation/SharedFieldUtils';

/** The field's string-length bounds ({min,eq,max}) if it has a length validator. */
export function lengthBoundsOf(
  validators: FieldValidators,
): { min?: number; eq?: number; max?: number } | undefined {
  if (!validators || typeof validators !== 'object') return undefined;
  const length = (validators as Record<string, unknown>).length as
    | { min?: number; eq?: number; max?: number } | undefined;
  if (!length || typeof length !== 'object') return undefined;
  const bounds: { min?: number; eq?: number; max?: number } = {};
  if (typeof length.min === 'number') bounds.min = length.min;
  if (typeof length.eq === 'number') bounds.eq = length.eq;
  if (typeof length.max === 'number') bounds.max = length.max;
  return Object.keys(bounds).length > 0 ? bounds : undefined;
}
```

- [ ] **Step 4:** `npm test -- lengthBounds` → PASS.
- [ ] **Step 5:** commit `feat(plan): lengthBoundsOf helper`.

---

### Task A3: `buildCell` — one field × one locale → CellPlan

**Files:** Create `src/engine/plan/buildCell.ts`; Test `src/engine/plan/buildCell.test.ts`.

**Consumes:** `resolveFieldFate`, `cannotBeBlank` (`../fieldFate`); `blockSignatureOf` (`./checks/blockStructure`); `lengthBoundsOf`, `getExactSourceValue`; `CellPlan` (`./types`); `PlanField`, `PlanRecord`, `PlanPolicy` (`./buildPlanTypes`).

**Produces:** `buildCell(args: { field: PlanField; record: PlanRecord; toLocale: string; fromLocale: string; policy: PlanPolicy; allLocalesRequired: boolean; existingLocales: Set<string> }): CellPlan`.

Behavior:
- `fate` = `resolveFieldFate({ fieldId, fieldApiKey, validators, excludedTokens, copyTokens })`; if `allLocalesRequired && fate === 'exclude'` → `'copy'`.
- `cannotBeBlank` = `cannotBeBlank(validators) || allLocalesRequired`.
- `expected.preservedLocales` = the field value's existing locale keys (from `record[apiKey]`), or `[]`.
- `expected.lengthBounds` = `lengthBoundsOf(validators)`.
- `expected.blockSignature` = `blockSignatureOf(sourceValue)` when the source value is block-bearing (array/`{type:'item'}`); else omit.

- [ ] **Step 1: failing test** — cover: a `translate` string field with a `length` validator sets `lengthBounds`; a required field sets `cannotBeBlank`; `allLocalesRequired` flips an excluded field to `copy` and forces `cannotBeBlank`; `preservedLocales` reflects the source value's locale keys.

```ts
import { describe, expect, it } from 'vitest';
import { buildCell } from './buildCell';
import type { PlanField, PlanРecordPolicyPlaceholder } from './buildPlanTypes';
```
(Author the four cases against the behavior above; use a real `PlanField`/`PlanRecord`/`PlanPolicy`. Example:)

```ts
import { describe, expect, it } from 'vitest';
import { buildCell } from './buildCell';
import type { PlanField, PlanRecord, PlanPolicy } from './buildPlanTypes';

const policy: PlanPolicy = { excludedTokens: [], copyTokens: [] };
const strField = (over: Partial<PlanField> = {}): PlanField =>
  ({ id: 'title', apiKey: 'title', fieldType: 'string', isLocalized: true, validators: {}, ...over });
const record: PlanRecord = { id: '1', itemTypeId: 'article', title: { en: 'Hi', it: 'Ciao' } };

describe('buildCell', () => {
  it('sets lengthBounds for a length-validated field', () => {
    const cell = buildCell({ field: strField({ validators: { length: { max: 100 } } as never }), record, toLocale: 'it', fromLocale: 'en', policy, allLocalesRequired: false, existingLocales: new Set(['en', 'it']) });
    expect(cell.fate).toBe('translate');
    expect(cell.expected.lengthBounds).toEqual({ max: 100 });
    expect(cell.expected.preservedLocales.sort()).toEqual(['en', 'it']);
  });
  it('marks a required field cannotBeBlank', () => {
    const cell = buildCell({ field: strField({ validators: { required: {} } as never }), record, toLocale: 'it', fromLocale: 'en', policy, allLocalesRequired: false, existingLocales: new Set() });
    expect(cell.cannotBeBlank).toBe(true);
  });
  it('all_locales_required flips exclude→copy and forces cannotBeBlank', () => {
    const cell = buildCell({ field: strField(), record, toLocale: 'it', fromLocale: 'en', policy: { excludedTokens: ['title'], copyTokens: [] }, allLocalesRequired: true, existingLocales: new Set() });
    expect(cell.fate).toBe('copy');
    expect(cell.cannotBeBlank).toBe(true);
  });
});
```

- [ ] **Step 2:** `npm test -- buildCell` → FAIL.
- [ ] **Step 3:** implement per the behavior list. Detect block-bearing via `Array.isArray(sourceValue) || (sourceValue && sourceValue.type === 'item')`. Only set `expected` sub-keys that apply (omit `undefined`).
- [ ] **Step 4:** `npm test -- buildCell` → PASS.
- [ ] **Step 5:** commit `feat(plan): buildCell — field×locale to CellPlan`.

---

### Task A4: `buildRecordLocaleUnit` — completeness fill

**Files:** Create `src/engine/plan/buildUnit.ts`; Test `src/engine/plan/buildUnit.test.ts`.

**Consumes:** `buildCell`; `existingLocalesOf`; `resolveFieldFate` (to decide inclusion). **Produces:** `buildRecordLocaleUnit(args: { record; fields: PlanField[]; toLocale; fromLocale; policy; allLocalesRequired; existingLocales: Set<string> }): RecordLocaleUnit`.

Inclusion rule (spec §3 / Global Constraints):
- `isNewLocale = !existingLocales.has(toLocale.toLowerCase())`.
- For each **localized** field: compute its fate. Include a cell when `isNewLocale` (ALL localized fields — completeness) OR the fate ∈ {`translate`,`copy`}. Skip a non-localized field always.

- [ ] **Step 1: failing test** — (a) existing locale: an excluded field yields NO cell, a translate field yields one; (b) new locale: the excluded field ALSO yields a cell (completeness); `isNewLocale` set correctly.
- [ ] **Step 2:** `npm test -- buildUnit` → FAIL.
- [ ] **Step 3:** implement. Reuse `resolveFieldFate` for the inclusion decision, then delegate cell construction to `buildCell` (which recomputes fate — acceptable; keep one source of the fate args in a local helper to stay DRY).
- [ ] **Step 4:** `npm test -- buildUnit` → PASS.
- [ ] **Step 5:** commit `feat(plan): buildRecordLocaleUnit with new-locale completeness fill`.

---

### Task A5: `buildPlan` top-level

**Files:** Create `src/engine/plan/buildPlan.ts`; Test `src/engine/plan/buildPlan.test.ts`.

**Consumes:** `buildRecordLocaleUnit`, `existingLocalesOf`, `BuildPlanInput` types. **Produces:** `buildPlan(input: BuildPlanInput): TranslationPlan`.

Behavior: for each record → look up `fields = fieldsByItemType.get(itemTypeId) ?? []`, `allLocalesRequired = allLocalesRequiredByItemType.get(itemTypeId) ?? false`, `existingLocales = existingLocalesOf(record, fields)`, `sourceVersion = record.meta?.current_version ?? ''`; build one unit per `toLocale`; assemble `RecordPlan`. Return `{ records, policyDigest }`.

- [ ] **Step 1: failing test** — a 1-record, 2-locale input yields a `RecordPlan` with 2 units, correct `sourceVersion`, `allLocalesRequired`, and cells present. An unknown item type yields a record with empty-cell units (no throw).
- [ ] **Step 2:** `npm test -- plan/buildPlan` → FAIL.
- [ ] **Step 3:** implement.
- [ ] **Step 4:** `npm test -- plan/buildPlan` → PASS.
- [ ] **Step 5:** commit `feat(plan): buildPlan — schema+policy+records to TranslationPlan`.

---

### Task A6: barrel + full-suite/build gate

**Files:** Modify `src/engine/plan/index.ts`.

- [ ] **Step 1:** extend the barrel with `buildPlan`, `buildRecordLocaleUnit`, `buildCell`, `existingLocalesOf`, `lengthBoundsOf`, and the `buildPlanTypes` types.
- [ ] **Step 2:** `npm test` → entire suite green.
- [ ] **Step 3:** `npm run build` → clean.
- [ ] **Step 4:** commit `feat(plan): export buildPlan (Stage A) from the plan barrel`.

## Self-Review (author)

- Spec §5 coverage: fate (A3), cannotBeBlank+all_locales_required (A3), new-locale completeness fill (A4), lengthBounds/blockSignature/preservedLocales expectations (A2/A3). Deferred (own plan): placeholder/segment expectations (reconstruct-time), htmlBlocks/mdBlocks (can be added to buildCell later from source value), and the write-path.
- No placeholders except the intentionally-noted A3 test-stub line (fix on implement — the real example block below it governs).
- Type consistency: `PlanField`/`PlanRecord`/`PlanPolicy`/`BuildPlanInput` names are stable across A1/A3/A4/A5; `buildCell`/`buildRecordLocaleUnit`/`buildPlan` signatures consistent.
