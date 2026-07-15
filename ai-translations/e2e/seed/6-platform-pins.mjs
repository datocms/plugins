/**
 * Stage 6 — platform pins (spec §4.0). Scratch records only; always cleaned up.
 *  P1: a draft-saving model PERSISTS an invalid draft (blank required title).
 *  P2: that invalid draft CANNOT be published.
 *  P3: a strict model 422s the same blank (VALIDATION_REQUIRED).
 *
 * Safe to re-run: scratch records are destroyed in a `finally`-style cleanup
 * pass regardless of pin outcome, so nothing accumulates in the shared project.
 */
import { client, section, step } from './lib/config.mjs';

const itemTypes = await client.itemTypes.list();
const byKey = Object.fromEntries(itemTypes.map((it) => [it.api_key, it]));
const dp = byKey.draft_pool;
const article = byKey.article;
if (!dp || !article) throw new Error('run 1-schema.mjs first (draft_pool/article missing)');

const failures = [];
const pin = async (name, fn) => {
  try {
    await fn();
    console.log(`  ✓ ${name}`);
  } catch (err) {
    const detail = err?.errors ? JSON.stringify(err.errors, null, 2) : err?.message || String(err);
    failures.push(name);
    console.log(`  ✗ ${name}\n${detail}`);
  }
};
const scratch = [];

section('STAGE 6 — platform pins');

await pin('P1 draft-saving model persists an invalid draft', async () => {
  const item = await client.items.create({
    item_type: { type: 'item_type', id: dp.id },
    title: { en: null, it: null }, // blank REQUIRED field, every locale
    summary: { en: 'pin scratch', it: 'pin scratch' },
  });
  scratch.push(item.id);
  if (!item.id) throw new Error('no id returned');
  // meta.is_valid is the CMA's real validity flag on Item (verified against
  // @datocms/cma-client's ApiTypes.ItemMeta — not just the plan's assumption).
  const fetched = await client.items.find(item.id);
  if (fetched.meta.is_valid !== false) throw new Error(`expected meta.is_valid=false, got ${fetched.meta.is_valid}`);
});

await pin('P2 the invalid draft cannot be published', async () => {
  const id = scratch[0];
  if (!id) throw new Error('P1 did not produce a scratch record to publish');
  let published = false;
  try {
    await client.items.publish(id);
    published = true;
  } catch {
    /* expected */
  }
  if (published) throw new Error('publish succeeded on an invalid draft');
});

await pin('P3 a strict model 422s the same blank (VALIDATION_REQUIRED)', async () => {
  // article.title carries `validators: { required: {} }` in 1-schema.mjs — the
  // seed's strict control field (verified there, not assumed).
  let created;
  try {
    created = await client.items.create({
      item_type: { type: 'item_type', id: article.id },
      title: { en: null, it: null },
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
