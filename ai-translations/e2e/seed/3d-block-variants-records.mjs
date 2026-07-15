/**
 * Stage 3d — block_variants + draft_pool records (spec §9.4 phase 0).
 *
 *  BV Probe — the bug-#1 target: true_frameless carries a block in BOTH
 *    locales (required forces it); pseudo_frameless and framed_control carry a
 *    block in `en` and NULL in `it` (key present — INVALID_LOCALES needs every
 *    localized field on the same locale set). Sidebar-translating en→it must
 *    materialise the missing blocks; v3 silently drops the frameless one.
 *  BV Control — fully bilingual on all three variants (merge/preserve cases).
 *  DP Valid — a valid draft_pool record (en+it), so tests can blank a locale
 *    via the plugin rather than seed an already-broken record.
 *
 * Idempotent by marker title. Additive — NEVER folded into 3-records.mjs
 * (that script is not re-run safe; see e2e/AGENTS.md).
 */
import { buildBlockRecord } from '@datocms/cma-client-node';
import { client, section, step } from './lib/config.mjs';

const itemTypes = await client.itemTypes.list();
const byKey = Object.fromEntries(itemTypes.map((it) => [it.api_key, it]));
const bv = byKey.block_variant;
const dp = byKey.draft_pool;
const callout = byKey.callout;
if (!bv || !dp || !callout) throw new Error('run 1-schema.mjs first (block_variants/draft_pool/callout missing)');

const CALLOUT_REF = { type: 'item_type', id: callout.id };
const BV_REF = { type: 'item_type', id: bv.id };
const DP_REF = { type: 'item_type', id: dp.id };

// block fields are non-localized (per 1-schema.mjs's callout definition).
const calloutBlock = (title, body) =>
  buildBlockRecord({
    item_type: CALLOUT_REF,
    title,
    body,
    is_dismissible: false,
  });

// Per-record idempotency by marker title, so a partial earlier run self-heals
// (mirrors 3c-catalog-records.mjs's pattern).
const existingTitlesFor = async (itemTypeId) => {
  const existing = await client.items.list({
    filter: { type: itemTypeId },
    page: { limit: 100 },
  });
  return new Set(existing.map((it) => it.title?.en).filter(Boolean));
};

section('STAGE 3d — block_variants + draft_pool records');

const bvExisting = await existingTitlesFor(bv.id);

if (bvExisting.has('BV Probe')) {
  console.log('  ✓ block_variants "BV Probe" already exists (skipped)');
} else {
  await step('block_variants "BV Probe"', () => client.items.create({
    item_type: BV_REF,
    title: { en: 'BV Probe', it: 'BV Probe (it)' },
    true_frameless: {
      en: calloutBlock('Probe note', 'Required block, en'),
      it: calloutBlock('Nota probe', 'Blocco richiesto, it'),
    },
    pseudo_frameless: {
      en: calloutBlock('Pseudo note', 'Only en has this block'),
      it: null,
    },
    framed_control: {
      en: calloutBlock('Framed note', 'Only en has this block'),
      it: null,
    },
  }));
}

if (bvExisting.has('BV Control')) {
  console.log('  ✓ block_variants "BV Control" already exists (skipped)');
} else {
  await step('block_variants "BV Control"', () => client.items.create({
    item_type: BV_REF,
    title: { en: 'BV Control', it: 'BV Control (it)' },
    true_frameless: {
      en: calloutBlock('Ctrl A', 'en body A'),
      it: calloutBlock('Ctrl A it', 'it body A'),
    },
    pseudo_frameless: {
      en: calloutBlock('Ctrl B', 'en body B'),
      it: calloutBlock('Ctrl B it', 'it body B'),
    },
    framed_control: {
      en: calloutBlock('Ctrl C', 'en body C'),
      it: calloutBlock('Ctrl C it', 'it body C'),
    },
  }));
}

const dpExisting = await existingTitlesFor(dp.id);

if (dpExisting.has('DP Valid')) {
  console.log('  ✓ draft_pool "DP Valid" already exists (skipped)');
} else {
  await step('draft_pool "DP Valid"', () => client.items.create({
    item_type: DP_REF,
    title: { en: 'DP Valid', it: 'DP Valid (it)' },
    summary: { en: 'A valid draft-pool record.', it: 'Un record valido.' },
  }));
}

section('STAGE 3d complete');
