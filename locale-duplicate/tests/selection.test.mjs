import assert from 'node:assert/strict';
import test from 'node:test';
import {
  createCachedModelLoader,
  getVisibleOptions,
  isFieldCopyConfigured,
  LARGE_SELECTION_THRESHOLD,
  normalizeFieldCopyConfigs,
  PLUGIN_PARAMETER_LIMIT_BYTES,
  validatePluginParameters,
} from '../src/utils/selection.ts';

test('normalizes partial legacy parameters and deduplicates by model and field', () => {
  const entries = [
    null,
    false,
    {},
    { modelId: 'a', fieldId: 12 },
    { modelId: '', fieldId: 'title' },
    { modelId: 'a', fieldId: 'title' },
    { modelId: 'a', fieldId: 'title', fieldLabel: 'Duplicate' },
    { modelId: 'b', fieldId: 'title', modelLabel: 'B', fieldLabel: 'Title' },
  ];
  assert.deepEqual(normalizeFieldCopyConfigs(entries), [
    { modelId: 'a', fieldId: 'title', modelLabel: '', fieldLabel: '' },
    { modelId: 'b', fieldId: 'title', modelLabel: 'B', fieldLabel: 'Title' },
  ]);
  assert.deepEqual(normalizeFieldCopyConfigs({}), []);
  assert.equal(isFieldCopyConfigured(entries, 'a', 'title'), true);
  assert.equal(isFieldCopyConfigured(entries, 'missing', 'title'), false);
});

test('small select menus preserve their option objects and existing filtering', () => {
  const options = Array.from(
    { length: LARGE_SELECTION_THRESHOLD },
    (_, index) => ({
      label: `Model ${index}`,
      value: `${index}`,
    }),
  );
  assert.equal(getVisibleOptions(options, 'unmatched'), options);
});

test('model loading shares pending calls and caches complete field results', async () => {
  let calls = 0;
  let resolve;
  const completeFields = Array.from({ length: 10 }, (_, index) => ({
    value: `${index}`,
  }));
  const load = createCachedModelLoader(() => {
    calls += 1;
    return new Promise((done) => {
      resolve = done;
    });
  });
  const first = load('model');
  assert.equal(load('model'), first);
  await Promise.resolve();
  assert.equal(calls, 1);
  resolve(completeFields);
  assert.equal(await first, completeFields);
  const cached = await Promise.all(
    Array.from({ length: 10 }, () => load('model')),
  );
  for (const fields of cached) assert.equal(fields, completeFields);
  assert.equal(calls, 1);
});

test('model cache is bounded with LRU eviction and failed loads can retry', async () => {
  const calls = [];
  let failing = true;
  const load = createCachedModelLoader(async (id) => {
    calls.push(id);
    if (id === 'failure' && failing)
      throw new Error('Synthetic network failure');
    return [id];
  }, 2);
  await load('a');
  await load('b');
  await load('a');
  await load('c');
  await load('b');
  assert.deepEqual(calls, ['a', 'b', 'c', 'b']);
  await assert.rejects(load('failure'), /Synthetic network failure/);
  failing = false;
  assert.deepEqual(await load('failure'), ['failure']);
  assert.equal(calls.filter((id) => id === 'failure').length, 2);
});

test('plugin parameter limit measures UTF-8 bytes and includes unrelated settings', () => {
  const overhead = JSON.stringify({ text: '' }).length;
  assert.doesNotThrow(() =>
    validatePluginParameters({
      text: 'a'.repeat(PLUGIN_PARAMETER_LIMIT_BYTES - overhead),
    }),
  );
  assert.throws(
    () =>
      validatePluginParameters({
        text: 'a'.repeat(PLUGIN_PARAMETER_LIMIT_BYTES - overhead + 1),
      }),
    /10 KB plugin settings limit/,
  );
  assert.throws(
    () =>
      validatePluginParameters({
        unrelatedSetting: 'é'.repeat(5_000),
        fieldConfigs: [],
      }),
    /Remove some field configurations/,
  );
});
