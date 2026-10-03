import assert from 'node:assert/strict';
import test from 'node:test';
import { setImmediate } from 'node:timers/promises';
import { ApiError } from '@datocms/cma-client-browser';
import { CmaUncertainOutcomeError } from '../src/services/cmaClient.ts';
import { runLocaleDuplication } from '../src/services/LocaleDuplicationService.ts';
import { ProgressLog } from '../src/utils/progressLog.ts';

const config = {
  sourceLocale: 'en',
  targetLocale: 'pt',
  publishAfterDuplication: true,
};
const fields = [{ api_key: 'title', field_type: 'string', localized: true }];
const apiError = (status = 422, code = 'INVALID_ITEM') =>
  new ApiError({
    request: { url: 'https://example.test', method: 'PUT', headers: {} },
    response: {
      status,
      statusText: 'Error',
      headers: {},
      body: {
        data: [
          {
            id: 'error',
            type: 'api_error',
            attributes: { code, doc_url: '', details: {} },
          },
        ],
      },
    },
  });

function mockProject(counts = [35], options = {}) {
  const models = counts.map((_, index) => ({
    id: `model-${index}`,
    api_key: `model_${index}`,
    name: `Model ${index}`,
    modular_block: false,
    draft_mode_active: options.draftMode !== false,
  }));
  const records = new Map();
  for (const [index, count] of counts.entries()) {
    for (let i = 0; i < count; i++) {
      const id = `${index}-${String(i).padStart(5, '0')}`;
      records.set(id, {
        id,
        type: 'item',
        item_type: { type: 'item_type', id: models[index].id },
        title: {
          en: options.noop ? 'Same' : `Source ${i}`,
          pt: options.noop ? 'Same' : 'Old',
          fr: 'Preserve',
        },
        meta: { current_version: `v-${id}`, status: 'published' },
      });
    }
  }
  const calls = {
    pages: [],
    updates: [],
    batches: [],
    active: 0,
    maxActive: 0,
    find: 0,
  };
  const clone = (record) => structuredClone(record);
  const client = {
    itemTypes: { list: async () => models },
    fields: { list: async () => fields },
    items: {
      rawList: async (query) => {
        const list = [...records.values()]
          .filter((record) => record.item_type.id === query.filter.type)
          .sort((a, b) => a.id.localeCompare(b.id));
        calls.pages.push(query);
        return {
          data: list
            .slice(query.page.offset, query.page.offset + query.page.limit)
            .map(({ id }) => ({ id })),
          meta: { total_count: list.length },
        };
      },
      list: async (query) => {
        if (query.nested) {
          assert.ok(query.page.limit <= 30);
          assert.equal(
            calls.active,
            0,
            'Previous page must be consumed before requesting another',
          );
        }
        return query.filter.ids
          .split(',')
          .filter((id) => !options.missing?.has(id))
          .map((id) => records.get(id))
          .filter(Boolean)
          .map(clone);
      },
      find: async (id) => {
        calls.find++;
        return clone(records.get(id));
      },
      update: async (id, updates) => {
        calls.active++;
        calls.maxActive = Math.max(calls.maxActive, calls.active);
        calls.updates.push({ id, updates });
        try {
          await setImmediate();
          if (options.fail?.has(id)) throw apiError();
          if (options.onUpdate)
            await options.onUpdate(id, updates, records, calls);
          const record = records.get(id);
          const { meta, ...attributes } = updates;
          assert.equal(meta.current_version, record.meta.current_version);
          const updated = {
            ...record,
            ...attributes,
            meta: {
              ...record.meta,
              current_version: `new-${id}`,
              status: 'updated',
            },
          };
          records.set(id, updated);
          if (options.uncertain?.has(id))
            throw new CmaUncertainOutcomeError('Lost write response');
          return clone(updated);
        } finally {
          calls.active--;
        }
      },
      rawBulkPublish: async ({ data }) => {
        const items = data.relationships.items.data;
        assert.ok(items.length <= 200);
        calls.batches.push(items);
        if (options.publish) {
          const result = await options.publish(items, records, calls);
          if (result?.meta) return result;
        }
        for (const item of items)
          records.get(item.id).meta.status = 'published';
        return { data: [], meta: { successful: items.length, failed: 0 } };
      },
    },
  };
  return { client, records, calls, models };
}

async function run(project, overrides = {}, onProgress = () => {}) {
  return runLocaleDuplication(
    project.client,
    { ...config, ...overrides },
    onProgress,
  );
}

test('copies multiple models in bounded pages/workers and publishes all in CMA-sized batches', async () => {
  const project = mockProject([201, 205, 35]);
  const log = new ProgressLog();
  const progress = [];
  const result = await run(project, {}, (update) => {
    log.add(update);
    progress.push(update.progress);
  });
  assert.equal(result.totalRecordsProcessed, 441);
  assert.equal(result.successfulRecords, 441);
  assert.equal(result.publishedRecords, 441);
  assert.equal(result.stats.totalModels, 3);
  assert.equal(result.stats.pendingPublications, 0);
  assert.ok(project.calls.maxActive > 1 && project.calls.maxActive <= 3);
  assert.deepEqual(
    project.calls.batches.map((batch) => batch.length),
    [200, 200, 41],
  );
  assert.equal(project.calls.pages[0].order_by, 'id_ASC');
  assert.equal(project.calls.pages[0].nested, undefined);
  for (const record of project.records.values()) {
    assert.equal(record.title.pt, record.title.en);
    assert.equal(record.title.fr, 'Preserve');
  }
  for (let i = 1; i < progress.length; i++)
    assert.ok(progress[i] >= progress[i - 1]);
  assert.equal(progress.at(-1), 100);
  assert.ok(log.entries().length <= 500);
});

test('discovers 200000 synthetic IDs through 2000 bounded pages without retaining record payloads', async () => {
  let pages = 0;
  let nestedCalls = 0;
  const abortSignal = { current: false };
  const client = {
    itemTypes: {
      list: async () => [
        {
          id: 'massive',
          api_key: 'massive',
          name: 'Massive',
          modular_block: false,
        },
      ],
    },
    items: {
      rawList: async ({ page, order_by }) => {
        assert.equal(order_by, 'id_ASC');
        assert.equal(page.limit, 100);
        pages++;
        return {
          data: Array.from(
            { length: Math.min(100, 200_000 - page.offset) },
            (_, index) => ({ id: `virtual-${page.offset + index}` }),
          ),
          meta: { total_count: 200_000 },
        };
      },
      list: async () => {
        nestedCalls++;
        return { data: [], meta: { successful: items.length, failed: 0 } };
      },
    },
  };
  const result = await runLocaleDuplication(
    client,
    { ...config, abortSignal },
    (update) => {
      if (update.stats?.totalToProcess === 200_000) abortSignal.current = true;
    },
  );
  assert.equal(pages, 2000);
  assert.equal(nestedCalls, 0);
  assert.equal(result.stats.totalToProcess, 200_000);
  assert.equal(result.stats.cancelled, true);
  assert.equal(result.totalRecordsProcessed, 0);
});

test('per-record failures and missing records are counted and never published', async () => {
  const project = mockProject([35], {
    fail: new Set(['0-00002']),
    missing: new Set(['0-00003']),
  });
  const result = await run(project);
  assert.equal(result.totalRecordsProcessed, 35);
  assert.equal(result.failedRecords, 2);
  assert.equal(result.successfulRecords, 33);
  assert.equal(result.publishedRecords, 33);
  assert.equal(result.stats.modelStats['model-0'].error, 2);
});

test('no-op records and models without draft mode do not enter publication batches', async () => {
  const noop = mockProject([35], { noop: true });
  const result = await run(noop);
  assert.equal(result.stats.skippedRecords, 35);
  assert.equal(noop.calls.updates.length, 0);
  assert.equal(noop.calls.batches.length, 0);
  const automatic = mockProject([35], { draftMode: false });
  assert.equal((await run(automatic)).publishedRecords, 0);
  assert.equal(automatic.calls.batches.length, 0);
});

test('cancellation settles active writes and prevents additional pages and publication', async () => {
  const abortSignal = { current: false };
  const project = mockProject([65], {
    onUpdate: () => {
      abortSignal.current = true;
    },
  });
  const updates = [];
  const result = await run(project, { abortSignal }, (event) =>
    updates.push(event),
  );
  assert.ok(result.successfulRecords >= 1 && result.successfulRecords <= 3);
  assert.equal(result.successfulRecords, project.calls.updates.length);
  assert.equal(project.calls.batches.length, 0);
  assert.equal(result.stats.cancelled, true);
  assert.equal(result.stats.pendingPublications, result.successfulRecords);
  assert.ok(updates.at(-1).progress < 100);
  assert.equal(updates.at(-1).type, 'error');
});

test('partial publication failure reconciles known outcomes and continues later batches', async () => {
  const project = mockProject([405], {
    publish: async (items, records, calls) => {
      if (calls.batches.length === 2) {
        for (const item of items.slice(0, 17))
          records.get(item.id).meta.status = 'published';
        throw apiError();
      }
      for (const item of items) records.get(item.id).meta.status = 'published';
      return [];
    },
  });
  const result = await run(project);
  assert.equal(result.publishedRecords, 222);
  assert.equal(result.stats.failedPublications, 183);
  assert.equal(result.stats.pendingPublications, 0);
  assert.equal(project.calls.batches.length, 3);
});

test('uncertain writes are read back and never replayed', async () => {
  const project = mockProject([1], { uncertain: new Set(['0-00000']) });
  const result = await run(project);
  assert.equal(result.successfulRecords, 1);
  assert.equal(result.failedRecords, 0);
  assert.equal(project.calls.updates.length, 1);
  assert.equal(project.calls.find, 1);
  const failed = mockProject([1]);
  failed.client.items.update = async () => {
    failed.calls.updates.push({});
    throw new CmaUncertainOutcomeError('Lost response');
  };
  const rejected = await run(failed);
  assert.equal(rejected.failedRecords, 1);
  assert.equal(failed.calls.updates.length, 1);
  assert.equal(failed.calls.batches.length, 0);
});

test('unconfirmed publication remains uncertain without resubmitting its accepted job', async () => {
  const project = mockProject([3], {
    publish: async () => {
      throw new CmaUncertainOutcomeError('Job observation timed out');
    },
  });
  const result = await run(project);
  assert.equal(result.publishedRecords, 0);
  assert.equal(result.stats.uncertainPublications, 3);
  assert.equal(project.calls.batches.length, 1);
});

test('changed drafts are excluded before publication and selected empty models do not mean all', async () => {
  const project = mockProject([1]);
  const list = project.client.items.list;
  project.client.items.list = async (query) => {
    if (!query.nested)
      project.records.get('0-00000').meta.current_version = 'editor-version';
    return list(query);
  };
  const result = await run(project);
  assert.equal(result.stats.failedPublications, 1);
  assert.equal(result.publishedRecords, 0);
  assert.equal(project.calls.batches.length, 0);
  const empty = mockProject([35]);
  assert.equal(
    (await run(empty, { selectedModelIds: [] })).totalRecordsProcessed,
    0,
  );
  assert.equal(empty.calls.pages.length, 0);
});

test('pagination ending early fails the model instead of reporting success', async () => {
  const project = mockProject([35]);
  project.client.items.rawList = async () => ({
    data: [],
    meta: { total_count: 35 },
  });
  const updates = [];
  const result = await run(project, {}, (event) => updates.push(event));
  assert.equal(result.stats.modelFailures, 1);
  assert.equal(result.successfulRecords, 0);
  assert.equal(project.calls.updates.length, 0);
  assert.equal(updates.at(-1).type, 'error');
});

test('authentication failure stops launching writes and preserves completed counters', async () => {
  const project = mockProject([65]);
  project.client.items.update = async () => {
    project.calls.updates.push({});
    throw apiError(403, 'INSUFFICIENT_PERMISSIONS');
  };
  const result = await run(project);
  assert.ok(project.calls.updates.length <= 3);
  assert.equal(result.failedRecords, project.calls.updates.length);
  assert.equal(result.stats.modelFailures, 1);
  assert.equal(project.calls.batches.length, 0);
});

test('the operation log retains bounded samples while counting 200000 events exactly', () => {
  const log = new ProgressLog();
  for (let i = 0; i < 200_000; i++)
    log.add({
      message: `Record ${i}`,
      type: i % 10 === 0 ? 'error' : 'success',
      timestamp: i,
      stats: { modelStats: {} },
    });
  const entries = log.entries();
  assert.equal(log.total, 200_000);
  assert.equal(log.totalErrors, 20_000);
  assert.equal(entries.length, 500);
  assert.equal(log.errors.length, 100);
  assert.equal(entries[0].message, 'Record 199500');
  assert.equal(entries.at(-1).message, 'Record 199999');
  assert.equal(entries[0].stats, undefined);
});

test('a completed bulk job can contain partial failures without rejecting its promise', async () => {
  const project = mockProject([5], {
    publish: async (items, records) => {
      for (const item of items.slice(0, 3))
        records.get(item.id).meta.status = 'published';
      return { data: [], meta: { successful: 3, failed: 2 } };
    },
  });
  const result = await run(project);
  assert.equal(result.publishedRecords, 3);
  assert.equal(result.stats.failedPublications, 2);
  assert.equal(result.stats.pendingPublications, 0);
});

test('stale writes rebuild the locale payload from fresh data without losing other locale edits', async () => {
  const project = mockProject([1], {
    onUpdate: (id, _updates, records, calls) => {
      if (calls.updates.length !== 1) return;
      const latest = records.get(id);
      latest.title.en = 'Fresh source';
      latest.title.fr = 'Fresh French';
      latest.meta.current_version = 'editor-version';
      throw apiError(409, 'STALE_ITEM_VERSION');
    },
  });
  const result = await run(project);
  assert.equal(result.successfulRecords, 1);
  assert.equal(result.failedRecords, 0);
  assert.equal(project.calls.updates.length, 2);
  assert.equal(project.records.get('0-00000').title.pt, 'Fresh source');
  assert.equal(project.records.get('0-00000').title.fr, 'Fresh French');
  assert.equal(project.calls.find, 1);
});

test('cancellation while publishing lets the accepted batch settle and stops later batches', async () => {
  const abortSignal = { current: false };
  const project = mockProject([405], {
    publish: async (items, records) => {
      for (const item of items) records.get(item.id).meta.status = 'published';
      abortSignal.current = true;
      return { data: [], meta: { successful: items.length, failed: 0 } };
    },
  });
  const result = await run(project, { abortSignal });
  assert.equal(project.calls.batches.length, 1);
  assert.equal(result.publishedRecords, 200);
  assert.equal(result.stats.pendingPublications, 205);
  assert.equal(result.stats.cancelled, true);
});

test('short discovery pages continue by their actual length, without truncating the selection', async () => {
  const project = mockProject([35]);
  const listing = project.client.items.rawList;
  project.client.items.rawList = async (query) =>
    listing({ ...query, page: { ...query.page, limit: 17 } });
  const result = await run(project);
  assert.equal(result.totalRecordsProcessed, 35);
  assert.equal(project.calls.pages.length, 3);
  assert.deepEqual(
    project.calls.pages.map((query) => query.page.offset),
    [0, 17, 34],
  );
});

test('a submitted publication with unavailable read-back is uncertain while unsent batches stay pending', async () => {
  let sent = false;
  const project = mockProject([205], {
    publish: async () => {
      sent = true;
      throw new CmaUncertainOutcomeError('Accepted job response lost');
    },
  });
  const list = project.client.items.list;
  project.client.items.list = async (query) => {
    if (sent && !query.nested) throw apiError(403, 'INSUFFICIENT_PERMISSIONS');
    return list(query);
  };
  const result = await run(project);
  assert.equal(project.calls.batches.length, 1);
  assert.equal(result.stats.uncertainPublications, 200);
  assert.equal(result.stats.pendingPublications, 5);
  assert.equal(result.publishedRecords, 0);
  assert.equal(result.stats.modelFailures, 1);
});

test('an uncertain update with unavailable read-back remains unconfirmed and stops on permission failure', async () => {
  const project = mockProject([35]);
  project.client.items.update = async () => {
    project.calls.updates.push({});
    throw new CmaUncertainOutcomeError('Lost response');
  };
  project.client.items.find = async () => {
    throw apiError(403, 'INSUFFICIENT_PERMISSIONS');
  };
  const result = await run(project);
  assert.ok(result.failedRecords > 0 && result.failedRecords <= 3);
  assert.equal(result.stats.uncertainRecords, result.failedRecords);
  assert.equal(result.stats.modelFailures, 1);
  assert.equal(result.publishedRecords, 0);
});

test('an applied HTTP 200 write with malformed JSON is confirmed without replaying its payload', async () => {
  const project = mockProject([1]);
  const update = project.client.items.update;
  project.client.items.update = async (...args) => {
    await update(...args);
    return new Response('{invalid JSON', { status: 200 }).json();
  };
  const result = await run(project);
  assert.equal(result.successfulRecords, 1);
  assert.equal(result.failedRecords, 0);
  assert.equal(result.stats.uncertainRecords, 0);
  assert.equal(result.publishedRecords, 1);
  assert.equal(project.calls.find, 1);
  assert.equal(project.calls.updates.length, 1);
});

test('post-write type errors and successful-status API errors are confirmed by read-back', async () => {
  for (const error of [
    new TypeError('Could not deserialize the successful write response'),
    apiError(200, 'INVALID_RESPONSE_CONTENT_TYPE'),
  ]) {
    const project = mockProject([1]);
    const update = project.client.items.update;
    project.client.items.update = async (...args) => {
      await update(...args);
      throw error;
    };
    // biome-ignore lint/performance/noAwaitInLoops: settle each independent failure fixture before the next.
    const result = await run(project);
    assert.equal(result.successfulRecords, 1);
    assert.equal(result.failedRecords, 0);
    assert.equal(project.calls.find, 1);
    assert.equal(project.calls.updates.length, 1);
  }
});

test('a publication parse failure stays uncertain when read-back has not confirmed publication', async () => {
  const project = mockProject([3], {
    publish: async () => new Response('{invalid JSON', { status: 200 }).json(),
  });
  const result = await run(project);
  assert.equal(result.publishedRecords, 0);
  assert.equal(result.stats.failedPublications, 0);
  assert.equal(result.stats.uncertainPublications, 3);
  assert.equal(result.stats.pendingPublications, 0);
  assert.equal(project.calls.batches.length, 1);
});

test('an applied publication with an unreadable successful result is counted from read-back', async () => {
  const project = mockProject([3], {
    publish: async (items, records) => {
      for (const item of items) records.get(item.id).meta.status = 'published';
      throw apiError(202, 'INVALID_RESPONSE_CONTENT_TYPE');
    },
  });
  const result = await run(project);
  assert.equal(result.publishedRecords, 3);
  assert.equal(result.stats.failedPublications, 0);
  assert.equal(result.stats.uncertainPublications, 0);
  assert.equal(result.stats.pendingPublications, 0);
  assert.equal(project.calls.batches.length, 1);
});

function blockRecordProject() {
  const project = mockProject([1]);
  const block = (id, modelId) => ({
    id,
    type: 'item',
    attributes: { title: 'Block content' },
    relationships: {
      item_type: { data: { type: 'item_type', id: modelId } },
    },
  });
  const record = project.records.get('0-00000');
  record.content = {
    en: [block('source-block', 'source-model')],
    pt: [],
    fr: [block('preserved-block', 'preserved-model')],
  };
  project.client.fields.list = async (modelId) =>
    modelId === 'model-0'
      ? [{ api_key: 'content', field_type: 'rich_text', localized: true }]
      : [{ api_key: 'title', field_type: 'string', localized: false }];
  return project;
}

test('a schema failure while comparing an uncertain write remains uncertain and stops on permission failure', async () => {
  const project = blockRecordProject();
  const fields = project.client.fields.list;
  project.client.fields.list = async (modelId) => {
    if (modelId === 'preserved-model')
      throw apiError(403, 'INSUFFICIENT_PERMISSIONS');
    return fields(modelId);
  };
  const update = project.client.items.update;
  project.client.items.update = async (...args) => {
    await update(...args);
    throw new CmaUncertainOutcomeError('Lost write response');
  };
  const result = await run(project);
  assert.equal(result.failedRecords, 1);
  assert.equal(result.stats.uncertainRecords, 1);
  assert.equal(result.stats.modelFailures, 1);
  assert.equal(result.successfulRecords, 0);
  assert.equal(project.calls.updates.length, 1);
  assert.equal(project.calls.find, 1);
  assert.equal(project.calls.batches.length, 0);
});

test('a type error while preparing block payloads is a pre-write failure without read-back', async () => {
  const project = blockRecordProject();
  const fields = project.client.fields.list;
  project.client.fields.list = async (modelId) => {
    if (modelId === 'source-model')
      throw new TypeError('Could not deserialize the block schema');
    return fields(modelId);
  };
  const result = await run(project);
  assert.equal(result.failedRecords, 1);
  assert.equal(result.stats.uncertainRecords, 0);
  assert.equal(project.calls.updates.length, 0);
  assert.equal(project.calls.find, 0);
  assert.equal(project.calls.batches.length, 0);
});
