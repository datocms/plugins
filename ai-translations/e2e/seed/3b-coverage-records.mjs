/**
 * Stage 3b — Coverage top-ups from the adversarial audit (all verified against
 * the plugin source):
 *
 *  A6 (NEW, article, ar + zh-Hans, en EMPTY)
 *    - non-Latin / RTL / CJK SOURCE locales (translate-FROM ar & zh-Hans)
 *    - hyphenated source (zh-Hans) exercises parseLocalesFromActionId's
 *      multi-segment splitter in ItemsDropdownUtils.ts
 *    - placeholder/variable tokens {{brand}} {count} %s :destination + an ICU
 *      plural string -> triggers tokenize()/detokenize() + checkPlaceholderSurvival
 *      (the feature/translation-qc placeholder-survival path), incl. inside a block field
 *    - blocks translated FROM a non-Latin source (callout in structured_text, hero+cta in modular)
 *    - optional single_block fields (spotlight, inline_note) + cover/gallery left
 *      empty while other block containers are filled -> mixed gap-fill coverage
 *
 *  A1 (UPDATE)
 *    - add a PARTIAL fr locale (title + seo only) so a suite translation into fr
 *      can exercise overwrite (selected fields) vs preserve (already-present fr)
 *
 * Idempotent: skips A6 if it already exists; the A1 fr top-up is harmless to repeat.
 */
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { buildBlockRecord } from '@datocms/cma-client-node';
import { client, section, step } from './lib/config.mjs';
import { span, blockNode, dast, fileVal, seoVal, jsonVal } from './lib/content.mjs';

const here = dirname(fileURLToPath(import.meta.url));
const uploads = JSON.parse(readFileSync(join(here, 'uploads.json'), 'utf8'));

const itemTypes = await client.itemTypes.list();
const byKey = Object.fromEntries(itemTypes.map((it) => [it.api_key, it]));
const ref = (k) => ({ type: 'item_type', id: byKey[k].id });
const ARTICLE = ref('article');
const refs = { hero: ref('hero'), callout: ref('callout'), cta: ref('cta') };

const heroBlock = (a) => buildBlockRecord({ item_type: refs.hero, heading: a.heading, tagline: a.tagline, cta_label: a.cta_label, background_image: a.background_image ?? null, display_order: a.display_order ?? 1 });
const calloutBlock = (a) => buildBlockRecord({ item_type: refs.callout, title: a.title, body: a.body, is_dismissible: a.is_dismissible ?? false });
const ctaBlock = (a) => buildBlockRecord({ item_type: refs.cta, label: a.label, open_in_new_tab: a.open_in_new_tab ?? false });
const cover = (key, alt, title) => fileVal(uploads[key], alt, title);

section('STAGE 3b — Coverage top-ups');

// ---- A6: non-Latin source + placeholders -----------------------------------
const A6_TITLE_ZH = '{{brand}} 旅行指南';
const existing = await client.items.list({ filter: { type: byKey.article.id }, page: { limit: 100 } });
const a6Exists = existing.some((it) => it.title && it.title['zh-Hans'] === A6_TITLE_ZH);

if (a6Exists) {
  console.log('  ✓ A6 already exists (skipped)');
} else {
  await step('A6 article non-Latin source + placeholders (ar+zh-Hans, en empty)', () =>
    client.items.create({
      item_type: ARTICLE,
      // tokens ({{brand}} {count} %s :destination) are byte-identical across locales — they must survive translation
      title: { 'zh-Hans': A6_TITLE_ZH, ar: 'دليل السفر من {{brand}}' },
      slug: { 'zh-Hans': 'brand-lvxing-zhinan', ar: 'dalil-alsafar-brand' },
      excerpt: {
        'zh-Hans': '欢迎，{{userName}}！您还有 {count} 天即可前往 :destination。立即开始计划吧。',
        ar: 'مرحبًا، {{userName}}! بقي لديك {count} يوم للوصول إلى :destination. ابدأ التخطيط الآن.',
      },
      body_markdown: {
        'zh-Hans': '## 出发前\n\n使用优惠码 `%s` 即可享受 {{discount}} 折扣。查看我们的 [行程清单](https://example.com/checklist)。\n\n剩余名额：{itemCount, plural, one {# 个名额} other {# 个名额}}。',
        ar: '## قبل المغادرة\n\nاستخدم الرمز `%s` للحصول على خصم {{discount}}. اطّلع على [قائمة التحضير](https://example.com/checklist).\n\nالأماكن المتبقية: {itemCount, plural, one {# مكان} other {# أماكن}}.',
      },
      seo: {
        'zh-Hans': seoVal('{{brand}} 旅行指南', '与 {{brand}} 一起探索世界：为 {{userName}} 定制的行程、当地美食与实用贴士。'),
        ar: seoVal('دليل السفر من {{brand}}', 'استكشف العالم مع {{brand}}: مسارات مخصّصة لـ {{userName}}، وأطعمة محلية، ونصائح عملية.'),
      },
      // BLOCK-ONLY DAST (no heading/paragraph) -> exercises the textValues===0 && blockNodes>0
      // branch in StructuredTextTranslation that every other seeded structured_body misses.
      structured_body: {
        'zh-Hans': dast(blockNode(calloutBlock({ title: '小贴士', body: '尽早预订即可使用 `%s` 优惠。', is_dismissible: false }))),
        ar: dast(blockNode(calloutBlock({ title: 'نصيحة', body: 'احجز مبكرًا لاستخدام عرض `%s`.', is_dismissible: false }))),
      },
      content_blocks: {
        'zh-Hans': [
          heroBlock({ heading: '轻装上阵，看得更多', tagline: '{{userName}}，为你量身定制的低碳冒险。', cta_label: '开始计划', background_image: cover('mountain', '黎明时分的山脉', '黎明山峰'), display_order: 1 }),
          ctaBlock({ label: '下载清单', open_in_new_tab: true }),
        ],
        ar: [
          heroBlock({ heading: 'سافر خفيفًا، شاهد أكثر', tagline: '{{userName}}، مغامرات منخفضة الكربون مصمَّمة لك.', cta_label: 'ابدأ التخطيط', background_image: cover('mountain', 'سلسلة جبال عند الفجر', 'قمم الفجر'), display_order: 1 }),
          ctaBlock({ label: 'حمّل القائمة', open_in_new_tab: true }),
        ],
      },
      // spotlight, inline_note, cover_image, media_gallery deliberately left empty (mixed gap-fill coverage)
      author_name: 'Atlas Studio',
      view_count: 999,
      is_premium: false,
    }),
  );
}

// ---- A7: pre-filled partial TARGET locale + token in a JSON field ----------
// ru (an otherwise-empty suite target) is pre-filled for title+seo ONLY, so a
// suite translation INTO ru overwrites those two and gap-fills the rest ->
// exercises the overwrite-existing vs preserve-existing branches.
const A7_TITLE_EN = 'A Weekend in the Mountains';
const a7Exists = existing.some((it) => it.title && it.title.en === A7_TITLE_EN);
if (a7Exists) {
  console.log('  ✓ A7 already exists (skipped)');
} else {
  // DatoCMS rule: all PROVIDED localized fields must share the same locale set.
  // So every field below carries {en, ru}; ru is a real value only for title+seo
  // (pre-filled target) and null elsewhere (gap-fill on translate). Block-heavy
  // fields are omitted entirely (omitted fields are exempt).
  await step('A7 article partial-ru target + JSON token (en + partial ru)', () =>
    client.items.create({
      item_type: ARTICLE,
      title: { en: A7_TITLE_EN, ru: 'Выходные в горах' }, // ru pre-filled -> overwrite branch
      slug: { en: 'a-weekend-in-the-mountains', ru: null },
      excerpt: { en: 'Two days, one ridge, zero crowds — a micro-itinerary for a restorative mountain weekend.', ru: null },
      body_markdown: { en: '## Day one\n\nArrive by **noon**, hike the lower trail, and watch the sunset from the ridge.', ru: null },
      seo: {
        en: seoVal('A Weekend in the Mountains', 'A restorative two-day mountain micro-itinerary: a gentle ridge hike, a sunset, and no crowds.'),
        ru: seoVal('Выходные в горах', 'Восстанавливающий двухдневный маршрут в горах: лёгкий поход по хребту, закат и никакой толпы.'), // ru pre-filled -> overwrite branch
      },
      // tokens in a JSON field -> json translation through tokenize/detokenize
      featured_data: { en: jsonVal({ region: 'Alps', difficulty: 'moderate', cta: 'Book {{nights}} nights with {{brand}} for %s', refUrl: '/trip/:slug' }), ru: null },
      cover_image: { en: cover('mountain', 'A quiet alpine ridge at golden hour', 'Alpine Ridge'), ru: null },
      author_name: 'Sam Rivers',
      view_count: 211,
    }),
  );
}

// ---- A5: placeholder tokens in a Latin-source field + OVER-limit SEO --------
const a5 = existing.find((it) => it.title && it.title.en === 'Visas, Vaccines & VPNs: A Pre-Trip Checklist');
if (!a5) {
  console.log('  ✗ A5 not found — skipping A5 top-up');
} else if (a5.excerpt && a5.excerpt.en) {
  console.log('  ✓ A5 already topped up (skipped)');
} else {
  await step('A5 add placeholder excerpt + over-limit SEO (en+fr)', () =>
    client.items.update(a5.id, {
      excerpt: {
        en: 'Welcome back, {{name}}! You have {count} tasks left before your :destination trip — save %s on insurance this week.',
        fr: 'Bon retour, {{name}} ! Il vous reste {count} tâches avant votre voyage à :destination — économisez %s sur l’assurance cette semaine.',
      },
      // > 60 / > 160 chars so verbose targets reliably overshoot SeoTranslation's truncation branch
      seo: {
        en: seoVal(
          'The Ultimate Pre-Departure Travel Checklist: Visas, Vaccines, VPNs and Insurance',
          'A genuinely complete pre-departure checklist covering passports, visas, vaccinations, comprehensive travel insurance, VPNs and document backups, so absolutely nothing essential is forgotten before you finally fly abroad.',
        ),
        fr: seoVal(
          'La liste de contrôle ultime avant le départ : visas, vaccins, VPN et assurance voyage',
          'Une liste de contrôle réellement complète avant le départ : passeports, visas, vaccins, assurance voyage complète, VPN et sauvegardes de documents, pour ne rien oublier d’essentiel avant de partir enfin à l’étranger.',
        ),
      },
    }),
  );
}

section('STAGE 3b complete');
