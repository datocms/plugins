import {
  extractTitleFromRecordData,
  getRecordTitles,
} from '@utils/recordTitleUtils';
import { afterEach, describe, expect, it, vi } from 'vitest';

vi.mock('@datocms/cma-client', () => ({
  SchemaRepository: class {
    async getItemTypeById(id: string) {
      return {
        id,
        name: `Model ${id}`,
        singleton: false,
        title_field: { id: 'title-field' },
      };
    }
    async getItemTypeFields() {
      return [{ id: 'title-field', api_key: 'title' }];
    }
  },
}));

function createClient(prefix = '') {
  return {
    items: {
      list: vi.fn(async (query: { filter: { ids: string } }) =>
        query.filter.ids.split(',').map((id) => ({
          id,
          title: { en: `${prefix}${id}`, it: `${prefix}it:${id}` },
        })),
      ),
    },
  };
}

const references = (count: number, models = 1) =>
  Array.from({ length: count }, (_, index) => ({
    recordId: `record-${index}`,
    modelId: `model-${index % models}`,
  }));

afterEach(() => vi.useRealTimers());

describe('localized record titles', () => {
  const arabicTitle = 'كاتب: Westhaven Bridge 005999';
  const config = { presentationTitleFieldId: null, titleFieldId: 'title-field' };
  const fields = [{ id: 'title-field', apiKey: 'title' }];
  const extract = (title: unknown, locale = 'en') =>
    extractTitleFromRecordData(
      'record-ar', { title }, config, fields, 'Authors', locale, false,
    );

  it('uses the Arabic title when the preferred locale is empty', () => {
    expect(extract({ en: null, ar: arabicTitle })).toBe(arabicTitle);
  });

  it.each(['', '   ', null, undefined, [], {}, 123, false])(
    'skips an empty or malformed preferred localized value %j',
    (preferred) => {
      expect(extract({ en: preferred, ar: arabicTitle })).toBe(arabicTitle);
    },
  );

  it('keeps the preferred locale ahead of other populated locales', () => {
    const title = { ar: arabicTitle, en: 'Author: Westhaven Bridge 005999' };
    expect(extract(title)).toBe(title.en);
    expect(extract(title, 'ar')).toBe(arabicTitle);
  });

  it('uses the first other nonempty localized string', () => {
    expect(extract({ en: null, fr: ' ', it: 'Autore', ar: arabicTitle })).toBe('Autore');
  });

  it.each([
    null,
    undefined,
    '',
    '   ',
    [],
    {},
    { en: null, ar: '' },
    { en: [], ar: { text: arabicTitle } },
    { en: 123, ar: false },
  ])('keeps the generic fallback when no valid title exists in %j', (title) => {
    expect(extract(title)).toBe('Record #record-ar');
  });

  it('preserves nonlocalized titles and presentation/singleton priority', () => {
    expect(extract('Plain title')).toBe('Plain title');
    expect(extract(0)).toBe('0');
    expect(extractTitleFromRecordData(
      'record-ar',
      { title: { en: 'Title' }, presentation: { en: null, ar: arabicTitle } },
      { ...config, presentationTitleFieldId: 'presentation-field' },
      [...fields, { id: 'presentation-field', apiKey: 'presentation' }],
      'Authors', 'en', false,
    )).toBe(arabicTitle);
    expect(extractTitleFromRecordData(
      'record-ar', { title: arabicTitle }, config, fields, 'Authors', 'en', true,
    )).toBe('Authors');
  });
});

describe('getRecordTitles at scale', () => {
  it('fetches every referenced ID in bounded batches using valid filters', async () => {
    const client = createClient();
    const result = await getRecordTitles(
      client as never,
      references(251),
      'en',
    );
    expect(result.size).toBe(251);
    expect(client.items.list).toHaveBeenCalledTimes(3);
    for (const [query] of client.items.list.mock.calls) {
      expect(query.filter).not.toHaveProperty('type');
      expect(query.filter.ids.split(',').length).toBeLessThanOrEqual(100);
      expect(query).toMatchObject({ page: { limit: 100 } });
    }
    expect(result.get('record-250')?.title).toBe('record-250');
  });

  it('limits concurrent model resolution without skipping models', async () => {
    let active = 0;
    let maximumActive = 0;
    const client = createClient();
    client.items.list.mockImplementation(async (query) => {
      active += 1;
      maximumActive = Math.max(maximumActive, active);
      await Promise.resolve();
      active -= 1;
      return query.filter.ids.split(',').map((id) => ({
        id,
        title: { en: id, it: id },
      }));
    });
    const result = await getRecordTitles(
      client as never,
      references(800, 40),
      'en',
    );
    expect(result.size).toBe(800);
    expect(client.items.list).toHaveBeenCalledTimes(40);
    expect(maximumActive).toBeLessThanOrEqual(4);
  });

  it('isolates cached titles by client, model and locale and expires each entry', async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2026-01-01T00:00:00Z'));
    const first = createClient('first:');
    const second = createClient('second:');
    const refs = references(1);
    expect(
      (await getRecordTitles(first as never, refs, 'en')).get('record-0')
        ?.title,
    ).toBe('first:record-0');
    await getRecordTitles(first as never, refs, 'en');
    expect(first.items.list).toHaveBeenCalledTimes(1);
    expect(
      (await getRecordTitles(second as never, refs, 'en')).get('record-0')
        ?.title,
    ).toBe('second:record-0');
    expect(
      (await getRecordTitles(first as never, refs, 'it')).get('record-0')
        ?.title,
    ).toBe('first:it:record-0');
    await getRecordTitles(
      first as never,
      [{ recordId: 'record-0', modelId: 'different-model' }],
      'en',
    );
    expect(first.items.list).toHaveBeenCalledTimes(3);
    vi.advanceTimersByTime(5 * 60 * 1000);
    await getRecordTitles(first as never, refs, 'en');
    expect(first.items.list).toHaveBeenCalledTimes(4);
  });

  it('evicts old cache entries in a long-lived session', async () => {
    const client = createClient();
    const refs = references(2200);
    await getRecordTitles(client as never, refs, 'en');
    const before = client.items.list.mock.calls.length;
    await getRecordTitles(client as never, refs.slice(-1), 'en');
    expect(client.items.list).toHaveBeenCalledTimes(before);
    await getRecordTitles(client as never, refs.slice(0, 1), 'en');
    expect(client.items.list).toHaveBeenCalledTimes(before + 1);
  });

  it('stops later batches when the caller changes context', async () => {
    const client = createClient();
    let keepGoing = true;
    client.items.list.mockImplementation(async (query) => {
      keepGoing = false;
      return query.filter.ids
        .split(',')
        .map((id) => ({ id, title: { en: id, it: id } }));
    });
    await getRecordTitles(
      client as never,
      references(1000),
      'en',
      () => keepGoing,
    );
    expect(client.items.list).toHaveBeenCalledTimes(1);
  });
});
