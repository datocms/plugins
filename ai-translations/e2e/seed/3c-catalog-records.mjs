/**
 * Stage 3c — Catalog-entry records for the localized-reference + length-validator
 * paths (master 3.6.0 linked-record fix + the QC length check). Depends on the
 * `catalog_entry` model from 1-schema.mjs (title + required localized `links`
 * `related_articles` + tiny-limit `badge`).
 *
 *  C1, C2 (reference-copy → completed-with-warnings)
 *    - title + related_articles filled in the source locales (en + it); es/others
 *      empty. The links field is never sent to a provider, so a bulk translate
 *      into a new locale must CARRY the same referenced ids over (locale-sync
 *      fallback) — satisfying the size:{min:1} constraint that used to 422 — and
 *      the record surfaces as `completed-with-warnings`. `badge` left empty so
 *      these isolate the reference path from the length path.
 *
 *  C3 (length-validator → failure with a reason)
 *    - additionally sets `badge` = "Phone" (en only; 5 chars, within the limit at
 *      source). Any real translation overflows the 5-char limit (es "Teléfono"),
 *      so a bulk translate drives checkFieldLength (per-record: a ctx.alert) and
 *      the CMA length 422 (bulk: a failed row with a length reason).
 *
 * Idempotent: skips creation when the catalog records already exist (by marker
 * title). Links target real article records fetched at run time.
 */
import { client, section, step } from './lib/config.mjs';

const itemTypes = await client.itemTypes.list();
const byKey = Object.fromEntries(itemTypes.map((it) => [it.api_key, it]));
const catalog = byKey.catalog_entry;
const article = byKey.article;
if (!catalog) throw new Error('catalog_entry model missing — run 1-schema.mjs first');

const CATALOG_REF = { type: 'item_type', id: catalog.id };

section('STAGE 3c — Catalog-entry records (reference-copy + length-validator)');

// Two real article records to reference (shared across locales).
const articles = await client.items.list({
  filter: { type: article.id },
  page: { limit: 2 },
});
if (articles.length < 2) {
  throw new Error('need ≥2 article records to link — run 3-records.mjs first');
}
const [artA, artB] = articles;

// Every localized field on a record must define the SAME locale set (DatoCMS
// INVALID_LOCALES), so `badge` carries both en+it even where only en drives the
// en→target overflow; both source values stay within the 5-char limit.
const RECORDS = [
  {
    // C1 — reference-copy only.
    title: { en: 'Summer Collection', it: 'Collezione Estiva' },
    related_articles: { en: [artA.id], it: [artA.id] },
  },
  {
    // C2 — reference-copy only (a second, so the withWarnings bucket is > 1).
    title: { en: 'Winter Collection', it: 'Collezione Invernale' },
    related_articles: { en: [artB.id], it: [artB.id] },
  },
  {
    // C3 — length-validator: `badge` overflows the 5-char limit on translation.
    // "Learn" (5, at the limit) reliably translates to a longer word in any
    // target (es "Aprender" = 8) — a common verb no provider leaves in English,
    // unlike a loanword such as "Phone".
    title: { en: 'Autumn Picks', it: 'Scelte Autunnali' },
    related_articles: { en: [artA.id], it: [artA.id] },
    badge: { en: 'Learn', it: 'App' }, // ≤5 at source; en→es "Aprender" > 5
  },
];

// Per-record idempotency by marker title, so a partial earlier run self-heals.
const existing = await client.items.list({
  filter: { type: catalog.id },
  page: { limit: 100 },
});
const existingTitles = new Set(
  existing.map((it) => it.title?.en).filter(Boolean),
);
for (const fields of RECORDS) {
  const marker = fields.title.en;
  if (existingTitles.has(marker)) {
    console.log(`  ✓ ${marker} already exists (skipped)`);
    continue;
  }
  await step(`catalog_entry "${marker}"`, () =>
    client.items.create({ item_type: CATALOG_REF, ...fields }),
  );
}

section('STAGE 3c complete');
