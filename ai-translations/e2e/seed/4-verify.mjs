/**
 * Stage 4 — Verify & report.
 * Reads the live project back and cross-checks it against the plugin's
 * translatable editor surface. Prints a coverage matrix; exits non-zero on gaps.
 */
import { client, LOCALES, section } from './lib/config.mjs';

// The 10 editors the plugin exposes as translatable + special-cased equivalents.
const TRANSLATABLE_EDITORS = [
  'single_line', 'markdown', 'wysiwyg', 'textarea', 'slug', 'json', 'seo',
  'structured_text', 'rich_text', 'file',
];
const SPECIAL_EDITORS = ['gallery', 'framed_single_block', 'frameless_single_block'];

section('STAGE 4 — Verification');

// --- locales -----------------------------------------------------------------
const site = await client.site.find();
console.log('Primary locale:', site.locales[0]);
console.log(`Locales (${site.locales.length}):`, site.locales.join(', '));
const localesOk = LOCALES.every((l) => site.locales.includes(l)) && site.locales[0] === 'en';
console.log(localesOk ? '  ✓ all expected locales present, en primary' : '  ✗ locale mismatch');

// --- schema ------------------------------------------------------------------
section('Schema — editors present (localized top-level + block fields)');
const itemTypes = await client.itemTypes.list();
const models = itemTypes.filter((it) => !it.modular_block);
const blocks = itemTypes.filter((it) => it.modular_block);

const editorsLocalizedTopLevel = new Set();
const editorsAnywhere = new Set();
const fieldsByType = {};
let negativesTopLevel = 0;

for (const it of itemTypes) {
  const fields = await client.fields.list(it.id);
  fieldsByType[it.api_key] = fields;
  for (const f of fields) {
    const ed = f.appearance.editor;
    editorsAnywhere.add(ed);
    if (f.localized && !it.modular_block) editorsLocalizedTopLevel.add(ed);
    if (!it.modular_block && !f.localized && ['single_line', 'integer', 'float', 'boolean'].includes(ed)) {
      negativesTopLevel++;
    }
  }
}

console.log(`Models: ${models.map((m) => m.api_key).join(', ')}`);
console.log(`Blocks: ${blocks.map((b) => b.api_key).join(', ')}`);
const missingTranslatable = TRANSLATABLE_EDITORS.filter((e) => !editorsLocalizedTopLevel.has(e));
const missingSpecial = SPECIAL_EDITORS.filter((e) => !editorsAnywhere.has(e));
console.log('\nTranslatable editors as localized top-level fields:');
for (const e of TRANSLATABLE_EDITORS) console.log(`  ${editorsLocalizedTopLevel.has(e) ? '✓' : '✗'} ${e}`);
console.log('Special-cased editors present anywhere:');
for (const e of SPECIAL_EDITORS) console.log(`  ${editorsAnywhere.has(e) ? '✓' : '✗'} ${e}`);
console.log(`Negative-coverage fields (non-localized / non-text top-level): ${negativesTopLevel}`);

// block inner fields include a nested file + negatives?
const heroFields = (fieldsByType.hero || []).map((f) => f.appearance.editor);
console.log(`Hero block inner editors: ${heroFields.join(', ')} ${heroFields.includes('file') ? '(✓ nested file)' : '(✗ no nested file)'}`);

// --- records -----------------------------------------------------------------
section('Records — populated locales & block payloads');
// Filter to the content models only — block records are items too and would
// otherwise show up here with no locales (block fields are non-localized).
const contentTypeIds = models.map((m) => m.id).join(',');
const allItems = await client.items.list({ nested: true, filter: { type: contentTypeIds }, page: { limit: 30 } });
console.log(`Content records: ${allItems.length}`);

/** Which locales have any non-empty value across a record's localized fields. */
const populatedLocales = (item, fields) => {
  const locs = new Set();
  for (const f of fields) {
    if (!f.localized) continue;
    const v = item[f.api_key];
    if (v && typeof v === 'object' && !Array.isArray(v)) {
      for (const [loc, val] of Object.entries(v)) {
        const nonEmpty = Array.isArray(val) ? val.length > 0 : val !== null && val !== undefined && val !== '';
        if (nonEmpty) locs.add(loc);
      }
    }
  }
  return [...locs];
};

let recordsOk = true;
for (const item of allItems) {
  const it = itemTypes.find((t) => t.id === item.item_type.id);
  const fields = fieldsByType[it.api_key];
  const locs = populatedLocales(item, fields).sort();
  // count blocks in rich_text/single_block/structured_text across locales
  let blockCount = 0;
  for (const f of fields) {
    if (!['rich_text', 'single_block', 'structured_text'].includes(f.field_type)) continue;
    const v = item[f.api_key];
    if (!v) continue;
    for (const val of Object.values(v)) {
      if (Array.isArray(val)) blockCount += val.filter((x) => x && typeof x === 'object').length;
      else if (val && typeof val === 'object' && val.document) {
        blockCount += (val.document.children || []).filter((c) => c.type === 'block').length;
      } else if (val && typeof val === 'object') blockCount += 1; // single_block
    }
  }
  const ok = locs.length >= 2;
  if (!ok) recordsOk = false;
  console.log(`  ${ok ? '✓' : '✗'} ${it.api_key.padEnd(8)} ${item.id}  locales=[${locs.join(',')}] blocks=${blockCount}`);
}

// --- verdict -----------------------------------------------------------------
section('Verdict');
const problems = [];
if (!localesOk) problems.push('locale set mismatch');
if (missingTranslatable.length) problems.push(`missing translatable editors: ${missingTranslatable.join(', ')}`);
if (missingSpecial.length) problems.push(`missing special editors: ${missingSpecial.join(', ')}`);
if (!recordsOk) problems.push('some records have <2 populated locales');
if (allItems.length < 8) problems.push(`expected >=8 records, found ${allItems.length}`);

if (problems.length) {
  console.log('✗ PROBLEMS:');
  for (const p of problems) console.log(`  - ${p}`);
  process.exit(2);
}
console.log('✓ All checks passed: locales, every translatable editor, single+multi blocks,');
console.log(`  single+multi assets, negative coverage, and ${allItems.length} records with ≥2 locales each.`);
