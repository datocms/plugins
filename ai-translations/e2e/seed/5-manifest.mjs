/**
 * Stage 5 — Manifest dump (read-only).
 * Writes seed-manifest.json: locales, models/blocks + fields, uploads, and the
 * 8 content records with their populated (source) locales and empty (target)
 * locales — everything the E2E suite needs to drive translations.
 */
import { writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { client, LOCALES } from './lib/config.mjs';

const here = dirname(fileURLToPath(import.meta.url));
const site = await client.site.find();
const itemTypes = await client.itemTypes.list();
const models = itemTypes.filter((it) => !it.modular_block);
const blocks = itemTypes.filter((it) => it.modular_block);

const fieldSummary = async (it) =>
  (await client.fields.list(it.id)).map((f) => ({
    api_key: f.api_key, editor: f.appearance.editor, field_type: f.field_type, localized: f.localized,
  }));

const schema = { models: {}, blocks: {} };
for (const m of models) schema.models[m.api_key] = { id: m.id, fields: await fieldSummary(m) };
for (const b of blocks) schema.blocks[b.api_key] = { id: b.id, fields: await fieldSummary(b) };

const contentTypeIds = models.map((m) => m.id).join(',');
const items = await client.items.list({ nested: true, filter: { type: contentTypeIds }, page: { limit: 30 } });

const populated = (item, fields) => {
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
  return [...locs].sort();
};

const records = [];
for (const item of items) {
  const m = models.find((t) => t.id === item.item_type.id);
  const fields = schema.models[m.api_key].fields;
  const sourceLocales = populated(item, fields);
  records.push({
    id: item.id,
    model: m.api_key,
    title: (item.title || item.name)?.[sourceLocales[0]] ?? '(untitled)',
    sourceLocales,
    emptyTargetLocales: LOCALES.filter((l) => !sourceLocales.includes(l)),
  });
}

const manifest = {
  project: { name: site.name, id: site.id },
  locales: site.locales,
  primaryLocale: site.locales[0],
  schema,
  records,
};
const out = join(here, 'seed-manifest.json');
writeFileSync(out, JSON.stringify(manifest, null, 2));
console.log(`Wrote ${out}`);
console.log(`Models: ${models.length}, Blocks: ${blocks.length}, Records: ${records.length}, Locales: ${site.locales.length}`);
