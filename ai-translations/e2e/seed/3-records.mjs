/**
 * Stage 3 — Records.
 *
 * Eight records in deliberate permutations so the E2E suite can exercise every
 * translation path. Each record has TWO locales populated (a source + one other);
 * the remaining 10 locales are left empty for the suite to translate into.
 *
 * Permutation matrix:
 *   A1 article  en+it  KITCHEN SINK — every translatable editor populated
 *   A2 article  en+es  SPARSE — few fields (title, excerpt, markdown, seo, cover)
 *   A3 article  it+es  NON-EN SOURCE — en empty; inline blocks + modular content
 *   A4 article  en+de  BLOCKS-HEAVY — modular + framed + frameless single blocks + gallery
 *   A5 article  en+fr  QC TORTURE — tricky HTML/markdown/marks/links/nested JSON/SEO-at-limit
 *   P1 product  en+es  FULL PRODUCT — all fields, features(multi) + hero(single)
 *   P2 product  es+de  NON-EN SOURCE — en empty; specs HTML + features
 *   P3 product  en+it  MINIMAL — name, slug, description, seo
 */
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { buildBlockRecord } from '@datocms/cma-client-node';
import { client, section } from './lib/config.mjs';
import {
  span, para, heading, link, bulleted, numbered, quoteNode, blockNode, dast,
  fileVal, seoVal, jsonVal,
} from './lib/content.mjs';

const here = dirname(fileURLToPath(import.meta.url));
const uploads = JSON.parse(readFileSync(join(here, 'uploads.json'), 'utf8'));

// ---- resolve schema refs by api_key ----------------------------------------
const itemTypes = await client.itemTypes.list();
const byKey = Object.fromEntries(itemTypes.map((it) => [it.api_key, it]));
const ref = (apiKey) => ({ type: 'item_type', id: byKey[apiKey].id });
const refs = {
  hero: ref('hero'), callout: ref('callout'), quote: ref('quote'),
  cta: ref('cta'), feature_item: ref('feature_item'),
};
const ARTICLE = ref('article');
const PRODUCT = ref('product');

// ---- block builders (block fields are non-localized) ------------------------
const heroBlock = (a) => buildBlockRecord({
  item_type: refs.hero,
  heading: a.heading, tagline: a.tagline, cta_label: a.cta_label,
  background_image: a.background_image ?? null, display_order: a.display_order ?? 1,
});
const calloutBlock = (a) => buildBlockRecord({
  item_type: refs.callout, title: a.title, body: a.body, is_dismissible: a.is_dismissible ?? false,
});
const quoteBlock = (a) => buildBlockRecord({
  item_type: refs.quote, quote_text: a.quote_text, attribution: a.attribution,
});
const ctaBlock = (a) => buildBlockRecord({
  item_type: refs.cta, label: a.label, open_in_new_tab: a.open_in_new_tab ?? false,
});
const featureBlock = (a) => buildBlockRecord({
  item_type: refs.feature_item, name: a.name, description: a.description, detail_html: a.detail_html,
});

// asset shorthands
const cover = (key, alt, title) => fileVal(uploads[key], alt, title);

// =============================================================================
//  RECORD DEFINITIONS
// =============================================================================
const records = [];

// ---- A1: KITCHEN SINK (article, en + it) -----------------------------------
records.push({
  label: 'A1 article kitchen-sink (en+it)',
  payload: {
    item_type: ARTICLE,
    title: { en: 'The Complete Guide to Sustainable Travel', it: 'La guida completa al viaggio sostenibile' },
    slug: { en: 'complete-guide-sustainable-travel', it: 'guida-completa-viaggio-sostenibile' },
    excerpt: {
      en: 'Practical, field-tested advice for exploring the world while keeping your footprint light.',
      it: 'Consigli pratici e collaudati per esplorare il mondo mantenendo leggera la tua impronta.',
    },
    body_markdown: {
      en: '## Why it matters\n\nTravel can be a force for **good** when done thoughtfully. Here are three principles:\n\n1. Move slowly\n2. Spend locally\n3. Pack light\n\n> Small choices compound into real impact.',
      it: '## Perché è importante\n\nIl viaggio può essere una forza **positiva** se fatto con consapevolezza. Ecco tre principi:\n\n1. Muoviti lentamente\n2. Spendi nel territorio\n3. Viaggia leggero\n\n> Le piccole scelte si sommano in un impatto reale.',
    },
    body_html: {
      en: '<h2>Getting started</h2><p>The single most important step is to <strong>plan around trains</strong>, not planes. Read our <a href="https://example.com/rail">rail guide</a> first.</p><ul><li>Book early</li><li>Travel off-peak</li></ul>',
      it: '<h2>Per iniziare</h2><p>Il passo più importante è <strong>pianificare intorno ai treni</strong>, non agli aerei. Leggi prima la nostra <a href="https://example.com/rail">guida ferroviaria</a>.</p><ul><li>Prenota in anticipo</li><li>Viaggia fuori dagli orari di punta</li></ul>',
    },
    seo: {
      en: seoVal('Sustainable Travel: The Complete Guide', 'Field-tested advice for low-impact travel: slow routes, local spending, and lighter packing.', uploads.mountain),
      it: seoVal('Viaggio sostenibile: la guida completa', 'Consigli collaudati per viaggiare a basso impatto: percorsi lenti, spesa locale e bagagli leggeri.', uploads.mountain),
    },
    featured_data: {
      en: jsonVal({ tags: ['travel', 'sustainability', 'guide'], highlights: ['Scenic rail routes', 'Local food markets'], meta: { readingLevel: 'intermediate', estimatedMinutes: 8 } }),
      it: jsonVal({ tags: ['viaggio', 'sostenibilità', 'guida'], highlights: ['Percorsi panoramici in treno', 'Mercati gastronomici locali'], meta: { readingLevel: 'intermedio', estimatedMinutes: 8 } }),
    },
    structured_body: {
      en: dast(
        heading(2, span('A mindful itinerary')),
        para(span('This release brings '), span('major improvements', ['strong']), span(' to how you plan. See the '), link('https://example.com/changelog', 'changelog'), span(' for details.')),
        bulleted([span('Faster route planning')], [span('Lower-carbon options first')]),
        blockNode(calloutBlock({ title: 'Pro tip', body: 'Book **refundable** tickets when plans are uncertain.', is_dismissible: true })),
        quoteNode(para(span('The journey is the destination.'))),
        blockNode(quoteBlock({ quote_text: 'We do not inherit the earth from our ancestors; we borrow it from our children.', attribution: 'Native American Proverb' })),
      ),
      it: dast(
        heading(2, span('Un itinerario consapevole')),
        para(span('Questa versione porta '), span('miglioramenti importanti', ['strong']), span(' al modo in cui pianifichi. Consulta il '), link('https://example.com/changelog', 'registro delle modifiche'), span(' per i dettagli.')),
        bulleted([span('Pianificazione dei percorsi più veloce')], [span('Prima le opzioni a basse emissioni')]),
        blockNode(calloutBlock({ title: 'Consiglio', body: 'Prenota biglietti **rimborsabili** quando i piani sono incerti.', is_dismissible: true })),
        quoteNode(para(span('Il viaggio è la destinazione.'))),
        blockNode(quoteBlock({ quote_text: 'Non ereditiamo la terra dai nostri avi; la prendiamo in prestito dai nostri figli.', attribution: 'Proverbio nativo americano' })),
      ),
    },
    content_blocks: {
      en: [
        heroBlock({ heading: 'Travel light, see more', tagline: 'A practical framework for low-impact adventures across every continent.', cta_label: 'Start planning', background_image: cover('mountain', 'Mountains at dawn', 'Dawn Peaks'), display_order: 1 }),
        calloutBlock({ title: 'Did you know?', body: 'Trains emit up to **90% less CO₂** than short-haul flights.', is_dismissible: false }),
        ctaBlock({ label: 'Download the checklist', open_in_new_tab: true }),
      ],
      it: [
        heroBlock({ heading: 'Viaggia leggero, scopri di più', tagline: 'Un quadro pratico per avventure a basso impatto in ogni continente.', cta_label: 'Inizia a pianificare', background_image: cover('mountain', 'Montagne all’alba', 'Cime all’alba'), display_order: 1 }),
        calloutBlock({ title: 'Lo sapevi?', body: 'I treni emettono fino al **90% in meno di CO₂** rispetto ai voli a corto raggio.', is_dismissible: false }),
        ctaBlock({ label: 'Scarica la checklist', open_in_new_tab: true }),
      ],
    },
    spotlight: {
      en: heroBlock({ heading: 'Editor’s pick', tagline: 'Our favourite slow-travel route this season.', cta_label: 'Read more', background_image: cover('forest', 'Forest trail', 'Forest Trail'), display_order: 1 }),
      it: heroBlock({ heading: 'Scelta della redazione', tagline: 'Il nostro percorso slow-travel preferito di questa stagione.', cta_label: 'Leggi di più', background_image: cover('forest', 'Sentiero nel bosco', 'Sentiero nel bosco'), display_order: 1 }),
    },
    inline_note: {
      en: calloutBlock({ title: 'A quick note', body: 'Prices were accurate at the time of writing.', is_dismissible: false }),
      it: calloutBlock({ title: 'Una nota veloce', body: 'I prezzi erano corretti al momento della scrittura.', is_dismissible: false }),
    },
    cover_image: {
      en: cover('mountain', 'A snow-capped mountain range at sunrise', 'Mountain Sunrise'),
      it: cover('mountain', 'Una catena montuosa innevata all’alba', 'Alba sulle montagne'),
    },
    media_gallery: {
      en: [cover('forest', 'Sunlight through a forest canopy', 'Forest Canopy'), cover('ocean', 'Waves on a quiet beach', 'Quiet Beach')],
      it: [cover('forest', 'Luce del sole tra le chiome del bosco', 'Chioma del bosco'), cover('ocean', 'Onde su una spiaggia tranquilla', 'Spiaggia tranquilla')],
    },
    // negatives (must be ignored by the plugin)
    author_name: 'Jordan Avery',
    view_count: 1284,
    is_premium: true,
  },
});

// ---- A2: SPARSE (article, en + es) -----------------------------------------
records.push({
  label: 'A2 article sparse (en+es)',
  payload: {
    item_type: ARTICLE,
    title: { en: 'Five Underrated Coastal Towns', es: 'Cinco pueblos costeros infravalorados' },
    excerpt: {
      en: 'Skip the crowds — these quiet harbours reward travellers who arrive by ferry.',
      es: 'Evita las multitudes: estos puertos tranquilos recompensan a quienes llegan en ferri.',
    },
    body_markdown: {
      en: 'Each town on this list shares three traits: **walkable** centres, fresh seafood, and a slow pace.\n\n- Quiet mornings\n- Friendly locals',
      es: 'Cada pueblo de esta lista comparte tres rasgos: centros **peatonales**, marisco fresco y un ritmo pausado.\n\n- Mañanas tranquilas\n- Gente amable',
    },
    seo: {
      en: seoVal('Five Underrated Coastal Towns to Visit', 'Quiet harbours, fresh seafood, and slow mornings — five coastal towns worth the detour.'),
      es: seoVal('Cinco pueblos costeros infravalorados', 'Puertos tranquilos, marisco fresco y mañanas pausadas: cinco pueblos costeros que merecen el desvío.'),
    },
    cover_image: {
      en: cover('ocean', 'Turquoise water beside a stone harbour', 'Stone Harbour'),
      es: cover('ocean', 'Agua turquesa junto a un puerto de piedra', 'Puerto de piedra'),
    },
    author_name: 'Marisol Vega',
    view_count: 342,
  },
});

// ---- A3: NON-EN SOURCE (article, it + es, en EMPTY) ------------------------
records.push({
  label: 'A3 article non-en source (it+es, en empty)',
  payload: {
    item_type: ARTICLE,
    title: { it: 'Borghi medievali da non perdere', es: 'Pueblos medievales que no te puedes perder' },
    body_html: {
      it: '<h2>Tra le mura</h2><p>Ogni vicolo racconta <strong>secoli di storia</strong>. Parti dalla <a href="https://example.com/piazza">piazza principale</a>.</p>',
      es: '<h2>Entre murallas</h2><p>Cada callejón cuenta <strong>siglos de historia</strong>. Empieza por la <a href="https://example.com/piazza">plaza principal</a>.</p>',
    },
    structured_body: {
      it: dast(
        heading(2, span('Cosa vedere')),
        para(span('Non perdere il '), span('mercato del sabato', ['strong']), span(', il cuore del borgo.')),
        blockNode(calloutBlock({ title: 'Suggerimento', body: 'Arriva **presto** per evitare la folla.', is_dismissible: false })),
      ),
      es: dast(
        heading(2, span('Qué ver')),
        para(span('No te pierdas el '), span('mercado del sábado', ['strong']), span(', el corazón del pueblo.')),
        blockNode(calloutBlock({ title: 'Sugerencia', body: 'Llega **temprano** para evitar las multitudes.', is_dismissible: false })),
      ),
    },
    content_blocks: {
      it: [
        heroBlock({ heading: 'Il fascino del medioevo', tagline: 'Pietre, torri e tradizioni che resistono al tempo.', cta_label: 'Esplora', background_image: cover('city', 'Borgo al tramonto', 'Borgo al tramonto'), display_order: 1 }),
        quoteBlock({ quote_text: 'Le città sono libri scritti nella pietra.', attribution: 'Anonimo' }),
      ],
      es: [
        heroBlock({ heading: 'El encanto medieval', tagline: 'Piedras, torres y tradiciones que resisten al tiempo.', cta_label: 'Explorar', background_image: cover('city', 'Pueblo al atardecer', 'Pueblo al atardecer'), display_order: 1 }),
        quoteBlock({ quote_text: 'Las ciudades son libros escritos en piedra.', attribution: 'Anónimo' }),
      ],
    },
    author_name: 'Luca Bianchi',
  },
});

// ---- A4: BLOCKS-HEAVY (article, en + de) -----------------------------------
records.push({
  label: 'A4 article blocks-heavy (en+de)',
  payload: {
    item_type: ARTICLE,
    title: { en: 'How to Build a Capsule Travel Wardrobe', de: 'So baust du eine Capsule-Reisegarderobe' },
    excerpt: {
      en: 'Ten pieces, twenty outfits, one carry-on. Here is the system.',
      de: 'Zehn Teile, zwanzig Outfits, ein Handgepäck. Hier ist das System.',
    },
    structured_body: {
      en: dast(
        heading(2, span('The ten pieces')),
        numbered([span('Two pairs of trousers')], [span('Three tops')], [span('One jacket')]),
        blockNode(quoteBlock({ quote_text: 'Own less, travel further.', attribution: 'The Minimalist Traveller' })),
      ),
      de: dast(
        heading(2, span('Die zehn Teile')),
        numbered([span('Zwei Hosen')], [span('Drei Oberteile')], [span('Eine Jacke')]),
        blockNode(quoteBlock({ quote_text: 'Besitze weniger, reise weiter.', attribution: 'Der minimalistische Reisende' })),
      ),
    },
    content_blocks: {
      en: [
        heroBlock({ heading: 'Pack once, wear everything', tagline: 'A repeatable formula for a featherweight bag.', cta_label: 'See the list', background_image: cover('ocean', 'Folded clothes by the sea', 'Packing by the Sea'), display_order: 1 }),
        calloutBlock({ title: 'Rule of three', body: 'Every item must pair with **three** others.', is_dismissible: false }),
        calloutBlock({ title: 'Fabric matters', body: 'Choose merino and linen for breathability.', is_dismissible: true }),
        ctaBlock({ label: 'Get the packing app', open_in_new_tab: true }),
      ],
      de: [
        heroBlock({ heading: 'Einmal packen, alles tragen', tagline: 'Eine wiederholbare Formel für ein federleichtes Gepäck.', cta_label: 'Zur Liste', background_image: cover('ocean', 'Gefaltete Kleidung am Meer', 'Packen am Meer'), display_order: 1 }),
        calloutBlock({ title: 'Dreierregel', body: 'Jedes Teil muss zu **drei** anderen passen.', is_dismissible: false }),
        calloutBlock({ title: 'Stoff zählt', body: 'Wähle Merino und Leinen für Atmungsaktivität.', is_dismissible: true }),
        ctaBlock({ label: 'Hol dir die Pack-App', open_in_new_tab: true }),
      ],
    },
    spotlight: {
      en: heroBlock({ heading: 'Featured kit', tagline: 'The exact bag we travelled with for a month.', cta_label: 'Shop the look', background_image: cover('mountain', 'A backpack on a ridge', 'Ridge Backpack'), display_order: 1 }),
      de: heroBlock({ heading: 'Empfohlene Ausrüstung', tagline: 'Genau die Tasche, mit der wir einen Monat unterwegs waren.', cta_label: 'Den Look kaufen', background_image: cover('mountain', 'Ein Rucksack auf einem Bergkamm', 'Rucksack am Grat'), display_order: 1 }),
    },
    inline_note: {
      en: calloutBlock({ title: 'Affiliate note', body: 'Some links may earn us a small commission.', is_dismissible: false }),
      de: calloutBlock({ title: 'Hinweis zu Affiliate-Links', body: 'Einige Links bringen uns eine kleine Provision.', is_dismissible: false }),
    },
    cover_image: {
      en: cover('city', 'A neatly packed carry-on bag', 'Carry-on Bag'),
      de: cover('city', 'Eine ordentlich gepackte Handgepäcktasche', 'Handgepäcktasche'),
    },
    media_gallery: {
      en: [cover('mountain', 'Trail shoes on rock', 'Trail Shoes'), cover('forest', 'A merino layer drying on a branch', 'Merino Layer'), cover('ocean', 'A packing cube on sand', 'Packing Cube')],
      de: [cover('mountain', 'Trailschuhe auf Fels', 'Trailschuhe'), cover('forest', 'Eine Merino-Schicht trocknet an einem Ast', 'Merino-Schicht'), cover('ocean', 'Ein Packwürfel auf Sand', 'Packwürfel')],
    },
    view_count: 5012,
    is_premium: false,
  },
});

// ---- A5: QC TORTURE (article, en + fr) -------------------------------------
// 60-char SEO title and ~160-char description to exercise QC length checks.
records.push({
  label: 'A5 article QC-torture (en+fr)',
  payload: {
    item_type: ARTICLE,
    title: { en: 'Visas, Vaccines & VPNs: A Pre-Trip Checklist', fr: 'Visas, vaccins et VPN : une liste avant le départ' },
    slug: { en: 'visas-vaccines-vpns-checklist', fr: 'visas-vaccins-vpn-liste' },
    body_html: {
      en: '<h2>Before you fly</h2><p>Confirm your passport has <strong>6&nbsp;months</strong> validity &amp; two blank pages. Check the <a href="https://example.com/visa?country=JP&type=tourist">visa rules</a>.</p><ol><li>Scan documents</li><li>Set up a <em>VPN</em></li></ol><blockquote>Keep digital &amp; paper copies.</blockquote>',
      fr: '<h2>Avant de partir</h2><p>Vérifiez que votre passeport a <strong>6&nbsp;mois</strong> de validité &amp; deux pages vierges. Consultez les <a href="https://example.com/visa?country=JP&type=tourist">règles de visa</a>.</p><ol><li>Scannez les documents</li><li>Configurez un <em>VPN</em></li></ol><blockquote>Conservez des copies numériques &amp; papier.</blockquote>',
    },
    body_markdown: {
      en: 'Use this `packing.sh` snippet:\n\n```bash\nrsync -av ~/docs/ ./backup/\n```\n\nDon’t forget [travel insurance](https://example.com/insure) — it costs ~**2%** of your trip.',
      fr: 'Utilisez cet extrait `packing.sh` :\n\n```bash\nrsync -av ~/docs/ ./backup/\n```\n\nN’oubliez pas l’[assurance voyage](https://example.com/insure) — elle coûte ~**2 %** de votre voyage.',
    },
    structured_body: {
      en: dast(
        heading(2, span('Document tiers')),
        para(span('Keep '), span('originals', ['emphasis']), span(', '), span('photocopies', ['underline']), span(', and '), span('encrypted scans', ['code']), span(' in three places.')),
        para(span('Email everything to '), link('mailto:backup@example.com', 'yourself'), span(' before you leave.')),
        bulleted([span('Passport + visa')], [span('Insurance policy')], [span('Emergency contacts')]),
      ),
      fr: dast(
        heading(2, span('Niveaux de documents')),
        para(span('Gardez les '), span('originaux', ['emphasis']), span(', les '), span('photocopies', ['underline']), span(', et les '), span('scans chiffrés', ['code']), span(' à trois endroits.')),
        para(span('Envoyez tout par e-mail à '), link('mailto:backup@example.com', 'vous-même'), span(' avant de partir.')),
        bulleted([span('Passeport + visa')], [span('Police d’assurance')], [span('Contacts d’urgence')]),
      ),
    },
    featured_data: {
      en: jsonVal({ checklist: { documents: ['passport', 'visa', 'insurance'], digital: ['VPN', 'password manager'] }, warnings: ['Validity must exceed 6 months', 'Some VPNs are restricted'], priority: 'high' }),
      fr: jsonVal({ checklist: { documents: ['passeport', 'visa', 'assurance'], digital: ['VPN', 'gestionnaire de mots de passe'] }, warnings: ['La validité doit dépasser 6 mois', 'Certains VPN sont restreints'], priority: 'élevée' }),
    },
    seo: {
      en: seoVal('Visas, Vaccines and VPNs: The Pre-Trip Checklist Guide', 'A practical pre-trip checklist covering passports, visas, vaccines, travel insurance and VPNs so nothing essential is forgotten before you fly abroad.'),
      fr: seoVal('Visas, vaccins et VPN : le guide de la liste avant départ', 'Une liste pratique avant le départ : passeports, visas, vaccins, assurance voyage et VPN, pour ne rien oublier d’essentiel avant de partir à l’étranger.'),
    },
    cover_image: {
      en: cover('city', 'A passport and boarding pass on a desk', 'Passport and Boarding Pass'),
      fr: cover('city', 'Un passeport et une carte d’embarquement sur un bureau', 'Passeport et carte d’embarquement'),
    },
    author_name: 'Priya Nair',
    view_count: 8801,
    is_premium: true,
  },
});

// ---- P1: FULL PRODUCT (product, en + es) -----------------------------------
records.push({
  label: 'P1 product full (en+es)',
  payload: {
    item_type: PRODUCT,
    name: { en: 'Wanderer 45L Travel Backpack', es: 'Mochila de viaje Wanderer 45L' },
    slug: { en: 'wanderer-45l-travel-backpack', es: 'mochila-viaje-wanderer-45l' },
    subtitle: { en: 'Carry-on ready, built for a month on the road', es: 'Lista para cabina, hecha para un mes de viaje' },
    description: {
      en: 'A 45-litre, carry-on-compliant backpack with a lie-flat opening and a dedicated laptop sleeve. Weatherproof zips keep your gear dry.',
      es: 'Una mochila de 45 litros apta para cabina, con apertura plana y funda para portátil. Las cremalleras impermeables mantienen seco tu equipo.',
    },
    specs_html: {
      en: '<ul><li><strong>Capacity:</strong> 45L</li><li><strong>Weight:</strong> 1.4&nbsp;kg</li><li><strong>Material:</strong> recycled ripstop nylon</li></ul>',
      es: '<ul><li><strong>Capacidad:</strong> 45&nbsp;l</li><li><strong>Peso:</strong> 1,4&nbsp;kg</li><li><strong>Material:</strong> nailon ripstop reciclado</li></ul>',
    },
    promo_markdown: {
      en: '### Limited launch offer\n\nGet a **free packing cube set** with every order this week. [Shop now](https://example.com/shop).',
      es: '### Oferta de lanzamiento limitada\n\nLlévate un **set de organizadores gratis** con cada pedido esta semana. [Compra ahora](https://example.com/shop).',
    },
    seo: {
      en: seoVal('Wanderer 45L Travel Backpack — Carry-on Ready', 'A lightweight 45L carry-on backpack with lie-flat opening, laptop sleeve and weatherproof zips for long trips.', uploads.forest),
      es: seoVal('Mochila de viaje Wanderer 45L — Apta para cabina', 'Mochila de cabina de 45 L, ligera, con apertura plana, funda para portátil y cremalleras impermeables para viajes largos.', uploads.forest),
    },
    attributes_json: {
      en: jsonVal({ colors: ['Slate', 'Forest Green', 'Sand'], sizes: ['One size'], features: ['Lie-flat opening', 'Laptop sleeve', 'Weatherproof zips'] }),
      es: jsonVal({ colors: ['Pizarra', 'Verde bosque', 'Arena'], sizes: ['Talla única'], features: ['Apertura plana', 'Funda para portátil', 'Cremalleras impermeables'] }),
    },
    features: {
      en: [
        featureBlock({ name: 'Lie-flat opening', description: 'Opens like a suitcase so you can pack and find things fast.', detail_html: '<p>The <strong>180°</strong> opening means no more digging.</p>' }),
        featureBlock({ name: 'Hidden laptop sleeve', description: 'A padded, back-panel sleeve fits up to a 16-inch laptop.', detail_html: '<p>Suspended off the base to protect against drops.</p>' }),
        ctaBlock({ label: 'Add to cart', open_in_new_tab: false }),
      ],
      es: [
        featureBlock({ name: 'Apertura plana', description: 'Se abre como una maleta para empacar y encontrar todo rápido.', detail_html: '<p>La apertura de <strong>180°</strong> evita tener que rebuscar.</p>' }),
        featureBlock({ name: 'Funda oculta para portátil', description: 'Una funda acolchada en el panel trasero para portátiles de hasta 16 pulgadas.', detail_html: '<p>Suspendida de la base para proteger frente a caídas.</p>' }),
        ctaBlock({ label: 'Añadir al carrito', open_in_new_tab: false }),
      ],
    },
    hero: {
      en: heroBlock({ heading: 'Everything you need, nothing you don’t', tagline: 'Thirty-day trips out of a single bag.', cta_label: 'Buy now', background_image: cover('forest', 'The backpack against foliage', 'Backpack in Forest'), display_order: 1 }),
      es: heroBlock({ heading: 'Todo lo que necesitas, nada de más', tagline: 'Viajes de treinta días con una sola mochila.', cta_label: 'Comprar ahora', background_image: cover('forest', 'La mochila sobre el follaje', 'Mochila en el bosque'), display_order: 1 }),
    },
    main_image: {
      en: cover('forest', 'Wanderer 45L backpack, three-quarter view', 'Wanderer 45L'),
      es: cover('forest', 'Mochila Wanderer 45L, vista de tres cuartos', 'Wanderer 45L'),
    },
    price: 189.0,
    sku: 'WND-45L-GRN',
  },
});

// ---- P2: NON-EN SOURCE (product, es + de, en EMPTY) ------------------------
records.push({
  label: 'P2 product non-en source (es+de, en empty)',
  payload: {
    item_type: PRODUCT,
    name: { es: 'Cantimplora térmica Cumbre 1L', de: 'Cumbre 1L Thermosflasche' },
    description: {
      es: 'Una botella de acero inoxidable de doble pared que mantiene las bebidas frías 24 horas y calientes 12.',
      de: 'Eine doppelwandige Edelstahlflasche, die Getränke 24 Stunden kalt und 12 Stunden warm hält.',
    },
    specs_html: {
      es: '<ul><li><strong>Capacidad:</strong> 1&nbsp;l</li><li><strong>Aislamiento:</strong> doble pared al vacío</li></ul>',
      de: '<ul><li><strong>Fassungsvermögen:</strong> 1&nbsp;l</li><li><strong>Isolierung:</strong> doppelwandig, vakuumisoliert</li></ul>',
    },
    features: {
      es: [
        featureBlock({ name: 'Sin BPA', description: 'Acero inoxidable de grado alimentario, sin plásticos.', detail_html: '<p>Apta para <strong>lavavajillas</strong>.</p>' }),
        featureBlock({ name: 'Tapón antigoteo', description: 'Un cierre hermético para llevarla en cualquier mochila.', detail_html: '<p>Probado contra fugas en todas las posiciones.</p>' }),
      ],
      de: [
        featureBlock({ name: 'BPA-frei', description: 'Lebensmittelechter Edelstahl, ganz ohne Kunststoff.', detail_html: '<p><strong>Spülmaschinenfest.</strong></p>' }),
        featureBlock({ name: 'Auslaufsicherer Verschluss', description: 'Ein dichter Verschluss für jeden Rucksack.', detail_html: '<p>In jeder Lage auf Dichtheit geprüft.</p>' }),
      ],
    },
    price: 34.5,
    sku: 'CMB-1L-STL',
  },
});

// ---- P3: MINIMAL (product, en + it) ----------------------------------------
records.push({
  label: 'P3 product minimal (en+it)',
  payload: {
    item_type: PRODUCT,
    name: { en: 'Featherlight Packable Rain Jacket', it: 'Giacca antipioggia ultraleggera ripiegabile' },
    slug: { en: 'featherlight-packable-rain-jacket', it: 'giacca-antipioggia-ultraleggera' },
    description: {
      en: 'A 120-gram rain shell that folds into its own pocket — your insurance against a sudden downpour.',
      it: 'Un guscio antipioggia da 120 grammi che si ripiega nella propria tasca: la tua assicurazione contro un acquazzone improvviso.',
    },
    seo: {
      en: seoVal('Featherlight Packable Rain Jacket', 'A 120g packable rain shell that folds into its own pocket — pocket-sized protection against sudden downpours.'),
      it: seoVal('Giacca antipioggia ultraleggera ripiegabile', 'Un guscio antipioggia da 120 g che si ripiega in tasca: protezione tascabile contro gli acquazzoni improvvisi.'),
    },
    price: 79.0,
    sku: 'FTH-RAIN-BLU',
  },
});

// =============================================================================
//  CREATE
// =============================================================================
section(`STAGE 3 — Records (${records.length})`);
const created = [];
const failures = [];
for (const rec of records) {
  try {
    const item = await client.items.create(rec.payload);
    created.push({ label: rec.label, id: item.id });
    console.log(`  ✓ ${rec.label} -> ${item.id}`);
  } catch (err) {
    const detail = err?.errors ? JSON.stringify(err.errors) : err?.message || String(err);
    failures.push({ label: rec.label, detail });
    console.log(`  ✗ ${rec.label}\n      ${detail}`);
  }
}

section('STAGE 3 complete');
console.log(`created ${created.length}/${records.length}`);
if (failures.length) {
  console.log('\nFAILURES:');
  for (const f of failures) console.log(`  - ${f.label}: ${f.detail}`);
  process.exit(2);
}
