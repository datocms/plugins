import assert from 'node:assert/strict';
import { test } from 'node:test';
import { abortable } from '../src/utils/abortable';
import { buildUpload, selectImages } from '../src/utils/assetSelection';
import {
  estimateBatchBytes,
  getSelectedImages,
  imageBrowserReducer,
  initialImageBrowserState,
  MAX_HISTORY_BYTES,
} from '../src/utils/imageBrowserState';
import type { NormalizedGenerationBatch } from '../src/utils/imageService/types';

function batch(id: string): NormalizedGenerationBatch {
  return {
    id,
    createdAt: '2026-10-02T12:00:00.000Z',
    request: {
      provider: 'openai',
      model: 'gpt-image-1',
      prompt: 'Prompt',
      aspectRatio: '1:1',
      imageSize: 'native',
      variationCount: 4,
      outputFormat: 'png',
    },
    images: Array.from({ length: 4 }, (_, index) => ({
      kind: 'success' as const,
      id: `${id}-${index}`,
      position: index + 1,
      base64: 'aGVsbG8=',
      previewSrc: 'data:image/png;base64,aGVsbG8=',
      mediaType: 'image/png',
    })),
  };
}

test('memory retention removes whole old batches and their selection IDs', () => {
  const old = batch('old');
  const latest = batch('latest');
  // Virtual lengths exercise the byte boundary without allocating hundreds of MiB.
  for (const request of [old, latest]) {
    for (const image of request.images) {
      if (image.kind !== 'success') continue;
      image.base64 = { length: MAX_HISTORY_BYTES / 24 } as unknown as string;
      image.previewSrc = {
        length: MAX_HISTORY_BYTES / 24,
      } as unknown as string;
    }
  }
  assert.ok(estimateBatchBytes(latest) < MAX_HISTORY_BYTES);
  let state = imageBrowserReducer(initialImageBrowserState, {
    type: 'add',
    batch: old,
  });
  state = imageBrowserReducer(state, { type: 'toggle', id: 'old-0' });
  state = imageBrowserReducer(state, { type: 'sent', ids: ['old-1'] });
  state = imageBrowserReducer(state, { type: 'add', batch: latest });
  assert.deepEqual(
    state.requests.map((request) => request.id),
    ['latest'],
  );
  assert.equal(state.selectedIds.size, 0);
  assert.equal(state.sentIds.size, 0);
  assert.equal(state.evictedSelectedCount, 1);
});

test('failed previews and sent images cannot remain in the import selection', () => {
  let state = imageBrowserReducer(initialImageBrowserState, {
    type: 'add',
    batch: batch('a'),
  });
  state = imageBrowserReducer(state, { type: 'toggle', id: 'a-0' });
  state = imageBrowserReducer(state, { type: 'unavailable', id: 'a-0' });
  assert.equal(getSelectedImages(state).length, 0);
  state = imageBrowserReducer(state, { type: 'sent', ids: ['a-1'] });
  state = imageBrowserReducer(state, { type: 'toggle', id: 'a-1' });
  assert.equal(getSelectedImages(state).length, 0);
  state = imageBrowserReducer(state, { type: 'rejected', id: 'a-1' });
  assert.equal(getSelectedImages(state).length, 1);
});

test('all 20 handoffs dispatch synchronously, dedupe double clicks, and preserve partial failures', () => {
  let state = initialImageBrowserState;
  for (let index = 0; index < 5; index++) {
    const next = batch(`${index}`);
    state = imageBrowserReducer(state, { type: 'add', batch: next });
    for (const image of next.images)
      state = imageBrowserReducer(state, { type: 'toggle', id: image.id });
  }
  let calls = 0;
  const sentIds = new Set<string>();
  const context = {
    select() {
      calls++;
      if (calls === 3) throw new Error('Mock handoff failure');
    },
  };
  const selected = getSelectedImages(state);
  const first = selectImages(context, ['en'], selected, sentIds, () => {});
  assert.equal(calls, 20);
  assert.equal(first.sent.length, 19);
  assert.equal(first.failed.length, 1);
  state = imageBrowserReducer(state, { type: 'sent', ids: first.sent });
  assert.equal(getSelectedImages(state).length, 1);
  const second = selectImages(context, ['en'], selected, sentIds, () => {});
  assert.equal(calls, 21);
  assert.equal(second.sent.length, 1);
});

test('a runtime bridge rejection is observed without replaying the upload', async () => {
  let state = imageBrowserReducer(initialImageBrowserState, {
    type: 'add',
    batch: batch('a'),
  });
  state = imageBrowserReducer(state, { type: 'toggle', id: 'a-0' });
  const sentIds = new Set<string>();
  const rejected: string[] = [];
  let calls = 0;
  selectImages(
    {
      select: () => {
        calls++;
        return Promise.reject(new Error('Bridge rejected'));
      },
    },
    ['en'],
    getSelectedImages(state),
    sentIds,
    (id) => rejected.push(id),
  );
  await Promise.resolve();
  assert.equal(calls, 1);
  assert.deepEqual(rejected, ['a-0']);
  assert.equal(sentIds.size, 0);
});

test('upload preserves metadata across locales and current field-keyed SDK shape', () => {
  const request = batch('a');
  const image = request.images[0];
  if (image.kind !== 'success') throw new Error('Invalid fixture');
  const locales = ['locale-0', 'locale-1', 'locale-2', '__proto__'];
  const upload = buildUpload(locales, { request, image });
  assert.deepEqual(Object.keys(upload.default_field_metadata ?? {}), ['alt']);
  assert.equal(Object.keys(upload.default_field_metadata?.alt ?? {}).length, 4);
  assert.equal(upload.default_field_metadata?.alt?.['locale-2'], 'Prompt');
  assert.equal(upload.default_field_metadata?.alt?.__proto__, 'Prompt');
  assert.deepEqual(upload.resource, {
    base64: image.previewSrc,
    filename: 'image-prompt-20261002-120000-1.png',
  });
});

test('cancellation settles promptly even if the provider ignores AbortSignal', async () => {
  const controller = new AbortController();
  const pending = abortable(new Promise<never>(() => {}), controller.signal);
  controller.abort();
  await assert.rejects(pending, { name: 'AbortError' });
});

test('late provider rejection after cancellation is handled', async () => {
  const controller = new AbortController();
  let rejectProvider: (error: Error) => void = () => {};
  const pending = abortable(
    new Promise<never>((_resolve, reject) => {
      rejectProvider = reject;
    }),
    controller.signal,
  );
  controller.abort();
  await assert.rejects(pending, { name: 'AbortError' });
  rejectProvider(new Error('Late network failure'));
  await Promise.resolve();
});
