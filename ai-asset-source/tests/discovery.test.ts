import assert from 'node:assert/strict';
import test from 'node:test';
import { loadProviderModelOptions } from '../src/utils/imageService/modelDiscovery';

const apiKey = 'synthetic-key';
const noWait = async () => {};

function json(payload: unknown, status = 200, headers?: HeadersInit): Response {
  return new Response(JSON.stringify(payload), { status, headers });
}

function googleImage(index: number) {
  return {
    name: `models/gemini-3-image-${index}`,
    displayName: `Image ${index}`,
    supportedGenerationMethods: ['generateContent'],
  };
}

test('Google only offers image models supported by the generation path', async () => {
  const result = await loadProviderModelOptions('google', apiKey, {
    selectedModel: 'imagen-4.0-generate-001',
    fetch: async () =>
      json({
        models: [
          googleImage(1),
          {
            name: 'models/gemini-3-text',
            description: 'Understands images',
            supportedGenerationMethods: ['generateContent'],
          },
          {
            name: 'models/imagen-4.0-generate-001',
            supportedGenerationMethods: ['predict'],
          },
          {
            name: 'models/gemini-3-image-predict-only',
            supportedGenerationMethods: ['predict'],
          },
          { name: 'models/gemini-3-image-no-methods' },
        ],
      }),
  });
  assert.deepEqual(
    result.options.map((option) => [option.value, Boolean(option.unavailable)]),
    [
      ['gemini-3-image-1', false],
      ['imagen-4.0-generate-001', true],
    ],
  );
});

test('OpenAI pins only a listed GPT Image 2 and keeps unavailable saved values', async () => {
  const fetchModels: typeof fetch = async (input, init) => {
    assert.equal(String(input), 'https://api.openai.com/v1/models');
    assert.equal(
      new Headers(init?.headers).get('Authorization'),
      `Bearer ${apiKey}`,
    );
    return json({
      data: [
        { id: 'gpt-image-1', created: 10 },
        { id: 'gpt-image-2', created: 20 },
        { id: 'gpt-image-2', created: 20 },
        { id: 'chatgpt-image-latest', created: 30 },
        { id: 'gpt-text', created: 30 },
      ],
    });
  };
  const result = await loadProviderModelOptions('openai', apiKey, {
    fetch: fetchModels,
  });
  assert.deepEqual(
    result.options.map((option) => option.value),
    ['gpt-image-2', 'chatgpt-image-latest', 'gpt-image-1'],
  );
  const missing = await loadProviderModelOptions('openai', apiKey, {
    selectedModel: 'gpt-image-2',
    fetch: async () => json({ data: [{ id: 'gpt-image-1' }] }),
  });
  assert.equal(missing.options[0].value, 'gpt-image-1');
  assert.equal(missing.options[1].value, 'gpt-image-2');
  assert.equal(missing.options[1].unavailable, true);
});

test('empty valid catalogs stay empty without invented available models', async () => {
  await Promise.all(
    (['google', 'openai'] as const).map(async (provider) => {
      const result = await loadProviderModelOptions(provider, apiKey, {
        fetch: async () =>
          json(provider === 'google' ? { models: [] } : { data: [] }),
      });
      assert.deepEqual(result.options, []);
    }),
  );
});

test('missing keys preserve the saved fallback without requesting a catalog', async () => {
  const result = await loadProviderModelOptions('google', '  ', {
    selectedModel: ' saved-model ',
    fetch: async () => {
      throw new Error('Must not fetch');
    },
  });
  assert.deepEqual(result.options, [
    {
      value: 'saved-model',
      label: 'saved-model (unavailable)',
      unavailable: true,
    },
  ]);
});

test('malformed catalogs and entries fail explicitly instead of empty success', async () => {
  const malformedCatalogs = [
    null,
    [],
    {},
    { data: null },
    { data: 'not an array' },
    { data: [null] },
    { data: [{ id: ' ' }] },
  ];
  await Promise.all(
    malformedCatalogs.map((payload) =>
      assert.rejects(
        loadProviderModelOptions('openai', apiKey, {
          fetch: async () => json(payload),
        }),
        /invalid|valid identifier/,
      ),
    ),
  );
  const malformedGoogleCatalogs = [
    { models: [null] },
    { models: [{}] },
    {
      models: [
        { ...googleImage(0), supportedGenerationMethods: 'generateContent' },
      ],
    },
  ];
  await Promise.all(
    malformedGoogleCatalogs.map((payload) =>
      assert.rejects(
        loadProviderModelOptions('google', apiKey, {
          fetch: async () => json(payload),
        }),
        /invalid|valid identifier/,
      ),
    ),
  );
});

test('malformed JSON is not retried or presented as an empty catalog', async () => {
  let calls = 0;
  await assert.rejects(
    loadProviderModelOptions('openai', apiKey, {
      fetch: async () => {
        calls += 1;
        return new Response('{broken');
      },
      wait: noWait,
    }),
    /invalid model catalog response/,
  );
  assert.equal(calls, 1);
});

test('Google detects a multi-page token cycle before repeating its request', async () => {
  let calls = 0;
  const tokens = ['page-a', 'page-b', 'page-a'];
  await assert.rejects(
    loadProviderModelOptions('google', apiKey, {
      fetch: async () => json({ models: [], nextPageToken: tokens[calls++] }),
    }),
    /repeated/,
  );
  assert.equal(calls, 3);
});

test('Google rejects malformed pagination tokens', async () => {
  await Promise.all(
    [12, null, {}, '  '].map((nextPageToken) =>
      assert.rejects(
        loadProviderModelOptions('google', apiKey, {
          fetch: async () => json({ models: [], nextPageToken }),
        }),
        /invalid model catalog page token/,
      ),
    ),
  );
});
