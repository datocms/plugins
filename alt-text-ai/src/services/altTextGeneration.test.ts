import { buildClient, type Client } from '@datocms/cma-client-browser';
import type {
  ExecuteFieldDropdownActionCtx,
  FileFieldValue,
  FieldDropdownActionsCtx,
  Item,
} from 'datocms-plugin-sdk';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { DEFAULT_ALT_TEXT_PROMPT } from '../config';
import { createAltTextProvider } from '../providers/factory';
import type { AltTextProvider } from '../providers/types';
import { observeFieldContext } from './fieldContext';
import { AltTextProviderError } from '../providers/errors';
import {
  hasGeneratableFieldValue,
  isFileFieldValue,
  mapSettledWithConcurrency,
  runAltGenerationForField,
  shouldProcessAsset,
  transformImageUrl,
} from './altTextGeneration';

vi.mock('@datocms/cma-client-browser', () => ({
  buildClient: vi.fn(),
}));

vi.mock('../providers/factory', () => ({
  createAltTextProvider: vi.fn(),
}));

function asset(uploadId: string, alt: string | null = null): FileFieldValue {
  return {
    upload_id: uploadId,
    alt,
    title: null,
    focal_point: null,
    custom_data: {},
  };
}

function fieldContext(
  value: FileFieldValue | FileFieldValue[],
  parameters: Record<string, unknown>,
  options: {
    fieldPath?: string;
    formValues?: Record<string, unknown>;
  } = {},
) {
  const alert = vi.fn(async (_message: string) => {});
  const notice = vi.fn(async (_message: string) => {});
  const customToast = vi.fn(async (_toast: unknown) => null);
  const setFieldValue = vi.fn(async (_path: string, _value: unknown) => {});
  const disableField = vi.fn(async (_path: string, _disabled: boolean) => {});

  const ctx = {
    currentUserAccessToken: 'dato-token',
    environment: 'sandbox',
    cmaBaseUrl: 'https://cma.example.com',
    plugin: { attributes: { parameters } },
    formValues: options.formValues ?? { image: value },
    fieldPath: options.fieldPath ?? 'image',
    locale: 'it',
    disabled: false,
    alert,
    notice,
    customToast,
    setFieldValue,
    disableField,
  } as unknown as ExecuteFieldDropdownActionCtx;

  return { ctx, alert, notice, customToast, setFieldValue, disableField };
}

function mockGenerationDependencies(
  uploadsFind: Client['uploads']['find'],
  generate: AltTextProvider['generate'],
  providerId: AltTextProvider['id'] = 'alttext-ai',
) {
  const client = {
    uploads: { find: uploadsFind },
  } as unknown as Client;
  const provider: AltTextProvider = {
    id: providerId,
    generate,
  };

  vi.mocked(buildClient).mockReturnValue(client);
  vi.mocked(createAltTextProvider).mockReturnValue(provider);
}

beforeEach(() => {
  vi.clearAllMocks();
});

describe('asset field guards', () => {
  it('recognizes file and non-empty gallery values', () => {
    expect(isFileFieldValue(asset('one'))).toBe(true);
    expect(hasGeneratableFieldValue(asset('one'))).toBe(true);
    expect(hasGeneratableFieldValue([asset('one'), asset('two')])).toBe(true);
    expect(hasGeneratableFieldValue([])).toBe(false);
    expect(hasGeneratableFieldValue(null)).toBe(false);
  });

  it('only skips meaningful existing alt text in missing-only mode', () => {
    expect(shouldProcessAsset(asset('one', null), 'missing-only')).toBe(true);
    expect(shouldProcessAsset(asset('one', '   '), 'missing-only')).toBe(true);
    expect(shouldProcessAsset(asset('one', 'Existing'), 'missing-only')).toBe(
      false,
    );
    expect(shouldProcessAsset(asset('one', 'Existing'), 'overwrite-all')).toBe(
      true,
    );
  });
});

describe('transformImageUrl', () => {
  it('preserves existing parameters while bounding the image payload', () => {
    const result = new URL(
      transformImageUrl('https://example.imgix.net/image.png?token=signed'),
    );

    expect(result.searchParams.get('token')).toBe('signed');
    expect(result.searchParams.get('fit')).toBe('max');
    expect(result.searchParams.get('h')).toBe('1024');
    expect(result.searchParams.get('fm')).toBe('jpg');
    expect(result.searchParams.get('q')).toBe('80');
    expect(result.searchParams.get('w')).toBe('1024');
  });
});

describe('runAltGenerationForField', () => {
  it('does not take ownership of an already disabled field', async () => {
    const { ctx, alert, notice, customToast, setFieldValue, disableField } =
      fieldContext(asset('upload-one'), { apiKey: 'legacy-key' });
    ctx.disabled = true;

    await runAltGenerationForField(ctx, 'missing-only');

    expect(notice).toHaveBeenCalledWith('This field is read-only.');
    expect(alert).not.toHaveBeenCalled();
    expect(customToast).not.toHaveBeenCalled();
    expect(disableField).not.toHaveBeenCalled();
    expect(setFieldValue).not.toHaveBeenCalled();
    expect(buildClient).not.toHaveBeenCalled();
    expect(createAltTextProvider).not.toHaveBeenCalled();
  });

  it('does not unlock a field when acquiring the lock fails', async () => {
    const { ctx, alert, disableField } = fieldContext(asset('upload-one'), {
      apiKey: 'legacy-key',
    });
    disableField.mockRejectedValueOnce(new Error('lock failed'));
    const consoleError = vi
      .spyOn(console, 'error')
      .mockImplementation(() => undefined);

    try {
      await runAltGenerationForField(ctx, 'missing-only');

      expect(disableField).toHaveBeenCalledOnce();
      expect(disableField).toHaveBeenCalledWith('image', true);
      expect(alert).toHaveBeenCalledWith(
        'Unexpected error while generating alt text: lock failed',
      );
      expect(buildClient).not.toHaveBeenCalled();
      expect(createAltTextProvider).not.toHaveBeenCalled();
    } finally {
      consoleError.mockRestore();
    }
  });

  it('does not show the generation warning when no alt needs generating', async () => {
    const uploadsFind = vi.fn<Client['uploads']['find']>();
    const generate = vi.fn<AltTextProvider['generate']>();
    mockGenerationDependencies(uploadsFind, generate);
    const { ctx, notice, customToast, setFieldValue, disableField } =
      fieldContext(asset('upload-one', 'Existing description'), {
        apiKey: 'legacy-key',
      });

    await runAltGenerationForField(ctx, 'missing-only');

    expect(notice).toHaveBeenCalledWith(
      'Alt text already exists for this asset.',
    );
    expect(customToast).not.toHaveBeenCalled();
    expect(uploadsFind).not.toHaveBeenCalled();
    expect(generate).not.toHaveBeenCalled();
    expect(setFieldValue).not.toHaveBeenCalled();
    expect(disableField.mock.calls).toEqual([
      ['image', true],
      ['image', false],
    ]);
  });

  it('generates a single-file alt using legacy AltText.ai settings', async () => {
    const currentAsset = asset('upload-one');
    const uploadsFind = vi.fn<Client['uploads']['find']>();
    uploadsFind.mockResolvedValue({
      is_image: true,
      url: 'https://example.imgix.net/photo.png?token=signed',
      filename: 'photo.png',
    } as Awaited<ReturnType<Client['uploads']['find']>>);
    const generate = vi.fn<AltTextProvider['generate']>();
    generate.mockResolvedValue('Una barca rossa sul lago');
    mockGenerationDependencies(uploadsFind, generate);
    const { ctx, notice, customToast, setFieldValue, disableField } =
      fieldContext(
        currentAsset,
        { apiKey: 'legacy-key' },
        {
          fieldPath: 'image.it',
          formValues: { image: { it: currentAsset } },
        },
      );

    await runAltGenerationForField(ctx, 'missing-only');

    expect(buildClient).toHaveBeenCalledWith({
      apiToken: 'dato-token',
      environment: 'sandbox',
      baseUrl: 'https://cma.example.com',
      autoRetry: false,
      requestTimeout: 125_000,
      fetchFn: expect.any(Function),
    });
    expect(createAltTextProvider).toHaveBeenCalledWith({
      provider: 'alttext-ai',
      apiKey: 'legacy-key',
    });
    expect(uploadsFind).toHaveBeenCalledWith('upload-one');
    expect(generate).toHaveBeenCalledOnce();

    const providerInput = generate.mock.calls[0][0];
    expect(providerInput).toMatchObject({
      assetId: 'upload-one',
      locale: 'it',
      filename: 'photo.png',
      promptTemplate: DEFAULT_ALT_TEXT_PROMPT,
    });
    const imageUrl = new URL(providerInput.imageUrl);
    expect(imageUrl.searchParams.get('token')).toBe('signed');
    expect(imageUrl.searchParams.get('fit')).toBe('max');
    expect(imageUrl.searchParams.get('h')).toBe('1024');
    expect(imageUrl.searchParams.get('w')).toBe('1024');

    expect(setFieldValue).toHaveBeenCalledWith('image.it', {
      ...currentAsset,
      alt: 'Una barca rossa sul lago',
    });
    expect(notice).toHaveBeenCalledWith('Alt text generated with AltText.ai.');
    expect(customToast).toHaveBeenCalledWith({
      type: 'warning',
      message: 'Generating alts, this can take some time…',
      dismissOnPageChange: true,
      dismissAfterTimeout: 5000,
    });
    expect(disableField.mock.calls).toEqual([
      ['image.it', true],
      ['image.it', false],
    ]);
  });

  it('only processes missing gallery alts and preserves failed entries', async () => {
    const existingAsset = asset('upload-existing', 'Existing description');
    const successfulAsset = asset('upload-success');
    const failedAsset = asset('upload-failed');
    const uploadsFind = vi.fn<Client['uploads']['find']>();
    uploadsFind.mockImplementation(
      async (uploadId) =>
        ({
          is_image: true,
          url: `https://example.imgix.net/${uploadId}.jpg`,
          filename: `${uploadId}.jpg`,
        }) as Awaited<ReturnType<Client['uploads']['find']>>,
    );
    const generate = vi.fn<AltTextProvider['generate']>();
    generate.mockImplementation(async ({ assetId }) => {
      if (assetId === 'upload-failed') {
        throw new Error('provider unavailable');
      }
      return 'Generated gallery description';
    });
    mockGenerationDependencies(uploadsFind, generate, 'openai');
    const { ctx, alert, notice, customToast, setFieldValue, disableField } =
      fieldContext([existingAsset, successfulAsset, failedAsset], {
        provider: 'openai',
        openAiApiKey: 'openai-key',
        openAiModel: 'gpt-vision-test',
        prompt: 'Describe {filename} in {locale}.',
      });

    await runAltGenerationForField(ctx, 'missing-only');

    expect(createAltTextProvider).toHaveBeenCalledWith({
      provider: 'openai',
      apiKey: 'openai-key',
      model: 'gpt-vision-test',
      maxOutputTokens: 1000,
    });
    expect(uploadsFind.mock.calls.map(([uploadId]) => uploadId)).toEqual([
      'upload-success',
      'upload-failed',
    ]);
    expect(generate.mock.calls.map(([input]) => input.assetId)).toEqual([
      'upload-success',
      'upload-failed',
    ]);
    expect(setFieldValue).toHaveBeenCalledWith('image', [
      existingAsset,
      { ...successfulAsset, alt: 'Generated gallery description' },
      failedAsset,
    ]);
    expect(notice).toHaveBeenCalledWith('1 alt text generated with OpenAI.');
    expect(customToast).toHaveBeenCalledOnce();
    expect(alert).toHaveBeenCalledWith(
      'Alt text generation errors:\nupload-failed: provider unavailable',
    );
    expect(disableField.mock.calls).toEqual([
      ['image', true],
      ['image', false],
    ]);
  });

  it('aborts stalled generation and releases the field lock', async () => {
    vi.useFakeTimers();
    try {
      const uploadsFind = vi.fn<Client['uploads']['find']>();
      uploadsFind.mockResolvedValue({
        is_image: true,
        url: 'https://example.imgix.net/photo.jpg',
        filename: 'photo.jpg',
      } as Awaited<ReturnType<Client['uploads']['find']>>);
      const generate = vi.fn<AltTextProvider['generate']>();
      generate.mockImplementation(() => new Promise<string>(() => undefined));
      mockGenerationDependencies(uploadsFind, generate);
      const { ctx, alert, disableField } = fieldContext(asset('upload-one'), {
        apiKey: 'legacy-key',
      });

      const generation = runAltGenerationForField(ctx, 'missing-only');
      await vi.advanceTimersByTimeAsync(0);
      expect(generate).toHaveBeenCalledOnce();

      await vi.advanceTimersByTimeAsync(365_000);
      await generation;

      expect(generate.mock.calls[0][0].signal?.aborted).toBe(true);
      expect(alert).toHaveBeenCalledWith(
        'Could not generate alt text: Alt text generation timed out after 365 seconds.',
      );
      expect(disableField.mock.calls).toEqual([
        ['image', true],
        ['image', false],
      ]);
    } finally {
      vi.useRealTimers();
    }
  });
});

describe('mapSettledWithConcurrency', () => {
  it('limits concurrency, preserves result order, and isolates failures', async () => {
    let active = 0;
    let maximumActive = 0;

    const results = await mapSettledWithConcurrency(
      [30, 10, 20, 5],
      2,
      async (delay, index) => {
        active += 1;
        maximumActive = Math.max(maximumActive, active);
        await new Promise((resolve) => setTimeout(resolve, delay));
        active -= 1;
        if (index === 2) {
          throw new Error('failed');
        }
        return index;
      },
    );

    expect(maximumActive).toBe(2);
    expect(results).toEqual([
      { status: 'fulfilled', value: 0 },
      { status: 'fulfilled', value: 1 },
      { status: 'rejected', reason: expect.any(Error) },
      { status: 'fulfilled', value: 3 },
    ]);
  });
});

describe('large and changing field values', () => {
  it('applies 10,000 gallery entries incrementally and generates repeated images once', async () => {
    const gallery = Array.from({ length: 10_000 }, (_, index) => ({
      ...asset(`image-${index % 10}`),
      title: `Title ${index}`,
      custom_data: { index: String(index), credit: 'Photographer' },
      focal_point: { x: 0.2, y: 0.8 },
    }));
    let requests = 0;
    let active = 0;
    let maximumActive = 0;
    const uploadsFind = vi.fn<Client['uploads']['find']>();
    uploadsFind.mockImplementation(
      async (id) =>
        ({
          id,
          is_image: true,
          url: `https://example.imgix.net/${id}.jpg`,
          filename: `${id}.jpg`,
        }) as Awaited<ReturnType<Client['uploads']['find']>>,
    );
    const generate = vi.fn<AltTextProvider['generate']>();
    generate.mockImplementation(async ({ assetId }) => {
      requests += 1;
      active += 1;
      maximumActive = Math.max(maximumActive, active);
      await Promise.resolve();
      active -= 1;
      return `Alt ${assetId}`;
    });
    mockGenerationDependencies(uploadsFind, generate, 'openai');
    const { ctx, notice, setFieldValue } = fieldContext(gallery, {
      provider: 'openai',
      openAiApiKey: 'mock-key',
      openAiModel: 'vision-model',
    });
    let firstWriteAt = 0;
    let finalValue: unknown;
    setFieldValue.mockImplementation(async (_path, value) => {
      firstWriteAt ||= requests;
      finalValue = value;
    });
    await runAltGenerationForField(ctx, 'missing-only');
    expect(maximumActive).toBe(3);
    expect(requests).toBe(10);
    expect(uploadsFind).toHaveBeenCalledTimes(10);
    expect(firstWriteAt).toBe(10);
    expect(setFieldValue).toHaveBeenCalledTimes(200);
    expect(finalValue).toEqual(
      gallery.map((entry) => ({ ...entry, alt: `Alt ${entry.upload_id}` })),
    );
    expect(notice).toHaveBeenCalledWith(
      '10000 alt texts generated with OpenAI.',
    );
    expect(gallery.every((entry) => entry.alt === null)).toBe(true);
  });

  it('merges current single-file metadata and preserves concurrent alt edits in overwrite mode', async () => {
    const current = asset('one', 'Original');
    const { ctx, notice, setFieldValue } = fieldContext(current, {
      apiKey: 'mock-key',
    });
    ctx.item = { id: 'saved-record' } as Item;
    const uploadsFind = vi.fn<Client['uploads']['find']>();
    uploadsFind.mockResolvedValue({
      id: 'one',
      is_image: true,
      url: 'https://example.imgix.net/one.jpg',
      filename: 'one.jpg',
    } as Awaited<ReturnType<Client['uploads']['find']>>);
    const generate = vi.fn<AltTextProvider['generate']>();
    generate.mockImplementation(async () => {
      observeFieldContext({
        ...ctx,
        formValues: {
          image: { ...current, alt: 'Editor changed it', title: 'New title' },
        },
      } as unknown as FieldDropdownActionsCtx);
      return 'Generated';
    });
    mockGenerationDependencies(uploadsFind, generate);
    await runAltGenerationForField(ctx, 'overwrite-all');
    expect(setFieldValue).not.toHaveBeenCalled();
    expect(notice).toHaveBeenCalledWith(
      'Newer field changes were preserved; no alt text was changed.',
    );
  });

  it('keeps current title, custom data and focal point when only the alt is generated', async () => {
    const current = asset('one');
    const latest = {
      ...current,
      title: 'New title',
      custom_data: { credit: 'Latest' },
      focal_point: { x: 0.1, y: 0.9 },
    };
    const { ctx, setFieldValue } = fieldContext(current, {
      apiKey: 'mock-key',
    });
    ctx.item = { id: 'saved-record' } as Item;
    const uploadsFind = vi.fn<Client['uploads']['find']>();
    uploadsFind.mockResolvedValue({
      id: 'one',
      is_image: true,
      url: 'https://example.imgix.net/one.jpg',
      filename: 'one.jpg',
    } as Awaited<ReturnType<Client['uploads']['find']>>);
    const generate = vi.fn<AltTextProvider['generate']>();
    generate.mockImplementation(async () => {
      observeFieldContext({
        ...ctx,
        formValues: { image: latest },
      } as unknown as FieldDropdownActionsCtx);
      return 'Generated';
    });
    mockGenerationDependencies(uploadsFind, generate);
    await runAltGenerationForField(ctx, 'missing-only');
    expect(setFieldValue).toHaveBeenCalledWith('image', {
      ...latest,
      alt: 'Generated',
    });
  });

  it('does not apply generated gallery alts after the gallery is reordered', async () => {
    const gallery = [asset('one'), asset('two')];
    const { ctx, alert, setFieldValue } = fieldContext(gallery, {
      apiKey: 'mock-key',
    });
    ctx.item = { id: 'saved-record' } as Item;
    const uploadsFind = vi.fn<Client['uploads']['find']>();
    uploadsFind.mockImplementation(
      async (id) =>
        ({
          id,
          is_image: true,
          url: `https://example.imgix.net/${id}.jpg`,
          filename: `${id}.jpg`,
        }) as Awaited<ReturnType<Client['uploads']['find']>>,
    );
    const generate = vi.fn<AltTextProvider['generate']>();
    generate.mockImplementation(async () => {
      observeFieldContext({
        ...ctx,
        formValues: { image: [...gallery].reverse() },
      } as unknown as FieldDropdownActionsCtx);
      return 'Generated';
    });
    mockGenerationDependencies(uploadsFind, generate);
    await runAltGenerationForField(ctx, 'missing-only');
    expect(setFieldValue).not.toHaveBeenCalled();
    expect(alert).toHaveBeenCalledWith(
      expect.stringContaining('gallery changed'),
    );
  });

  it('stops new gallery generation after a fatal provider failure', async () => {
    const gallery = Array.from({ length: 10_000 }, (_, index) =>
      asset(`image-${index}`),
    );
    const uploadsFind = vi.fn<Client['uploads']['find']>();
    uploadsFind.mockImplementation(
      async (id) =>
        ({
          id,
          is_image: true,
          url: `https://example.imgix.net/${id}.jpg`,
          filename: `${id}.jpg`,
        }) as Awaited<ReturnType<Client['uploads']['find']>>,
    );
    const generate = vi.fn<AltTextProvider['generate']>();
    generate.mockRejectedValue(
      new AltTextProviderError('openai', 'quota', 'Quota exceeded'),
    );
    mockGenerationDependencies(uploadsFind, generate, 'openai');
    const { ctx, notice, setFieldValue } = fieldContext(gallery, {
      provider: 'openai',
      openAiApiKey: 'mock-key',
      openAiModel: 'vision-model',
    });
    await runAltGenerationForField(ctx, 'missing-only');
    expect(generate.mock.calls.length).toBeLessThanOrEqual(3);
    expect(setFieldValue).not.toHaveBeenCalled();
    expect(notice).toHaveBeenCalledWith(
      expect.stringContaining('Generation stopped after a service error'),
    );
  });
});
