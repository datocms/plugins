# Integration Step 0 — Pure Glue & Layer Changes — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: superpowers:subagent-driven-development or executing-plans. Steps use `- [ ]`.

**Goal:** Build the pure pieces the plan/apply→live integration needs, per the integration design (rev2): a provenance-aware reconstructor, a net-new-only flag collector, the missing `checkLocaleCompleteness`, the assembled-body check pass, a canonical `policyDigest`, and the `buildPlan` version-fallback fix. All pure, TDD, no live wiring — the suite stays green.

**Architecture:** New files under `src/engine/plan/` (net-new checks/collectors) and `src/engine/report/` (policyDigest). Everything composes already-built pure checks; nothing touches `ItemsDropdownUtils`/`engine/index.ts`. The one edit to existing code is a one-line `buildPlan` fallback + its test.

**Tech Stack:** TypeScript ESNext, Vitest (`npm test`), pure functions.

## Global Constraints

- **Design spec:** `docs/superpowers/specs/2026-07-17-plan-apply-integration-design.md` (rev2). Section refs are to it.
- **Provenance rule (§4, review finding):** the net-new collector judges ONLY genuinely-translated fields — `localeResult.translatedFields`. Copied / fallback-filled / failed fields are `undefined` to it (never judged).
- **Ownership partition (§5):** the plan-side seam collector runs **ONLY** `block-structure` + `block-id-provenance`. `truncated`/`length-validator`/placeholder/structural/copied are the **engine's** `qcFlags`. `segment-alignment` is **struck** from the seam. `cannot-be-blank`/`locale-preservation`/`locale-completeness` run at **assembly time on the body**, not per cell.
- **Verify with:** `npm run build && npm test` — gate every commit on **both** (vitest passes unused imports/bad intersections that `tsc` rejects; this bit us twice).
- **Reused signatures (do not redefine):**
  - `checkBlockStructure({ value, expected: BlockSignature, fieldPath?, locale? }): QcFlag | null` — `src/engine/plan/checks/blockStructure.ts`
  - `checkBlockIdProvenance({ sourceValue, targetValue, fieldPath?, locale? }): QcFlag | null` — `src/engine/plan/checks/blockIdProvenance.ts`
  - `checkLocalePreservation({ outgoing, preservedLocales: string[], fieldPath?, locale? }): QcFlag | null` — `src/engine/plan/checks/localePreservation.ts`
  - `checkCannotBeBlank({ value, cannotBeBlank: boolean, fieldPath?, locale? }): QcFlag | null` — `src/engine/plan/checks/cannotBeBlank.ts`
  - `unitKey(recordId, toLocale): string` — `src/engine/plan/conform.ts`
  - `getExactSourceValue(fieldData, fromLocale): unknown` — `src/utils/translation/SharedFieldUtils.ts`
  - Types: `TranslationPlan { records: RecordPlan[]; policyDigest }`, `RecordPlan { recordId, itemTypeId, fromLocale, sourceVersion?, allLocalesRequired, units: RecordLocaleUnit[] }`, `RecordLocaleUnit { toLocale, isNewLocale, cells: CellPlan[] }`, `CellPlan { fieldPath, fieldType, toLocale, fate, cannotBeBlank, expected: CellExpectation }`, `CellExpectation { preservedLocales, blockSignature?, ... }`, `PlanPolicy { excludedTokens, copyTokens }` — `src/engine/plan/types.ts`, `buildPlanTypes.ts`.
  - `BuildTranslatedUpdatePayloadResult { payload: Record<string, Record<string, unknown>>; translatedFields: string[]; qcFlags; ... }` — `src/utils/translation/ItemsDropdownUtils.ts:404`.
  - `ReconstructedCell { translatedValue; sourceValue?; finishReason? }` — `src/engine/plan/collectUnitFlags.ts`.

---

### Task 1: `reconstructTranslatedCells` (provenance-aware)

**Files:** Create `src/engine/plan/reconstructTranslatedCells.ts`; Test `…test.ts`.

**Produces:** `reconstructTranslatedCells(args: { payload: Record<string, Record<string, unknown>>; translatedFields: string[]; record: Record<string, unknown>; fromLocale: string; toLocale: string }): (recordId: string, fieldPath: string, locale: string) => ReconstructedCell | undefined`.

Behavior: returns a cell ONLY when `fieldPath ∈ translatedFields` AND `locale === toLocale`; the cell's `translatedValue = payload[fieldPath]?.[toLocale]`, `sourceValue = getExactSourceValue(record[fieldPath], fromLocale)`. Everything else → `undefined` (so the net-new invariants never judge a copied/fallback/failed field).

- [ ] **Step 1: failing test**

```ts
import { describe, expect, it } from 'vitest';
import { reconstructTranslatedCells } from './reconstructTranslatedCells';

const base = {
  payload: { title: { en: 'Hi', it: 'Ciao' }, brand: { en: 'Acme', it: 'Acme' } },
  translatedFields: ['title'], // brand was copied, not translated
  record: { title: { en: 'Hi' }, brand: { en: 'Acme' } },
  fromLocale: 'en',
  toLocale: 'it',
};

describe('reconstructTranslatedCells', () => {
  it('returns a cell only for genuinely-translated fields in the target locale', () => {
    const at = reconstructTranslatedCells(base);
    expect(at('r1', 'title', 'it')).toEqual({ translatedValue: 'Ciao', sourceValue: 'Hi' });
  });
  it('returns undefined for a copied/fallback field (not in translatedFields)', () => {
    expect(reconstructTranslatedCells(base)('r1', 'brand', 'it')).toBeUndefined();
  });
  it('returns undefined for a non-target locale', () => {
    expect(reconstructTranslatedCells(base)('r1', 'title', 'de')).toBeUndefined();
  });
});
```

- [ ] **Step 2:** `npm test -- reconstructTranslatedCells` → FAIL (module missing).
- [ ] **Step 3: implement**

```ts
/**
 * Builds the reconstruct lookup for the net-new invariants, restricted by
 * PROVENANCE (integration spec §4): only fields the provider genuinely translated
 * (`translatedFields`) are judged. Copied / fallback-filled / failed fields return
 * `undefined`, so block-structure/block-id-provenance never fire against a fallback
 * null. The write body, separately, uses the engine payload verbatim.
 */
import { getExactSourceValue } from '../../utils/translation/SharedFieldUtils';
import type { ReconstructedCell } from './collectUnitFlags';

export function reconstructTranslatedCells(args: {
  payload: Record<string, Record<string, unknown>>;
  translatedFields: string[];
  record: Record<string, unknown>;
  fromLocale: string;
  toLocale: string;
}): (recordId: string, fieldPath: string, locale: string) => ReconstructedCell | undefined {
  const translated = new Set(args.translatedFields);
  return (_recordId, fieldPath, locale) => {
    if (locale !== args.toLocale || !translated.has(fieldPath)) return undefined;
    return {
      translatedValue: args.payload[fieldPath]?.[args.toLocale],
      sourceValue: getExactSourceValue(
        args.record[fieldPath] as Record<string, unknown> | undefined,
        args.fromLocale,
      ),
    };
  };
}
```

- [ ] **Step 4:** `npm test -- reconstructTranslatedCells` → PASS.
- [ ] **Step 5:** `npm run build && npm test` → green; commit `feat(plan): reconstructTranslatedCells — provenance-restricted reconstruct for the seam`.

---

### Task 2: `checkNetNewCell` + `collectNetNewFlags` + disjoint guard

**Files:** Create `src/engine/plan/collectNetNewFlags.ts`; Test `…test.ts`.

**Produces:**
- `checkNetNewCell(args: { cell: CellPlan; translatedValue: unknown; sourceValue?: unknown }): QcFlag[]` — runs ONLY `checkBlockStructure` (when `cell.expected.blockSignature`) + `checkBlockIdProvenance` (when `sourceValue !== undefined`).
- `collectNetNewFlags(plan: TranslationPlan, resultFor): Map<string, QcFlag[]>` — walks the plan, calls `checkNetNewCell` per cell whose `resultFor` yields a value, groups by `unitKey`.
- `SEAM_NET_NEW_CHECK_IDS: readonly QcCheckId[]` = `['block-structure','block-id-provenance']` (for the disjoint test).

- [ ] **Step 1: failing test** — cover: a dropped block → `block-structure`; a leaked source id → `block-id-provenance`; a clean cell → no flags; grouping under the right `unitKey`; and the disjoint guard: `SEAM_NET_NEW_CHECK_IDS` shares nothing with the engine-owned set `['truncated','length-validator','placeholder-loss','html-structure','markdown-structure','copied-from-source']`.

```ts
import { describe, expect, it } from 'vitest';
import { checkNetNewCell, collectNetNewFlags, SEAM_NET_NEW_CHECK_IDS } from './collectNetNewFlags';
import { unitKey } from './conform';
import type { CellPlan, TranslationPlan } from './types';

const cell = (over: Partial<CellPlan> = {}): CellPlan => ({
  fieldPath: 'body', fieldType: 'rich_text', toLocale: 'it', fate: 'translate',
  cannotBeBlank: false, expected: { preservedLocales: [] }, ...over,
});
const block = (id?: string) => ({ type: 'item', ...(id ? { id } : {}), attributes: {}, relationships: {} });

describe('checkNetNewCell', () => {
  it('runs ONLY block-structure and block-id-provenance', () => {
    const flags = checkNetNewCell({
      cell: cell({ expected: { preservedLocales: [], blockSignature: { count: 2, children: [] } } }),
      translatedValue: [block()], sourceValue: [block('s1')],
    });
    expect(flags.map((f) => f.checkId).sort()).toEqual(['block-structure']);
  });
  it('flags a leaked source id', () => {
    const flags = checkNetNewCell({ cell: cell(), translatedValue: [block('s1')], sourceValue: [block('s1')] });
    expect(flags.map((f) => f.checkId)).toContain('block-id-provenance');
  });
  it('never emits an engine-owned checkId', () => {
    const flags = checkNetNewCell({ cell: cell(), translatedValue: '', sourceValue: '' });
    expect(flags.some((f) => ['truncated', 'length-validator', 'cannot-be-blank'].includes(f.checkId))).toBe(false);
  });
});

describe('collectNetNewFlags', () => {
  const plan: TranslationPlan = {
    policyDigest: 'x',
    records: [{ recordId: 'r1', itemTypeId: 'a', fromLocale: 'en', sourceVersion: 'v', allLocalesRequired: false,
      units: [{ toLocale: 'it', isNewLocale: false, cells: [cell({ expected: { preservedLocales: [], blockSignature: { count: 1, children: [] } } })] }] }],
  };
  it('groups net-new flags under the unit key', () => {
    const flags = collectNetNewFlags(plan, () => ({ translatedValue: [], sourceValue: [block('s')] }));
    expect(flags.get(unitKey('r1', 'it'))?.map((f) => f.checkId)).toContain('block-structure');
  });
});

describe('ownership partition', () => {
  it('is disjoint from the engine-owned check ids', () => {
    const engineOwned = ['truncated', 'length-validator', 'placeholder-loss', 'html-structure', 'markdown-structure', 'copied-from-source'];
    expect(SEAM_NET_NEW_CHECK_IDS.some((id) => engineOwned.includes(id))).toBe(false);
  });
});
```

- [ ] **Step 2:** `npm test -- collectNetNewFlags` → FAIL.
- [ ] **Step 3: implement**

```ts
/**
 * The seam's net-new flag collector (integration spec §4.1/§5): runs ONLY the
 * invariants the engine does NOT already emit — block-structure and
 * block-id-provenance — over genuinely-translated cells. Disjoint by checkId from
 * the engine's qcFlags (truncated/length/placeholder/structural/copied) and from
 * the assembly-time body pass (cannot-be-blank/locale-preservation/completeness).
 */
import type { QcCheckId, QcFlag } from '../../utils/translation/qc/types';
import { checkBlockStructure } from './checks/blockStructure';
import { checkBlockIdProvenance } from './checks/blockIdProvenance';
import { unitKey } from './conform';
import type { ReconstructedCell } from './collectUnitFlags';
import type { CellPlan, TranslationPlan } from './types';

export const SEAM_NET_NEW_CHECK_IDS: readonly QcCheckId[] = ['block-structure', 'block-id-provenance'];

export function checkNetNewCell(args: {
  cell: CellPlan;
  translatedValue: unknown;
  sourceValue?: unknown;
}): QcFlag[] {
  const { cell, translatedValue, sourceValue } = args;
  const { fieldPath, toLocale: locale, expected } = cell;
  const flags: QcFlag[] = [];
  if (expected.blockSignature) {
    const flag = checkBlockStructure({ value: translatedValue, expected: expected.blockSignature, fieldPath, locale });
    if (flag) flags.push(flag);
  }
  if (sourceValue !== undefined) {
    const flag = checkBlockIdProvenance({ sourceValue, targetValue: translatedValue, fieldPath, locale });
    if (flag) flags.push(flag);
  }
  return flags;
}

export function collectNetNewFlags(
  plan: TranslationPlan,
  resultFor: (recordId: string, fieldPath: string, toLocale: string) => ReconstructedCell | undefined,
): Map<string, QcFlag[]> {
  const byUnit = new Map<string, QcFlag[]>();
  for (const record of plan.records) {
    for (const unit of record.units) {
      const key = unitKey(record.recordId, unit.toLocale);
      for (const cell of unit.cells) {
        const result = resultFor(record.recordId, cell.fieldPath, unit.toLocale);
        if (!result) continue;
        const flags = checkNetNewCell({ cell, translatedValue: result.translatedValue, sourceValue: result.sourceValue });
        if (flags.length === 0) continue;
        const existing = byUnit.get(key);
        if (existing) existing.push(...flags);
        else byUnit.set(key, [...flags]);
      }
    }
  }
  return byUnit;
}
```

- [ ] **Step 4:** `npm test -- collectNetNewFlags` → PASS.
- [ ] **Step 5:** `npm run build && npm test`; commit `feat(plan): collectNetNewFlags — seam collector (block-structure+block-id-provenance only) + disjoint guard`.

---

### Task 3: `checkLocaleCompleteness` (new invariant)

**Files:** Create `src/engine/plan/checks/localeCompleteness.ts`; Test `…test.ts`.

**Produces:** `checkLocaleCompleteness(args: { body: Record<string, Record<string, unknown>>; recordPlan: RecordPlan }): QcFlag[]` — for each `isNewLocale` unit, every cell's `fieldPath` MUST be present in `body[fieldPath]` for that locale (Locale Sync Rule); a missing one → `{ checkId: 'locale-completeness', severity: 'error', fieldPath, locale }`.

- [ ] **Step 1: failing test**

```ts
import { describe, expect, it } from 'vitest';
import { checkLocaleCompleteness } from './localeCompleteness';
import type { RecordPlan } from '../types';

const recordPlan = (isNewLocale: boolean): RecordPlan => ({
  recordId: 'r1', itemTypeId: 'a', fromLocale: 'en', sourceVersion: 'v', allLocalesRequired: false,
  units: [{ toLocale: 'de', isNewLocale, cells: [
    { fieldPath: 'title', fieldType: 'string', toLocale: 'de', fate: 'translate', cannotBeBlank: false, expected: { preservedLocales: [] } },
    { fieldPath: 'body', fieldType: 'string', toLocale: 'de', fate: 'copy', cannotBeBlank: false, expected: { preservedLocales: [] } },
  ] }],
});

describe('checkLocaleCompleteness', () => {
  it('passes when a new locale carries every field', () => {
    const body = { title: { en: 'x', de: 'y' }, body: { en: 'x', de: 'y' } };
    expect(checkLocaleCompleteness({ body, recordPlan: recordPlan(true) })).toEqual([]);
  });
  it('flags a new-locale field missing from the body (would 422 VALIDATION_INVALID_LOCALES)', () => {
    const body = { title: { en: 'x', de: 'y' } }; // body (field) missing for de
    const flags = checkLocaleCompleteness({ body, recordPlan: recordPlan(true) });
    expect(flags).toHaveLength(1);
    expect(flags[0]).toMatchObject({ checkId: 'locale-completeness', severity: 'error', fieldPath: 'body', locale: 'de' });
  });
  it('ignores existing locales (only new locales must be complete)', () => {
    expect(checkLocaleCompleteness({ body: { title: { en: 'x', de: 'y' } }, recordPlan: recordPlan(false) })).toEqual([]);
  });
});
```

- [ ] **Step 2:** `npm test -- localeCompleteness` → FAIL.
- [ ] **Step 3: implement**

```ts
/**
 * Invariant: when a NEW locale is added to a record, EVERY localized field must
 * carry it in the write body, or the CMA rejects the whole update with
 * VALIDATION_INVALID_LOCALES (Locale Sync Rule). Runs at assembly time on the
 * final body (integration spec §5). Existing locales are exempt (omitting a field
 * for them preserves its value).
 */
import type { QcFlag } from '../../../utils/translation/qc/types';
import type { RecordPlan } from '../types';

export function checkLocaleCompleteness(args: {
  body: Record<string, Record<string, unknown>>;
  recordPlan: RecordPlan;
}): QcFlag[] {
  const flags: QcFlag[] = [];
  for (const unit of args.recordPlan.units) {
    if (!unit.isNewLocale) continue;
    for (const cell of unit.cells) {
      const present = args.body[cell.fieldPath] && cell.toLocale in args.body[cell.fieldPath];
      if (!present) {
        flags.push({
          checkId: 'locale-completeness',
          severity: 'error',
          fieldPath: cell.fieldPath,
          locale: unit.toLocale,
          message: `New locale "${unit.toLocale}" is missing field "${cell.fieldPath}"; the CMA would reject the whole record.`,
        });
      }
    }
  }
  return flags;
}
```

- [ ] **Step 4:** `npm test -- localeCompleteness` → PASS.
- [ ] **Step 5:** `npm run build && npm test`; commit `feat(plan): checkLocaleCompleteness invariant (Locale Sync Rule on the assembled body)`.

---

### Task 4: `checkAssembledBody` (the body pass)

**Files:** Create `src/engine/plan/checkAssembledBody.ts`; Test `…test.ts`.

**Produces:** `checkAssembledBody(args: { body: Record<string, Record<string, unknown>>; recordPlan: RecordPlan }): QcFlag[]` — the assembly-time gate composing three checks over the final body:
- **locale-preservation** (per field): `checkLocalePreservation({ outgoing: body[fieldPath], preservedLocales })` using the field's `preservedLocales` (from any cell with that `fieldPath`). A drop is catastrophic for the whole write, so **emit the flag for EVERY target locale of the record** (so conform blocks all units → nothing is written).
- **cannot-be-blank** (per field×locale where `cell.cannotBeBlank`): `checkCannotBeBlank({ value: body[fieldPath]?.[toLocale], cannotBeBlank: true })`.
- **locale-completeness**: delegate to `checkLocaleCompleteness`.

All flags carry `fieldPath`+`locale`; the seam caller keys them via `unitKey(recordPlan.recordId, flag.locale)`.

- [ ] **Step 1: failing test** — cover: clean body → no flags; a dropped existing locale → a `locale-preservation` error for every target locale; a blank required field → `cannot-be-blank` for that field×locale; a missing new-locale field → `locale-completeness`.

```ts
import { describe, expect, it } from 'vitest';
import { checkAssembledBody } from './checkAssembledBody';
import type { RecordPlan } from './types';

const plan = (over: Partial<RecordPlan> = {}): RecordPlan => ({
  recordId: 'r1', itemTypeId: 'a', fromLocale: 'en', sourceVersion: 'v', allLocalesRequired: false,
  units: [
    { toLocale: 'it', isNewLocale: false, cells: [{ fieldPath: 'title', fieldType: 'string', toLocale: 'it', fate: 'translate', cannotBeBlank: true, expected: { preservedLocales: ['en', 'it'] } }] },
    { toLocale: 'de', isNewLocale: false, cells: [{ fieldPath: 'title', fieldType: 'string', toLocale: 'de', fate: 'translate', cannotBeBlank: true, expected: { preservedLocales: ['en', 'de'] } }] },
  ],
  ...over,
});

describe('checkAssembledBody', () => {
  it('passes a clean body', () => {
    const body = { title: { en: 'Hi', it: 'Ciao', de: 'Hallo' } };
    expect(checkAssembledBody({ body, recordPlan: plan() })).toEqual([]);
  });
  it('blocks EVERY target locale when a field would drop an existing locale', () => {
    const body = { title: { it: 'Ciao', de: 'Hallo' } }; // en dropped!
    const flags = checkAssembledBody({ body, recordPlan: plan() });
    const preservation = flags.filter((f) => f.checkId === 'locale-preservation');
    expect(preservation.map((f) => f.locale).sort()).toEqual(['de', 'it']);
  });
  it('flags a blank required field per locale', () => {
    const body = { title: { en: 'Hi', it: '', de: 'Hallo' } };
    const flags = checkAssembledBody({ body, recordPlan: plan() });
    expect(flags.some((f) => f.checkId === 'cannot-be-blank' && f.locale === 'it')).toBe(true);
  });
});
```

- [ ] **Step 2:** `npm test -- checkAssembledBody` → FAIL.
- [ ] **Step 3: implement**

```ts
/**
 * The assembly-time gate (integration spec §5): runs the body-level invariants
 * over the FINAL items.update body — locale-preservation (per field; a drop
 * blocks the whole record), cannot-be-blank (per field×locale), and
 * locale-completeness. Emitted flags carry fieldPath+locale; the seam keys them
 * into flagsByUnit before conform.
 */
import type { QcFlag } from '../../utils/translation/qc/types';
import { checkCannotBeBlank } from './checks/cannotBeBlank';
import { checkLocalePreservation } from './checks/localePreservation';
import { checkLocaleCompleteness } from './checks/localeCompleteness';
import type { CellPlan, RecordPlan } from './types';

export function checkAssembledBody(args: {
  body: Record<string, Record<string, unknown>>;
  recordPlan: RecordPlan;
}): QcFlag[] {
  const { body, recordPlan } = args;
  const targetLocales = recordPlan.units.map((u) => u.toLocale);
  const flags: QcFlag[] = [];

  // preservedLocales per field (same across units); pick any cell for the field.
  const cellByField = new Map<string, CellPlan>();
  for (const unit of recordPlan.units) for (const cell of unit.cells) cellByField.set(cell.fieldPath, cell);

  for (const [fieldPath, cell] of cellByField) {
    const drop = checkLocalePreservation({ outgoing: body[fieldPath], preservedLocales: cell.expected.preservedLocales, fieldPath });
    // A dropped locale poisons the single record write — block every target locale.
    if (drop) for (const locale of targetLocales) flags.push({ ...drop, locale });
  }

  for (const unit of recordPlan.units) {
    for (const cell of unit.cells) {
      if (!cell.cannotBeBlank) continue;
      const blank = checkCannotBeBlank({ value: body[cell.fieldPath]?.[unit.toLocale], cannotBeBlank: true, fieldPath: cell.fieldPath, locale: unit.toLocale });
      if (blank) flags.push(blank);
    }
  }

  flags.push(...checkLocaleCompleteness({ body, recordPlan }));
  return flags;
}
```

- [ ] **Step 4:** `npm test -- checkAssembledBody` → PASS.
- [ ] **Step 5:** `npm run build && npm test`; commit `feat(plan): checkAssembledBody — assembly-time gate (preservation+cannot-be-blank+completeness)`.

---

### Task 5: canonical `policyDigest`

**Files:** Create `src/engine/report/policyDigest.ts`; Test `…test.ts`.

**Produces:** `policyDigest(policy: PlanPolicy): string` — an order-independent hash. Sort `excludedTokens` and `copyTokens`, stable-stringify, hash via the existing `crc32` (hex). Semantically-identical policies MUST produce the same digest (it gates resume via `isPolicyCompatible`).

- [ ] **Step 1: failing test**

```ts
import { describe, expect, it } from 'vitest';
import { policyDigest } from './policyDigest';

describe('policyDigest', () => {
  it('is order-independent over the token lists', () => {
    expect(policyDigest({ excludedTokens: ['a', 'b'], copyTokens: ['x'] }))
      .toBe(policyDigest({ excludedTokens: ['b', 'a'], copyTokens: ['x'] }));
  });
  it('changes when a token changes', () => {
    expect(policyDigest({ excludedTokens: ['a'], copyTokens: [] }))
      .not.toBe(policyDigest({ excludedTokens: ['a', 'c'], copyTokens: [] }));
  });
  it('does not confuse the two lists', () => {
    expect(policyDigest({ excludedTokens: ['a'], copyTokens: [] }))
      .not.toBe(policyDigest({ excludedTokens: [], copyTokens: ['a'] }));
  });
});
```

- [ ] **Step 2:** `npm test -- policyDigest` → FAIL.
- [ ] **Step 3: implement**

```ts
/**
 * Canonical, order-independent digest of the locked policy — the resume gate
 * (persistence §3 / recovery.isPolicyCompatible). Two semantically-identical
 * policies MUST hash equal, so the token lists are sorted before hashing and the
 * two lists are kept distinguishable.
 */
import type { PlanPolicy } from '../plan/buildPlanTypes';
import { crc32 } from './crc32';

export function policyDigest(policy: PlanPolicy): string {
  const canonical = JSON.stringify({
    excluded: [...policy.excludedTokens].sort(),
    copy: [...policy.copyTokens].sort(),
  });
  return crc32(new TextEncoder().encode(canonical)).toString(16).padStart(8, '0');
}
```

- [ ] **Step 4:** `npm test -- policyDigest` → PASS.
- [ ] **Step 5:** `npm run build && npm test`; commit `feat(report): canonical policyDigest (order-independent resume gate)`.

---

### Task 6: `buildPlan` version fallback (`''` → `undefined`)

**Files:** Modify `src/engine/plan/buildPlan.ts`; Test `src/engine/plan/buildPlan.test.ts`.

**Change:** `sourceVersion: record.meta?.current_version ?? ''` → `?? undefined`, so a versionless record omits `meta` on write (matching today's `buildRecordUpdateBody` omit-when-absent). `RecordPlan.sourceVersion` is already `string | undefined`-compatible.

- [ ] **Step 1: update the failing test** — the existing buildPlan test asserts `sourceVersion === ''` for a meta-less record; change it to assert `undefined`.

```ts
// in buildPlan.test.ts, the meta-less case:
it('defaults sourceVersion to undefined when meta is absent', () => {
  const plan = buildPlan(input({ records: [{ id: '2', itemTypeId: 'article', title: { en: 'x' } }] }));
  expect(plan.records[0].sourceVersion).toBeUndefined();
});
```

- [ ] **Step 2:** `npm test -- plan/buildPlan` → FAIL (currently `''`).
- [ ] **Step 3: implement** — in `buildPlan.ts`: `sourceVersion: record.meta?.current_version ?? undefined,`.
- [ ] **Step 4:** `npm test -- plan/buildPlan` → PASS.
- [ ] **Step 5:** `npm run build && npm test`; commit `fix(plan): buildPlan omits sourceVersion when the record has no version (undefined, not '')`.

---

### Task 7: barrel + full gate

**Files:** Modify `src/engine/plan/index.ts`, `src/engine/report/index.ts`.

- [ ] **Step 1:** export `reconstructTranslatedCells`, `checkNetNewCell`/`collectNetNewFlags`/`SEAM_NET_NEW_CHECK_IDS`, `checkLocaleCompleteness`, `checkAssembledBody` from the plan barrel; `policyDigest` from the report barrel.
- [ ] **Step 2:** `npm run build && npm test` → entire suite green, clean build.
- [ ] **Step 3:** commit `feat(plan): export Step-0 integration glue from the barrels`.

---

## Self-Review (author)

- **Spec coverage:** §4 reconstructTranslatedCells (T1); §4.1/§5 collectNetNewFlags net-new-only + disjoint (T2); §4.1/§5 checkLocaleCompleteness (T3) + checkAssembledBody body pass with cannot-be-blank moved here (T4); §4 canonical policyDigest (T5); §4.1 buildPlan `undefined` fallback (T6). **Deferred to the next plan:** `toPlanInput`/`toPlanRecord` (needs the exact `DatoCMSRecordFromAPI` shape — read it there), and Steps 1-6 (live wiring / write flip / brake / persistence).
- **Placeholder scan:** none — every step has real code + exact commands.
- **Type consistency:** `ReconstructedCell` reused from `collectUnitFlags`; `QcFlag`/`QcCheckId` from `qc/types`; `RecordPlan`/`CellPlan`/`PlanPolicy`/`TranslationPlan` from the plan types; `crc32` from report. `checkNetNewCell`/`collectNetNewFlags`/`checkLocaleCompleteness`/`checkAssembledBody`/`policyDigest` names consistent across tasks.
