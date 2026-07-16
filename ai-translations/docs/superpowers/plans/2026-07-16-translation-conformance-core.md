# Translation Conformance Core — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build the pure, provider-free *conformance core* — the typed Translation Plan IR and the `conform` function that turns per-cell QC flags into per-`(record,locale)` Written/Blocked verdicts — implementing the two-tier (invariant→block / heuristic→write+flag) contract from the design spec.

**Architecture:** A new `src/engine/plan/` module holds the plan IR types, outcome types, the net-new invariant checks, and `conform`. It reuses the existing `qc/` checks unchanged (their `error`/`warning` severity already encodes invariant/heuristic). This plan is pure: no CMA, no providers, no engine wiring — everything is unit-tested with hand-authored fixtures. `buildPlan` (schema→plan) and the write-path integration are **separate follow-on plans**.

**Tech Stack:** TypeScript (ESNext), Vitest (`npm test`), pure functions only.

## Global Constraints

- **Design spec:** `docs/superpowers/specs/2026-07-16-translation-plan-design.md`. Section refs below are to it.
- **Tier mapping (verbatim from spec §2/§9):** a QC flag of severity `error` is an **invariant** (violation → BLOCK the `(record,locale)`); `warning`/`info` is a **heuristic** (violation → WRITE + FLAG).
- **Write unit vs decision unit (spec §3):** this plan produces verdicts per `(record, target-locale)` — the *decision* unit. It does NOT assemble write payloads (that is the follow-on write-path plan).
- **Purity:** every function in `src/engine/plan/` is pure and synchronous. No I/O, no `Date.now()`, no randomness.
- **`cannotBeBlank` ≠ `required` (spec §5, v4 §4.1):** the blank predicate is `cannotBeBlank`, never the DatoCMS `required` validator. Name it `cannotBeBlank` everywhere.
- **Naming:** React-style booleans (`isFoo`/`hasBar`); TSDoc on every exported symbol; `import type` for types.
- Run the full suite with `npm test`; a single file with `npm test -- <pattern>`.

---

### Task 1: Plan IR + outcome types + tier helper

**Files:**
- Create: `src/engine/plan/types.ts`
- Modify: `src/utils/translation/qc/types.ts:22-34` (extend `QcCheckId`)
- Test: `src/engine/plan/types.test.ts`

**Interfaces:**
- Consumes: `QcFlag`, `QcSeverity`, `QcCheckId` from `../../utils/translation/qc/types`.
- Produces: `Fate`, `CellExpectation`, `CellPlan`, `RecordLocaleUnit`, `RecordPlan`, `TranslationPlan`, `Bucket`, `ReasonCode`, `CellReason`, `CellFlag`, `UnitOutcome`, `Tier`, `tierOf(severity)`.

- [ ] **Step 1: Extend the QC check-id union**

In `src/utils/translation/qc/types.ts`, add the net-new ids to `QcCheckId` (keep existing members):

```ts
export type QcCheckId =
  | 'length-mismatch'
  | 'source-fallback'
  | 'placeholder-loss'
  | 'truncated'
  | 'html-structure'
  | 'markdown-structure'
  | 'no-op'
  | 'length-ratio'
  | 'length-validator'
  | 'seo-truncated'
  | 'json-validity'
  | 'copied-from-source'
  // plan/apply conformance additions (spec §5):
  | 'cannot-be-blank'
  | 'block-structure'
  | 'segment-alignment'
  | 'paragraph-count';
```

- [ ] **Step 2: Write the failing test** (`src/engine/plan/types.test.ts`)

```ts
import { describe, expect, it } from 'vitest';
import { tierOf } from './types';
import type { CellPlan, RecordPlan, TranslationPlan, UnitOutcome } from './types';

describe('tierOf', () => {
  it('maps error → invariant', () => expect(tierOf('error')).toBe('invariant'));
  it('maps warning → heuristic', () => expect(tierOf('warning')).toBe('heuristic'));
  it('maps info → heuristic', () => expect(tierOf('info')).toBe('heuristic'));
});

describe('plan IR shape', () => {
  it('composes a well-formed plan value', () => {
    const cell: CellPlan = {
      fieldPath: 'title',
      fieldType: 'string',
      toLocale: 'it',
      fate: 'translate',
      cannotBeBlank: true,
      expected: { preservedLocales: ['en'] },
    };
    const record: RecordPlan = {
      recordId: '1',
      itemTypeId: 'article',
      fromLocale: 'en',
      sourceVersion: 'v1',
      allLocalesRequired: false,
      units: [{ toLocale: 'it', isNewLocale: false, cells: [cell] }],
    };
    const plan: TranslationPlan = { records: [record], policyDigest: 'abc' };
    expect(plan.records[0].units[0].cells[0].fate).toBe('translate');
    const outcome: UnitOutcome = {
      recordId: '1', toLocale: 'it', bucket: 'written', reasons: [], flags: [],
    };
    expect(outcome.bucket).toBe('written');
  });
});
```

- [ ] **Step 3: Run test to verify it fails**

Run: `npm test -- plan/types`
Expected: FAIL — cannot find module `./types` / `tierOf` not exported.

- [ ] **Step 4: Implement `src/engine/plan/types.ts`**

```ts
/**
 * Translation Plan intermediate representation (IR) and the conformance outcome
 * model. See docs/superpowers/specs/2026-07-16-translation-plan-design.md §5, §7.
 * All types here are pure data; no behavior beyond {@link tierOf}.
 */
import type { QcCheckId, QcSeverity } from '../../utils/translation/qc/types';

/** Per-field disposition from the locked policy. UI labels `exclude` as "Skip". */
export type Fate = 'translate' | 'copy' | 'exclude';

/** Recursive block-count signature: blocks at this level plus each child's shape. */
export interface BlockSignature {
  count: number;
  children: BlockSignature[];
}

/** The contract a cell's reconstructed value is verified against (spec §5). */
export interface CellExpectation {
  /** Locales that must survive on this field (replace-not-merge guard). */
  preservedLocales: string[];
  blockSignature?: BlockSignature;
  /** Structural HTML block-tag multiset — `<p>` EXCLUDED (it is a heuristic). */
  htmlBlocks?: Record<string, number>;
  /** Structural Markdown block multiset — paragraphs EXCLUDED. */
  mdBlocks?: Record<string, number>;
  placeholders?: string[];
  lengthBounds?: { min?: number; eq?: number; max?: number };
  /** For array/multi-block fields: elements sent (== expected received). */
  segmentCount?: number;
  /** Per-segment source id/hash, to detect positional drift. */
  segmentAnchors?: string[];
}

/** One field, one target locale — the leaf of the plan. */
export interface CellPlan {
  fieldPath: string;
  fieldType: string;
  toLocale: string;
  fate: Fate;
  /** `cannotBeBlank(validators)` — NOT the `required` validator (spec §5). */
  cannotBeBlank: boolean;
  expected: CellExpectation;
}

/** All cells for one target locale of a record — the decision/report unit. */
export interface RecordLocaleUnit {
  toLocale: string;
  isNewLocale: boolean;
  cells: CellPlan[];
}

/** One record — the WRITE unit (one items.update, one version). */
export interface RecordPlan {
  recordId: string;
  itemTypeId: string;
  fromLocale: string;
  sourceVersion: string;
  allLocalesRequired: boolean;
  units: RecordLocaleUnit[];
}

export interface TranslationPlan {
  records: RecordPlan[];
  policyDigest: string;
}

/** Which report bucket a (record,locale) unit lands in (spec §7). */
export type Bucket = 'written' | 'blocked' | 'not-attempted' | 'written-unverified';

/** Machine-readable cause of a Blocked cell (spec §7). */
export type ReasonCode =
  | 'locale-would-drop'
  | 'locales-incomplete'
  | 'required-blank'
  | 'length-validator'
  | 'block-count-mismatch'
  | 'block-id-leak'
  | 'placeholder-lost'
  | 'html-block-lost'
  | 'md-block-lost'
  | 'segment-misalignment'
  | 'truncated'
  | 'source-drifted';

export interface CellReason {
  fieldPath: string;
  code: ReasonCode;
  message: string;
}

/** A heuristic finding attached to a Written unit. */
export interface CellFlag {
  checkId: QcCheckId;
  message: string;
}

/** The verdict for one (record, target-locale) unit. */
export interface UnitOutcome {
  recordId: string;
  toLocale: string;
  bucket: Bucket;
  reasons: CellReason[];
  flags: CellFlag[];
  preVersion?: string;
  postVersion?: string;
}

export type Tier = 'invariant' | 'heuristic';

/**
 * Maps a QC severity to its conformance tier. `error` corrupts the stored value
 * or guarantees a CMA rejection → invariant (block); everything else is a
 * fallible signal → heuristic (write + flag). (spec §2/§9)
 */
export function tierOf(severity: QcSeverity): Tier {
  return severity === 'error' ? 'invariant' : 'heuristic';
}
```

- [ ] **Step 5: Run test to verify it passes**

Run: `npm test -- plan/types`
Expected: PASS (6 assertions).

- [ ] **Step 6: Commit**

```bash
git add src/engine/plan/types.ts src/engine/plan/types.test.ts src/utils/translation/qc/types.ts
git commit -m "feat(plan): translation plan IR + outcome types + tier mapping"
```

---

### Task 2: `checkCannotBeBlank` invariant

**Files:**
- Create: `src/engine/plan/checks/cannotBeBlank.ts`
- Test: `src/engine/plan/checks/cannotBeBlank.test.ts`

**Interfaces:**
- Consumes: `QcFlag` from `../../../utils/translation/qc/types`.
- Produces: `checkCannotBeBlank(args: { value: unknown; cannotBeBlank: boolean; fieldPath?: string; locale?: string }): QcFlag | null`.

- [ ] **Step 1: Write the failing test**

```ts
import { describe, expect, it } from 'vitest';
import { checkCannotBeBlank } from './cannotBeBlank';

describe('checkCannotBeBlank', () => {
  it('passes a non-blank value', () => {
    expect(checkCannotBeBlank({ value: 'Ciao', cannotBeBlank: true })).toBeNull();
  });
  it('ignores fields that may be blank', () => {
    expect(checkCannotBeBlank({ value: '', cannotBeBlank: false })).toBeNull();
  });
  it('flags an empty string on a cannot-be-blank field', () => {
    const flag = checkCannotBeBlank({ value: '   ', cannotBeBlank: true, fieldPath: 'title', locale: 'it' });
    expect(flag?.checkId).toBe('cannot-be-blank');
    expect(flag?.severity).toBe('error');
    expect(flag?.fieldPath).toBe('title');
  });
  it('flags null, undefined, empty array, and empty object', () => {
    for (const value of [null, undefined, [], {}]) {
      expect(checkCannotBeBlank({ value, cannotBeBlank: true })?.severity).toBe('error');
    }
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npm test -- cannotBeBlank`
Expected: FAIL — module not found.

- [ ] **Step 3: Implement**

```ts
/**
 * Invariant: a field whose value cannot be blank (per validators or a
 * model-level `all_locales_required`) must not end up empty. A blank value would
 * 422 on save, so this blocks the (record,locale) pre-send. (spec §5)
 */
import type { QcFlag } from '../../../utils/translation/qc/types';

/** True for null/undefined, whitespace-only strings, empty arrays, empty objects. */
function isBlank(value: unknown): boolean {
  if (value === null || value === undefined) return true;
  if (typeof value === 'string') return value.trim() === '';
  if (Array.isArray(value)) return value.length === 0;
  if (typeof value === 'object') return Object.keys(value as object).length === 0;
  return false;
}

export function checkCannotBeBlank(args: {
  value: unknown;
  cannotBeBlank: boolean;
  fieldPath?: string;
  locale?: string;
}): QcFlag | null {
  if (!args.cannotBeBlank || !isBlank(args.value)) return null;
  return {
    checkId: 'cannot-be-blank',
    severity: 'error',
    fieldPath: args.fieldPath,
    locale: args.locale,
    message: 'Field must not be blank but the translation is empty; DatoCMS will reject the save.',
  };
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npm test -- cannotBeBlank`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/engine/plan/checks/cannotBeBlank.ts src/engine/plan/checks/cannotBeBlank.test.ts
git commit -m "feat(plan): cannot-be-blank invariant check"
```

---

### Task 3: `checkSegmentAlignment` invariant (Anthropic mid-drop)

**Files:**
- Create: `src/engine/plan/checks/segmentAlignment.ts`
- Test: `src/engine/plan/checks/segmentAlignment.test.ts`

**Interfaces:**
- Consumes: `QcFlag`.
- Produces: `checkSegmentAlignment(args: { sentCount: number; received: unknown[]; expectedAnchors?: string[]; receivedAnchors?: string[]; fieldPath?: string; locale?: string }): QcFlag | null`.

- [ ] **Step 1: Write the failing test**

```ts
import { describe, expect, it } from 'vitest';
import { checkSegmentAlignment } from './segmentAlignment';

describe('checkSegmentAlignment', () => {
  it('passes when counts and anchors line up', () => {
    expect(checkSegmentAlignment({
      sentCount: 3, received: ['a', 'b', 'c'],
      expectedAnchors: ['h1', 'h2', 'h3'], receivedAnchors: ['h1', 'h2', 'h3'],
    })).toBeNull();
  });
  it('flags a count mismatch', () => {
    const flag = checkSegmentAlignment({ sentCount: 3, received: ['a', 'b'], fieldPath: 'body', locale: 'it' });
    expect(flag?.checkId).toBe('segment-alignment');
    expect(flag?.severity).toBe('error');
  });
  it('flags a positional anchor drift even when counts match', () => {
    const flag = checkSegmentAlignment({
      sentCount: 3, received: ['a', 'b', 'c'],
      expectedAnchors: ['h1', 'h2', 'h3'], receivedAnchors: ['h1', 'h3', 'h3'],
    });
    expect(flag?.severity).toBe('error');
  });
  it('passes when no anchors are provided and counts match', () => {
    expect(checkSegmentAlignment({ sentCount: 2, received: ['a', 'b'] })).toBeNull();
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npm test -- segmentAlignment`
Expected: FAIL — module not found.

- [ ] **Step 3: Implement**

```ts
/**
 * Invariant: for array / multi-block fields, the reconstructed value must have as
 * many elements as were sent, and (when anchors are known) each element must sit
 * at its original position. Guards the Anthropic mid-array drop, which shifts
 * segment i to i+1's translation — well-formed content no other check catches.
 * (spec §5)
 */
import type { QcFlag } from '../../../utils/translation/qc/types';

export function checkSegmentAlignment(args: {
  sentCount: number;
  received: unknown[];
  expectedAnchors?: string[];
  receivedAnchors?: string[];
  fieldPath?: string;
  locale?: string;
}): QcFlag | null {
  const { sentCount, received, expectedAnchors, receivedAnchors, fieldPath, locale } = args;
  const flag = (message: string): QcFlag => ({
    checkId: 'segment-alignment', severity: 'error', fieldPath, locale, message,
  });
  if (received.length !== sentCount) {
    return flag(`Expected ${sentCount} segment(s) but reconstructed ${received.length}; content may be dropped or misaligned.`);
  }
  if (expectedAnchors && receivedAnchors) {
    const drifted = expectedAnchors.some((anchor, i) => anchor !== receivedAnchors[i]);
    if (drifted) return flag('A segment landed out of position; translations may be shifted across blocks.');
  }
  return null;
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npm test -- segmentAlignment`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/engine/plan/checks/segmentAlignment.ts src/engine/plan/checks/segmentAlignment.test.ts
git commit -m "feat(plan): segment-alignment invariant check"
```

---

### Task 4: Block signature + `checkBlockStructure` invariant

**Files:**
- Create: `src/engine/plan/checks/blockStructure.ts`
- Test: `src/engine/plan/checks/blockStructure.test.ts`

**Interfaces:**
- Consumes: `QcFlag`, `BlockSignature` from `../types`.
- Produces: `blockSignatureOf(value: unknown): BlockSignature`; `checkBlockStructure(args: { value: unknown; expected: BlockSignature; fieldPath?: string; locale?: string }): QcFlag | null`.

- [ ] **Step 1: Write the failing test**

```ts
import { describe, expect, it } from 'vitest';
import { blockSignatureOf, checkBlockStructure } from './blockStructure';

const block = (id: string, children: unknown[] = []) => ({
  type: 'item', id, attributes: {}, relationships: { children: { data: children } },
});

describe('blockSignatureOf', () => {
  it('counts top-level blocks in an array', () => {
    expect(blockSignatureOf([block('a'), block('b')])).toEqual({ count: 2, children: [] });
  });
  it('recurses into nested block arrays', () => {
    const value = [block('a', [block('a1'), block('a2')])];
    const sig = blockSignatureOf(value);
    expect(sig.count).toBe(1);
    expect(sig.children[0].count).toBe(2);
  });
  it('returns a zero signature for a non-block value', () => {
    expect(blockSignatureOf('hello')).toEqual({ count: 0, children: [] });
  });
});

describe('checkBlockStructure', () => {
  it('passes when counts and nesting match', () => {
    const expected = blockSignatureOf([block('a'), block('b')]);
    expect(checkBlockStructure({ value: [block('x'), block('y')], expected })).toBeNull();
  });
  it('flags a dropped block', () => {
    const expected = blockSignatureOf([block('a'), block('b')]);
    const flag = checkBlockStructure({ value: [block('x')], expected, fieldPath: 'body', locale: 'it' });
    expect(flag?.checkId).toBe('block-structure');
    expect(flag?.severity).toBe('error');
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npm test -- blockStructure`
Expected: FAIL — module not found.

- [ ] **Step 3: Implement**

```ts
/**
 * Invariant: modular/structured content must keep the same block COUNT and
 * NESTING shape across translation. A dropped or added block changes the
 * signature and blocks the (record,locale). Detects structure loss, NOT id leaks
 * (those are prevented by deepStripBlockIdentifiers; see spec §5 block-id-provenance). (spec §5)
 */
import type { BlockSignature } from '../types';
import type { QcFlag } from '../../../utils/translation/qc/types';

/** A DatoCMS nested block: { type: 'item', id, attributes, relationships }. */
function isBlock(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null &&
    (value as Record<string, unknown>).type === 'item';
}

/** Recursively collect nested block arrays from a block's relationships/attributes. */
function childBlockArrays(block: Record<string, unknown>): unknown[][] {
  const arrays: unknown[][] = [];
  const scan = (node: unknown): void => {
    if (Array.isArray(node)) {
      if (node.some(isBlock)) arrays.push(node);
      else node.forEach(scan);
    } else if (typeof node === 'object' && node !== null) {
      Object.values(node as Record<string, unknown>).forEach(scan);
    }
  };
  scan(block.attributes);
  scan(block.relationships);
  return arrays;
}

/** Builds the recursive block-count signature of a field value. */
export function blockSignatureOf(value: unknown): BlockSignature {
  const blocks = Array.isArray(value) ? value.filter(isBlock) : isBlock(value) ? [value] : [];
  const children: BlockSignature[] = [];
  for (const block of blocks) {
    for (const array of childBlockArrays(block)) children.push(blockSignatureOf(array));
  }
  return { count: blocks.length, children };
}

function signaturesEqual(a: BlockSignature, b: BlockSignature): boolean {
  if (a.count !== b.count || a.children.length !== b.children.length) return false;
  return a.children.every((child, i) => signaturesEqual(child, b.children[i]));
}

export function checkBlockStructure(args: {
  value: unknown;
  expected: BlockSignature;
  fieldPath?: string;
  locale?: string;
}): QcFlag | null {
  if (signaturesEqual(blockSignatureOf(args.value), args.expected)) return null;
  return {
    checkId: 'block-structure',
    severity: 'error',
    fieldPath: args.fieldPath,
    locale: args.locale,
    message: 'Translated block structure differs from the source (a block was dropped, added, or re-nested).',
  };
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npm test -- blockStructure`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/engine/plan/checks/blockStructure.ts src/engine/plan/checks/blockStructure.test.ts
git commit -m "feat(plan): block-structure invariant check"
```

---

### Task 5: Reclassify HTML paragraphs as a heuristic

**Files:**
- Modify: `src/utils/translation/qc/structuralChecks.ts:17-76` (`HTML_BLOCK_TAGS`, `checkHtmlStructure`)
- Test: `src/utils/translation/qc/structuralChecks.test.ts` (add cases)

**Interfaces:**
- Produces: `checkHtmlStructure` unchanged signature, new behavior — a `<p>`-only difference now returns a `paragraph-count` **warning**; structural block differences still return an `html-structure` **error**.

- [ ] **Step 1: Write the failing test** (append to the existing describe block for `checkHtmlStructure`)

```ts
import { checkHtmlStructure } from './structuralChecks';

describe('checkHtmlStructure paragraph reclassification', () => {
  it('treats a paragraph-count-only difference as a heuristic warning', () => {
    const flag = checkHtmlStructure({
      source: '<p>one</p><p>two</p>',
      translated: '<p>one two merged</p>',
    });
    expect(flag?.checkId).toBe('paragraph-count');
    expect(flag?.severity).toBe('warning');
  });
  it('still errors when a structural block (heading) is lost', () => {
    const flag = checkHtmlStructure({
      source: '<h2>Title</h2><p>body</p>',
      translated: '<p>body</p>',
    });
    expect(flag?.checkId).toBe('html-structure');
    expect(flag?.severity).toBe('error');
  });
  it('passes identical structure', () => {
    expect(checkHtmlStructure({ source: '<p>a</p>', translated: '<p>b</p>' })).toBeNull();
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npm test -- structuralChecks`
Expected: FAIL — merged-paragraph case currently returns `html-structure`/`error`.

- [ ] **Step 3: Implement** — remove `'p'` from `HTML_BLOCK_TAGS` and add a separate paragraph tally.

Replace `HTML_BLOCK_TAGS` (drop `'p'`) and rewrite `checkHtmlStructure`:

```ts
const HTML_BLOCK_TAGS = new Set([
  'h1', 'h2', 'h3', 'h4', 'h5', 'h6', 'ul', 'ol', 'li', 'blockquote',
  'pre', 'table', 'tr', 'td', 'th', 'img', 'hr', 'figure',
]);

/** Counts <p> elements only. Paragraph reflow is a legitimate translation move. */
function paragraphCount(html: string): number | null {
  if (typeof DOMParser === 'undefined') return null;
  const doc = new DOMParser().parseFromString(html, 'text/html');
  return doc.body.querySelectorAll('p').length;
}

/**
 * Flags a different STRUCTURAL block-tag multiset (heading/list/table/image/…)
 * as an `error` (a block was dropped/added). A pure `<p>`-count drift is a
 * `paragraph-count` `warning`: LLMs legitimately merge/split paragraphs across
 * languages. Inline-emphasis reshuffling never trips either. (spec §5)
 */
export function checkHtmlStructure(args: SegmentArgs): QcFlag | null {
  const src = blockTagCounts(args.source);
  const tgt = blockTagCounts(args.translated);
  if (src && tgt && !multisetsEqual(src, tgt)) {
    return {
      checkId: 'html-structure',
      severity: 'error',
      fieldPath: args.fieldPath,
      locale: args.locale,
      segmentIndex: args.segmentIndex,
      message: 'Translated HTML has a different block structure than the source — a block may have been dropped or altered.',
    };
  }
  const srcP = paragraphCount(args.source);
  const tgtP = paragraphCount(args.translated);
  if (srcP !== null && tgtP !== null && srcP !== tgtP) {
    return {
      checkId: 'paragraph-count',
      severity: 'warning',
      fieldPath: args.fieldPath,
      locale: args.locale,
      segmentIndex: args.segmentIndex,
      message: 'Translated HTML has a different paragraph count than the source.',
    };
  }
  return null;
}
```

- [ ] **Step 4: Run test to verify it passes** — and confirm no regression in the existing structuralChecks suite.

Run: `npm test -- structuralChecks`
Expected: PASS (new cases + all existing).

- [ ] **Step 5: Commit**

```bash
git add src/utils/translation/qc/structuralChecks.ts src/utils/translation/qc/structuralChecks.test.ts
git commit -m "fix(qc): html paragraph drift is a heuristic warning, not a structural error"
```

---

### Task 6: `reasonCodeFor` — QC check-id → Blocked reason code

**Files:**
- Create: `src/engine/plan/reasonCode.ts`
- Test: `src/engine/plan/reasonCode.test.ts`

**Interfaces:**
- Consumes: `QcCheckId`, `ReasonCode` from `../../utils/translation/qc/types` and `./types`.
- Produces: `reasonCodeFor(checkId: QcCheckId): ReasonCode`.

- [ ] **Step 1: Write the failing test**

```ts
import { describe, expect, it } from 'vitest';
import { reasonCodeFor } from './reasonCode';

describe('reasonCodeFor', () => {
  it('maps invariant check ids to their blocked reason codes', () => {
    expect(reasonCodeFor('truncated')).toBe('truncated');
    expect(reasonCodeFor('length-validator')).toBe('length-validator');
    expect(reasonCodeFor('placeholder-loss')).toBe('placeholder-lost');
    expect(reasonCodeFor('html-structure')).toBe('html-block-lost');
    expect(reasonCodeFor('markdown-structure')).toBe('md-block-lost');
    expect(reasonCodeFor('block-structure')).toBe('block-count-mismatch');
    expect(reasonCodeFor('segment-alignment')).toBe('segment-misalignment');
    expect(reasonCodeFor('cannot-be-blank')).toBe('required-blank');
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npm test -- reasonCode`
Expected: FAIL — module not found.

- [ ] **Step 3: Implement**

```ts
/**
 * Translates an invariant QC check id into the machine-readable Blocked reason
 * code surfaced in the report (spec §7). Only invariant (error-tier) checks ever
 * block, so only those need a mapping; a heuristic id falling through is a
 * programming error.
 */
import type { QcCheckId } from '../../utils/translation/qc/types';
import type { ReasonCode } from './types';

const REASON_BY_CHECK: Partial<Record<QcCheckId, ReasonCode>> = {
  truncated: 'truncated',
  'length-validator': 'length-validator',
  'placeholder-loss': 'placeholder-lost',
  'html-structure': 'html-block-lost',
  'markdown-structure': 'md-block-lost',
  'block-structure': 'block-count-mismatch',
  'segment-alignment': 'segment-misalignment',
  'cannot-be-blank': 'required-blank',
};

export function reasonCodeFor(checkId: QcCheckId): ReasonCode {
  const code = REASON_BY_CHECK[checkId];
  if (!code) throw new Error(`No blocked reason code for invariant check "${checkId}"`);
  return code;
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npm test -- reasonCode`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/engine/plan/reasonCode.ts src/engine/plan/reasonCode.test.ts
git commit -m "feat(plan): map invariant check ids to blocked reason codes"
```

---

### Task 7: `conform` — QC flags → per-(record,locale) verdicts

**Files:**
- Create: `src/engine/plan/conform.ts`
- Test: `src/engine/plan/conform.test.ts`

**Interfaces:**
- Consumes: `QcFlag` (`../../utils/translation/qc/types`); `TranslationPlan`, `UnitOutcome`, `tierOf` (`./types`); `reasonCodeFor` (`./reasonCode`).
- Produces: `conform(plan: TranslationPlan, flagsByUnit: Map<string, QcFlag[]>): UnitOutcome[]`; `unitKey(recordId: string, toLocale: string): string`.

Note: `conform` here consumes **already-computed** QC flags keyed per unit (the checks from Tasks 2–6 and the existing `qc/` checks produce them upstream during reconstruction — wired in the follow-on plan). `conform`'s sole job is the two-tier bucketing, which is the keystone this plan exists to prove.

- [ ] **Step 1: Write the failing test**

```ts
import { describe, expect, it } from 'vitest';
import { conform, unitKey } from './conform';
import type { TranslationPlan } from './types';
import type { QcFlag } from '../../utils/translation/qc/types';

const plan: TranslationPlan = {
  policyDigest: 'x',
  records: [{
    recordId: 'r1', itemTypeId: 'article', fromLocale: 'en', sourceVersion: 'v1',
    allLocalesRequired: false,
    units: [
      { toLocale: 'it', isNewLocale: false, cells: [] },
      { toLocale: 'zh', isNewLocale: false, cells: [] },
    ],
  }],
};

const err = (checkId: QcFlag['checkId'], fieldPath: string): QcFlag =>
  ({ checkId, severity: 'error', fieldPath, message: 'boom' });
const warn = (checkId: QcFlag['checkId'], fieldPath: string): QcFlag =>
  ({ checkId, severity: 'warning', fieldPath, message: 'hmm' });

describe('conform', () => {
  it('writes a clean unit', () => {
    const out = conform(plan, new Map());
    const it = out.find((u) => u.toLocale === 'it');
    expect(it?.bucket).toBe('written');
    expect(it?.reasons).toEqual([]);
  });
  it('blocks a unit with any invariant (error) flag and records its reason code', () => {
    const flags = new Map([[unitKey('r1', 'zh'), [err('placeholder-loss', 'body')]]]);
    const out = conform(plan, flags);
    const zh = out.find((u) => u.toLocale === 'zh');
    expect(zh?.bucket).toBe('blocked');
    expect(zh?.reasons).toEqual([{ fieldPath: 'body', code: 'placeholder-lost', message: 'boom' }]);
  });
  it('writes a unit that has only heuristic (warning) flags, attaching them', () => {
    const flags = new Map([[unitKey('r1', 'it'), [warn('length-ratio', 'body')]]]);
    const out = conform(plan, flags);
    const it = out.find((u) => u.toLocale === 'it');
    expect(it?.bucket).toBe('written');
    expect(it?.flags).toEqual([{ checkId: 'length-ratio', message: 'hmm' }]);
  });
  it('blocks a mixed unit (one error + one warning) and keeps only the error as a reason', () => {
    const flags = new Map([[unitKey('r1', 'zh'), [warn('no-op', 'title'), err('truncated', 'body')]]]);
    const out = conform(plan, flags);
    const zh = out.find((u) => u.toLocale === 'zh');
    expect(zh?.bucket).toBe('blocked');
    expect(zh?.reasons.map((r) => r.code)).toEqual(['truncated']);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npm test -- plan/conform`
Expected: FAIL — module not found.

- [ ] **Step 3: Implement**

```ts
/**
 * The conformance keystone: turns per-unit QC flags into per-(record,locale)
 * verdicts. Two-tier contract (spec §2/§9): a unit with ANY invariant (error)
 * flag is Blocked with reason codes; otherwise it is Written with any heuristic
 * (warning/info) flags attached. Pure. Payload assembly and the write live in the
 * follow-on plan. (spec §3, §7)
 */
import type { QcFlag } from '../../utils/translation/qc/types';
import { reasonCodeFor } from './reasonCode';
import type { TranslationPlan, UnitOutcome } from './types';
import { tierOf } from './types';

/** Stable key for a (record, target-locale) decision unit. */
export function unitKey(recordId: string, toLocale: string): string {
  return `${recordId} ${toLocale}`;
}

export function conform(
  plan: TranslationPlan,
  flagsByUnit: Map<string, QcFlag[]>,
): UnitOutcome[] {
  const outcomes: UnitOutcome[] = [];
  for (const record of plan.records) {
    for (const unit of record.units) {
      const flags = flagsByUnit.get(unitKey(record.recordId, unit.toLocale)) ?? [];
      const invariants = flags.filter((f) => tierOf(f.severity) === 'invariant');
      if (invariants.length > 0) {
        outcomes.push({
          recordId: record.recordId,
          toLocale: unit.toLocale,
          bucket: 'blocked',
          reasons: invariants.map((f) => ({
            fieldPath: f.fieldPath ?? unit.toLocale,
            code: reasonCodeFor(f.checkId),
            message: f.message,
          })),
          flags: [],
        });
      } else {
        outcomes.push({
          recordId: record.recordId,
          toLocale: unit.toLocale,
          bucket: 'written',
          reasons: [],
          flags: flags.map((f) => ({ checkId: f.checkId, message: f.message })),
        });
      }
    }
  }
  return outcomes;
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npm test -- plan/conform`
Expected: PASS (4 cases).

- [ ] **Step 5: Commit**

```bash
git add src/engine/plan/conform.ts src/engine/plan/conform.test.ts
git commit -m "feat(plan): conform — per-(record,locale) two-tier verdicts"
```

---

### Task 8: Full-suite gate + barrel export + self-review

**Files:**
- Create: `src/engine/plan/index.ts` (barrel)
- Test: none new (gate task)

- [ ] **Step 1: Barrel export**

```ts
export * from './types';
export { conform, unitKey } from './conform';
export { reasonCodeFor } from './reasonCode';
export { checkCannotBeBlank } from './checks/cannotBeBlank';
export { checkSegmentAlignment } from './checks/segmentAlignment';
export { blockSignatureOf, checkBlockStructure } from './checks/blockStructure';
```

- [ ] **Step 2: Run the full unit suite**

Run: `npm test`
Expected: PASS — all prior tests plus the new plan/ tests, zero regressions.

- [ ] **Step 3: Build gate**

Run: `npm run build`
Expected: clean `tsc` + Vite build (no type errors from the new module).

- [ ] **Step 4: Self-review against the spec**

Confirm each is covered: two-tier bucketing (Task 7), invariant checks cannot-be-blank/segment-alignment/block-structure (Tasks 2–4), truncation & length-validator remain error-tier invariants (existing `qc/` checks, unchanged — verify they still return `severity: 'error'`), paragraph reclassification (Task 5), reason codes (Task 6), IR + outcome types (Task 1). Note explicitly in the commit body what is deferred to the write-path plan: `locale-preservation`, `locale-completeness`, `block-id-provenance`, payload assembly, drift/version, retry, report persistence, and `buildPlan`.

- [ ] **Step 5: Commit**

```bash
git add src/engine/plan/index.ts
git commit -m "feat(plan): barrel export for the conformance core; full-suite green"
```

---

## Self-Review (plan author)

- **Spec coverage:** §2 two-tier → Task 7 + `tierOf` (Task 1). §5 invariant catalog → cannot-be-blank (T2), segment-alignment (T3), block-structure (T4); truncated/length-validator/placeholder/html/md re-pointed (existing `qc/`, verified in T8); paragraph→heuristic (T5). §7 outcome model + reason codes → T1 + T6 + T7. **Deferred by design (own plan):** `locale-preservation`, `locale-completeness`, `block-id-provenance`, `buildPlan` (§5 build steps), write-path/§6, report persistence/§7 buckets `not-attempted`/`written-unverified`, runaway reconciliation/§8. This plan is the pure verdict core; it stands alone and is fully testable.
- **Placeholder scan:** none — every step has real code and an exact command.
- **Type consistency:** `unitKey`/`conform`/`UnitOutcome`/`CellPlan`/`reasonCodeFor`/`blockSignatureOf` names and signatures match across Tasks 1, 4, 6, 7, 8.
