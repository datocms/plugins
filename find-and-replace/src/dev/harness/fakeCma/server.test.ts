import {
  ApiError,
  buildClient,
  type Client,
} from '@datocms/cma-client-browser';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { compileRootUpdateAttributes } from '../../../replacement/payloadCompiler';
import { loadSchemaIndex } from '../../../selection/schemaIndex';
import { traverseRecord } from '../../../selection/traversal';
import { RECORD } from './records';
import { SCENARIO_NAMES, type ScenarioName } from './scenarios';
import { fieldIdFor, modelIdFor } from './schema';
import { type FakeCma, installFakeCma } from './server';

type UnknownRecord = Record<string, unknown>;

let cma: FakeCma | null = null;

function install(scenario: ScenarioName): { cma: FakeCma; client: Client } {
  cma = installFakeCma(scenario, { latency: 0 });
  const client = buildClient({
    apiToken: 'harness-token',
    environment: 'main',
    baseUrl: 'https://site-api.datocms.com',
  });
  return { cma, client };
}

afterEach(() => {
  cma?.uninstall();
  cma = null;
  vi.useRealTimers();
});

function asRecord(value: unknown): UnknownRecord {
  expect(value).toBeTypeOf('object');
  return value as UnknownRecord;
}

async function apiErrorOf(promise: Promise<unknown>): Promise<ApiError> {
  const error = await promise.then(
    () => null,
    (reason: unknown) => reason,
  );
  expect(error).toBeInstanceOf(ApiError);
  return error as ApiError;
}

async function findCurrent(client: Client, id: string) {
  const { data } = await client.items.rawFind(id, {
    nested: true,
    version: 'current',
  });
  return data;
}

function documentChildren(value: unknown): UnknownRecord[] {
  const document = asRecord(asRecord(value).document);
  return document.children as UnknownRecord[];
}

describe('fake CMA: schema', () => {
  it('serves the site, the models and their fields', async () => {
    const { client } = install('default');

    const site = await client.site.find();
    expect(site.locales).toEqual(['en', 'it']);
    expect(site.internal_domain).toBe('harness.admin.datocms.com');

    const itemTypes = await client.itemTypes.list();
    const byKey = new Map(
      itemTypes.map((itemType) => [itemType.api_key, itemType]),
    );
    expect(byKey.get('article')?.draft_mode_active).toBe(true);
    expect(byKey.get('page')?.draft_mode_active).toBe(false);
    expect(byKey.get('hero')?.modular_block).toBe(true);
    expect(byKey.get('article')?.title_field).toEqual({
      type: 'field',
      id: fieldIdFor('article', 'title'),
    });

    const fields = await client.fields.list(modelIdFor('article'));
    const title = fields.find((field) => field.api_key === 'title');
    expect(title?.localized).toBe(true);
    expect(fields.map((field) => field.field_type)).toEqual([
      'string',
      'slug',
      'date',
      'link',
      'structured_text',
      'seo',
    ]);
  });

  it('builds a schema index the engine can traverse', async () => {
    const { client } = install('default');
    const schema = await loadSchemaIndex(client, {
      rootModelIds: [modelIdFor('page')],
    });
    const record = await findCurrent(client, RECORD.about);
    const values = traverseRecord({
      record,
      rootModelId: modelIdFor('page'),
      schema,
      siteId: 'harness-site',
      environment: 'main',
      locales: ['en', 'it'],
    });

    const buttonLabel = values.find(
      (value) =>
        value.field.apiKey === 'label' &&
        value.ref.locale === null &&
        value.value === 'Talk to Acme sales',
    );
    expect(buttonLabel?.ref.blockAncestry.map((entry) => entry.kind)).toEqual([
      'modular_content',
      'single_block',
    ]);
    const quoteText = values.find(
      (value) => value.value === 'We only ship what we would use ourselves.',
    );
    expect(quoteText?.ref.blockAncestry.map((entry) => entry.kind)).toEqual([
      'modular_content',
      'structured_text_block',
    ]);
  });

  it('answers 500 on /item-types in the boot-error scenario', async () => {
    const { client } = install('boot-error');
    const error = await apiErrorOf(client.itemTypes.list());
    expect(error.response.status).toBe(500);
  });
});

describe('fake CMA: listing records', () => {
  it('counts with page[limit]=1 and pages nested records', async () => {
    const { client, cma: fake } = install('default');

    const count = await client.items.rawList({
      filter: { type: modelIdFor('page') },
      page: { offset: 0, limit: 1 },
      version: 'current',
    });
    expect(count.data).toHaveLength(1);
    expect(count.meta.total_count).toBe(4);

    const first = await client.items.rawList({
      nested: true,
      version: 'current',
      filter: { type: modelIdFor('page') },
      page: { offset: 0, limit: 3 },
      order_by: 'id_ASC',
    });
    const second = await client.items.rawList({
      nested: true,
      version: 'current',
      filter: { type: modelIdFor('page') },
      page: { offset: 3, limit: 3 },
      order_by: 'id_ASC',
    });
    expect(first.data).toHaveLength(3);
    expect(second.data).toHaveLength(1);
    expect(second.meta.total_count).toBe(4);
    const ids = [...first.data, ...second.data].map((item) => item.id);
    expect(new Set(ids).size).toBe(4);
    expect([...ids].sort()).toEqual(ids);

    const about = [...first.data, ...second.data].find(
      (item) => item.id === RECORD.about,
    );
    const content = asRecord(asRecord(about?.attributes).content);
    const hero = asRecord((content.en as unknown[])[0]);
    expect(asRecord(hero.attributes).heading).toBe('We are Acme™');
    expect(asRecord(asRecord(hero.attributes).cta).type).toBe('item');

    expect(fake.requests[fake.requests.length - 1]?.search).toContain(
      'filter%5Btype%5D=',
    );
    expect(fake.requests[fake.requests.length - 1]?.search).toContain(
      'page%5Boffset%5D=3',
    );
  });

  it('collapses blocks to ids without nested=true', async () => {
    const { client } = install('default');
    const { data } = await client.items.rawList({
      filter: { ids: RECORD.about },
    });
    const content = asRecord(asRecord(data[0]?.attributes).content);
    expect(content.en).toEqual([
      expect.any(String),
      expect.any(String),
      expect.any(String),
    ]);
  });

  it('keeps Structured Text blocks nested and links as record ids', async () => {
    const { client } = install('default');
    const record = await findCurrent(client, RECORD.launch);
    const body = asRecord(asRecord(record.attributes).body);
    const nodes = documentChildren(body.en);

    const block = nodes.find((node) => node.type === 'block');
    expect(asRecord(block?.item).type).toBe('item');
    expect(asRecord(asRecord(block?.item).attributes).text).toContain('Acme');

    const spans = asRecord(nodes[1]).children as UnknownRecord[];
    expect(spans.map((span) => span.value).join('')).toContain(
      'said the Acme CEO',
    );
    expect(spans[1]?.marks).toEqual(['strong']);

    const paragraphWithLinks = asRecord(nodes[3]).children as UnknownRecord[];
    expect(paragraphWithLinks[1]).toMatchObject({
      type: 'itemLink',
      item: RECORD.jane,
    });
    const inlineItem = (asRecord(nodes[5]).children as UnknownRecord[])[1];
    expect(inlineItem).toEqual({ type: 'inlineItem', item: RECORD.jane });
  });

  it('hydrates records by filter[ids]', async () => {
    const { client } = install('default');
    const { data } = await client.items.rawList({
      nested: true,
      version: 'current',
      filter: { ids: [RECORD.brand, RECORD.jane, 'missing'].join(',') },
      page: { offset: 0, limit: 30 },
    });
    expect(data.map((item) => item.id).sort()).toEqual(
      [RECORD.brand, RECORD.jane].sort(),
    );
  });

  it('generates 3,000 articles in the many scenario', async () => {
    const { client } = install('many');
    const { meta } = await client.items.rawList({
      filter: { type: 'article' },
      page: { limit: 1 },
    });
    expect(meta.total_count).toBe(3000);
  });

  it('answers 401 without a token', async () => {
    install('default');
    const client = buildClient({ apiToken: null });
    const error = await apiErrorOf(client.site.find());
    expect(error.response.status).toBe(401);
  });
});

describe('fake CMA: finding and updating', () => {
  it('finds the current version and 404s on unknown records', async () => {
    const { client } = install('default');
    const record = await findCurrent(client, RECORD.pricing);
    expect(record.meta.current_version).toMatch(/^[\w-]{22}$/);
    expect(record.meta.status).toBe('published');

    const error = await apiErrorOf(findCurrent(client, 'missing'));
    expect(error.response.status).toBe(404);
  });

  it('bumps the version on update and rejects a stale version', async () => {
    const { client } = install('default');
    const before = await findCurrent(client, RECORD.pricing);
    const title = asRecord(asRecord(before.attributes).title);

    const updated = await client.items.update(RECORD.pricing, {
      title: {
        ...title,
        en: 'Globex pricing for teams, agencies and enterprises',
      },
      meta: { current_version: before.meta.current_version },
    });
    expect(updated.meta.current_version).not.toBe(before.meta.current_version);
    expect(updated.meta.status).toBe('updated');

    const after = await findCurrent(client, RECORD.pricing);
    expect(asRecord(asRecord(after.attributes).title)).toEqual({
      en: 'Globex pricing for teams, agencies and enterprises',
      it: 'Prezzi Acme per team, agenzie e aziende',
    });

    const error = await apiErrorOf(
      client.items.update(RECORD.pricing, {
        title: { en: 'Initech pricing', it: 'Prezzi' },
        meta: { current_version: before.meta.current_version },
      }),
    );
    expect(error.response.status).toBe(422);
    expect(error.findError('STALE_ITEM_VERSION')).toBeTruthy();
  });

  it('merges updated blocks and keeps blocks sent as ids', async () => {
    const { client } = install('default');
    const before = await findCurrent(client, RECORD.about);
    const content = asRecord(asRecord(before.attributes).content);
    const [hero, text1, text2] = content.en as UnknownRecord[];
    const itIds = (content.it as UnknownRecord[]).map((block) => block.id);

    const updated = await client.items.update(RECORD.about, {
      content: {
        en: [
          {
            id: hero?.id,
            type: 'item',
            attributes: { heading: 'We are Globex™' },
          },
          text1?.id,
          text2?.id,
        ],
        it: itIds,
      },
      meta: { current_version: before.meta.current_version },
    } as never);
    expect(updated.meta.status).toBe('published');

    const after = await findCurrent(client, RECORD.about);
    const afterContent = asRecord(asRecord(after.attributes).content);
    const [afterHero, afterText1] = afterContent.en as UnknownRecord[];
    expect(afterHero?.id).toBe(hero?.id);
    expect(asRecord(afterHero?.attributes).heading).toBe('We are Globex™');
    expect(
      asRecord(asRecord(asRecord(afterHero?.attributes).cta).attributes).label,
    ).toBe('Talk to Acme sales');
    expect(afterText1).toEqual(text1);
    expect(
      (afterContent.it as UnknownRecord[]).map((block) => block.id),
    ).toEqual(itIds);
  });

  it('updates a Single Block nested in a Modular Content block', async () => {
    const { client } = install('default');
    const before = await findCurrent(client, RECORD.about);
    const content = asRecord(asRecord(before.attributes).content);
    const [hero, ...rest] = content.en as UnknownRecord[];
    const button = asRecord(asRecord(hero?.attributes).cta);

    await client.items.update(RECORD.about, {
      content: {
        en: [
          {
            id: hero?.id,
            type: 'item',
            attributes: {
              cta: {
                id: button.id,
                type: 'item',
                attributes: { label: 'Talk to Globex sales' },
              },
            },
          },
          ...rest.map((block) => block.id),
        ],
        it: (content.it as UnknownRecord[]).map((block) => block.id),
      },
      meta: { current_version: before.meta.current_version },
    } as never);

    const after = await findCurrent(client, RECORD.about);
    const afterHero = asRecord(
      (asRecord(asRecord(after.attributes).content).en as unknown[])[0],
    );
    expect(asRecord(afterHero.attributes).heading).toBe('We are Acme™');
    expect(asRecord(asRecord(afterHero.attributes).cta)).toMatchObject({
      id: button.id,
      attributes: {
        label: 'Talk to Globex sales',
        url: 'https://www.acme.test/contact',
      },
    });
  });

  it('rejects blocks the record does not own', async () => {
    const { client } = install('default');
    const before = await findCurrent(client, RECORD.careers);
    const error = await apiErrorOf(
      client.items.update(RECORD.careers, {
        content: { en: ['not-a-block'], it: [] },
        meta: { current_version: before.meta.current_version },
      } as never),
    );
    expect(error.response.status).toBe(422);
    expect(error.findError('INVALID_FIELD')?.attributes.details).toMatchObject({
      field: 'content',
    });
  });

  it('updates a Structured Text value whose block is sent by id', async () => {
    const { client } = install('default');
    const before = await findCurrent(client, RECORD.launch);
    const body = asRecord(asRecord(before.attributes).body);
    const en = asRecord(body.en);
    const document = asRecord(en.document);
    const children = (document.children as UnknownRecord[]).map((node) =>
      node.type === 'block' ? { ...node, item: asRecord(node.item).id } : node,
    );
    children[0] = {
      type: 'heading',
      level: 2,
      children: [{ type: 'span', value: 'A Globex widget for every desk' }],
    };

    await client.items.update(RECORD.launch, {
      body: {
        ...body,
        en: { schema: 'dast', document: { type: 'root', children } },
      },
      meta: { current_version: before.meta.current_version },
    } as never);

    const after = await findCurrent(client, RECORD.launch);
    const nodes = documentChildren(
      asRecord(asRecord(after.attributes).body).en,
    );
    expect(asRecord(nodes[0]).children).toEqual([
      { type: 'span', value: 'A Globex widget for every desk' },
    ]);
    const block = nodes.find((node) => node.type === 'block');
    expect(asRecord(block?.item).attributes).toMatchObject({
      attribution: 'Jane Doe, Head of Design',
    });
  });

  it('validates slugs like the CMA', async () => {
    const { client } = install('default');
    const before = await findCurrent(client, RECORD.brand);
    const error = await apiErrorOf(
      client.items.update(RECORD.brand, {
        slug: 'Globex-brand-guidelines',
        meta: { current_version: before.meta.current_version },
      }),
    );
    expect(error.response.status).toBe(422);
    expect(error.findError('INVALID_FIELD')?.attributes.details).toMatchObject({
      field: 'slug',
      field_id: fieldIdFor('article', 'slug'),
      code: 'VALIDATION_SLUG_FORMAT',
    });
  });

  it('keeps replacements for the next search', async () => {
    const { client } = install('default');
    const before = await findCurrent(client, RECORD.jane);
    await client.items.update(RECORD.jane, {
      bio: 'Jane leads design at **Globex**.',
      meta: { current_version: before.meta.current_version },
    });
    const { data } = await client.items.rawList({
      nested: true,
      filter: { type: 'author' },
    });
    expect(data.find((item) => item.id === RECORD.jane)?.attributes.bio).toBe(
      'Jane leads design at **Globex**.',
    );
  });
});

describe('fake CMA: publishing', () => {
  it('mixes publication states among Acme matches in models with drafts', async () => {
    const { client } = install('default');
    const { data } = await client.items.rawList({
      filter: { type: 'article,author', query: 'Acme' },
      page: { offset: 0, limit: 30 },
    });
    const byStatus = (status: string) =>
      data
        .filter((item) => item.meta.status === status)
        .map((item) => item.id)
        .sort();
    expect(byStatus('published')).toEqual(
      [RECORD.launch, RECORD.pricing, RECORD.acmeTeam, RECORD.jane].sort(),
    );
    expect(byStatus('updated')).toEqual([RECORD.brand]);
    expect(byStatus('draft')).toEqual([RECORD.offsite]);
  });

  it('finds a record without nested=true', async () => {
    const { client } = install('default');
    const brand = await client.items.find(RECORD.brand, { version: 'current' });
    expect(brand.meta.current_version).toMatch(/^[\w-]{22}$/);
    expect(brand.meta.status).toBe('updated');

    const about = await client.items.find(RECORD.about, {
      version: 'current',
    });
    expect(about.meta.status).toBe('published');
    expect(asRecord(about.content).en).toEqual([
      expect.any(String),
      expect.any(String),
      expect.any(String),
    ]);
  });

  it('publishes a record and keeps its current version', async () => {
    const { client, cma: fake } = install('default');
    const before = await client.items.find(RECORD.brand, {
      version: 'current',
    });

    const published = await client.items.publish(RECORD.brand);
    expect(published.meta.status).toBe('published');
    expect(published.meta.current_version).toBe(before.meta.current_version);
    expect(published.meta.first_published_at).toBe(
      before.meta.first_published_at,
    );
    expect(published.meta.published_at).not.toBe(before.meta.published_at);
    expect(published.meta.is_published_version_valid).toBe(true);
    expect(fake.requests[fake.requests.length - 1]).toMatchObject({
      method: 'PUT',
      path: `/items/${RECORD.brand}/publish`,
      status: 200,
    });

    const after = await client.items.find(RECORD.brand, { version: 'current' });
    expect(after.meta.status).toBe('published');
    expect(after.meta.current_version).toBe(before.meta.current_version);
  });

  it('publishes a draft for the first time', async () => {
    const { client } = install('default');
    const before = await findCurrent(client, RECORD.offsite);
    expect(before.meta.first_published_at).toBeNull();

    const published = await client.items.publish(RECORD.offsite);
    expect(published.meta.status).toBe('published');
    expect(published.meta.first_published_at).toEqual(expect.any(String));
    expect(published.meta.published_at).toBe(published.meta.first_published_at);
    expect(published.meta.current_version).toBe(before.meta.current_version);
  });

  it('404s publishing an unknown record', async () => {
    const { client } = install('default');
    const error = await apiErrorOf(client.items.publish('missing'));
    expect(error.response.status).toBe(404);
    expect(error.findError('NOT_FOUND')?.attributes.details).toEqual({
      id: 'missing',
    });
  });

  it('marks a published record updated on save, then published again', async () => {
    const { client } = install('default');
    const before = await findCurrent(client, RECORD.launch);
    expect(before.meta.status).toBe('published');

    const updated = await client.items.update(RECORD.launch, {
      slug: 'globex-widget-launch',
      meta: { current_version: before.meta.current_version },
    });
    expect(updated.meta.status).toBe('updated');
    expect(updated.meta.current_version).not.toBe(before.meta.current_version);

    const nested = await findCurrent(client, RECORD.launch);
    expect(nested.meta.status).toBe('updated');
    expect(nested.meta.current_version).toBe(updated.meta.current_version);

    const published = await client.items.publish(RECORD.launch);
    expect(published.meta.status).toBe('published');
    expect(published.meta.current_version).toBe(updated.meta.current_version);
    expect(published.slug).toBe('globex-widget-launch');
  });

  it('keeps a draft a draft and an updated record updated on save', async () => {
    const { client } = install('default');
    const save = async (id: string) => {
      const before = await findCurrent(client, id);
      const updated = await client.items.update(id, {
        published_on: '2026-07-01',
        meta: { current_version: before.meta.current_version },
      });
      expect(updated.meta.current_version).not.toBe(
        before.meta.current_version,
      );
      return updated.meta.status;
    };
    expect(await save(RECORD.offsite)).toBe('draft');
    expect(await save(RECORD.brand)).toBe('updated');
  });

  it('keeps records of models without drafts published on save', async () => {
    const { client } = install('default');
    const before = await client.items.find(RECORD.careers, {
      version: 'current',
    });
    const updated = await client.items.update(RECORD.careers, {
      title: 'Careers at Globex',
      meta: { current_version: before.meta.current_version },
    });
    expect(updated.meta.status).toBe('published');
    expect(updated.meta.current_version).not.toBe(before.meta.current_version);
    expect(
      (await client.items.find(RECORD.careers, { version: 'current' })).meta
        .status,
    ).toBe('published');
  });
});

describe('fake CMA: engine payloads', () => {
  async function traversed(
    client: Client,
    id: string,
    apiKey: 'article' | 'page',
  ) {
    const schema = await loadSchemaIndex(client, {
      rootModelIds: [modelIdFor(apiKey)],
    });
    const record = await findCurrent(client, id);
    const values = traverseRecord({
      record,
      rootModelId: modelIdFor(apiKey),
      schema,
      siteId: 'harness-site',
      environment: 'main',
      locales: ['en', 'it'],
    });
    const byText = (text: string) => {
      const found = values.find((value) => value.value === text);
      if (!found) throw new Error(`No field value "${text}"`);
      return found;
    };
    return { schema, record, values, byText };
  }

  it("applies the payload compiler's nested block updates", async () => {
    const { client } = install('default');
    const before = await traversed(client, RECORD.about, 'page');

    const attributes = compileRootUpdateAttributes({
      root: before.record,
      schema: before.schema,
      changedValues: [
        {
          fieldValue: before.byText('Talk to Acme sales'),
          value: 'Talk to Globex sales',
        },
        {
          fieldValue: before.byText(
            'We only ship what we would use ourselves.',
          ),
          value: 'We only ship what Globex would use.',
        },
      ],
    });
    await client.items.update(RECORD.about, {
      ...attributes,
      meta: { current_version: before.record.meta.current_version },
    } as never);

    const after = await traversed(client, RECORD.about, 'page');
    expect(after.byText('Talk to Globex sales').ref.blockAncestry).toHaveLength(
      2,
    );
    expect(after.byText('We only ship what Globex would use.')).toBeTruthy();
    const untouched = (values: typeof before.values) =>
      values
        .filter((value) => typeof value.value === 'string')
        .map((value) => value.value)
        .filter(
          (text) =>
            text !== 'Talk to Acme sales' &&
            text !== 'Talk to Globex sales' &&
            text !== 'We only ship what we would use ourselves.' &&
            text !== 'We only ship what Globex would use.',
        );
    expect(untouched(after.values)).toEqual(untouched(before.values));
  });

  it('applies a Structured Text edit next to a Quote block', async () => {
    const { client } = install('default');
    const before = await traversed(client, RECORD.launch, 'article');
    const body = before.values.find(
      (value) => value.field.apiKey === 'body' && value.ref.locale === 'en',
    );
    if (!body) throw new Error('No English body');

    const text = JSON.stringify(body.value).replace(
      'Acme store',
      'Globex store',
    );
    const attributes = compileRootUpdateAttributes({
      root: before.record,
      schema: before.schema,
      changedValues: [
        { fieldValue: body, value: JSON.parse(text) },
        {
          fieldValue: before.byText('Acme launches a new widget™'),
          value: 'Globex launches a new widget™',
        },
      ],
    });
    await client.items.update(RECORD.launch, {
      ...attributes,
      meta: { current_version: before.record.meta.current_version },
    } as never);

    const after = await traversed(client, RECORD.launch, 'article');
    expect(after.byText('Globex launches a new widget™').ref.locale).toBe('en');
    expect(JSON.stringify(after.record.attributes.body)).toContain(
      'Globex store',
    );
    expect(
      after.byText(
        'Acme has always built tools people keep for decades. This one is no different.',
      ).ref.blockAncestry[0]?.kind,
    ).toBe('structured_text_block');
  });
});

describe('fake CMA: the errors scenario', () => {
  it('fails every Author list request', async () => {
    const { client } = install('errors');
    const error = await apiErrorOf(
      client.items.rawList({
        nested: true,
        filter: { type: modelIdFor('author') },
      }),
    );
    expect(error.response.status).toBe(500);
    const pages = await client.items.rawList({
      filter: { type: modelIdFor('page') },
    });
    expect(pages.meta.total_count).toBe(4);
  });

  it('answers 422 INVALID_FIELD for "Acme pricing"', async () => {
    const { client } = install('errors');
    const before = await findCurrent(client, RECORD.pricing);
    const error = await apiErrorOf(
      client.items.update(RECORD.pricing, {
        title: { en: 'Globex pricing', it: 'Prezzi Globex' },
        meta: { current_version: before.meta.current_version },
      }),
    );
    expect(error.response.status).toBe(422);
    expect(error.findError('INVALID_FIELD')?.attributes.details).toMatchObject({
      field_id: fieldIdFor('article', 'title'),
      code: 'VALIDATION_LENGTH',
    });
  });

  it('drops the first "Careers" update, then accepts it', async () => {
    const { client } = install('errors');
    const before = await findCurrent(client, RECORD.careers);
    const body = {
      title: 'Careers at Globex',
      meta: { current_version: before.meta.current_version },
    };
    await expect(
      client.items.update(RECORD.careers, body),
    ).rejects.toBeInstanceOf(TypeError);
    const updated = await client.items.update(RECORD.careers, body);
    expect(updated.title).toBe('Careers at Globex');
  });

  it('forbids updating "Legal notice"', async () => {
    const { client } = install('errors');
    const before = await findCurrent(client, RECORD.legal);
    const error = await apiErrorOf(
      client.items.update(RECORD.legal, {
        title: 'Legal',
        meta: { current_version: before.meta.current_version },
      }),
    );
    expect(error.response.status).toBe(403);
  });

  it('saves "About the acme team" but refuses to publish it', async () => {
    const { client } = install('errors');
    const before = await findCurrent(client, RECORD.acmeTeam);
    expect(before.meta.status).toBe('published');
    const updated = await client.items.update(RECORD.acmeTeam, {
      title: { en: 'About the Globex team', it: 'Il team Globex' },
      meta: { current_version: before.meta.current_version },
    });
    expect(updated.meta.status).toBe('updated');

    const error = await apiErrorOf(client.items.publish(RECORD.acmeTeam));
    expect(error.response.status).toBe(422);
    expect(error.findError('INVALID_FIELD')?.attributes.details).toEqual({
      field: 'published_on',
      field_id: fieldIdFor('article', 'published_on'),
      field_label: 'Published on',
      field_type: 'date',
      code: 'VALIDATION_REQUIRED',
    });
    const after = await findCurrent(client, RECORD.acmeTeam);
    expect(after.meta.status).toBe('updated');
    expect(after.attributes.published_on).toBeNull();

    const launch = await client.items.publish(RECORD.launch);
    expect(launch.meta.status).toBe('published');
  });
});

describe('fake CMA: the search-error scenario', () => {
  it('drops the first scan of each model, then serves it', async () => {
    const { client } = install('search-error');
    const scan = () =>
      client.items.rawList({
        nested: true,
        version: 'current',
        filter: { type: modelIdFor('article') },
        page: { offset: 0, limit: 30 },
      });
    await expect(scan()).rejects.toBeInstanceOf(TypeError);
    const counts = await client.items.rawList({
      filter: { type: modelIdFor('author') },
      page: { offset: 0, limit: 1 },
    });
    expect(counts.meta.total_count).toBeGreaterThan(0);
    const page = await scan();
    expect(page.data.length).toBeGreaterThan(0);
  });
});

describe('fake CMA: the stale scenario', () => {
  /** One nested page per model is a complete scan (every model has under 30 records). */
  async function scanEverything(client: Client): Promise<void> {
    const pages = await Promise.all(
      (['article', 'author', 'page'] as const).map((apiKey) =>
        client.items.rawList({
          nested: true,
          version: 'current',
          filter: { type: modelIdFor(apiKey) },
          page: { offset: 0, limit: 30 },
        }),
      ),
    );
    for (const page of pages) {
      expect(page.data).toHaveLength(page.meta.total_count);
    }
  }

  it('edits three records once a full search completes', async () => {
    const { client } = install('stale');
    const offsite = await findCurrent(client, RECORD.offsite);
    const brand = await findCurrent(client, RECORD.brand);
    const untouched = await findCurrent(client, RECORD.acmeTeam);

    await scanEverything(client);

    const offsiteAfter = await findCurrent(client, RECORD.offsite);
    expect(offsiteAfter.meta.current_version).not.toBe(
      offsite.meta.current_version,
    );
    expect(JSON.stringify(offsiteAfter.attributes.body)).toContain(
      'in Lisbon and Porto',
    );
    const brandAfter = await findCurrent(client, RECORD.brand);
    expect(brandAfter.meta.current_version).not.toBe(
      brand.meta.current_version,
    );
    expect(brandAfter.attributes.title).toEqual(brand.attributes.title);
    expect(brandAfter.attributes.published_on).toBe('2026-03-09');
    expect(
      (await findCurrent(client, RECORD.acmeTeam)).meta.current_version,
    ).toBe(untouched.meta.current_version);
  });

  it('changes "Legal notice" between the fresh read and the update', async () => {
    const { client } = install('stale');
    await scanEverything(client);
    const fresh = await findCurrent(client, RECORD.legal);
    const error = await apiErrorOf(
      client.items.update(RECORD.legal, {
        title: 'Legal notice (Globex)',
        meta: { current_version: fresh.meta.current_version },
      }),
    );
    expect(error.findError('STALE_ITEM_VERSION')).toBeTruthy();
    expect((await findCurrent(client, RECORD.legal)).attributes.title).toBe(
      'Legal notice',
    );
  });

  it('lands the first "Jane Doe" update, answers 503, and the retry is stale', async () => {
    vi.useFakeTimers();
    const { client, cma: fake } = install('stale');
    const fresh = await findCurrent(client, RECORD.jane);

    const pending = apiErrorOf(
      client.items.update(RECORD.jane, {
        bio: 'Jane leads design at **Globex**.',
        meta: { current_version: fresh.meta.current_version },
      }),
    );
    await vi.advanceTimersByTimeAsync(1_000);
    const error = await pending;

    expect(error.findError('STALE_ITEM_VERSION')).toBeTruthy();
    expect(
      fake.requests
        .filter((entry) => entry.method === 'PUT')
        .map((entry) => entry.status),
    ).toEqual([503, 422]);
    expect((await findCurrent(client, RECORD.jane)).attributes.bio).toBe(
      'Jane leads design at **Globex**.',
    );
  });
});

describe('fake CMA: install', () => {
  it('passes other URLs to the original fetch and restores it', async () => {
    const original = vi.fn(async () => new Response('ok'));
    const previous = globalThis.fetch;
    globalThis.fetch = original;
    try {
      const fake = installFakeCma('default', { latency: 0 });
      expect(globalThis.fetch).not.toBe(original);
      await globalThis.fetch('https://example.com/other');
      expect(original).toHaveBeenCalledWith(
        'https://example.com/other',
        undefined,
      );
      fake.uninstall();
      expect(globalThis.fetch).toBe(original);
    } finally {
      globalThis.fetch = previous;
    }
  });

  it('defines every scenario', () => {
    for (const name of SCENARIO_NAMES) {
      const fake = installFakeCma(name, { latency: 0 });
      expect(fake.scenario.name).toBe(name);
      fake.uninstall();
    }
  });
});
