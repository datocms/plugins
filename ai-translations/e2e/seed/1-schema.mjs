/**
 * Stage 1 — Locales + schema.
 *
 * Creates a content model covering EVERY editor the AI Translations plugin can
 * translate, across two real-world models (article, product) plus 5 reusable
 * block models. Localized container fields exercise single vs multi blocks and
 * single vs multi assets; a few non-localized / non-text fields provide negative
 * coverage (the plugin must leave them untouched).
 *
 * Idempotent: re-running skips item types / fields that already exist (by api_key).
 */
import { client, LOCALES, section, step } from './lib/config.mjs';

// --- generic appearances -----------------------------------------------------
const textarea = { editor: 'textarea', parameters: {}, addons: [] };
// markdown's toolbar enum differs from wysiwyg's; empty params => Dato applies its default toolbar.
const markdown = { editor: 'markdown', parameters: {}, addons: [] };
const wysiwyg = {
  editor: 'wysiwyg',
  parameters: {
    toolbar: ['format', 'bold', 'italic', 'strikethrough', 'code', 'ordered_list',
      'unordered_list', 'quote', 'link', 'image', 'show_source'],
  },
  addons: [],
};
const framedBlock = { editor: 'framed_single_block', parameters: { start_collapsed: false }, addons: [] };
const framelessBlock = { editor: 'frameless_single_block', parameters: {}, addons: [] };

// --- idempotent helpers ------------------------------------------------------
const itemTypeCache = new Map();
const fieldCache = new Map(); // key: `${itemTypeId}:${apiKey}`

const loadItemTypes = async () => {
  const all = await client.itemTypes.list();
  for (const it of all) itemTypeCache.set(it.api_key, it);
};

const getOrCreateItemType = (apiKey, attrs) =>
  step(`item_type ${apiKey}`, async () => {
    if (itemTypeCache.has(apiKey)) return itemTypeCache.get(apiKey);
    const created = await client.itemTypes.create({ api_key: apiKey, ...attrs });
    itemTypeCache.set(apiKey, created);
    return created;
  });

const loadFields = async (itemTypeId) => {
  const fields = await client.fields.list(itemTypeId);
  for (const f of fields) fieldCache.set(`${itemTypeId}:${f.api_key}`, f);
};

const fieldFailures = [];

/**
 * Create a field if absent. Non-fatal: a failure is recorded and null returned
 * so one bad appearance doesn't abort the rest of the schema (re-run is idempotent).
 * @param spec - { field_type, label, localized?, validators?, appearance? }
 */
const field = async (itemTypeId, apiKey, spec) => {
  const cacheKey = `${itemTypeId}:${apiKey}`;
  if (fieldCache.has(cacheKey)) {
    console.log(`  ✓ field ${apiKey} (exists)`);
    return fieldCache.get(cacheKey);
  }
  try {
    const created = await client.fields.create(itemTypeId, {
      api_key: apiKey,
      label: spec.label,
      field_type: spec.field_type,
      localized: spec.localized ?? false,
      validators: spec.validators ?? {},
      ...(spec.appearance ? { appearance: spec.appearance } : {}),
    });
    fieldCache.set(cacheKey, created);
    console.log(`  ✓ field ${apiKey} (${spec.appearance?.editor || spec.field_type})`);
    return created;
  } catch (err) {
    const detail = err?.errors ? JSON.stringify(err.errors) : err?.message || String(err);
    console.log(`  ✗ field ${apiKey} (${spec.appearance?.editor || spec.field_type})\n      ${detail}`);
    fieldFailures.push({ itemTypeId, apiKey, detail });
    return null;
  }
};

// short field-spec builders
const single = (label, localized = true) => ({ field_type: 'string', label, localized });
const txt = (label, localized = true) => ({ field_type: 'text', label, localized, appearance: textarea });
const md = (label, localized = true) => ({ field_type: 'text', label, localized, appearance: markdown });
const html = (label, localized = true) => ({ field_type: 'text', label, localized, appearance: wysiwyg });
const intg = (label) => ({ field_type: 'integer', label, localized: false });
const bool = (label) => ({ field_type: 'boolean', label, localized: false });
const flt = (label) => ({ field_type: 'float', label, localized: false });
const fileF = (label, localized = true) => ({ field_type: 'file', label, localized });
const galleryF = (label, localized = true) => ({ field_type: 'gallery', label, localized });
const jsonF = (label, localized = true) => ({ field_type: 'json', label, localized });
const seoF = (label, localized = true) => ({ field_type: 'seo', label, localized });

async function main() {
  section('STAGE 1 — Locales + Schema');

  // 1. Locales (en stays primary at index 0)
  await step(`locales → [${LOCALES.join(', ')}]`, () =>
    client.site.update({ locales: LOCALES }),
  );

  await loadItemTypes();

  // 2. Block models (must exist before block-bearing fields reference them)
  section('Block models');
  const hero = await getOrCreateItemType('hero', { name: 'Hero', modular_block: true });
  const callout = await getOrCreateItemType('callout', { name: 'Callout', modular_block: true });
  const quote = await getOrCreateItemType('quote', { name: 'Quote', modular_block: true });
  const cta = await getOrCreateItemType('cta', { name: 'Call To Action', modular_block: true });
  const featureItem = await getOrCreateItemType('feature_item', { name: 'Feature Item', modular_block: true });

  for (const it of [hero, callout, quote, cta, featureItem]) await loadFields(it.id);

  // 3. Block fields (non-localized; container field localization drives per-locale)
  section('Block fields');
  await field(hero.id, 'heading', single('Heading', false));
  await field(hero.id, 'tagline', txt('Tagline', false));
  await field(hero.id, 'cta_label', single('CTA label', false));
  await field(hero.id, 'background_image', fileF('Background image', false)); // nested file translation
  await field(hero.id, 'display_order', intg('Display order')); // negative: integer skipped

  await field(callout.id, 'title', single('Title', false));
  await field(callout.id, 'body', md('Body', false));
  await field(callout.id, 'is_dismissible', bool('Is dismissible')); // negative

  await field(quote.id, 'quote_text', txt('Quote text', false));
  await field(quote.id, 'attribution', single('Attribution', false));

  await field(cta.id, 'label', single('Label', false));
  await field(cta.id, 'open_in_new_tab', bool('Open in new tab')); // negative

  await field(featureItem.id, 'name', single('Name', false));
  await field(featureItem.id, 'description', txt('Description', false));
  await field(featureItem.id, 'detail_html', html('Detail (HTML)', false));

  const blockIds = {
    hero: hero.id, callout: callout.id, quote: quote.id, cta: cta.id, feature_item: featureItem.id,
  };

  // 4. Main models
  section('Main models');
  const article = await getOrCreateItemType('article', { name: 'Article' });
  const product = await getOrCreateItemType('product', { name: 'Product' });
  await loadFields(article.id);
  await loadFields(product.id);

  // 5a. Article fields — every translatable editor + negatives
  section('Article fields');
  const articleTitle = await field(article.id, 'title', { ...single('Title'), validators: { required: {} } });
  await field(article.id, 'slug', {
    field_type: 'slug', label: 'Slug', localized: true,
    validators: {
      ...(articleTitle ? { slug_title_field: { title_field_id: articleTitle.id } } : {}),
      slug_format: { predefined_pattern: 'webpage_slug' },
    },
  });
  await field(article.id, 'excerpt', txt('Excerpt'));
  await field(article.id, 'body_markdown', md('Body (Markdown)'));
  await field(article.id, 'body_html', html('Body (HTML)'));
  await field(article.id, 'seo', seoF('SEO'));
  await field(article.id, 'featured_data', jsonF('Featured data (JSON)'));
  await field(article.id, 'structured_body', {
    field_type: 'structured_text', label: 'Structured body', localized: true,
    validators: {
      structured_text_blocks: { item_types: [blockIds.callout, blockIds.quote] },
      structured_text_inline_blocks: { item_types: [] },
      structured_text_links: { item_types: [], on_publish_with_unpublished_references_strategy: 'fail', on_reference_unpublish_strategy: 'fail', on_reference_delete_strategy: 'fail' },
    },
  });
  await field(article.id, 'content_blocks', {
    field_type: 'rich_text', label: 'Content blocks (Modular)', localized: true,
    validators: { rich_text_blocks: { item_types: [blockIds.hero, blockIds.callout, blockIds.quote, blockIds.cta] } },
  });
  await field(article.id, 'spotlight', {
    field_type: 'single_block', label: 'Spotlight (single, framed)', localized: true,
    appearance: framedBlock, validators: { single_block_blocks: { item_types: [blockIds.hero] } },
  });
  await field(article.id, 'inline_note', {
    field_type: 'single_block', label: 'Inline note (single, frameless)', localized: true,
    appearance: framelessBlock, validators: { single_block_blocks: { item_types: [blockIds.callout] } },
  });
  await field(article.id, 'cover_image', fileF('Cover image'));
  await field(article.id, 'media_gallery', galleryF('Media gallery'));
  await field(article.id, 'author_name', single('Author name', false)); // negative: translatable editor, not localized
  await field(article.id, 'view_count', intg('View count')); // negative
  await field(article.id, 'is_premium', bool('Is premium')); // negative
  if (articleTitle) await step('article.title_field wiring', () =>
    client.itemTypes.update(article.id, { title_field: { id: articleTitle.id, type: 'field' } }),
  );

  // 5b. Product fields
  section('Product fields');
  const productName = await field(product.id, 'name', { ...single('Name'), validators: { required: {} } });
  await field(product.id, 'slug', {
    field_type: 'slug', label: 'Slug', localized: true,
    validators: {
      ...(productName ? { slug_title_field: { title_field_id: productName.id } } : {}),
      slug_format: { predefined_pattern: 'webpage_slug' },
    },
  });
  await field(product.id, 'subtitle', single('Subtitle'));
  await field(product.id, 'description', txt('Description'));
  await field(product.id, 'specs_html', html('Specs (HTML)'));
  await field(product.id, 'promo_markdown', md('Promo (Markdown)'));
  await field(product.id, 'seo', seoF('SEO'));
  await field(product.id, 'attributes_json', jsonF('Attributes (JSON)'));
  await field(product.id, 'features', {
    field_type: 'rich_text', label: 'Features (Modular)', localized: true,
    validators: { rich_text_blocks: { item_types: [blockIds.feature_item, blockIds.cta] } },
  });
  await field(product.id, 'hero', {
    field_type: 'single_block', label: 'Hero (single, framed)', localized: true,
    appearance: framedBlock, validators: { single_block_blocks: { item_types: [blockIds.hero] } },
  });
  await field(product.id, 'main_image', fileF('Main image'));
  await field(product.id, 'price', flt('Price')); // negative
  await field(product.id, 'sku', single('SKU', false)); // negative
  if (productName) await step('product.title_field wiring', () =>
    client.itemTypes.update(product.id, { title_field: { id: productName.id, type: 'field' } }),
  );

  section('STAGE 1 complete');
  console.log('Models:', { article: article.id, product: product.id });
  console.log('Blocks:', blockIds);
  if (fieldFailures.length) {
    section(`⚠ ${fieldFailures.length} FIELD FAILURE(S) — fix appearance/validators and re-run`);
    for (const f of fieldFailures) console.log(`  - ${f.apiKey}: ${f.detail}`);
    process.exit(2);
  }
}

main().catch((e) => {
  console.error('\nFATAL:', e?.message || e);
  process.exit(1);
});
