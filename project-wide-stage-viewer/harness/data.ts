import type { RawApiTypes } from '@datocms/cma-client-browser';

type Field = RawApiTypes.Field;
type Item = RawApiTypes.Item;
type ItemType = RawApiTypes.ItemType;

export const WORKFLOWS = [
  {
    id: 'wf-editorial',
    name: 'Editorial',
    stages: [
      { id: 'drafting', name: 'Drafting' },
      { id: 'review', name: 'In review' },
      { id: 'legal', name: 'Legal check' },
      { id: 'ready', name: 'Ready to publish' },
    ],
  },
  {
    id: 'wf-translation',
    name: 'Translation',
    stages: [
      { id: 'to_translate', name: 'To translate' },
      { id: 'review', name: 'In review' },
      { id: 'done', name: 'Done' },
    ],
  },
];

function ref(id: string | null) {
  return { data: id ? { id, type: 'field' } : null };
}

function itemType(
  id: string,
  name: string,
  draftMode: boolean,
  titleField: string,
  imageField: string | null,
): ItemType {
  return {
    id,
    type: 'item_type',
    attributes: {
      name,
      api_key: id,
      modular_block: false,
      draft_mode_active: draftMode,
    },
    relationships: {
      workflow: { data: { id: 'wf-editorial', type: 'workflow' } },
      presentation_title_field: ref(titleField),
      title_field: ref(null),
      presentation_image_field: ref(imageField),
      image_preview_field: ref(null),
    },
  } as unknown as ItemType;
}

function field(
  id: string,
  apiKey: string,
  type: string,
  localized = false,
): Field {
  return {
    id,
    type: 'field',
    attributes: {
      api_key: apiKey,
      field_type: type,
      localized,
      position: 1,
      appearance: { editor: 'single_line', parameters: {}, addons: [] },
    },
  } as unknown as Field;
}

export const ITEM_TYPES: ItemType[] = [
  itemType('article', 'Blog post', true, 'f-title', 'f-cover'),
  itemType('author', 'Author', false, 'f-name', 'f-avatar'),
  itemType('landing', 'Landing page', true, 'f-headline', null),
];

export const FIELDS: Record<string, Field[]> = {
  article: [
    field('f-title', 'title', 'string', true),
    field('f-cover', 'cover', 'file'),
  ],
  author: [
    field('f-name', 'name', 'string'),
    field('f-avatar', 'avatar', 'file'),
  ],
  landing: [field('f-headline', 'headline', 'string', true)],
};

const ARTICLE_TITLES = [
  'How we rebuilt our checkout in six weeks',
  'A field guide to structured content',
  'Ten lessons from a year of remote design reviews',
  'Why our editors love workflows',
  'The quiet power of good defaults',
  'Shipping localization without the headaches',
  'Image performance: a practical checklist',
  'What we learned migrating 40,000 records',
  'Designing for dark mode from day one',
  'Accessibility audits that actually stick',
  'From spreadsheet chaos to a single source of truth',
  'Writing release notes people read',
];

const AUTHORS = [
  'Jane Cooper',
  'Leslie Alexander',
  'Kristin Watson',
  'Robert Fox',
  'Cody Fisher',
];
const LANDINGS = [
  'Spring sale 2026',
  'Enterprise plan',
  'Partner program',
  'Product tour',
];

const HOUR = 3_600_000;

export function buildRecords(count: number): Record<string, Item[]> {
  const now = Date.now();
  const records: Record<string, Item[]> = {
    article: [],
    author: [],
    landing: [],
  };
  for (let index = 0; index < count; index += 1) {
    const kind =
      index % 7 === 3 ? 'author' : index % 9 === 5 ? 'landing' : 'article';
    const id = `rec${1000 + index}`;
    const statuses = ['draft', 'updated', 'published'] as const;
    let attributes: Record<string, unknown>;
    if (kind === 'article') {
      const base = ARTICLE_TITLES[index % ARTICLE_TITLES.length];
      attributes = {
        title: {
          en:
            index < ARTICLE_TITLES.length
              ? base
              : `${base} (part ${Math.floor(index / 12) + 1})`,
        },
        cover: index % 5 === 4 ? null : { upload_id: `up${index}` },
      };
    } else if (kind === 'author') {
      attributes = {
        name: AUTHORS[index % AUTHORS.length],
        avatar: { upload_id: `up${index}` },
      };
    } else {
      attributes = { headline: { en: LANDINGS[index % LANDINGS.length] } };
    }
    records[kind].push({
      id,
      type: 'item',
      attributes,
      relationships: { item_type: { data: { id: kind, type: 'item_type' } } },
      meta: {
        created_at: new Date(now - (index + 30) * 24 * HOUR).toISOString(),
        updated_at: new Date(
          now - index * 7 * HOUR - 25 * 60_000,
        ).toISOString(),
        status: statuses[index % 3],
        is_current_version_valid: index % 11 !== 6,
        is_published_version_valid: true,
        stage: 'review',
      },
    } as unknown as Item);
  }
  return records;
}
