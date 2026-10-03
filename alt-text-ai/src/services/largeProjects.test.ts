import { buildClient, type Client } from '@datocms/cma-client-browser';
import type {
  ExecuteUploadsDropdownActionCtx,
  Upload,
} from 'datocms-plugin-sdk';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { AltTextProviderError } from '../providers/errors';
import { createAltTextProvider } from '../providers/factory';
import type { AltTextProvider } from '../providers/types';
import { runAltGenerationForUploads } from './altTextGeneration';

vi.mock('@datocms/cma-client-browser', () => ({
  buildClient: vi.fn(),
}));

vi.mock('../providers/factory', () => ({
  createAltTextProvider: vi.fn(),
}));

type CmaUpload = Awaited<ReturnType<Client['uploads']['find']>>;
type UploadUpdate = Parameters<Client['uploads']['update']>[1];

function selectedUpload(id: string): Upload {
  return {
    id,
    type: 'upload',
    attributes: { filename: `${id}.jpg` },
  } as Upload;
}

function cmaUpload(
  id: string,
  alts: Record<string, string | null> = {},
): CmaUpload {
  return {
    id,
    type: 'upload',
    filename: `${id}.jpg`,
    url: `https://example.imgix.net/${id}.jpg`,
    is_image: true,
    default_field_metadata: {
      alt: alts,
      title: { en: 'Original title' },
      custom_data: { en: { credit: 'Original credit' } },
      focal_point: { x: 0.2, y: 0.7 },
      poster_time: null,
    },
  } as unknown as CmaUpload;
}

function getUpload(store: Map<string, CmaUpload>, id: unknown): CmaUpload {
  const upload = store.get(String(id));
  if (!upload) {
    throw new Error(`Missing synthetic upload ${String(id)}`);
  }
  return upload;
}

// Reads return immutable snapshots: updates replace objects as the CMA does.
function applyUpdate(
  store: Map<string, CmaUpload>,
  id: unknown,
  update: UploadUpdate,
): CmaUpload {
  const before = getUpload(store, id);
  const after = {
    ...before,
    default_field_metadata: {
      ...before.default_field_metadata,
      alt: {
        ...before.default_field_metadata.alt,
        ...update.default_field_metadata?.alt,
      },
    },
  };
  store.set(before.id, after);
  return after;
}

function uploadContext(locales: string[]) {
  const alert = vi.fn(async (_message: string) => {});
  const notice = vi.fn(async (_message: string) => {});
  const customToast = vi.fn(async (_toast: unknown) => null);
  const openConfirm = vi.fn(async (_options: unknown) => true);
  const ctx = {
    currentUserAccessToken: 'synthetic-dato-token',
    environment: 'synthetic-scale-tests',
    cmaBaseUrl: 'https://cma.example.com',
    plugin: {
      attributes: {
        parameters: {
          provider: 'openai',
          openAiApiKey: 'synthetic-provider-key',
          openAiModel: 'synthetic-vision-model',
        },
      },
    },
    site: { id: 'synthetic-site', attributes: { locales } },
    alert,
    notice,
    customToast,
    openConfirm,
  } as unknown as ExecuteUploadsDropdownActionCtx;
  return { ctx, alert, notice, customToast, openConfirm };
}

function mockDependencies(
  find: Client['uploads']['find'],
  update: Client['uploads']['update'],
  generate: AltTextProvider['generate'],
) {
  vi.mocked(buildClient).mockReturnValue({
    uploads: { find, update },
  } as unknown as Client);
  vi.mocked(createAltTextProvider).mockReturnValue({
    id: 'openai',
    generate,
  });
}

function generatedAlt(id: string, locale: string): string {
  return `Synthetic alt for ${id} in ${locale}`;
}

function scaleFixture(assetCount: number, localeCount: number) {
  const locales = Array.from(
    { length: localeCount },
    (_, index) => `l-${index}`,
  );
  const selection = Array.from({ length: assetCount }, (_, index) =>
    selectedUpload(`upload-${index}`),
  );
  const store = new Map(selection.map(({ id }) => [id, cmaUpload(id)]));
  const loaded = new Set<string>();
  const pending = new Map<string, Set<string>>();
  const stats = {
    reads: 0,
    generated: 0,
    writes: 0,
    saved: 0,
    active: 0,
    maximumActive: 0,
    pending: 0,
    maximumPending: 0,
    maximumInitialReadsBetweenSaves: 0,
    initialReadsBetweenSaves: 0,
    firstSaveLoaded: 0,
    largestSave: 0,
    batchStartedBeforePreviousSaved: false,
  };
  // Functional mocks avoid retaining hundreds of thousands of call arguments.
  const find: Client['uploads']['find'] = async (id) => {
    stats.reads += 1;
    const upload = getUpload(store, id);
    if (!loaded.has(upload.id)) {
      const index = Number(upload.id.replace('upload-', ''));
      if (index > 0 && index % 50 === 0) {
        for (let previous = index - 50; previous < index; previous += 1) {
          const previousUpload = getUpload(store, `upload-${previous}`);
          if (
            locales.some(
              (locale) =>
                previousUpload.default_field_metadata.alt[locale] !==
                generatedAlt(previousUpload.id, locale),
            )
          ) {
            stats.batchStartedBeforePreviousSaved = true;
          }
        }
      }
      loaded.add(upload.id);
      stats.initialReadsBetweenSaves += 1;
      stats.maximumInitialReadsBetweenSaves = Math.max(
        stats.maximumInitialReadsBetweenSaves,
        stats.initialReadsBetweenSaves,
      );
    }
    return upload;
  };
  const update: Client['uploads']['update'] = async (id, body) => {
    const before = getUpload(store, id);
    const after = applyUpdate(store, id, body);
    let savedNow = 0;
    for (const locale of locales) {
      if (
        after.default_field_metadata.alt[locale] !==
          before.default_field_metadata.alt[locale] &&
        after.default_field_metadata.alt[locale] ===
          generatedAlt(after.id, locale)
      ) {
        savedNow += 1;
        if (pending.get(after.id)?.delete(locale)) {
          stats.pending -= 1;
        }
      }
    }
    if (pending.get(after.id)?.size === 0) {
      pending.delete(after.id);
    }
    if (stats.writes === 0) {
      stats.firstSaveLoaded = loaded.size;
    }
    stats.writes += 1;
    stats.saved += savedNow;
    stats.largestSave = Math.max(stats.largestSave, savedNow);
    stats.initialReadsBetweenSaves = 0;
    return after;
  };
  const generate: AltTextProvider['generate'] = async ({ assetId, locale }) => {
    stats.active += 1;
    stats.maximumActive = Math.max(stats.maximumActive, stats.active);
    await Promise.resolve();
    stats.active -= 1;
    stats.generated += 1;
    const assetPending = pending.get(assetId) ?? new Set<string>();
    assetPending.add(locale);
    pending.set(assetId, assetPending);
    stats.pending += 1;
    stats.maximumPending = Math.max(stats.maximumPending, stats.pending);
    return generatedAlt(assetId, locale);
  };
  return { locales, selection, store, stats, find, update, generate };
}

function deferred<T>() {
  let resolve: ((value: T) => void) | undefined;
  let reject: ((reason: unknown) => void) | undefined;
  const promise = new Promise<T>((resolvePromise, rejectPromise) => {
    resolve = resolvePromise;
    reject = rejectPromise;
  });
  return {
    promise,
    resolve(value: T) {
      if (!resolve) throw new Error('Missing deferred resolver');
      resolve(value);
    },
    reject(reason: unknown) {
      if (!reject) throw new Error('Missing deferred rejection handler');
      reject(reason);
    },
  };
}

async function waitFor(condition: () => boolean): Promise<void> {
  for (let step = 0; step < 200 && !condition(); step += 1) {
    // biome-ignore lint/performance/noAwaitInLoops: Deterministic microtask turns wait for the mocked worker state without real delays.
    await Promise.resolve();
  }
  expect(condition()).toBe(true);
}

function useImmediateSuccessTimers(): void {
  // These provider/CMA mocks resolve immediately. Avoid creating thousands of native
  // 60-second watchdogs; timeout behavior is covered by the smaller timeout tests.
  // Plain functions also avoid retaining a mock call record for every watchdog.
  vi.stubGlobal('setTimeout', () => 0);
  vi.stubGlobal('clearTimeout', () => {});
  vi.stubGlobal('setInterval', () => 0);
  vi.stubGlobal('clearInterval', () => {});
}

beforeEach(() => {
  vi.clearAllMocks();
});

afterEach(() => {
  vi.unstubAllGlobals();
});

describe('continuous generation for large selections', () => {
  it.each([
    3, 20,
  ])('processes 10,000 uploads across %i locales with bounded work and saves', async (localeCount) => {
    useImmediateSuccessTimers();
    const fixture = scaleFixture(10_000, localeCount);
    mockDependencies(fixture.find, fixture.update, fixture.generate);
    const { ctx, alert, notice } = uploadContext(fixture.locales);

    await runAltGenerationForUploads(ctx, fixture.selection, 'missing-only');

    expect(alert).not.toHaveBeenCalled();
    expect(fixture.stats.generated).toBe(10_000 * localeCount);
    expect(fixture.stats.saved).toBe(10_000 * localeCount);
    expect(fixture.stats.writes).toBe(10_000 * Math.ceil(localeCount / 10));
    expect(fixture.stats.maximumActive).toBe(3);
    expect(fixture.stats.firstSaveLoaded).toBe(50);
    expect(fixture.stats.maximumInitialReadsBetweenSaves).toBeLessThanOrEqual(
      50,
    );
    expect(fixture.stats.batchStartedBeforePreviousSaved).toBe(false);
    expect(fixture.stats.largestSave).toBe(Math.min(10, localeCount));
    expect(fixture.stats.maximumPending).toBeLessThanOrEqual(30);
    expect(fixture.stats.pending).toBe(0);
    expect(notice).toHaveBeenCalledWith(
      `${10_000 * localeCount} alt texts generated for 10000 assets with OpenAI.`,
    );
    for (const id of ['upload-0', 'upload-4999', 'upload-9999']) {
      expect(getUpload(fixture.store, id).default_field_metadata.alt).toEqual(
        Object.fromEntries(
          fixture.locales.map((locale) => [locale, generatedAlt(id, locale)]),
        ),
      );
    }
  }, 60_000);

  it('saves every ten locales while bounding pending alts across three active uploads', async () => {
    const fixture = scaleFixture(3, 20);
    mockDependencies(fixture.find, fixture.update, fixture.generate);
    const { ctx, alert, notice } = uploadContext(fixture.locales);

    await runAltGenerationForUploads(ctx, fixture.selection, 'missing-only');

    expect(alert).not.toHaveBeenCalled();
    expect(fixture.stats.generated).toBe(60);
    expect(fixture.stats.saved).toBe(60);
    expect(fixture.stats.writes).toBe(6);
    expect(fixture.stats.largestSave).toBe(10);
    expect(fixture.stats.maximumPending).toBeLessThanOrEqual(30);
    expect(fixture.stats.maximumActive).toBe(3);
    expect(fixture.stats.pending).toBe(0);
    expect(notice).toHaveBeenCalledWith(
      '60 alt texts generated for 3 assets with OpenAI.',
    );
  });

  it('deduplicates selected upload IDs and repeated locale identifiers', async () => {
    const fixture = scaleFixture(2, 3);
    mockDependencies(fixture.find, fixture.update, fixture.generate);
    const { ctx, alert, notice } = uploadContext([
      ...fixture.locales,
      ...fixture.locales,
    ]);

    await runAltGenerationForUploads(
      ctx,
      [...fixture.selection, ...fixture.selection, fixture.selection[0]],
      'missing-only',
    );

    expect(alert).not.toHaveBeenCalled();
    expect(fixture.stats.generated).toBe(6);
    expect(fixture.stats.writes).toBe(2);
    expect(fixture.stats.reads).toBe(4);
    expect(notice).toHaveBeenCalledWith(
      '6 alt texts generated for 2 assets with OpenAI.',
    );
  });

  it('keeps successful locale and asset saves after isolated load, generation and save failures', async () => {
    const store = new Map(
      ['load-failed', 'provider-failed', 'save-failed', 'success'].map((id) => [
        id,
        cmaUpload(id),
      ]),
    );
    const find: Client['uploads']['find'] = async (id) => {
      if (id === 'load-failed') throw new Error('synthetic load failure');
      return getUpload(store, id);
    };
    const update: Client['uploads']['update'] = async (id, body) => {
      if (id === 'save-failed') throw new Error('synthetic save failure');
      return applyUpdate(store, id, body);
    };
    const generate: AltTextProvider['generate'] = async ({
      assetId,
      locale,
    }) => {
      if (assetId === 'provider-failed' && locale === 'en') {
        throw new Error('synthetic generation failure');
      }
      return generatedAlt(assetId, locale);
    };
    mockDependencies(find, update, generate);
    const { ctx, alert, notice } = uploadContext(['en', 'it']);

    await runAltGenerationForUploads(
      ctx,
      Array.from(store.keys(), selectedUpload),
      'missing-only',
    );

    expect(notice).toHaveBeenCalledWith(
      '3 alt texts generated for 2 assets with OpenAI.',
    );
    expect(
      getUpload(store, 'provider-failed').default_field_metadata.alt,
    ).toEqual({
      it: generatedAlt('provider-failed', 'it'),
    });
    expect(getUpload(store, 'success').default_field_metadata.alt).toEqual({
      en: generatedAlt('success', 'en'),
      it: generatedAlt('success', 'it'),
    });
    expect(getUpload(store, 'save-failed').default_field_metadata.alt).toEqual(
      {},
    );
    expect(alert).toHaveBeenCalledOnce();
    const summary = alert.mock.calls[0][0];
    expect(summary).toContain(
      'load-failed.jpg: Could not load asset: synthetic load failure',
    );
    expect(summary).toContain(
      'provider-failed.jpg (en): synthetic generation failure',
    );
    expect(summary).toContain(
      'save-failed.jpg: Could not save generated alt text: synthetic save failure',
    );
  });

  it('bounds the displayed diagnostics while counting every failed locale', async () => {
    useImmediateSuccessTimers();
    const fixture = scaleFixture(1_000, 20);
    let generated = 0;
    const generate: AltTextProvider['generate'] = async () => {
      generated += 1;
      throw new Error('synthetic provider failure');
    };
    mockDependencies(fixture.find, fixture.update, generate);
    const { ctx, alert } = uploadContext(fixture.locales);

    await runAltGenerationForUploads(ctx, fixture.selection, 'missing-only');

    expect(generated).toBe(20_000);
    expect(fixture.stats.writes).toBe(0);
    expect(alert).toHaveBeenCalledOnce();
    const lines = alert.mock.calls[0][0].split('\n');
    expect(lines).toHaveLength(10);
    expect(lines[0]).toBe('Alt text generation errors:');
    expect(
      lines
        .slice(1, 9)
        .every((line) => line.includes('synthetic provider failure')),
    ).toBe(true);
    expect(lines[9]).toBe('…and 19992 more error(s).');
  }, 30_000);
});

describe('safe large-selection metadata writes', () => {
  it('preserves newer alt edits even in overwrite mode and retains unrelated latest metadata', async () => {
    const initial = cmaUpload('single', {
      en: 'Old English',
      it: 'Old Italian',
    });
    const store = new Map([[initial.id, initial]]);
    const find: Client['uploads']['find'] = async (id) => getUpload(store, id);
    const update = vi.fn<Client['uploads']['update']>(async (id, body) =>
      applyUpdate(store, id, body),
    );
    const generate: AltTextProvider['generate'] = async ({ locale }) => {
      if (locale === 'en') {
        store.set(initial.id, {
          ...initial,
          default_field_metadata: {
            ...initial.default_field_metadata,
            alt: { en: 'Latest manual English', it: 'Old Italian' },
            title: { en: 'Latest manual title' },
            custom_data: { en: { credit: 'Latest credit' } },
            focal_point: { x: 0.9, y: 0.1 },
          },
        });
      }
      return generatedAlt(initial.id, locale);
    };
    mockDependencies(find, update, generate);
    const { ctx, alert, notice } = uploadContext(['en', 'it']);

    await runAltGenerationForUploads(
      ctx,
      [selectedUpload(initial.id)],
      'overwrite-all',
    );

    expect(alert).not.toHaveBeenCalled();
    expect(update).toHaveBeenCalledOnce();
    expect(update).toHaveBeenCalledWith('single', {
      default_field_metadata: {
        alt: {
          it: generatedAlt('single', 'it'),
        },
      },
    });
    expect(getUpload(store, 'single').default_field_metadata).toMatchObject({
      title: { en: 'Latest manual title' },
      custom_data: { en: { credit: 'Latest credit' } },
      focal_point: { x: 0.9, y: 0.1 },
    });
    expect(notice).toHaveBeenCalledWith(
      '1 alt text generated for 1 asset with OpenAI.',
    );
  });

  it('never saves generated text for an image whose URL changed during generation', async () => {
    const initial = cmaUpload('single');
    const store = new Map([[initial.id, initial]]);
    const find: Client['uploads']['find'] = async (id) => getUpload(store, id);
    const update = vi.fn<Client['uploads']['update']>(async (id, body) =>
      applyUpdate(store, id, body),
    );
    const generate: AltTextProvider['generate'] = async () => {
      store.set(initial.id, {
        ...initial,
        url: 'https://example.imgix.net/new-image.jpg',
      });
      return 'Stale generated description';
    };
    mockDependencies(find, update, generate);
    const { ctx, alert } = uploadContext(['en']);

    await runAltGenerationForUploads(
      ctx,
      [selectedUpload(initial.id)],
      'missing-only',
    );

    expect(update).not.toHaveBeenCalled();
    expect(getUpload(store, initial.id).default_field_metadata.alt).toEqual({});
    expect(alert).toHaveBeenCalledWith(
      'Alt text generation errors:\nsingle.jpg: Could not save generated alt text: The asset image changed while alt text was being generated.',
    );
  });

  it('reconciles a timed-out write that was saved without replaying the metadata mutation', async () => {
    const initial = cmaUpload('single');
    const store = new Map([[initial.id, initial]]);
    let reads = 0;
    const find: Client['uploads']['find'] = async (id) => {
      reads += 1;
      return getUpload(store, id);
    };
    const update = vi.fn<Client['uploads']['update']>(async (id, body) => {
      applyUpdate(store, id, body);
      throw new Error('synthetic timeout after the server saved');
    });
    const generate: AltTextProvider['generate'] = async ({ assetId, locale }) =>
      generatedAlt(assetId, locale);
    mockDependencies(find, update, generate);
    const { ctx, alert, notice } = uploadContext(['en', 'it']);

    await runAltGenerationForUploads(
      ctx,
      [selectedUpload(initial.id)],
      'missing-only',
    );

    expect(reads).toBe(3);
    expect(update).toHaveBeenCalledOnce();
    expect(alert).not.toHaveBeenCalled();
    expect(notice).toHaveBeenCalledWith(
      '2 alt texts generated for 1 asset with OpenAI.',
    );
    expect(getUpload(store, initial.id).default_field_metadata.alt).toEqual({
      en: generatedAlt(initial.id, 'en'),
      it: generatedAlt(initial.id, 'it'),
    });
  });

  it.each([
    'auth',
    'quota',
  ] as const)('stops scheduling new work on a provider %s failure and saves already active successes', async (code) => {
    const fixture = scaleFixture(100, 20);
    const failedRequest = deferred<string>();
    const successfulRequests = deferred<string>();
    let calls = 0;
    const generate: AltTextProvider['generate'] = async ({ assetId }) => {
      calls += 1;
      return assetId === 'upload-0'
        ? failedRequest.promise
        : successfulRequests.promise;
    };
    mockDependencies(fixture.find, fixture.update, generate);
    const { ctx, alert, notice } = uploadContext(fixture.locales);

    const operation = runAltGenerationForUploads(
      ctx,
      fixture.selection,
      'missing-only',
    );
    await waitFor(() => calls === 3);
    failedRequest.reject(
      new AltTextProviderError('openai', code, 'synthetic fatal failure'),
    );
    // Let the fatal result reach the shared stop flag before in-flight successes finish.
    // biome-ignore lint/performance/noAwaitInLoops: Flush rejection microtasks before resolving the other active requests.
    for (let step = 0; step < 20; step += 1) await Promise.resolve();
    successfulRequests.resolve('Already active successful alt');
    await operation;

    expect(calls).toBe(3);
    expect(fixture.stats.firstSaveLoaded).toBe(50);
    expect(fixture.stats.writes).toBe(2);
    expect(
      getUpload(fixture.store, 'upload-1').default_field_metadata.alt,
    ).toEqual({
      'l-0': 'Already active successful alt',
    });
    expect(
      getUpload(fixture.store, 'upload-2').default_field_metadata.alt,
    ).toEqual({
      'l-0': 'Already active successful alt',
    });
    expect(
      getUpload(fixture.store, 'upload-50').default_field_metadata.alt,
    ).toEqual({});
    expect(notice).toHaveBeenCalledWith(
      '2 alt texts generated for 2 assets with OpenAI. Generation stopped after a service error; 50 of 100 assets checked, 3 locale versions processed. Saved metadata was kept.',
    );
    expect(alert).toHaveBeenCalledWith(
      'Alt text generation errors:\nupload-0.jpg (l-0): OpenAI: synthetic fatal failure',
    );
  });

  it('rejects a simultaneous duplicate run and releases the guard when the first run finishes', async () => {
    const fixture = scaleFixture(1, 2);
    const gate = deferred<string>();
    let calls = 0;
    const generate: AltTextProvider['generate'] = async () => {
      calls += 1;
      return gate.promise;
    };
    mockDependencies(fixture.find, fixture.update, generate);
    const { ctx, alert, notice } = uploadContext(fixture.locales);
    const firstRun = runAltGenerationForUploads(
      ctx,
      fixture.selection,
      'missing-only',
    );
    await waitFor(() => calls === 1);

    await runAltGenerationForUploads(ctx, fixture.selection, 'missing-only');

    expect(calls).toBe(1);
    expect(notice).toHaveBeenCalledWith(
      'Alt text generation is already running for selected assets.',
    );
    gate.resolve('Synthetic successful alt');
    await firstRun;
    fixture.store.set('upload-0', cmaUpload('upload-0'));
    await runAltGenerationForUploads(ctx, fixture.selection, 'missing-only');

    expect(calls).toBe(4);
    expect(alert).not.toHaveBeenCalled();
    expect(
      notice.mock.calls.filter(
        ([message]) =>
          message ===
          'Alt text generation is already running for selected assets.',
      ),
    ).toHaveLength(1);
  });
});
