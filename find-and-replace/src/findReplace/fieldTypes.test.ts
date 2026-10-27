import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { FindReplaceSnapshot } from './contract';
import {
  allMatches,
  type FixtureRecord,
  recordByKey,
  replaceAll,
  searchFor,
  setupController,
} from './findReplace.fixtures';
import { createCopy } from './ui/copy';

beforeEach(() => {
  vi.useFakeTimers();
});

afterEach(() => {
  vi.useRealTimers();
});

const SCHEMA_ORG = `{
  "@context": "https://schema.org",
  "@type": "Product",
  "name": "Laptop Pro",
  "description": "Kostenlose Lieferung \\u00fcber Nacht",
  "offers": { "price": "46.90", "priceCurrency": "EUR" }
}`;

function products(): FixtureRecord[] {
  return [
    {
      id: 'pr1',
      modelId: 'product',
      attributes: {
        name: 'Laptop Pro',
        description:
          '<p>Ob Laptop oder Rechner, ob &uuml;ber Deinen Browser.</p>\n<p>Fish <strong>&amp; Chips</strong></p>',
        notes: 'Gr&ouml;&szlig;e: **M** & L',
        price: { en: 46.9, it: 46.9 },
        stock: 12,
        schema: SCHEMA_ORG,
        image: {
          upload_id: 'upload-1',
          alt: 'Laptop on a desk',
          title: null,
          custom_data: {},
          focal_point: null,
        },
        gallery: [
          {
            upload_id: 'upload-2',
            alt: null,
            title: 'Front',
            custom_data: {},
            focal_point: null,
          },
          {
            upload_id: 'upload-3',
            alt: 'Laptop keyboard',
            title: null,
            custom_data: {},
            focal_point: null,
          },
        ],
        launch: '2026-11-01',
        related: null,
      },
    },
    {
      id: 'pr2',
      modelId: 'product',
      attributes: {
        name: 'Laptop Max',
        description: '<p>Nothing to see</p>',
        notes: null,
        price: { en: 146.9, it: 46.9 },
        stock: 3,
        schema: null,
        image: null,
        gallery: [],
        launch: null,
        related: null,
      },
    },
  ];
}

function setup() {
  return setupController({
    records: products(),
    products: true,
    locales: ['en', 'it'],
  });
}

function stored(
  harness: ReturnType<typeof setup>,
  id: string,
): Record<string, unknown> {
  const record = harness.cma.records.get(id);
  if (!record) throw new Error(`No record ${id}`);
  return record.attributes as Record<string, unknown>;
}

describe('text fields with HTML entities', () => {
  it('matches the decoded text and keeps the entities when replacing', async () => {
    const harness = setup();
    const snapshot = await searchFor(harness, 'über Deinen');

    const [match] = allMatches(snapshot);
    expect(allMatches(snapshot)).toHaveLength(1);
    expect(match).toMatchObject({
      text: 'über Deinen',
      before: 'Ob Laptop oder Rechner, ob ',
      after: ' Browser.',
    });

    harness.controller.setReplacementText('über Ihren');
    await replaceAll(harness);
    expect(stored(harness, 'pr1').description).toBe(
      '<p>Ob Laptop oder Rechner, ob &uuml;ber Ihren Browser.</p>\n<p>Fish <strong>&amp; Chips</strong></p>',
    );
  });

  it('matches visible text across inline tags but never the markup', async () => {
    const harness = setup();
    expect(allMatches(await searchFor(harness, 'strong'))).toHaveLength(0);
    // Block tags split the text: no match across two paragraphs.
    expect(allMatches(await searchFor(harness, 'Browser. Fish'))).toHaveLength(
      0,
    );

    const snapshot = await searchFor(harness, 'Fish & Chips');
    expect(allMatches(snapshot).map((match) => match.text)).toEqual([
      'Fish & Chips',
    ]);
    harness.controller.setReplacementText('Fish & Fries <new>');
    await replaceAll(harness);
    expect(stored(harness, 'pr1').description).toBe(
      '<p>Ob Laptop oder Rechner, ob &uuml;ber Deinen Browser.</p>\n<p>Fish &amp; Fries &lt;new&gt;<strong></strong></p>',
    );
  });

  it('decodes entities in non-HTML text fields without escaping markup', async () => {
    const harness = setup();
    const snapshot = await searchFor(harness, 'Größe');
    expect(allMatches(snapshot).map((match) => match.text)).toEqual(['Größe']);

    harness.controller.setReplacementText('Größen & Farben');
    await replaceAll(harness);
    expect(stored(harness, 'pr1').notes).toBe(
      'Gr&ouml;&szlig;en & Farben: **M** & L',
    );
  });
});

describe('number fields', () => {
  it('finds exact values in every locale and replaces them with numbers', async () => {
    const harness = setup();
    const snapshot = await searchFor(harness, '46.90');

    // 146.9 is a different price, so it isn't a match; the price text in
    // the structured data is.
    expect(
      snapshot.records.map((record) => [
        record.key,
        record.fields.map((field) => [field.path, field.locale]),
      ]),
    ).toEqual([
      [
        'product:pr1',
        [
          [['Price'], 'en'],
          [['Price'], 'it'],
          [['Structured data'], null],
        ],
      ],
      ['product:pr2', [[['Price'], 'it']]],
    ]);
    expect(allMatches(snapshot)[0]?.text).toBe('46.9');

    harness.controller.setReplacementText('49.9');
    expect(harness.snapshot().replacementCheck.warnings).toEqual([]);
    await replaceAll(harness);
    expect(stored(harness, 'pr1').price).toEqual({ en: 49.9, it: 49.9 });
    expect(stored(harness, 'pr2').price).toEqual({ en: 146.9, it: 49.9 });
    expect(JSON.parse(String(stored(harness, 'pr1').schema)).offers.price).toBe(
      '49.9',
    );
  });

  it('only matches a whole value', async () => {
    const harness = setup();
    const priceMatches = (snapshot: FindReplaceSnapshot) =>
      snapshot.records
        .flatMap((record) => record.fields)
        .filter((field) => field.path[0] === 'Price')
        .flatMap((field) => field.matches.map((match) => match.text));

    expect(priceMatches(await searchFor(harness, '46'))).toEqual([]);
    harness.controller.setOption('regex', true);
    expect(priceMatches(await searchFor(harness, '\\d+\\.9'))).toEqual([
      '46.9',
      '46.9',
      '146.9',
      '46.9',
    ]);
    expect(priceMatches(await searchFor(harness, '46'))).toEqual([]);
  });

  it("warns about, and doesn't save, text a number field won't take", async () => {
    const harness = setup();
    await searchFor(harness, '12');
    harness.controller.setReplacementText('7.5');
    expect(harness.snapshot().replacementCheck.warnings).toEqual([
      { code: 'number_format', count: 1 },
    ]);

    await replaceAll(harness);
    expect(recordByKey(harness.snapshot(), 'product:pr1').status).toEqual({
      kind: 'failed',
      reason: 'validation',
      retryable: false,
      detail: { fieldLabel: 'Stock', code: 'whole_number' },
    });
    expect(harness.cma.update).not.toHaveBeenCalled();
    expect(stored(harness, 'pr1').stock).toBe(12);
  });
});

describe('JSON fields', () => {
  it('replaces text inside string values and keeps the JSON as it was written', async () => {
    const harness = setup();
    // Keys are never matched.
    expect(allMatches(await searchFor(harness, 'priceCurrency'))).toHaveLength(
      0,
    );

    const snapshot = await searchFor(harness, 'über Nacht');
    expect(allMatches(snapshot).map((match) => match.text)).toEqual([
      'über Nacht',
    ]);
    harness.controller.setReplacementText('am nächsten Tag "garantiert"');
    await replaceAll(harness);

    const json = stored(harness, 'pr1').schema;
    expect(json).toBe(
      SCHEMA_ORG.replace(
        '\\u00fcber Nacht',
        'am n\\u00e4chsten Tag \\"garantiert\\"',
      ),
    );
    expect(JSON.parse(String(json)).description).toBe(
      'Kostenlose Lieferung am nächsten Tag "garantiert"',
    );
  });
});

describe('asset fields', () => {
  it('searches and replaces the alt and title text set on the field', async () => {
    const harness = setup();
    const snapshot = await searchFor(harness, 'Laptop');

    const pr1 = recordByKey(snapshot, 'product:pr1');
    expect(pr1.fields.map((field) => field.path)).toEqual([
      ['Name'],
      ['Description'],
      ['Structured data'],
      ['Image', 'Alt text'],
      ['Gallery', 'Asset 2', 'Alt text'],
    ]);

    harness.controller.setReplacementText('Notebook');
    await replaceAll(harness);
    const attributes = stored(harness, 'pr1');
    expect(attributes.image).toMatchObject({
      upload_id: 'upload-1',
      alt: 'Notebook on a desk',
    });
    expect(attributes.gallery).toEqual([
      expect.objectContaining({ alt: null, title: 'Front' }),
      expect.objectContaining({
        upload_id: 'upload-3',
        alt: 'Notebook keyboard',
      }),
    ]);
  });
});

describe('coverage', () => {
  it('says which fields the search left out', async () => {
    const harness = setup();
    const snapshot = await searchFor(harness, 'Laptop');
    expect(snapshot.coverage).toEqual({
      unsearched: [
        { fieldType: 'date', count: 1 },
        { fieldType: 'link', count: 1 },
      ],
    });
    expect(
      createCopy('en').coverage(snapshot.coverage ?? { unsearched: [] }),
    ).toBe(
      "Not searched: 1 date field and 1 single link field, as they don't hold text.",
    );

    const none = await searchFor(harness, 'nothing like this');
    expect(none.body).toBe('noResults');
    expect(none.coverage).toEqual(snapshot.coverage);
  });

  it('is left out when every field in scope is searched', async () => {
    const harness = setupController();
    expect((await searchFor(harness, 'acme')).coverage).toBeNull();
  });
});
