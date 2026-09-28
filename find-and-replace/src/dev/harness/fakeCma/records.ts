import type { RawApiTypes } from '@datocms/cma-client-browser';
import { seededRandom, stableId } from './ids';
import { type ModelKey, modelIdFor } from './schema';

/**
 * Record factories. Records are stored the way `?nested=true` serves them:
 * Modular Content, Single Block and Structured Text `block` nodes hold the
 * full block objects; `itemLink` and `inlineItem` nodes hold record ids.
 */

export type StoredItem = {
  type: 'item';
  id: string;
  attributes: Record<string, unknown>;
  relationships: {
    item_type: { data: { type: 'item_type'; id: string } };
    creator?: { data: { type: 'account'; id: string } };
  };
  meta: RawApiTypes.ItemMeta;
};

type Status = 'draft' | 'updated' | 'published';

const BASE_TIME = Date.parse('2026-06-01T08:30:00.000Z');
const MINUTE = 60_000;

function isoAt(minutesFromBase: number): string {
  return new Date(BASE_TIME + minutesFromBase * MINUTE).toISOString();
}

// ── Structured Text (DAST) builders ─────────────────────────────────────────

type DastNode = Record<string, unknown>;
type Mark =
  | 'strong'
  | 'emphasis'
  | 'underline'
  | 'strikethrough'
  | 'code'
  | 'highlight';

export function span(value: string, marks?: Mark[]): DastNode {
  return marks ? { type: 'span', marks, value } : { type: 'span', value };
}

function inline(child: string | DastNode): DastNode {
  return typeof child === 'string' ? span(child) : child;
}

export function paragraph(...children: Array<string | DastNode>): DastNode {
  return { type: 'paragraph', children: children.map(inline) };
}

export function heading(
  level: 2 | 3 | 4,
  ...children: Array<string | DastNode>
): DastNode {
  return { type: 'heading', level, children: children.map(inline) };
}

export function link(
  url: string,
  ...children: Array<string | DastNode>
): DastNode {
  return { type: 'link', url, children: children.map(inline) };
}

export function itemLink(
  itemId: string,
  ...children: Array<string | DastNode>
): DastNode {
  return { type: 'itemLink', item: itemId, children: children.map(inline) };
}

export function inlineItem(itemId: string): DastNode {
  return { type: 'inlineItem', item: itemId };
}

export function bulletedList(...items: DastNode[][]): DastNode {
  return {
    type: 'list',
    style: 'bulleted',
    children: items.map((children) => ({ type: 'listItem', children })),
  };
}

export function blockNode(block: StoredItem): DastNode {
  return { type: 'block', item: block };
}

export function dast(...children: DastNode[]): Record<string, unknown> {
  return { schema: 'dast', document: { type: 'root', children } };
}

// ── Items ───────────────────────────────────────────────────────────────────

function itemMeta(args: {
  seed: string;
  createdAt: number;
  status: Status | null;
}): RawApiTypes.ItemMeta {
  const created = isoAt(args.createdAt);
  const updated = isoAt(args.createdAt + 90);
  const published =
    args.status === 'published' || args.status === 'updated'
      ? isoAt(args.createdAt + 30)
      : null;

  return {
    created_at: created,
    updated_at: args.status === 'published' ? (published ?? updated) : updated,
    published_at: published,
    first_published_at: published,
    publication_scheduled_at: null,
    unpublishing_scheduled_at: null,
    status: args.status,
    is_valid: true,
    is_current_version_valid: args.status === null ? null : true,
    is_published_version_valid: published ? true : null,
    current_version: stableId(`version:${args.seed}:0`),
    stage: null,
    has_children: null,
  };
}

export function blockItem(
  model: ModelKey,
  seed: string,
  attributes: Record<string, unknown>,
): StoredItem {
  return {
    type: 'item',
    id: stableId(`block:${seed}`),
    attributes,
    relationships: {
      item_type: { data: { type: 'item_type', id: modelIdFor(model) } },
    },
    meta: itemMeta({ seed: `block:${seed}`, createdAt: 0, status: null }),
  };
}

export function recordIdFor(key: string): string {
  return stableId(`record:${key}`);
}

export function rootItem(args: {
  model: ModelKey;
  key: string;
  attributes: Record<string, unknown>;
  /** Ignored (always 'published') for models without draft mode. */
  status: Status;
  draftMode: boolean;
  createdAt: number;
}): StoredItem {
  return {
    type: 'item',
    id: recordIdFor(args.key),
    attributes: args.attributes,
    relationships: {
      item_type: { data: { type: 'item_type', id: modelIdFor(args.model) } },
      creator: { data: { type: 'account', id: 'harness-account' } },
    },
    meta: itemMeta({
      seed: `record:${args.key}`,
      createdAt: args.createdAt,
      status: args.draftMode ? args.status : 'published',
    }),
  };
}

function seo(title: string, description: string): Record<string, unknown> {
  return {
    title,
    description,
    image: null,
    twitter_card: 'summary_large_image',
    no_index: false,
  };
}

function quote(seed: string, text: string, attribution: string): StoredItem {
  return blockItem('quote', seed, { text, attribution });
}

function textBlock(seed: string, body: Record<string, unknown>): StoredItem {
  return blockItem('text_block', seed, { body });
}

function button(seed: string, label: string, url: string): StoredItem {
  return blockItem('button', seed, { label, url });
}

function hero(
  seed: string,
  headingText: string,
  subheading: string,
  cta: StoredItem | null,
): StoredItem {
  return blockItem('hero', seed, { heading: headingText, subheading, cta });
}

// ── The default content (12 records) ───────────────────────────────────────

/** Named records the scenarios refer to. */
export const RECORD = {
  launch: recordIdFor('article:launch'),
  brand: recordIdFor('article:brand'),
  pricing: recordIdFor('article:pricing'),
  offsite: recordIdFor('article:offsite'),
  acmeTeam: recordIdFor('article:acme-team'),
  roundup: recordIdFor('article:roundup'),
  about: recordIdFor('page:about'),
  legal: recordIdFor('page:legal'),
  careers: recordIdFor('page:careers'),
  contact: recordIdFor('page:contact'),
  jane: recordIdFor('author:jane'),
  marco: recordIdFor('author:marco'),
} as const;

function article(
  key: string,
  createdAt: number,
  status: Status,
  attributes: Record<string, unknown>,
): StoredItem {
  return rootItem({
    model: 'article',
    key: `article:${key}`,
    attributes,
    status,
    draftMode: true,
    createdAt,
  });
}

function page(
  key: string,
  createdAt: number,
  attributes: Record<string, unknown>,
): StoredItem {
  return rootItem({
    model: 'page',
    key: `page:${key}`,
    attributes,
    status: 'published',
    draftMode: false,
    createdAt,
  });
}

function author(
  key: string,
  createdAt: number,
  attributes: Record<string, unknown>,
): StoredItem {
  return rootItem({
    model: 'author',
    key: `author:${key}`,
    attributes,
    status: 'published',
    draftMode: true,
    createdAt,
  });
}

function defaultArticles(): StoredItem[] {
  return [
    article('launch', 12_000, 'published', {
      title: {
        en: 'Acme launches a new widget™',
        it: 'Acme lancia un nuovo widget',
      },
      slug: 'new-widget-launch',
      published_on: '2026-05-12',
      author: RECORD.jane,
      body: {
        en: dast(
          heading(2, 'A widget for every desk'),
          paragraph(
            'Today the new widget, said the Ac',
            span('me', ['strong']),
            ' CEO, ships in May. The launch event is in Milan, and everyone is invited.',
          ),
          blockNode(
            quote(
              'launch-quote-en',
              'Acme has always built tools people keep for decades. This one is no different.',
              'Jane Doe, Head of Design',
            ),
          ),
          paragraph(
            'Read more about ',
            itemLink(RECORD.jane, 'the designer behind it'),
            ', or visit the ',
            link('https://www.acme.test/widgets', 'Acme store'),
            ' to pre-order.',
          ),
          bulletedList(
            [paragraph('Acme Widget Pro, from €49')],
            [paragraph('Widget Mini, from €29')],
          ),
          paragraph('Written by ', inlineItem(RECORD.jane), '.'),
        ),
        it: dast(
          paragraph(
            'Oggi il nuovo widget, ha detto il CEO di Acme, arriva a maggio. La presentazione si terrà a Milano.',
          ),
          blockNode(
            quote(
              'launch-quote-it',
              'Acme costruisce da sempre strumenti che durano decenni.',
              'Jane Doe, Head of Design',
            ),
          ),
        ),
      },
      seo: {
        en: seo(
          'Acme launches a new widget',
          'The new Acme widget ships in May. Here is everything you need to know.',
        ),
        it: seo(
          'Acme lancia un nuovo widget',
          'Il nuovo widget arriva a maggio.',
        ),
      },
    }),
    article('brand', 4_000, 'updated', {
      title: {
        en: 'ACME brand guidelines',
        it: 'Linee guida del marchio ACME',
      },
      slug: 'acme-brand-guidelines',
      published_on: '2026-03-02',
      author: RECORD.marco,
      body: {
        en: dast(
          paragraph(
            'Use the logo on a white or very dark background, never on photos.',
          ),
          paragraph(
            'Our primary color is ',
            span('Brand Blue', ['code']),
            ' (#1F4FFF). Pair it with plenty of white space.',
          ),
        ),
        it: dast(paragraph('Usa il logo su sfondo bianco o molto scuro.')),
      },
      seo: {
        en: seo(
          'Brand guidelines',
          'Download the Acme logo pack and the full color palette.',
        ),
        it: seo(
          'Linee guida del marchio',
          'Scarica il logo e la palette colori.',
        ),
      },
    }),
    article('pricing', 8_000, 'published', {
      title: {
        en: 'Acme pricing for teams, agencies and enterprises',
        it: 'Prezzi Acme per team, agenzie e aziende',
      },
      slug: 'pricing',
      published_on: '2026-04-20',
      author: RECORD.marco,
      body: {
        en: dast(
          paragraph(
            'Every plan includes unlimited widgets. Agencies get a 20% discount on the Acme Pro plan.',
          ),
        ),
        it: dast(paragraph('Ogni piano include widget illimitati.')),
      },
      seo: {
        en: seo('Pricing', 'Plans for teams of every size.'),
        it: seo('Prezzi', 'Piani per team di ogni dimensione.'),
      },
    }),
    article('offsite', 20_000, 'draft', {
      title: { en: 'Team offsite', it: 'Offsite del team' },
      slug: 'team-offsite-2026',
      published_on: null,
      author: RECORD.jane,
      body: {
        en: dast(
          paragraph(
            'This year we met at the Acme offsite in Lisbon, where we planned the next two releases.',
          ),
          paragraph('Huge thanks to everyone at Acme who made it happen.'),
        ),
        it: dast(paragraph('Quest’anno ci siamo incontrati a Lisbona.')),
      },
      seo: {
        en: seo('Team offsite', 'Notes from our week in Lisbon.'),
        it: seo(
          'Offsite del team',
          'Appunti dalla nostra settimana a Lisbona.',
        ),
      },
    }),
    article('acme-team', 2_000, 'published', {
      title: { en: 'About the acme team', it: 'Il team acme' },
      slug: 'about-the-team',
      published_on: '2026-02-10',
      author: RECORD.marco,
      body: {
        en: dast(
          paragraph(
            'The company was founded by the Acme partners in 1987, in a small garage in Milan.',
          ),
        ),
        it: dast(
          paragraph('L’azienda è stata fondata nel 1987 in un piccolo garage.'),
        ),
      },
      seo: {
        en: seo('Our team', 'The people behind the widgets.'),
        it: seo('Il nostro team', 'Le persone dietro i widget.'),
      },
    }),
    article('roundup', 16_000, 'draft', {
      title: {
        en: 'Five desk setups we love',
        it: 'Cinque scrivanie che amiamo',
      },
      slug: 'five-desk-setups',
      published_on: null,
      author: RECORD.jane,
      body: {
        en: dast(
          paragraph(
            'From standing desks to tiny corners, here are the setups our readers sent us this month.',
          ),
        ),
        it: dast(
          paragraph('Dalle scrivanie in piedi agli angoli più piccoli.'),
        ),
      },
      seo: {
        en: seo('Five desk setups we love', 'Reader setups from this month.'),
        it: seo('Cinque scrivanie', 'Le scrivanie dei lettori.'),
      },
    }),
  ];
}

function defaultPages(): StoredItem[] {
  return [
    page('about', 1_000, {
      title: 'About us',
      slug: 'about',
      content: {
        en: [
          hero(
            'about-hero-en',
            'We are Acme™',
            'Widgets for every desk since 1987.',
            button(
              'about-cta-en',
              'Talk to Acme sales',
              'https://www.acme.test/contact',
            ),
          ),
          textBlock(
            'about-text-1-en',
            dast(
              paragraph('Acme was founded in 1987 in a garage in Milan.'),
              blockNode(
                quote(
                  'about-quote-en',
                  'We only ship what we would use ourselves.',
                  'The Acme founders',
                ),
              ),
            ),
          ),
          textBlock(
            'about-text-2-en',
            dast(
              paragraph('Today 240 people work at ACME across three offices.'),
            ),
          ),
        ],
        it: [
          hero(
            'about-hero-it',
            'Siamo Acme',
            'Widget per ogni scrivania dal 1987.',
            null,
          ),
          textBlock(
            'about-text-1-it',
            dast(paragraph('Acme è nata nel 1987 in un garage a Milano.')),
          ),
        ],
      },
      seo: seo('About Acme', 'Who we are and how we build widgets.'),
    }),
    page('legal', 1_500, {
      title: 'Legal notice',
      slug: 'legal-notice',
      content: {
        en: [
          textBlock(
            'legal-text-en',
            dast(
              paragraph(
                'Acme S.p.A., Via Roma 1, 20121 Milano, Italy. VAT IT01234567890.',
              ),
            ),
          ),
        ],
        it: [
          textBlock(
            'legal-text-it',
            dast(paragraph('Sede legale: Via Roma 1, 20121 Milano.')),
          ),
        ],
      },
      seo: seo('Legal notice', 'Company information.'),
    }),
    page('careers', 3_000, {
      title: 'Careers',
      slug: 'careers',
      content: {
        en: [
          textBlock(
            'careers-text-en',
            dast(
              heading(2, 'Open roles'),
              paragraph(
                'Come and join the Acme team in Milan or remote. We are hiring designers and engineers.',
              ),
            ),
          ),
        ],
        it: [],
      },
      seo: seo('Careers', 'Open roles in Milan and remote.'),
    }),
    page('contact', 3_500, {
      title: 'Contact',
      slug: 'contact',
      content: {
        en: [
          hero(
            'contact-hero-en',
            'Talk to us',
            'We usually reply within one business day.',
            button('contact-cta-en', 'Write to us', 'mailto:hello@acme.test'),
          ),
        ],
        it: [],
      },
      seo: seo('Contact', 'How to reach the team.'),
    }),
  ];
}

function defaultAuthors(): StoredItem[] {
  return [
    author('jane', 500, {
      name: 'Jane Doe',
      bio: 'Jane leads design at **Acme**, where she created the WidgetPro™ line.\n\nBefore joining Acme she designed furniture in Copenhagen.',
    }),
    author('marco', 600, {
      name: 'Marco Rossi',
      bio: 'Marco writes about tools, workspaces and the people who build them.',
    }),
  ];
}

export function defaultRecords(): StoredItem[] {
  return [...defaultArticles(), ...defaultPages(), ...defaultAuthors()];
}

export function supportingRecords(): StoredItem[] {
  return [...defaultPages(), ...defaultAuthors()];
}

// ── Generated content (the `many` scenario) ─────────────────────────────────

const TITLES = [
  'The history of the company',
  'Our values',
  'How we test the widgets',
  'Notes from the workshop',
  'The best desks of the year',
  'Why the details matter',
  'A day with the support team',
  'The making of the Widget Mini',
  'What the customers told us',
  'Inside the design studio',
];

const SENTENCES = [
  'In 1987, the founders opened a small shop near the station.',
  'We believe the best work happens when the team listens to the customer first.',
  'Every widget is tested for a week before it leaves the workshop.',
  'The first prototype was built from the parts of an old radio.',
  'Most of the feedback arrives through the support inbox on Monday.',
  'The new finish took three months and more than forty samples.',
  'Our engineers keep a notebook of every repair that comes back.',
  'At the end of the day, the details are what people remember.',
];

const ACME_SENTENCES = [
  'The Acme team shipped the update on a Tuesday.',
  'Customers still bring in the original Acme Widget for repairs.',
  'Thanks to everyone at Acme for the long nights.',
];

function pick<T>(random: () => number, values: ReadonlyArray<T>): T {
  return values[Math.floor(random() * values.length)] as T;
}

function sentences(random: () => number, count: number): string {
  const result: string[] = [];
  for (let index = 0; index < count; index += 1) {
    result.push(pick(random, SENTENCES));
  }
  return result.join(' ');
}

function slugify(value: string): string {
  return value
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-|-$/g, '');
}

function generatedArticle(index: number): StoredItem {
  const random = seededRandom(index + 1);
  const number = index + 1;
  const title = `${pick(random, TITLES)}, part ${number}`;
  const withAcme = index % 6 === 0;
  const paragraphs = [
    paragraph(sentences(random, 3)),
    paragraph(sentences(random, 2)),
    paragraph(sentences(random, 3)),
  ];

  if (withAcme) {
    paragraphs.splice(1, 0, paragraph(ACME_SENTENCES[0] as string));
    paragraphs.push(paragraph(`${ACME_SENTENCES[1]} ${ACME_SENTENCES[2]}`));
  }

  const statuses: Status[] = ['published', 'updated', 'draft'];

  return rootItem({
    model: 'article',
    key: `article:generated:${number}`,
    status: statuses[index % statuses.length] as Status,
    draftMode: true,
    createdAt: 30_000 + index * 7,
    attributes: {
      title: { en: title, it: `Articolo ${number}` },
      slug: `${slugify(title)}-${number}`,
      published_on: null,
      author: index % 2 === 0 ? RECORD.jane : RECORD.marco,
      body: {
        en: dast(...paragraphs),
        it: dast(paragraph('Un articolo generato per le prove di carico.')),
      },
      seo: {
        en: seo(title, sentences(random, 1)),
        it: seo(`Articolo ${number}`, 'Articolo generato.'),
      },
    },
  });
}

export function generatedArticles(count: number): StoredItem[] {
  const records: StoredItem[] = [];
  for (let index = 0; index < count; index += 1) {
    records.push(generatedArticle(index));
  }
  return records;
}

/** An Author (no field can hold blocks: a search reads Authors 500 at a time). */
function generatedAuthor(index: number): StoredItem {
  const random = seededRandom(100_000 + index);
  const number = index + 1;
  return author(`generated:${number}`, 90_000 + index * 7, {
    name: `Writer ${number}`,
    bio:
      index % 4 === 0
        ? `${sentences(random, 1)} ${ACME_SENTENCES[2]}`
        : sentences(random, 2),
  });
}

export function generatedAuthors(count: number): StoredItem[] {
  const records: StoredItem[] = [];
  for (let index = 0; index < count; index += 1) {
    records.push(generatedAuthor(index));
  }
  return records;
}
