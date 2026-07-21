import { buildClient, type Client } from '@datocms/cma-client-browser';
import type {
  ExecuteFieldDropdownActionCtx,
  FileFieldValue,
} from 'datocms-plugin-sdk';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { DEFAULT_ALT_TEXT_PROMPT } from '../config';
import { createAltTextProvider } from '../providers/factory';
import type { AltTextProvider } from '../providers/types';
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

      await vi.advanceTimersByTimeAsync(60_000);
      await generation;

      expect(generate.mock.calls[0][0].signal?.aborted).toBe(true);
      expect(alert).toHaveBeenCalledWith(
        'Could not generate alt text: Alt text generation timed out after 60 seconds.',
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
