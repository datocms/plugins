# v4 Phase 0 — E2E Foundations — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Land spec §9.4's phase-0 safety net — the seed fixtures, platform pins, and expected-fail probes that v4 phase 2+3 (deleting `translateRecordFields.ts`) depends on. The suite has **never exercised a real frameless block**; this plan fixes that before any engine code moves.

**Architecture:** Extend the existing seeded fixture project (DatoCMS site 219952, token in `.env.testing`) with the `block_variants` model (half-done, uncommitted in the working tree) and a new draft-saving model; add CMA-level platform pins as a seed-stage script; add browser pins as a new spec file that runs after the existing ones; add a debug-gated converter round-trip hook inside the plugin (converters only exist in the live plugin iframe). Bugs that v4 fixes are pinned with `test.fail()` so phase 2+3 flips them to green.

**Tech Stack:** Playwright (provider-matrix projects, forked `e2e-<vendor>-<RUN_ID>` envs), `@datocms/cma-client` seed scripts (`e2e/seed/*.mjs`), DatoCMS plugin SDK.

**Spec:** `docs/superpowers/specs/2026-07-13-v4-unified-translation-design.md` §9.4, §11 phase 0. Read `e2e/AGENTS.md` **in full** before executing any task — the suite has hard rules (single login, result-gated teardown, bulk-tests-first ordering, seed idempotency, `manual-e2e-*` sweep exemption) that individual steps below reference but do not restate.

## ⛔ What is deliberately NOT in this plan

Phases 2–7 are **not planned yet** — six §9.5 decisions gate them (the §4.2 ban reversal, Modular-Content type-pairing scope, streaming-UX replacement, throughput mode, fill-with-source affordance, customer-block-ids timing). Planning them now would bake in answers the stakeholder hasn't given. Also deferred out of this plan, with reasons:

- **§9.4 test 7 (same-type reorder → skip-and-flag):** asserts v4 engine semantics that don't exist yet and can't be expressed against v3's UI. Write it inside phase 2+3.
- **§9.4 test 8's UI half ("Leave them empty" option):** phase-5 UI. Its **schema half** (the draft-saving model) and the **platform pin** it rests on ARE in this plan (Tasks 2, 4).

## Global Constraints

- **The seed project is shared.** `e2e/seed/*.mjs` scripts run against the primary environment of site 219952 — the source of every fork. Schema scripts are idempotent (re-run safe); **record scripts are NOT re-run safe except by their own marker checks** — never re-run `3-records.mjs`; new records go in a new additive script (the `3b`/`3c` convention).
- **Do not run any seed script until its code is reviewed in the same task** — a bad write pollutes every future fork.
- Test ordering: bulk (CMA-writing) tests run before editor tests within a lane; new editor-only specs belong in a file that sorts **after** `bulk-reliability.spec.ts` (alphabetical file order, one worker per lane, `fullyParallel: false`).
- E2E env names: forks `e2e-<vendor>-<RUN_ID>` are swept when stale; `manual-e2e-*` is sweep-exempt.
- The stats-line/report selectors in `e2e/tests/steps/bulk.ts` are a pinned contract (spec §6.4) — nothing in this plan may change them.
- Locale rule for records: every localized field on a record must carry the **same locale key set** (DatoCMS `INVALID_LOCALES`) — a "missing" locale value is a **present key with `null`**, not an absent key.
- `test.fail()` pins must be verified against the result-gated teardown (Task 5 does this once, first).

## File Structure

| File | Responsibility |
| --- | --- |
| `e2e/seed/1-schema.mjs` | + `block_variants` (already in working tree, uncommitted) + `draft_pool` draft-saving model (new) |
| `e2e/seed/3d-block-variants-records.mjs` (new) | Additive, idempotent records for `block_variants` + `draft_pool` |
| `e2e/seed/6-platform-pins.mjs` (new) | CMA-level pins: draft-saving persists invalid, strict 422s, publish blocked |
| `e2e/tests/frameless-pins.spec.ts` (new) | Browser pins: rendering contract, bug-#1 probe (`test.fail`), framed control, exclusion pin (`test.fail`), converter round-trip |
| `src/utils/devConverterRoundtrip.ts` (new) + `src/entrypoints/Sidebar/TranslateSidebar.tsx` | Debug-gated in-iframe round-trip hook |
| `e2e/tests/setup/global-setup.ts`, `e2e/tests/steps/dato-auth.ts`, `e2e/seed/7-restricted-role.mjs` (new) | Restricted-role second auth context + `internalLocales` pin |

---

### Task 1: Review and commit the in-flight seed + manual-fork tooling

The working tree carries a previous session's phase-0 half: `e2e/seed/1-schema.mjs` (block_variants model + inline_note relabel), `e2e/manual/` (fork.ts, cleanup.ts, manual-env.ts — untracked), `e2e/tsconfig.json`, `e2e/README.md`, `package.json` (two `test:e2e:manual*` scripts). **Nothing has been run against the shared project yet.**

**Files:**
- Commit as-is after review: all of the above.

- [ ] **Step 1: Review the diff**

Run: `git diff e2e/ package.json && git status --short`
Check against spec §9.4's seed list: `true_frameless` (required + one block model + frameless editor), `pseudo_frameless` (frameless editor, no required), `framed_control` (framed editor, same nullability), `article.inline_note` relabelled as the misconfigured case. All four are present in the current diff — verify labels and validators match the spec table exactly.

- [ ] **Step 2: Typecheck the manual tooling**

Run: `npx tsc -p e2e/tsconfig.json --noEmit`
Expected: clean (the tsconfig edit exists precisely to cover `e2e/manual/`).

- [ ] **Step 3: Commit (do NOT run the seed yet — Task 3 runs everything once, in order)**

```bash
git add e2e/seed/1-schema.mjs e2e/manual/ e2e/tsconfig.json e2e/README.md package.json
git commit -m "test(e2e): block_variants seed model + manual-fork tooling (phase 0, part 1)

block_variants isolates the framed/frameless rendering contract: a
required localized single_block forces every locale of every record to
carry a block, so it lives on its own model. inline_note is relabelled as
the deliberate misconfigured-frameless case. manual/ forks a sweep-exempt
manual-e2e-* env for hand testing. Not yet run against the seed project."
```

---

### Task 2: Draft-saving model in the schema seed

Spec §9.4 test 8 (schema half) + §4.0: a model with `draft_mode_active ∧ draft_saving_active`, holding a `cannotBeBlank` localized field, so invalid-draft behavior is testable. The strict control is the existing `article` model (default flags).

**Files:**
- Modify: `e2e/seed/1-schema.mjs` (after the `block_variants` section, before `STAGE 1 complete`)

**Interfaces:**
- Produces: model api_key `draft_pool` with fields `title` (string, localized, `required`), `summary` (text, localized, no validators). Tasks 3–4 reference these exact api_keys.

- [ ] **Step 1: Add the model**

Insert after the block-variant fields section (mirror the file's existing helper style — `getOrCreateItemType`, `field`, `single`, `txt`):

```js
  // 5e. Draft-saving model — §4.0/§9.4-8. draft_mode_active ∧ draft_saving_active
  // makes the CMA persist INVALID drafts (blank required fields) instead of 422ing.
  // The strict control is `article` (default flags). Only the schema half lives in
  // phase 0; the bulk "Leave them empty" UI test arrives with spec phase 5.
  section('Draft-saving model');
  const draftPool = await getOrCreateItemType('draft_pool', {
    name: 'Draft Pool',
    draft_mode_active: true,
    draft_saving_active: true,
  });
  await loadFields(draftPool.id);
  const dpTitle = await field(draftPool.id, 'title', {
    ...single('Title'),
    validators: { required: {} },
  });
  await field(draftPool.id, 'summary', txt('Summary'));
  if (dpTitle) await step('draft_pool.title_field wiring', () =>
    client.itemTypes.update(draftPool.id, { title_field: { id: dpTitle.id, type: 'field' } }),
  );
```

Also extend the final `console.log('Models:', …)` with `draft_pool: draftPool.id`.

⚠️ `getOrCreateItemType` skips existing models, so if `draft_pool` ever pre-exists without the flags it will NOT be updated. Add a defensive flag sync right after creation:

```js
  if (!draftPool.draft_mode_active || !draftPool.draft_saving_active) {
    await step('draft_pool flags sync', () =>
      client.itemTypes.update(draftPool.id, { draft_mode_active: true, draft_saving_active: true }),
    );
  }
```

- [ ] **Step 2: Dry-review, no run**

Re-read the added block against `e2e/seed/1-schema.mjs`'s conventions (non-fatal `field()` failures, `fieldFailures` report). Confirm `draft_saving_active` is a valid `itemTypes.create` attribute per the CMA docs (`https://www.datocms.com/docs/content-management-api/resources/item-type/create.md`).

- [ ] **Step 3: Commit**

```bash
git add e2e/seed/1-schema.mjs
git commit -m "test(e2e): draft_pool seed model (draft_mode_active + draft_saving_active)"
```

---

### Task 3: Records for `block_variants` and `draft_pool` + one seeding run

**Files:**
- Create: `e2e/seed/3d-block-variants-records.mjs`
- Regenerate: `e2e/seed/seed-manifest.json` (via existing `5-manifest.mjs`)

**Interfaces:**
- Consumes: models from Tasks 1–2; the additive-record pattern of `e2e/seed/3c-catalog-records.mjs` (marker-title idempotency).
- Produces: records findable via the manifest: `BV1` (`block_variants`, `pseudo_frameless.it = null` — the bug-#1 target), `BV2` (fully bilingual control), `DP1` (`draft_pool`, valid en+it). Task 5's tests locate them by marker title through `loadManifest`/`findRecord` (`e2e/tests/steps/assert-record.ts`).

- [ ] **Step 1: Write the script**

`e2e/seed/3d-block-variants-records.mjs`:

```js
/**
 * Stage 3d — block_variants + draft_pool records (spec §9.4 phase 0).
 *
 *  BV1 "BV Probe" — the bug-#1 target: true_frameless carries a block in BOTH
 *    locales (required forces it); pseudo_frameless and framed_control carry a
 *    block in `en` and NULL in `it` (key present — INVALID_LOCALES needs every
 *    localized field on the same locale set). Sidebar-translating en→it must
 *    materialise the missing blocks; v3 silently drops the frameless one.
 *  BV2 "BV Control" — fully bilingual on all three variants (merge/preserve cases).
 *  DP1 "DP Valid" — a valid draft_pool record (en+it), so tests can blank a
 *    locale via the plugin rather than seed an already-broken record.
 *
 * Idempotent by marker title. Additive — NEVER folded into 3-records.mjs
 * (that script is not re-run safe; see e2e/AGENTS.md).
 */
import { client, section, step } from './lib/config.mjs';

const itemTypes = await client.itemTypes.list();
const byKey = Object.fromEntries(itemTypes.map((it) => [it.api_key, it]));
const bv = byKey.block_variants;
const dp = byKey.draft_pool;
const callout = byKey.callout;
if (!bv || !dp || !callout) throw new Error('run 1-schema.mjs first (block_variants/draft_pool/callout missing)');

const calloutBlock = (title, body) =>
  client.buildBlockRecord({
    item_type: { type: 'item_type', id: callout.id },
    title, body, is_dismissible: false,
  });

const exists = async (itemTypeId, markerTitle) => {
  const found = await client.items.list({
    filter: { type: itemTypeId, fields: { title: { matches: { pattern: markerTitle } } } },
    page: { limit: 1 },
  });
  return found.length > 0;
};

section('STAGE 3d — block_variants + draft_pool records');

if (await exists(bv.id, 'BV Probe')) {
  console.log('  ✓ BV Probe (exists)');
} else {
  await step('BV1 "BV Probe"', () => client.items.create({
    item_type: { type: 'item_type', id: bv.id },
    title: { en: 'BV Probe', it: 'BV Probe (it)' },
    true_frameless: { en: calloutBlock('Probe note', 'Required block, en'), it: calloutBlock('Nota probe', 'Blocco richiesto, it') },
    pseudo_frameless: { en: calloutBlock('Pseudo note', 'Only en has this block'), it: null },
    framed_control: { en: calloutBlock('Framed note', 'Only en has this block'), it: null },
  }));
}

if (await exists(bv.id, 'BV Control')) {
  console.log('  ✓ BV Control (exists)');
} else {
  await step('BV2 "BV Control"', () => client.items.create({
    item_type: { type: 'item_type', id: bv.id },
    title: { en: 'BV Control', it: 'BV Control (it)' },
    true_frameless: { en: calloutBlock('Ctrl A', 'en body A'), it: calloutBlock('Ctrl A it', 'it body A') },
    pseudo_frameless: { en: calloutBlock('Ctrl B', 'en body B'), it: calloutBlock('Ctrl B it', 'it body B') },
    framed_control: { en: calloutBlock('Ctrl C', 'en body C'), it: calloutBlock('Ctrl C it', 'it body C') },
  }));
}

if (await exists(dp.id, 'DP Valid')) {
  console.log('  ✓ DP Valid (exists)');
} else {
  await step('DP1 "DP Valid"', () => client.items.create({
    item_type: { type: 'item_type', id: dp.id },
    title: { en: 'DP Valid', it: 'DP Valid (it)' },
    summary: { en: 'A valid draft-pool record.', it: 'Un record valido.' },
  }));
}

section('STAGE 3d complete');
```

⚠️ Before running: check `e2e/seed/lib/config.mjs` for whether `client.buildBlockRecord` is available on the seed client version (it is a standard `@datocms/cma-client` helper; `3-records.mjs` already creates block-bearing records — reuse ITS exact block-building idiom if it differs from the above).

- [ ] **Step 2: Run the seeding, once, in order**

This is the one deliberate write to the shared project:

```bash
cd e2e/seed
node 1-schema.mjs        # idempotent: adds block_variants + draft_pool, skips the rest
node 3d-block-variants-records.mjs
node 4-verify.mjs        # existing verification must still pass
node 5-manifest.mjs      # regenerate seed-manifest.json with the new records
```

Expected: `1-schema` logs `✓ … (exists)` for all pre-existing fields and creates only the new ones with **zero entries in the field-failures report**; `3d` creates BV1/BV2/DP1; re-running `3d` immediately logs three `(exists)` lines (idempotency proof).

- [ ] **Step 3: Verify in the dashboard (manual fork, not the primary)**

`npm run test:e2e:manual claude` → in the forked env open BV Probe: `true_frameless` renders **without** a field label/kebab; `pseudo_frameless` and `framed_control` render framed. This is the first human look at a true frameless block in this suite — screenshot it for the PR.

- [ ] **Step 4: Commit**

```bash
git add e2e/seed/3d-block-variants-records.mjs e2e/seed/seed-manifest.json
git commit -m "test(e2e): seed block_variants + draft_pool records (additive, idempotent)"
```

---

### Task 4: CMA platform pins (`6-platform-pins.mjs`)

Pins the three Rails behaviors §4.0 rests on, at the CMA level, with scratch records that are always deleted. If the platform ever changes, these fail loudly at seed time instead of v4 discovering it in production.

**Files:**
- Create: `e2e/seed/6-platform-pins.mjs`

**Interfaces:**
- Consumes: `draft_pool` + `article` models (Tasks 2, existing seed).
- Produces: exit code 0/1; wired into the seeding README order.

- [ ] **Step 1: Write the script**

```js
/**
 * Stage 6 — platform pins (spec §4.0). Scratch records only; always cleaned up.
 *  P1: a draft-saving model PERSISTS an invalid draft (blank required title).
 *  P2: that invalid draft CANNOT be published.
 *  P3: a strict model 422s the same blank (VALIDATION_REQUIRED).
 */
import { client, section, step } from './lib/config.mjs';

const itemTypes = await client.itemTypes.list();
const byKey = Object.fromEntries(itemTypes.map((it) => [it.api_key, it]));
const dp = byKey.draft_pool;
const article = byKey.article;
if (!dp || !article) throw new Error('run 1-schema.mjs first');

const failures = [];
const pin = async (name, fn) => {
  try { await fn(); console.log(`  ✓ ${name}`); }
  catch (err) { failures.push(name); console.log(`  ✗ ${name}\n      ${err?.message ?? err}`); }
};
const scratch = [];

section('STAGE 6 — platform pins');

await pin('P1 draft-saving model persists an invalid draft', async () => {
  const item = await client.items.create({
    item_type: { type: 'item_type', id: dp.id },
    title: { en: null, it: null },            // blank REQUIRED field, every locale
    summary: { en: 'pin scratch', it: 'pin scratch' },
  });
  scratch.push(item.id);
  if (!item.id) throw new Error('no id returned');
  const fetched = await client.items.find(item.id);
  if (fetched.meta.is_valid !== false) throw new Error(`expected is_valid=false, got ${fetched.meta.is_valid}`);
});

await pin('P2 the invalid draft cannot be published', async () => {
  const id = scratch[0];
  let published = false;
  try { await client.items.publish(id); published = true; } catch { /* expected */ }
  if (published) throw new Error('publish succeeded on an invalid draft');
});

await pin('P3 a strict model 422s the same blank (VALIDATION_REQUIRED)', async () => {
  let created;
  try {
    created = await client.items.create({
      item_type: { type: 'item_type', id: article.id },
      title: { en: null, it: null },          // article.title is required in the seed
    });
    scratch.push(created.id);
    throw new Error('create succeeded on a strict model with a blank required field');
  } catch (err) {
    const body = JSON.stringify(err?.errors ?? err?.message ?? '');
    if (!/VALIDATION_REQUIRED|INVALID_FIELD/.test(body)) throw err;
  }
});

for (const id of scratch) {
  await step(`cleanup scratch ${id}`, () => client.items.destroy(id));
}

if (failures.length) {
  section(`✗ ${failures.length} PLATFORM PIN(S) FAILED — v4 assumptions broken`);
  process.exit(1);
}
section('STAGE 6 complete — platform behaves as spec §4.0 documents');
```

⚠️ Verify while implementing: `article.title`'s seed validators (open `1-schema.mjs` — if `title` is not `required`, pick the seed's required field or add `validators: { required: {} }` is NOT an option post-hoc; use whichever article field carries `required`). Also verify the invalid-draft flag surface: the CMA serializes validity under `meta.is_valid` on `items.find` — check `https://www.datocms.com/docs/content-management-api/resources/item.md` and adjust the assertion to the actual field if it differs (e.g. `meta.status` staying `draft` is NOT sufficient).

- [ ] **Step 2: Run it**

Run: `cd e2e/seed && node 6-platform-pins.mjs`
Expected: three `✓` pins, scratch cleanup lines, exit 0. Run it twice — the second run must behave identically (scratch records don't accumulate).

- [ ] **Step 3: Document the seed order**

Add `6-platform-pins.mjs` to `e2e/seed/README.md`'s run order (after `5-manifest.mjs`, marked "safe to re-run").

- [ ] **Step 4: Commit**

```bash
git add e2e/seed/6-platform-pins.mjs e2e/seed/README.md
git commit -m "test(e2e): CMA platform pins for §4.0 (invalid-draft persistence, publish block, strict 422)"
```

---

### Task 5: Browser pins — rendering contract, bug-#1 probe, control (§9.4 tests 1–3)

**Files:**
- Create: `e2e/tests/frameless-pins.spec.ts` (sorts after `bulk-reliability.spec.ts` → runs last in each lane; editor-only work, so the bulk-first ordering rule is satisfied)

**Interfaces:**
- Consumes (all verified to exist): `openRecord`, `translateRecordViaSidebar`, `saveRecord` from `../steps/per-record`; `loadManifest`, `findRecord`, `getLocaleValue` from `../steps/assert-record`; `ProjectMeta` from `./fixtures/providers`; `TIMEOUTS` from `./setup/constants`; `step` from `./setup/log`; `meta()` pattern from `ai-translations.spec.ts:65`.
- Produces: the `test.fail()` pins phase 2+3 will flip to plain `test()`.

- [ ] **Step 1: Confirm `test.fail()` × result-gated teardown, before writing tests**

Read `e2e/tests/setup/outcomes.ts` (`recordOutcome(project, ok)`) and find its caller (grep `recordOutcome` in `e2e/tests/`). Playwright reports an expected failure (`test.fail()` + actual failure) with outcome `"expected"` / suite exit 0 — confirm the caller derives `ok` from suite-level pass/fail (not per-test status), so a failing-as-expected pin still tears the fork down. Write the conclusion as a comment at the top of the new spec file. If the gate would hold envs alive, fix the `ok` derivation in the same commit (it should treat `expectedStatus === status` as passing).

- [ ] **Step 2: Write the spec skeleton + rendering-contract test (§9.4 test 1)**

```ts
import { expect, test } from '@playwright/test';
import type { ProjectMeta } from './fixtures/providers';
import { TIMEOUTS } from './setup/constants';
import { step } from './setup/log';
import { findRecord, getLocaleValue, loadManifest } from './steps/assert-record';
import { openRecord, saveRecord, translateRecordViaSidebar } from './steps/per-record';

// test.fail() interaction with the result-gated teardown: <conclusion from Step 1>.

const meta = (): ProjectMeta => test.info().project.metadata as ProjectMeta;
const manifest = loadManifest();
const BLOCK_VARIANTS = 'block_variants';
const BV_PROBE = findRecord(manifest, BLOCK_VARIANTS, 'BV Probe');

test.describe('frameless pins (spec §9.4, phase 0)', () => {
  test('rendering contract: true_frameless has no chrome; pseudo_frameless renders framed', async ({ page }) => {
    const { vendor } = meta();
    await step(vendor, 'open BV Probe', () => openRecord(page, meta(), BLOCK_VARIANTS, BV_PROBE.id));

    // A FRAMED single_block field shows its field label; a TRUE frameless one
    // renders the inner block fields with no label/kebab (spec §3). Labels are
    // the seed's exact strings, so label visibility IS the rendering contract.
    await expect(
      page.getByText('Pseudo frameless (no required → renders FRAMED)'),
    ).toBeVisible();
    await expect(
      page.getByText('Framed control (framed editor → renders FRAMED)'),
    ).toBeVisible();
    await expect(
      page.getByText('True frameless (required → renders FRAMELESS)'),
    ).toHaveCount(0);
    // …but the frameless block's CONTENT is on screen (its inner block fields render):
    await expect(page.getByText('Probe note')).toBeVisible();
  });
});
```

Note on `findRecord`: check its signature in `e2e/tests/steps/assert-record.ts:41` while implementing (it matches manifest records; if it keys on model api_key + title marker differently, adapt the two call-site lines — the manifest was regenerated in Task 3 so the records are present).

- [ ] **Step 3: Run the rendering test alone**

Run: `npx playwright test frameless-pins --project=deepl` (DeepL is the suite's debug lane per `e2e/AGENTS.md`)
Expected: PASS. If the label-visibility selectors don't discriminate (CMS DOM drift), fall back to structural assertions per the memory note in `datocms-dashboard-e2e-dom.md` — but prefer the semantic label check.

- [ ] **Step 4: Add the bug-#1 probe (`test.fail()`) and the framed control (§9.4 tests 2–3)**

```ts
  test('bug #1 probe: sidebar translate materialises a missing pseudo-frameless block', async ({ page }) => {
    test.fail(); // v3 silently discards the frameless-block translation (spec §1 bug 1). Phase 2+3 flips this.
    test.setTimeout(TIMEOUTS.twelve_min);
    const { vendor, envName } = meta();

    await step(vendor, 'open BV Probe', () => openRecord(page, meta(), BLOCK_VARIANTS, BV_PROBE.id));
    const run = await step(vendor, 'sidebar translate en → record locales', () =>
      translateRecordViaSidebar(page, { fromLocale: 'en', vendor }));
    expect(run.completed, 'translation should complete').toBe(true);

    const save = await step(vendor, 'save', () => saveRecord(page, vendor));
    expect(save.status, save.fieldErrors.join('; ')).toBe(200);

    // The it-locale pseudo_frameless block must now EXIST (CMA read-back).
    const value = await getLocaleValue(envName, BV_PROBE.id, 'it', 'pseudo_frameless');
    expect(value, 'pseudo_frameless.it should hold a block after translate+save').not.toBeNull();
  });

  test('control: the framed editor materialises its missing block (passes today)', async ({ page }) => {
    test.setTimeout(TIMEOUTS.twelve_min);
    const { vendor, envName } = meta();
    await step(vendor, 'open BV Probe', () => openRecord(page, meta(), BLOCK_VARIANTS, BV_PROBE.id));
    const run = await translateRecordViaSidebar(page, { fromLocale: 'en', vendor });
    expect(run.completed).toBe(true);
    const save = await saveRecord(page, vendor);
    expect(save.status, save.fieldErrors.join('; ')).toBe(200);
    const value = await getLocaleValue(envName, BV_PROBE.id, 'it', 'framed_control');
    expect(value, 'framed_control.it should hold a block').not.toBeNull();
  });
```

⚠️ Ordering caveat: both tests sidebar-translate the SAME record in the same lane run — the second starts from the first's saved state. That is fine for these assertions (both check block presence in `it`), but keep the probe FIRST so its `null → still null` failure isn't masked by the control's successful framed write. State this in a comment.

⚠️ `getLocaleValue(envName, …)` signature: verify against `assert-record.ts:171` while implementing (it reads via CMA in the forked env).

- [ ] **Step 5: Run both on the debug lane**

Run: `npx playwright test frameless-pins --project=deepl`
Expected: rendering PASS; probe reported as **expected failure** (✘ but suite green); control PASS. Confirm the teardown removed the fork (`global-teardown` output) — this validates Step 1's conclusion empirically.

- [ ] **Step 6: Commit**

```bash
git add e2e/tests/frameless-pins.spec.ts
git commit -m "test(e2e): frameless rendering contract + bug-#1 probe (test.fail) + framed control"
```

---

### Task 6: Exclusion-preservation pin (§9.4 test 4, `test.fail()`)

v3 writes the SOURCE text into an excluded block sub-field and clobbers hand-edited target content (spec §4.3 / incoherence #4). Pin the correct v4 behavior now.

**Files:**
- Modify: `e2e/tests/frameless-pins.spec.ts` (append)

**Interfaces:**
- Consumes: `cmaClient` from `./setup/cma` (`cmaClient(environment?)`), `resolvePluginId` from `./setup/plugin-params`, BV Control record (Task 3), callout sub-field `body`.

- [ ] **Step 1: Write the test**

```ts
  test('exclusion pin: an excluded block sub-field preserves existing target content', async ({ page }) => {
    test.fail(); // v3 copies the SOURCE into excluded sub-fields inside blocks (§4.3). Phase 2+3 flips this.
    test.setTimeout(TIMEOUTS.twelve_min);
    const { vendor, envName } = meta();
    const BV_CONTROL = findRecord(manifest, BLOCK_VARIANTS, 'BV Control');

    // Exclude callout.body by FIELD ID (the picker's stable token — spec §5.1)
    // directly via plugin params in this fork; restore afterwards.
    const client = cmaClient(envName);
    const pluginId = await resolvePluginId();
    const plugin = await client.plugins.find(pluginId);
    const params = plugin.parameters as Record<string, unknown>;
    const calloutFields = await client.fields.list('callout');
    const bodyField = calloutFields.find((f) => f.api_key === 'body');
    if (!bodyField) throw new Error('callout.body missing from seed');

    const before = await getLocaleValue(envName, BV_CONTROL.id, 'it', 'true_frameless');
    await client.plugins.update(pluginId, {
      parameters: {
        ...params,
        apiKeysToBeExcludedFromThisPlugin: [
          ...((params.apiKeysToBeExcludedFromThisPlugin as string[]) ?? []),
          bodyField.id,
        ],
      },
    });
    try {
      await step(vendor, 'open BV Control', () => openRecord(page, meta(), BLOCK_VARIANTS, BV_CONTROL.id));
      const run = await translateRecordViaSidebar(page, { fromLocale: 'en', vendor });
      expect(run.completed).toBe(true);
      const save = await saveRecord(page, vendor);
      expect(save.status, save.fieldErrors.join('; ')).toBe(200);

      // The excluded sub-field's it content must be byte-identical to before.
      const after = await getLocaleValue(envName, BV_CONTROL.id, 'it', 'true_frameless');
      const bodyOf = (v: unknown) => (v as { attributes?: { body?: string } })?.attributes?.body
        ?? (v as { body?: string })?.body;
      expect(bodyOf(after), 'excluded callout.body (it) must be preserved').toBe(bodyOf(before));
    } finally {
      await client.plugins.update(pluginId, { parameters: params }); // restore
    }
  });
```

⚠️ Two things to resolve while implementing, not assume: (a) `resolvePluginId()`'s environment handling — check `setup/plugin-params.ts:44`; the plugin install is per-fork, so the id must come from the fork's env; (b) the CMA block value shape for `getLocaleValue` reads (simple-shape `{ ...attrs }` vs JSON:API `{ attributes }` depends on the client call inside `assert-record.ts`) — the `bodyOf` helper above covers both, but trim it to the real one once seen.

- [ ] **Step 2: Run on the debug lane**

Run: `npx playwright test frameless-pins --project=deepl -g "exclusion pin"`
Expected: expected-failure (v3 clobbers `body` with the English source). If it PASSES, that is a finding, not a success — v3's behavior differs from the spec's diagnosis on this fixture; stop and re-verify §4.3 against what actually happened before committing.

- [ ] **Step 3: Commit**

```bash
git add e2e/tests/frameless-pins.spec.ts
git commit -m "test(e2e): exclusion-preservation pin for block sub-fields (test.fail)"
```

---

### Task 7: Converter round-trip harness (§9.4 test 6)

`ctx.formValuesToItem`/`ctx.itemToFormValues` exist only inside the live plugin iframe — the proof must run in the browser. A debug-gated hook exposes the round-trip on the sidebar iframe's `window`; the spec test drives it per seeded record.

**Files:**
- Create: `src/utils/devConverterRoundtrip.ts`
- Modify: `src/entrypoints/Sidebar/TranslateSidebar.tsx` (register the hook when `pluginParams.enableDebugging` is true)
- Modify: `e2e/tests/frameless-pins.spec.ts` (append the test)

**Interfaces:**
- Produces: `window.__aiTranslationsRoundtrip(): Promise<{ ok: boolean; diffs: string[] }>` on the **sidebar panel iframe's** window, only when `enableDebugging` is on (the E2E plugin params already enable debugging — verify in `setup/plugin-params.ts`, else enable it there for the fork).

- [ ] **Step 1: Write the hook module**

`src/utils/devConverterRoundtrip.ts`:

```ts
import type { RenderItemFormSidebarPanelCtx } from 'datocms-plugin-sdk';

/**
 * Debug-only converter round-trip probe (spec §9.4 test 6, phase 0).
 * formValues → formValuesToItem → itemToFormValues → deep-compare with the
 * original formValues. Registered on the sidebar iframe's window only when
 * `enableDebugging` is on; E2E drives it via frame.evaluate.
 *
 * Known-legitimate normalizations are excluded from the diff rather than
 * papered over: `internalLocales` (not an item attribute) and `undefined`
 * leaves (serialise to null by design — see prepareItemPayload).
 */
export type RoundtripResult = { ok: boolean; diffs: string[] };

const IGNORED_KEYS = new Set(['internalLocales']);

const diffValues = (a: unknown, b: unknown, path: string, out: string[]): void => {
  if (a === b) return;
  if ((a === undefined || a === null) && (b === undefined || b === null)) return;
  if (Array.isArray(a) && Array.isArray(b)) {
    if (a.length !== b.length) { out.push(`${path}: array length ${a.length} → ${b.length}`); return; }
    a.forEach((v, i) => diffValues(v, b[i], `${path}[${i}]`, out));
    return;
  }
  if (typeof a === 'object' && typeof b === 'object' && a && b) {
    const keys = new Set([...Object.keys(a), ...Object.keys(b)]);
    for (const k of keys) {
      if (IGNORED_KEYS.has(k)) continue;
      diffValues((a as Record<string, unknown>)[k], (b as Record<string, unknown>)[k], `${path}.${k}`, out);
    }
    return;
  }
  out.push(`${path}: ${JSON.stringify(a)} → ${JSON.stringify(b)}`);
};

/** Registers the probe; call once from the sidebar render when debugging is on. */
export const registerConverterRoundtrip = (ctx: RenderItemFormSidebarPanelCtx): void => {
  (window as unknown as Record<string, unknown>).__aiTranslationsRoundtrip =
    async (): Promise<RoundtripResult> => {
      const item = await ctx.formValuesToItem(ctx.formValues, false);
      if (!item) return { ok: false, diffs: ['formValuesToItem returned undefined'] };
      const back = await ctx.itemToFormValues(item);
      const diffs: string[] = [];
      diffValues(ctx.formValues, back, '$', diffs);
      return { ok: diffs.length === 0, diffs };
    };
};
```

- [ ] **Step 2: Register from the sidebar**

In `src/entrypoints/Sidebar/TranslateSidebar.tsx`, where `pluginParams` is already resolved (top of the component body), add:

```ts
  if (pluginParams.enableDebugging) {
    registerConverterRoundtrip(ctx);
  }
```

with the import. Wrap in `useEffect(() => { … }, [ctx])` if the component re-renders per keystroke (check the component's existing structure — registration is idempotent either way, it just reassigns the window property).

- [ ] **Step 3: Unit-test the differ**

`src/utils/devConverterRoundtrip.test.ts` — test `diffValues` indirectly is awkward (not exported); export it and pin: identical objects → no diffs; `undefined` vs `null` leaf → no diff; `internalLocales` ignored; a changed nested block field → one diff naming the path. Run `npm test -- devConverterRoundtrip`, expect PASS.

- [ ] **Step 4: Write the spec test**

Append to `frameless-pins.spec.ts` (the sidebar iframe locator pattern lives in `steps/per-record.ts:39` `openTranslationPanel` — reuse it):

```ts
  test('converter round-trip: formValuesToItem → itemToFormValues is lossless on seeded records', async ({ page }) => {
    const { vendor } = meta();
    const CASES = [
      { model: BLOCK_VARIANTS, rec: BV_PROBE },
      { model: 'article', rec: findRecord(manifest, 'article', /* kitchen-sink marker — copy from ai-translations.spec.ts's A1 */) },
    ];
    for (const { model, rec } of CASES) {
      await step(vendor, `round-trip ${model}/${rec.id}`, async () => {
        await openRecord(page, meta(), model, rec.id);
        const panel = await openTranslationPanel(page);
        const result = await panel.locator(':root').evaluate(async () => {
          const fn = (window as unknown as Record<string, unknown>).__aiTranslationsRoundtrip as
            () => Promise<{ ok: boolean; diffs: string[] }>;
          if (!fn) throw new Error('round-trip hook not registered — is enableDebugging on in this fork?');
          return fn();
        });
        expect(result.diffs, `round-trip diffs for ${model}`).toEqual([]);
      });
    }
  });
```

⚠️ `FrameLocator.evaluate` does not exist on frame locators directly — evaluate via a handle: `const frame = page.frames().find(...)` or `panel.locator('body').evaluate(...)`. Resolve against how `per-record.ts` already reaches into the iframe; adjust the two lines accordingly.

Expected finding, stated up front: the spec (§2.1) predicts real normalizations. If the diff list is non-empty for legitimate reasons (e.g. block wrapper shape differences), each one must be **classified** — either added to `IGNORED_KEYS`/normalization handling with a comment citing the CMS source, or reported as a phase-2 blocker. An unexplained diff is a failed task, not a tolerable flake.

- [ ] **Step 5: Run on the debug lane, then full suite once**

Run: `npx playwright test frameless-pins --project=deepl -g "round-trip"` → PASS (or classified diffs).
Then: `npx playwright test --project=deepl` → the whole lane stays green (the new spec must not disturb bulk ordering or teardown).

- [ ] **Step 6: Commit**

```bash
git add src/utils/devConverterRoundtrip.ts src/utils/devConverterRoundtrip.test.ts src/entrypoints/Sidebar/TranslateSidebar.tsx e2e/tests/frameless-pins.spec.ts
git commit -m "test(e2e): in-browser converter round-trip proof (debug-gated hook, spec §9.4-6)"
```

---

### Task 8: Restricted-role auth context + `internalLocales` pin (§9.4 test 5)

The suite has ONE dashboard login (`global-setup.ts:50` → `e2e/.auth/state.json`). The locale-scope pin (spec §6.3) is invisible to an admin, so this task adds a second, locale-restricted identity. **It contains one human step.**

**Files:**
- Create: `e2e/seed/7-restricted-role.mjs` (role + invitation via CMA)
- Modify: `e2e/tests/setup/env.ts` (optional vars `E2E_RESTRICTED_EMAIL` / `E2E_RESTRICTED_PASSWORD`), `e2e/tests/setup/global-setup.ts` (conditional second login → `e2e/.auth/restricted.json`), `e2e/tests/steps/dato-auth.ts` (parameterize credentials)
- Modify: `e2e/tests/frameless-pins.spec.ts` (append the pin, self-skipping when the creds are absent)

**Interfaces:**
- Consumes: `loginAndSaveState(storagePath)` (`dato-auth.ts:16`) — extend to `loginAndSaveState(storagePath, credentials?)`.
- Produces: role `e2e-restricted-it` (can edit only the `it` locale on `article`: `positive_item_type_permissions` entry with `localization_scope: 'localized'`, `locale: 'it'`, `action: 'update'` — verify exact rule shape against `https://www.datocms.com/docs/content-management-api/resources/role.md`); storage state `e2e/.auth/restricted.json`.

- [ ] **Step 1: Seed the role + invitation**

`e2e/seed/7-restricted-role.mjs`: idempotently create the role (list → find by name → create) and, if `process.env.E2E_RESTRICTED_EMAIL` is set and no collaborator with that email exists, `client.siteInvitations.create({ email, role })`. Log clearly:

```
⚠ HUMAN STEP: accept the invitation sent to <email>, set the password, and put
  E2E_RESTRICTED_EMAIL / E2E_RESTRICTED_PASSWORD into .env.testing.
```

- [ ] **Step 2: Second storage state in global-setup**

In `global-setup.ts`, after the existing `loginAndSaveState(STORAGE_STATE)`:

```ts
  if (process.env.E2E_RESTRICTED_EMAIL && process.env.E2E_RESTRICTED_PASSWORD) {
    await loginAndSaveState(RESTRICTED_STORAGE_STATE, {
      email: process.env.E2E_RESTRICTED_EMAIL,
      password: process.env.E2E_RESTRICTED_PASSWORD,
    });
  }
```

with `RESTRICTED_STORAGE_STATE = 'e2e/.auth/restricted.json'` exported from `setup/constants.ts`, and `loginAndSaveState` gaining an optional `credentials` parameter that defaults to the current env-var pair it already reads.

- [ ] **Step 3: The pin test**

Append to `frameless-pins.spec.ts` — a fresh context with the restricted state; self-skips when unprovisioned so lanes stay green until the human step is done:

```ts
  test('locale-scope pin: an out-of-scope locale write is dropped at save (restricted role)', async ({ browser }) => {
    test.skip(
      !process.env.E2E_RESTRICTED_EMAIL || !process.env.E2E_RESTRICTED_PASSWORD,
      'restricted-role credentials not provisioned (see e2e/seed/7-restricted-role.mjs)',
    );
    const context = await browser.newContext({ storageState: 'e2e/.auth/restricted.json' });
    const page = await context.newPage();
    try {
      // The restricted role can edit ONLY `it`. Open an article, sidebar-translate
      // en → all locales, save, then CMA-read: `it` landed; `es` (out of scope)
      // did NOT — and, critically, the UI surfaced NO success claim for `es`.
      // This is the CURRENT-BEHAVIOR pin for spec §6.3's silent-drop: today the
      // drop IS silent. Phase 2+3's mitigation work flips the last assertion.
      // …(openRecord/translateRecordViaSidebar/saveRecord/getLocaleValue as above,
      //   against the article kitchen-sink record; exact assertions per §6.3)…
    } finally {
      await context.close();
    }
  });
```

Write the body with the same helpers as Tasks 5–6; the two CMA assertions are `getLocaleValue(envName, id, 'it', 'title') !== null` and `getLocaleValue(envName, id, 'es', 'title') === null`. Mark the "no success claim for es" assertion `test.fail()`-style via a separate pinned expectation comment — v3 DOES claim success today; leave the assertion in as `expect.soft` with a `// FLIPS IN PHASE 2+3` comment rather than failing the whole pin.

⚠️ The restricted user must also be able to SEE the model and use the plugin — give the role read access to the environment and check `rolesToBeExcludedFromThisPlugin` stays empty in the fork's plugin params.

- [ ] **Step 4: Run (provisioned) or verify the skip (unprovisioned)**

Run: `npx playwright test frameless-pins --project=deepl -g "locale-scope"`
Expected: SKIP with the provisioning message until the human step is done; after provisioning: `it` lands, `es` null, soft-assert notes the silent success claim.

- [ ] **Step 5: Commit**

```bash
git add e2e/seed/7-restricted-role.mjs e2e/tests/setup/ e2e/tests/steps/dato-auth.ts e2e/tests/frameless-pins.spec.ts
git commit -m "test(e2e): restricted-role auth context + locale-scope pin (spec §6.3/§9.4-5)"
```

---

### Task 9: Full-suite validation + phase-0 close-out

- [ ] **Step 1: Full matrix run**

Run: `npx playwright test`
Expected: every configured lane green (expected-failures reported as expected); teardown removes every `e2e-*` fork; `manual-e2e-*` envs untouched.

- [ ] **Step 2: Unit suite + build untouched**

Run: `npm test && npm run build`
Expected: green — phase 0 added only the debug-gated hook to `src/`.

- [ ] **Step 3: Update `e2e/AGENTS.md`**

Add short sections: the `block_variants`/`draft_pool` fixtures and what each field pins; `frameless-pins.spec.ts`'s expected-fail inventory (which pins flip in which v4 phase); the platform-pins script; the restricted-role provisioning procedure. Follow the file's existing tone (rules + why).

- [ ] **Step 4: Commit**

```bash
git add e2e/AGENTS.md
git commit -m "docs(e2e): phase-0 fixtures, pins inventory, restricted-role provisioning"
```

---

## Self-Review Notes

- **Spec coverage (§9.4):** seed items → Tasks 1–3; test 1 → Task 5; test 2 → Task 5 (`test.fail`); test 3 → Task 5; test 4 → Task 6 (`test.fail`); test 5 → Task 8; test 6 → Task 7; test 7 → explicitly deferred to phase 2+3 (header); test 8 → schema+platform halves in Tasks 2/4, UI half deferred to phase 5 (header). Feasibility constraints (§9.4 bottom): `test.fail()`×teardown → Task 5 step 1; second auth context → Task 8; in-browser round-trip → Task 7.
- **Placeholder scan:** Task 8 step 3 leaves the pin body abbreviated by design — its helpers and assertions are fully specified in the surrounding text and identical to Task 5's shown code; the two CMA assertions are given exactly. Everything else carries complete code or an exact command.
- **Type consistency:** helper names (`openRecord`, `translateRecordViaSidebar`, `saveRecord`, `getLocaleValue`, `loadManifest`, `findRecord`, `cmaClient`, `resolvePluginId`, `loginAndSaveState`, `openTranslationPanel`) were verified against the current tree before writing; each task that touches an unverified detail (block value shape, `findRecord` signature, frame-evaluate idiom, role rule shape, `meta.is_valid`) carries an explicit ⚠ resolve-don't-assume instruction.
- **Safety:** the single shared-project write is confined to Task 3 step 2, after review, in documented order; record scripts are additive and marker-idempotent; platform pins clean up their scratch records.
