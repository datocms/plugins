import assert from 'node:assert/strict';
import { test } from 'node:test';
import { googleAdapter } from '../src/utils/imageService/adapters/google';
import { openAiAdapter } from '../src/utils/imageService/adapters/openai';
import {
  getCapabilities,
  isGoogleImageGenerationModel,
  isOpenAiImageGenerationModel,
} from '../src/utils/imageService/catalog';
import {
  MAX_GENERATED_IMAGE_BASE64_LENGTH,
  validateGenerationRequest,
} from '../src/utils/imageService/generationValidation';
import {
  createProviderFetch,
  MAX_GENERATION_RESPONSE_BYTES,
} from '../src/utils/imageService/providerTransport';
import {
  createFailedGenerationBatch,
  createGenerationBatch,
  normalizeGeneratedImages,
} from '../src/utils/imageService/shared';
import type { ImageOperationRequest } from '../src/utils/imageService/types';

const png =
  'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAusB9Wl6xSUAAAAASUVORK5CYII=';
const webp = Buffer.from('RIFF\0\0\0\0WEBP', 'binary').toString('base64');
const createdAt = '2026-10-02T12:00:00.000Z';
const openAiRequest: ImageOperationRequest = {
  provider: 'openai',
  model: 'gpt-image-1.5',
  prompt: 'A synthetic image for a mocked test',
  aspectRatio: '1:1',
  imageSize: 'native',
  variationCount: 1,
  outputFormat: 'png',
};
const googleRequest: ImageOperationRequest = {
  ...openAiRequest,
  provider: 'google',
  model: 'gemini-2.5-flash-image',
  outputFormat: undefined,
};

function jsonResponse(
  body: unknown,
  status = 200,
  headers?: HeadersInit,
): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json', ...headers },
  });
}

function googleImageResponse(images: string[] = [png]): Response {
  return jsonResponse({
    candidates: [
      {
        content: {
          role: 'model',
          parts: images.map((data) => ({
            inlineData: { mimeType: 'image/png', data },
          })),
        },
        finishReason: 'STOP',
      },
    ],
    usageMetadata: {
      promptTokenCount: 1,
      candidatesTokenCount: 1,
      totalTokenCount: 2,
    },
  });
}

test('provider catalog only exposes supported API image model families', () => {
  for (const model of [
    'gpt-image-1',
    'gpt-image-1.5',
    'gpt-image-2-2026-04-21',
    'chatgpt-image-latest',
  ]) {
    assert.equal(isOpenAiImageGenerationModel(model), true);
  }

  for (const model of [
    'dall-e-2',
    'dall-e-3',
    'gpt-image-search',
    'text-image-embedding',
  ]) {
    assert.equal(isOpenAiImageGenerationModel(model), false);
  }

  assert.equal(
    isGoogleImageGenerationModel('models/gemini-3.1-flash-image'),
    true,
  );
  assert.equal(isGoogleImageGenerationModel('imagen-4.0-generate-001'), false);
  assert.equal(isGoogleImageGenerationModel('gemini-3-pro'), false);
  assert.equal(
    getCapabilities('google', 'gemini-3.1-flash-image')
      .imageSizeOptionsByAspectRatio['2:3'][0].label,
    '848×1264 px',
  );
});

test('generation validates prompt/count/size/format/compression before a paid request', async () => {
  let calls = 0;
  const fetchMock: typeof fetch = async () => {
    calls += 1;
    throw new Error('A request must not be sent.');
  };
  const invalidRequests = [
    { ...openAiRequest, prompt: 'x'.repeat(32_001) },
    { ...openAiRequest, prompt: '   ' },
    { ...openAiRequest, variationCount: 200_000 },
    { ...openAiRequest, variationCount: Number.NaN },
    { ...openAiRequest, variationCount: 1.5 },
    { ...openAiRequest, imageSize: '4k' },
    { ...openAiRequest, aspectRatio: '16:9' },
    { ...openAiRequest, outputCompression: Number.NaN },
    { ...openAiRequest, outputCompression: 101 },
    { ...openAiRequest, outputQuality: 'max' },
    { ...openAiRequest, outputFormat: 'gif' },
    { ...openAiRequest, model: 'dall-e-3' },
  ];

  await Promise.all(
    invalidRequests.map((request) =>
      assert.rejects(
        openAiAdapter.run('mock-key', request as ImageOperationRequest, {
          fetch: fetchMock,
        }),
      ),
    ),
  );

  assert.equal(calls, 0);
  assert.doesNotThrow(() =>
    validateGenerationRequest({
      ...openAiRequest,
      prompt: 'x'.repeat(32_000),
      variationCount: 4,
      outputCompression: 0,
    }),
  );
  await assert.rejects(
    googleAdapter.run(
      'mock-key',
      { ...googleRequest, variationCount: 2 },
      { fetch: fetchMock },
    ),
  );
  await assert.rejects(
    googleAdapter.run(
      'mock-key',
      { ...googleRequest, model: 'imagen-4.0-generate-001' },
      { fetch: fetchMock },
    ),
    /retired/,
  );
  assert.equal(calls, 0);
});

test('OpenAI preserves successful and invalid positions and fills missing results', async () => {
  let sent: Record<string, unknown> | undefined;
  const result = await openAiAdapter.run(
    'mock-key',
    { ...openAiRequest, variationCount: 4 },
    {
      fetch: async (_input, init) => {
        sent = JSON.parse(String(init?.body)) as Record<string, unknown>;
        return jsonResponse({
          data: [{ b64_json: png }, { b64_json: '' }, { b64_json: png }],
        });
      },
    },
  );

  assert.equal(sent?.n, 4);
  assert.equal(sent?.size, '1024x1024');
  assert.equal(sent?.response_format, undefined);
  assert.deepEqual(
    result.images.map((image) => [image.position, image.kind]),
    [
      [1, 'success'],
      [2, 'error'],
      [3, 'success'],
      [4, 'error'],
    ],
  );
});

test('OpenAI default WebP format matches returned bytes when provider omits metadata', async () => {
  const result = await openAiAdapter.run(
    'mock-key',
    { ...openAiRequest, outputFormat: undefined },
    {
      fetch: async () => jsonResponse({ data: [{ b64_json: webp }] }),
    },
  );

  assert.equal(result.images[0].kind, 'success');
  if (result.images[0].kind === 'success') {
    assert.equal(result.images[0].mediaType, 'image/webp');
    assert.equal(result.images[0].returnedFormat, 'webp');
  }
});

test('oversized, malformed and format-mismatched images become per-image errors', () => {
  const images = normalizeGeneratedImages(
    [
      { base64: png, mediaType: 'image/png' },
      {
        base64: 'x'.repeat(MAX_GENERATED_IMAGE_BASE64_LENGTH + 4),
        mediaType: 'image/png',
      },
      { base64: '%%%invalid', mediaType: 'image/png' },
      { base64: png, mediaType: 'image/webp' },
    ],
    createdAt,
  );

  assert.deepEqual(
    images.map((image) => image.kind),
    ['success', 'error', 'error', 'error'],
  );
  assert.equal(
    normalizeGeneratedImages(
      [{ base64: 'AAAA', mediaType: 'image/png' }],
      createdAt,
    )[0].kind,
    'error',
  );
});

test('batches and all image/error positions have unique IDs at the same timestamp', () => {
  const source = [{ base64: png, mediaType: 'image/png' }];
  const firstImages = normalizeGeneratedImages(source, createdAt);
  const secondImages = normalizeGeneratedImages(source, createdAt);
  assert.notEqual(firstImages[0].id, secondImages[0].id);
  const request = {
    ...openAiRequest,
    variationCount: 4,
  } as ImageOperationRequest;
  const first = createGenerationBatch(request, createdAt, firstImages);
  const second = createGenerationBatch(request, createdAt, secondImages);
  const failed = createFailedGenerationBatch(request, createdAt, 'Failure');

  assert.equal(new Set([first.id, second.id, failed.id]).size, 3);
  const allImages = [...first.images, ...second.images, ...failed.images];
  assert.equal(new Set(allImages.map((image) => image.id)).size, 12);

  for (const batch of [first, second, failed]) {
    assert.ok(
      batch.images.every((image) => image.id.startsWith(`${batch.id}-`)),
    );
  }
});

test('10,000 returned images remain bounded, with an explicit overflow warning', () => {
  const sourceImages = Array.from({ length: 10_000 }, () => ({
    base64: png,
    mediaType: 'image/png',
  }));
  const images = normalizeGeneratedImages(sourceImages, createdAt);
  const batch = createGenerationBatch(
    openAiRequest,
    createdAt,
    images,
    undefined,
    sourceImages.length,
  );

  assert.equal(images.length, 4);
  assert.equal(batch.images.length, 4);
  assert.match(batch.warnings?.[0] ?? '', /10000 images.*first 4/);
  assert.equal(
    createFailedGenerationBatch(
      {
        ...openAiRequest,
        variationCount: 200_000,
      } as unknown as ImageOperationRequest,
      createdAt,
      'error',
    ).images.length,
    4,
  );
});

test('unexpected additional valid images are retained and reported', async () => {
  const result = await openAiAdapter.run('mock-key', openAiRequest, {
    fetch: async () =>
      jsonResponse({ data: [{ b64_json: png }, { b64_json: png }] }),
  });

  assert.equal(result.images.length, 2);
  assert.match(result.warnings?.[0] ?? '', /All returned images are shown/);
});

test('OpenAI never retries network/5xx/empty/malformed responses', async () => {
  await Promise.all(
    ['network', 'server', 'empty', 'malformed'].map(async (failure) => {
      let calls = 0;
      await assert.rejects(
        openAiAdapter.run('mock-key', openAiRequest, {
          fetch: async () => {
            calls += 1;
            if (failure === 'network') throw new TypeError('Failed to fetch');
            if (failure === 'server')
              return jsonResponse(
                { error: { message: 'Server failure' } },
                503,
              );
            if (failure === 'empty') return jsonResponse({ data: [] });
            return new Response('{malformed', {
              headers: { 'Content-Type': 'application/json' },
            });
          },
        }),
      );
      assert.equal(calls, 1, failure);
    }),
  );
});

test('Google uses one SDK request and retains all bounded image results', async () => {
  let calls = 0;
  let sent: Record<string, unknown> | undefined;
  const result = await googleAdapter.run('mock-key', googleRequest, {
    fetch: async (_input, init) => {
      calls += 1;
      sent = JSON.parse(String(init?.body)) as Record<string, unknown>;
      return googleImageResponse([png, png]);
    },
  });

  assert.equal(calls, 1);
  assert.ok(sent?.generationConfig);
  assert.equal(result.images.length, 2);
  assert.ok(result.images.every((image) => image.kind === 'success'));
  assert.match(result.warnings?.[0] ?? '', /instead of 1/);
});

test('Google SDK does not retry ambiguous server, network or empty responses', async () => {
  await Promise.all(
    ['network', 'server', 'empty'].map(async (failure) => {
      let calls = 0;
      await assert.rejects(
        googleAdapter.run('mock-key', googleRequest, {
          fetch: async () => {
            calls += 1;
            if (failure === 'network') throw new TypeError('Failed to fetch');
            if (failure === 'server')
              return jsonResponse(
                {
                  error: {
                    message: 'Server failure',
                    code: 503,
                    status: 'UNAVAILABLE',
                  },
                },
                503,
              );
            return jsonResponse({
              candidates: [
                { content: { role: 'model', parts: [] }, finishReason: 'STOP' },
              ],
            });
          },
        }),
      );
      assert.equal(calls, 1, failure);
    }),
  );
});

test('explicit rate limits retry at most twice and then complete continuously', async () => {
  let calls = 0;
  const result = await openAiAdapter.run('mock-key', openAiRequest, {
    fetch: async () => {
      calls += 1;
      return calls < 3
        ? jsonResponse(
            { error: { message: 'Rate limit', code: 'rate_limit_exceeded' } },
            429,
            { 'Retry-After': '0' },
          )
        : jsonResponse({ data: [{ b64_json: png }] });
    },
  });

  assert.equal(calls, 3);
  assert.equal(result.images[0].kind, 'success');
});

test('rate limits without bounded server guidance and billing quotas are never retried', async () => {
  const fixtures: Array<{ headers: HeadersInit; code: string }> = [
    { headers: {}, code: 'rate_limit_exceeded' },
    { headers: { 'Retry-After': '120' }, code: 'rate_limit_exceeded' },
    { headers: { 'Retry-After': '0' }, code: 'insufficient_quota' },
    { headers: { 'Retry-After': '0' }, code: 'daily quota exceeded' },
  ];
  await Promise.all(
    fixtures.map(async (fixture) => {
      let calls = 0;
      await assert.rejects(
        openAiAdapter.run('mock-key', openAiRequest, {
          fetch: async () => {
            calls += 1;
            return jsonResponse(
              { error: { message: fixture.code, code: fixture.code } },
              429,
              fixture.headers,
            );
          },
        }),
      );
      assert.equal(calls, 1);
    }),
  );
});

test('Google retries an explicit rate rejection only in the bounded transport', async () => {
  let calls = 0;
  const result = await googleAdapter.run('mock-key', googleRequest, {
    fetch: async () => {
      calls += 1;
      return calls === 1
        ? jsonResponse(
            {
              error: {
                code: 429,
                message: 'Rate limit',
                status: 'RESOURCE_EXHAUSTED',
              },
            },
            429,
            { 'Retry-After': '0' },
          )
        : googleImageResponse();
    },
  });
  assert.equal(calls, 2);
  assert.equal(result.images[0].kind, 'success');
});

test('quota/billing messages are preserved instead of suggesting a transient rate failure', () => {
  const error = Object.assign(new Error('Billing quota exhausted.'), {
    status: 429,
  });
  assert.equal(
    openAiAdapter.normalizeError(error).message,
    'Billing quota exhausted.',
  );
  assert.equal(
    googleAdapter.normalizeError(error).message,
    'Billing quota exhausted.',
  );
});

test('repeated rate limits stop after a finite number of requests', async () => {
  let calls = 0;
  await assert.rejects(
    openAiAdapter.run('mock-key', openAiRequest, {
      fetch: async () => {
        calls += 1;
        return jsonResponse({ error: { message: 'Rate limit' } }, 429, {
          'Retry-After': '0',
        });
      },
    }),
  );
  assert.equal(calls, 3);
});

test('aborted requests and cancellation during rate limit backoff send no new requests', async () => {
  const alreadyAborted = new AbortController();
  alreadyAborted.abort();
  let calls = 0;
  const fetchMock: typeof fetch = async () => {
    calls += 1;
    return googleImageResponse();
  };
  await assert.rejects(
    googleAdapter.run('mock-key', googleRequest, {
      fetch: fetchMock,
      signal: alreadyAborted.signal,
    }),
    { name: 'AbortError' },
  );
  assert.equal(calls, 0);

  const controller = new AbortController();
  const pending = openAiAdapter.run('mock-key', openAiRequest, {
    signal: controller.signal,
    fetch: async () => {
      calls += 1;
      queueMicrotask(() => controller.abort());
      return jsonResponse({ error: { message: 'Rate limit' } }, 429, {
        'Retry-After': '30',
      });
    },
  });
  await assert.rejects(pending, { name: 'AbortError' });
  assert.equal(calls, 1);
});

test('oversized response headers reject before allocating the payload and do not retry', async () => {
  let cancelled = false;
  let calls = 0;
  await assert.rejects(
    openAiAdapter.run('mock-key', openAiRequest, {
      fetch: async () => {
        calls += 1;
        return new Response(
          new ReadableStream({
            cancel() {
              cancelled = true;
            },
          }),
          {
            headers: {
              'Content-Length': String(MAX_GENERATION_RESPONSE_BYTES + 1),
            },
          },
        );
      },
    }),
    /memory limit/,
  );
  assert.equal(calls, 1);
  assert.equal(cancelled, true);
});

test('chunked responses enforce byte bounds even without Content-Length', async () => {
  let cancelled = false;
  const fetchBounded = createProviderFetch({
    fetch: async () =>
      new Response(
        new ReadableStream({
          pull(controller) {
            controller.enqueue(new Uint8Array(32 * 1024));
          },
          cancel() {
            cancelled = true;
          },
        }),
        { status: 503 },
      ),
  });
  const response = await fetchBounded('https://synthetic.invalid');
  await assert.rejects(response.text(), /memory limit/);
  assert.equal(cancelled, true);
});
