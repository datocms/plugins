import assert from 'node:assert/strict';
import test from 'node:test';
import {
  createCachedModelLoader,
  getVisibleOptions,
  indexFieldCopyConfigs,
  isFieldCopyConfigured,
  LARGE_SELECTION_THRESHOLD,
  normalizeFieldCopyConfigs,
  PLUGIN_PARAMETER_LIMIT_BYTES,
  VISIBLE_SELECTION_LIMIT,
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

test('indexes thousands of field configurations once per parameter snapshot', () => {
  let reads = 0;
  const entries = Array.from({ length: 5_000 }, (_, index) => ({
    get modelId() {
      reads += 1;
      return `model-${Math.floor(index / 10)}`;
    },
    fieldId: `field-${index}`,
    modelLabel: '',
    fieldLabel: '',
  }));
  assert.equal(isFieldCopyConfigured(entries, 'model-499', 'field-4999'), true);
  const initialReads = reads;
  for (let index = 0; index < entries.length; index += 1) {
    assert.equal(
      isFieldCopyConfigured(
        entries,
        `model-${Math.floor(index / 10)}`,
        `field-${index}`,
      ),
      true,
    );
  }
  assert.equal(
    reads,
    initialReads,
    'repeated addon hooks do not scan the array',
  );
  const updated = [...entries, { modelId: 'new', fieldId: 'new-field' }];
  assert.equal(isFieldCopyConfigured(updated, 'new', 'new-field'), true);
  assert.equal(isFieldCopyConfigured(entries, 'new', 'new-field'), false);

  const index = indexFieldCopyConfigs(normalizeFieldCopyConfigs(entries));
  assert.equal(index.size, 500);
  assert.equal(index.get('model-499').size, 10);
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

test('large menus bound render size while searching the entire schema', () => {
  const options = Array.from({ length: 10_000 }, (_, index) => ({
    label: `Model ${index}`,
    value: `id-${index}`,
  }));
  options[9_999] = { label: 'Último conteúdo', value: 'final-id' };
  assert.equal(getVisibleOptions(options, '').length, VISIBLE_SELECTION_LIMIT);
  assert.deepEqual(getVisibleOptions(options, 'ultimo conteudo'), [
    options[9_999],
  ]);
  assert.deepEqual(getVisibleOptions(options, 'FINAL-ID'), [options[9_999]]);
  assert.deepEqual(getVisibleOptions(options, 'does not exist'), []);
  const selected = new Set(options.slice(0, 200).map((option) => option.value));
  const visible = getVisibleOptions(options, '', selected);
  assert.equal(visible.length, VISIBLE_SELECTION_LIMIT);
  assert.equal(visible[0], options[200]);
  assert.equal(
    options.length,
    10_000,
    'the source list and selected values are preserved',
  );
});

test('model loading shares pending calls and caches complete field results', async () => {
  let calls = 0;
  let resolve;
  const completeFields = Array.from({ length: 1_000 }, (_, index) => ({
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
    Array.from({ length: 1_000 }, () => load('model')),
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
