import { describe, expect, it } from 'vitest';
import { formatDateTime } from '../src/lib/dates';
import {
  buildModelPresentation,
  buildRow,
  DEFAULT_ORDER_BY,
  filterRows,
  type RecordRow,
  sortRows,
} from '../src/lib/records';
import { buildField, buildItem, buildItemType } from './fixtures';

const locales = { locales: ['en', 'it'] };
const noLocales = { locales: [] };

describe('buildRow', () => {
  it('uses the presentation title field, in the first locale with a value', () => {
    const fields = [
      buildField('f-name', 'name', { position: 1 }),
      buildField('f-title', 'title', { position: 2, localized: true }),
    ];
    const itemType = buildItemType('m1', 'Article', {
      titleFieldId: 'f-title',
    });
    const row = buildRow(
      buildItem('r1', { name: 'Ignored', title: { en: '', it: 'Ciao' } }),
      buildModelPresentation(itemType, fields),
      locales,
    );

    expect(row.title).toBe('Ciao');
    expect(row.modelName).toBe('Article');
  });

  it('falls back to the first heading, then the first string field', () => {
    const fields = [
      buildField('f-slug', 'slug', { position: 1 }),
      buildField('f-head', 'headline', { position: 2, heading: true }),
    ];
    const presentation = buildModelPresentation(
      buildItemType('m1', 'Article'),
      fields,
    );
    expect(
      buildRow(
        buildItem('r1', { slug: 'a', headline: 'Big news' }),
        presentation,
        locales,
      ).title,
    ).toBe('Big news');
  });

  it('reads text out of Structured Text titles', () => {
    const fields = [buildField('f-body', 'body', { type: 'structured_text' })];
    const row = buildRow(
      buildItem('r1', {
        body: {
          schema: 'dast',
          document: {
            type: 'root',
            children: [
              {
                type: 'heading',
                level: 1,
                children: [
                  { type: 'span', marks: ['strong'], value: 'D' },
                  { type: 'span', value: 'atoCMS rocks' },
                ],
              },
              {
                type: 'paragraph',
                children: [
                  { type: 'span', value: 'See ' },
                  {
                    type: 'link',
                    url: 'https://example.com',
                    children: [{ type: 'span', value: 'docs' }],
                  },
                  { type: 'span', value: ', then ship.' },
                ],
              },
            ],
          },
        },
      }),
      buildModelPresentation(buildItemType('m1', 'Page'), fields),
      locales,
    );
    // Spans of one block join as written; blocks are separated by a space.
    expect(row.title).toBe('DatoCMS rocks See docs, then ship.');
  });

  it('collapses whitespace before cutting long titles, never mid-emoji', () => {
    const field = buildField('f', 'body', { type: 'text', editor: 'textarea' });
    const presentation = buildModelPresentation(
      buildItemType('m', 'M', { titleFieldId: 'f' }),
      [field],
    );
    const spaced = Array.from({ length: 4 }, () => 'a'.repeat(48)).join(
      '\n\n          \n\n',
    );
    expect(
      buildRow(buildItem('r1', { body: spaced }), presentation, locales).title,
    ).toBe(Array.from({ length: 4 }, () => 'a'.repeat(48)).join(' '));

    const emoji = `${'a'.repeat(198)}😀😀😀`;
    const title = buildRow(
      buildItem('r2', { body: emoji }),
      presentation,
      locales,
    ).title;
    expect(title).toBe(`${'a'.repeat(198)}😀…`);
  });

  it('never cuts a flag or a family emoji in half', () => {
    const field = buildField('f', 'body', { type: 'text', editor: 'textarea' });
    const presentation = buildModelPresentation(
      buildItemType('m', 'M', { titleFieldId: 'f' }),
      [field],
    );
    const titleOf = (body: string) =>
      buildRow(buildItem('r1', { body }), presentation, locales).title;

    expect(titleOf(`${'a'.repeat(198)}🇮🇹 tail`)).toBe(`${'a'.repeat(198)}🇮🇹…`);
    expect(titleOf(`${'a'.repeat(198)}👨‍👩‍👧 tail`)).toBe(
      `${'a'.repeat(198)}👨‍👩‍👧…`,
    );
  });

  it('still formats dates when the browser rejects the timezone', () => {
    const field = buildField('f', 'when', { type: 'date_time' });
    const row = buildRow(
      buildItem('r1', { when: '2026-10-03T10:00:00Z' }),
      buildModelPresentation(buildItemType('m', 'M', { titleFieldId: 'f' }), [
        field,
      ]),
      { locales: ['en'], timeZone: 'Mars/Olympus_Mons' },
    );
    expect(row.title).toMatch(/2026/);
  });

  it('formats date, color, and coordinate titles', () => {
    const options = { locales: ['en'], timeZone: 'Europe/Rome' };
    const titleOf = (field: ReturnType<typeof buildField>, value: unknown) =>
      buildRow(
        buildItem('r1', { [field.attributes.api_key]: value }),
        buildModelPresentation(buildItemType('m', 'M', { titleFieldId: 'f' }), [
          field,
        ]),
        options,
      ).title;

    expect(
      titleOf(
        buildField('f', 'when', { type: 'date_time' }),
        '2026-10-03T10:00:00Z',
      ),
    ).toBe('Oct 3, 2026, 12:00 PM');
    expect(
      titleOf(buildField('f', 'shade', { type: 'color' }), {
        red: 255,
        green: 0,
        blue: 0,
        alpha: 255,
      }),
    ).toBe('#FF0000');
    expect(
      titleOf(buildField('f', 'where', { type: 'lat_lon' }), {
        latitude: 45.4642,
        longitude: 9.19,
      }),
    ).toBe('Lat: 45.4642 Lon: 9.1900');
  });

  it('marks link titles for resolution instead of showing the linked ID', () => {
    const row = buildRow(
      buildItem('r1', { author: 'linked-1' }),
      buildModelPresentation(buildItemType('m', 'M', { titleFieldId: 'f' }), [
        buildField('f', 'author', { type: 'link' }),
      ]),
      locales,
    );
    expect(row).toMatchObject({ title: 'Record #r1', titleLinkId: 'linked-1' });
  });

  it('names untitled records by ID', () => {
    const row = buildRow(
      buildItem('r42', {}),
      buildModelPresentation(buildItemType('m1', 'Page'), []),
      locales,
    );
    expect(row.title).toBe('Record #r42');
  });

  it('reads the status from the record, defaulting to published', () => {
    const presentation = buildModelPresentation(buildItemType('a', 'A'), []);
    expect(
      buildRow(
        buildItem('r1', {}, { status: 'updated' }),
        presentation,
        locales,
      ).status,
    ).toBe('updated');
    expect(
      buildRow(buildItem('r2', {}, { status: null }), presentation, locales)
        .status,
    ).toBe('published');
  });

  it('points at the image only when the record has one', () => {
    const image = buildField('f-img', 'cover', { type: 'file' });
    const withImage = buildModelPresentation(buildItemType('a', 'A'), [image]);
    expect(
      buildRow(
        buildItem('r1', { cover: { upload_id: 'u1' } }),
        withImage,
        noLocales,
      ).imageUploadId,
    ).toBe('u1');
    expect(
      buildRow(buildItem('r2', { cover: null }), withImage, noLocales)
        .imageUploadId,
    ).toBeNull();
    expect(
      buildRow(
        buildItem('r3', {}),
        buildModelPresentation(buildItemType('b', 'B'), []),
        noLocales,
      ).imageUploadId,
    ).toBeNull();
  });

  it('keeps both validity flags and a compact record for permission checks', () => {
    const row = buildRow(
      buildItem(
        'r1',
        { title: 'A long body that selection never needs' },
        { is_current_version_valid: false, is_published_version_valid: true },
      ),
      buildModelPresentation(buildItemType('a', 'A'), []),
      locales,
    );
    expect(row).toMatchObject({ currentValid: false, publishedValid: true });
    expect(row.item.attributes).toEqual({});
    expect(row.item.meta.stage).toBe('review');
  });
});

function row(
  id: string,
  title: string,
  updatedAt: string,
  extra: Partial<RecordRow> = {},
): RecordRow {
  return {
    ...buildRow(
      buildItem(id, {}, { updated_at: updatedAt }),
      buildModelPresentation(buildItemType('m1', 'Article'), []),
      locales,
    ),
    title,
    ...extra,
  };
}

describe('sorting', () => {
  const rows = [
    row('1', 'Banana', '2026-01-02T00:00:00Z', { status: 'published' }),
    row('2', 'apple', '2026-01-03T00:00:00Z', { status: 'draft' }),
    row('3', 'Cherry', '2026-01-01T00:00:00Z', { status: 'updated' }),
  ];

  it('puts the most recently updated records first by default', () => {
    expect(sortRows(rows, DEFAULT_ORDER_BY).map(({ id }) => id)).toEqual([
      '2',
      '1',
      '3',
    ]);
  });

  it('sorts titles case-insensitively in both directions', () => {
    expect(sortRows(rows, '_preview_ASC').map(({ title }) => title)).toEqual([
      'apple',
      'Banana',
      'Cherry',
    ]);
    expect(sortRows(rows, '_preview_DESC').map(({ title }) => title)).toEqual([
      'Cherry',
      'Banana',
      'apple',
    ]);
  });

  it('orders statuses as the API does', () => {
    expect(sortRows(rows, '_status_ASC').map(({ status }) => status)).toEqual([
      'draft',
      'published',
      'updated',
    ]);
  });
});

describe('filterRows', () => {
  const rows = [
    row('a1', 'Café opening', '2026-01-01T00:00:00Z'),
    row('b2', 'Menu', '2026-01-01T00:00:00Z', {
      modelId: 'm2',
      modelName: 'Page',
      status: 'published',
    }),
  ];
  const none = { query: '', modelId: null, status: null };

  it('matches titles without accents or case', () => {
    expect(filterRows(rows, { ...none, query: 'CAFE' })).toHaveLength(1);
  });

  it('matches model names and IDs', () => {
    expect(filterRows(rows, { ...none, query: 'page' })[0].id).toBe('b2');
    expect(filterRows(rows, { ...none, query: 'a1' })[0].id).toBe('a1');
  });

  it('keeps only the chosen model and status', () => {
    expect(filterRows(rows, { ...none, modelId: 'm2' })).toHaveLength(1);
    expect(
      filterRows(rows, { ...none, status: 'published' }).map(({ id }) => id),
    ).toEqual(['b2']);
  });
});

describe('formatDateTime', () => {
  it('prints the medium date and short time in the project timezone', () => {
    expect(formatDateTime('2026-09-26T12:32:00Z', 'en-GB', 'Europe/Rome')).toBe(
      '26 Sept 2026, 14:32',
    );
  });

  it('prints a dash for missing or invalid dates', () => {
    expect(formatDateTime(null, 'en')).toBe('—');
    expect(formatDateTime('nope', 'en')).toBe('—');
  });
});
