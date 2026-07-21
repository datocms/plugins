import { buildClient, type Client } from '@datocms/cma-client-browser';
import type {
  ExecuteUploadsDropdownActionCtx,
  Upload,
} from 'datocms-plugin-sdk';
import { beforeEach, describe, expect, it, vi } from 'vitest';
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

type LegacyUploadMetadata = Record<
  string,
  {
    alt: string | null;
    title: string | null;
    custom_data: Record<string, unknown>;
    focal_point: { x: number; y: number } | null;
  }
>;

function selectedUpload(id: string, filename = `${id}.jpg`): Upload {
  return {
    id,
    type: 'upload',
    attributes: { filename },
  } as Upload;
}

function cmaUpload(
  id: string,
  options: {
    alts?: Record<string, string | null>;
    titles?: Record<string, string | null>;
    customData?: Record<string, Record<string, unknown>>;
    focalPoint?: { x: number; y: number } | null;
    filename?: string;
    isImage?: boolean;
  } = {},
): CmaUpload {
  return {
    id,
    type: 'upload',
    filename: options.filename ?? `${id}.jpg`,
    url: `https://example.imgix.net/${id}.jpg?token=signed`,
    is_image: options.isImage ?? true,
    default_field_metadata: {
      alt: options.alts ?? {},
      title: options.titles ?? {},
      custom_data: options.customData ?? {},
      focal_point: options.focalPoint ?? null,
      poster_time: null,
    },
  } as CmaUpload;
}

function legacyCmaUpload(
  id: string,
  defaultFieldMetadata: LegacyUploadMetadata,
): CmaUpload {
  return {
    ...cmaUpload(id),
    default_field_metadata: defaultFieldMetadata,
  } as unknown as CmaUpload;
}

function requireUpload(
  uploadsById: Map<string, CmaUpload>,
  id: string | unknown,
): CmaUpload {
  const upload = uploadsById.get(String(id));
  if (!upload) {
    throw new Error(`Missing test upload ${String(id)}`);
  }
  return upload;
}

function uploadContext(
  parameters: Record<string, unknown> = {
    provider: 'openai',
    openAiApiKey: 'openai-key',
    openAiModel: 'vision-model',
  },
  locales = ['en', 'it'],
) {
  const alert = vi.fn(async (_message: string) => {});
  const notice = vi.fn(async (_message: string) => {});
  const customToast = vi.fn(async (_toast: unknown) => null);
  const openConfirm = vi.fn(async (_options: unknown) => true);

  const ctx = {
    currentUserAccessToken: 'dato-token',
    environment: 'sandbox',
    cmaBaseUrl: 'https://cma.example.com',
    plugin: { attributes: { parameters } },
    site: { attributes: { locales } },
    alert,
    notice,
    customToast,
    openConfirm,
  } as unknown as ExecuteUploadsDropdownActionCtx;

  return { ctx, alert, notice, customToast, openConfirm };
}

function mockDependencies(
  uploadsFind: Client['uploads']['find'],
  uploadsUpdate: Client['uploads']['update'],
  generate: AltTextProvider['generate'],
  providerId: AltTextProvider['id'] = 'openai',
) {
  vi.mocked(buildClient).mockReturnValue({
    uploads: { find: uploadsFind, update: uploadsUpdate },
  } as unknown as Client);
  vi.mocked(createAltTextProvider).mockReturnValue({
    id: providerId,
    generate,
  });
}

beforeEach(() => {
  vi.clearAllMocks();
});

describe('runAltGenerationForUploads', () => {
  it('generates missing localized alts for selected images and skips other files', async () => {
    const first = cmaUpload('first', {
      alts: { en: 'Existing description', it: null },
      titles: { en: 'Existing title', it: 'Titolo esistente' },
      customData: { en: { credit: 'A' }, it: { credit: 'B' } },
      focalPoint: { x: 0.2, y: 0.7 },
    });
    const second = cmaUpload('second', {
      alts: { en: null, it: '   ' },
    });
    const complete = cmaUpload('complete', {
      alts: { en: 'English', it: 'Italiano' },
    });
    const document = cmaUpload('document', {
      filename: 'document.pdf',
      isImage: false,
    });
    const uploadsById = new Map(
      [first, second, complete, document].map((upload) => [upload.id, upload]),
    );
    const uploadsFind = vi.fn<Client['uploads']['find']>();
    uploadsFind.mockImplementation(async (id) => {
      const upload = uploadsById.get(String(id));
      if (!upload) {
        throw new Error('not found');
      }
      return upload;
    });
    const uploadsUpdate = vi.fn<Client['uploads']['update']>();
    uploadsUpdate.mockImplementation(async (id) =>
      requireUpload(uploadsById, id),
    );
    const generate = vi.fn<AltTextProvider['generate']>();
    generate.mockImplementation(
      async ({ assetId, locale }) => `${assetId}-${locale}`,
    );
    mockDependencies(uploadsFind, uploadsUpdate, generate);
    const { ctx, notice, customToast, openConfirm } = uploadContext();

    await runAltGenerationForUploads(
      ctx,
      [
        selectedUpload('first'),
        selectedUpload('second'),
        selectedUpload('complete'),
        selectedUpload('document', 'document.pdf'),
      ],
      'missing-only',
    );

    expect(buildClient).toHaveBeenCalledWith({
      apiToken: 'dato-token',
      environment: 'sandbox',
      baseUrl: 'https://cma.example.com',
    });
    expect(createAltTextProvider).toHaveBeenCalledWith({
      provider: 'openai',
      apiKey: 'openai-key',
      model: 'vision-model',
      maxOutputTokens: 1000,
    });
    expect(
      generate.mock.calls.map(([input]) => [input.assetId, input.locale]),
    ).toEqual([
      ['first', 'it'],
      ['second', 'en'],
      ['second', 'it'],
    ]);
    expect(uploadsUpdate).toHaveBeenCalledTimes(2);
    expect(uploadsUpdate).toHaveBeenCalledWith('first', {
      default_field_metadata: {
        alt: { en: 'Existing description', it: 'first-it' },
      },
    });
    expect(uploadsUpdate).toHaveBeenCalledWith('second', {
      default_field_metadata: {
        alt: { en: 'second-en', it: 'second-it' },
      },
    });
    expect(notice).toHaveBeenCalledWith(
      '3 alt texts generated for 2 assets with OpenAI. 1 non-image asset skipped.',
    );
    expect(customToast).toHaveBeenCalledOnce();
    expect(customToast).toHaveBeenCalledWith({
      type: 'warning',
      message: 'Generating 3 alt texts for 2 assets across 2 locales…',
      dismissOnPageChange: true,
      dismissAfterTimeout: 5000,
    });
    expect(openConfirm).not.toHaveBeenCalled();
  });

  it('shows throttled aggregate progress without one toast per asset', async () => {
    const first = cmaUpload('first', { alts: { en: null, it: null } });
    const second = cmaUpload('second', { alts: { en: null, it: null } });
    const uploadsById = new Map(
      [first, second].map((upload) => [upload.id, upload]),
    );
    const uploadsFind = vi.fn<Client['uploads']['find']>();
    uploadsFind.mockImplementation(async (id) =>
      requireUpload(uploadsById, id),
    );
    const uploadsUpdate = vi.fn<Client['uploads']['update']>();
    uploadsUpdate.mockImplementation(async (id) =>
      requireUpload(uploadsById, id),
    );
    const generate = vi.fn<AltTextProvider['generate']>();
    generate.mockImplementation(
      async ({ assetId, locale }) => `${assetId}-${locale}`,
    );
    mockDependencies(uploadsFind, uploadsUpdate, generate);
    const { ctx, customToast } = uploadContext();
    const now = vi
      .spyOn(Date, 'now')
      .mockReturnValueOnce(0)
      .mockReturnValueOnce(1_000)
      .mockReturnValueOnce(6_500)
      .mockReturnValueOnce(7_000)
      .mockReturnValueOnce(7_500);

    try {
      await runAltGenerationForUploads(
        ctx,
        [selectedUpload('first'), selectedUpload('second')],
        'missing-only',
      );
    } finally {
      now.mockRestore();
    }

    expect(customToast).toHaveBeenCalledTimes(2);
    expect(customToast).toHaveBeenNthCalledWith(1, {
      type: 'warning',
      message: 'Generating 4 alt texts for 2 assets across 2 locales…',
      dismissOnPageChange: true,
      dismissAfterTimeout: 5000,
    });
    expect(customToast).toHaveBeenNthCalledWith(2, {
      type: 'warning',
      message:
        'Generating alt texts… 2 of 4 locale versions processed; 1 of 2 assets finished.',
      dismissOnPageChange: true,
      dismissAfterTimeout: 5000,
    });
  });

  it('regenerates every locale for one open asset after confirmation', async () => {
    const current = cmaUpload('single', {
      alts: { en: 'Old English', it: 'Vecchio italiano' },
    });
    const uploadsFind = vi.fn<Client['uploads']['find']>();
    uploadsFind.mockResolvedValue(current);
    const uploadsUpdate = vi.fn<Client['uploads']['update']>();
    uploadsUpdate.mockResolvedValue(current);
    const generate = vi.fn<AltTextProvider['generate']>();
    generate.mockImplementation(async ({ locale }) => `New ${locale}`);
    mockDependencies(uploadsFind, uploadsUpdate, generate);
    const { ctx, notice, openConfirm } = uploadContext();

    await runAltGenerationForUploads(
      ctx,
      [selectedUpload('single')],
      'overwrite-all',
    );

    expect(openConfirm).toHaveBeenCalledWith({
      title: 'Regenerate asset alt texts?',
      content:
        'This will immediately replace existing default alt text for 1 image asset in every locale. This action cannot be undone.',
      choices: [
        {
          label: 'Regenerate alt texts',
          value: true,
          intent: 'negative',
        },
      ],
      cancel: { label: 'Cancel', value: false },
    });
    expect(uploadsUpdate).toHaveBeenCalledWith('single', {
      default_field_metadata: {
        alt: { en: 'New en', it: 'New it' },
      },
    });
    expect(notice).toHaveBeenCalledWith(
      '2 alt texts generated for 1 asset with OpenAI.',
    );
  });

  it('reads and updates legacy locale-keyed upload metadata', async () => {
    const current = legacyCmaUpload('legacy', {
      en: {
        alt: 'Existing English',
        title: 'Existing title',
        custom_data: { credit: 'Photographer' },
        focal_point: { x: 0.2, y: 0.8 },
      },
      it: {
        alt: null,
        title: 'Titolo esistente',
        custom_data: { credit: 'Fotografo' },
        focal_point: null,
      },
    });
    const uploadsFind = vi.fn<Client['uploads']['find']>();
    uploadsFind.mockResolvedValue(current);
    const uploadsUpdate = vi.fn<Client['uploads']['update']>();
    uploadsUpdate.mockResolvedValue(current);
    const generate = vi.fn<AltTextProvider['generate']>();
    generate.mockImplementation(async ({ locale }) => `Generated ${locale}`);
    mockDependencies(uploadsFind, uploadsUpdate, generate);
    const { ctx, notice } = uploadContext();

    await runAltGenerationForUploads(
      ctx,
      [selectedUpload('legacy')],
      'missing-only',
    );

    expect(generate).toHaveBeenCalledOnce();
    expect(generate).toHaveBeenCalledWith(
      expect.objectContaining({ assetId: 'legacy', locale: 'it' }),
    );
    expect(uploadsUpdate).toHaveBeenCalledWith('legacy', {
      default_field_metadata: {
        it: { alt: 'Generated it' },
      },
    });
    expect(notice).toHaveBeenCalledWith(
      '1 alt text generated for 1 asset with OpenAI.',
    );
  });

  it('does not generate or save when overwrite confirmation is cancelled', async () => {
    const current = cmaUpload('single', { alts: { en: 'Existing' } });
    const uploadsFind = vi.fn<Client['uploads']['find']>();
    uploadsFind.mockResolvedValue(current);
    const uploadsUpdate = vi.fn<Client['uploads']['update']>();
    const generate = vi.fn<AltTextProvider['generate']>();
    mockDependencies(uploadsFind, uploadsUpdate, generate);
    const { ctx, customToast, openConfirm } = uploadContext(undefined, ['en']);
    openConfirm.mockResolvedValue(false);

    await runAltGenerationForUploads(
      ctx,
      [selectedUpload('single')],
      'overwrite-all',
    );

    expect(generate).not.toHaveBeenCalled();
    expect(uploadsUpdate).not.toHaveBeenCalled();
    expect(customToast).not.toHaveBeenCalled();
  });

  it('avoids provider work when every image already has localized alts', async () => {
    const image = cmaUpload('complete', {
      alts: { en: 'English', it: 'Italiano' },
    });
    const document = cmaUpload('document', {
      filename: 'document.pdf',
      isImage: false,
    });
    const uploadsFind = vi.fn<Client['uploads']['find']>();
    uploadsFind.mockImplementation(async (id) =>
      String(id) === 'complete' ? image : document,
    );
    const uploadsUpdate = vi.fn<Client['uploads']['update']>();
    const generate = vi.fn<AltTextProvider['generate']>();
    mockDependencies(uploadsFind, uploadsUpdate, generate);
    const { ctx, notice, customToast } = uploadContext();

    await runAltGenerationForUploads(
      ctx,
      [selectedUpload('complete'), selectedUpload('document', 'document.pdf')],
      'missing-only',
    );

    expect(createAltTextProvider).not.toHaveBeenCalled();
    expect(generate).not.toHaveBeenCalled();
    expect(uploadsUpdate).not.toHaveBeenCalled();
    expect(customToast).not.toHaveBeenCalled();
    expect(notice).toHaveBeenCalledWith(
      'All selected image assets already have alt text for every locale. 1 non-image asset skipped.',
    );
  });

  it('reports provider and upload-update failures without stopping the batch', async () => {
    const first = cmaUpload('first', { alts: { en: null } });
    const second = cmaUpload('second', { alts: { en: null } });
    const third = cmaUpload('third', { alts: { en: null } });
    const uploadsById = new Map(
      [first, second, third].map((upload) => [upload.id, upload]),
    );
    const uploadsFind = vi.fn<Client['uploads']['find']>();
    uploadsFind.mockImplementation(async (id) =>
      requireUpload(uploadsById, id),
    );
    const uploadsUpdate = vi.fn<Client['uploads']['update']>();
    uploadsUpdate.mockImplementation(async (id) => {
      if (String(id) === 'third') {
        throw new Error('update denied');
      }
      return requireUpload(uploadsById, id);
    });
    const generate = vi.fn<AltTextProvider['generate']>();
    generate.mockImplementation(async ({ assetId }) => {
      if (assetId === 'second') {
        throw new Error('provider unavailable');
      }
      return `Alt for ${assetId}`;
    });
    mockDependencies(uploadsFind, uploadsUpdate, generate);
    const { ctx, alert, notice } = uploadContext(undefined, ['en']);

    await runAltGenerationForUploads(
      ctx,
      [
        selectedUpload('first'),
        selectedUpload('second'),
        selectedUpload('third'),
      ],
      'missing-only',
    );

    expect(uploadsUpdate).toHaveBeenCalledTimes(2);
    expect(notice).toHaveBeenCalledWith(
      '1 alt text generated for 1 asset with OpenAI.',
    );
    expect(alert).toHaveBeenCalledWith(
      'Alt text generation errors:\nsecond.jpg (en): provider unavailable\nthird.jpg: Could not save generated alt text: update denied',
    );
  });

  it('preserves an alt added while generation is still running', async () => {
    const initiallyMissing = cmaUpload('single', { alts: { en: null } });
    const updatedMeanwhile = cmaUpload('single', {
      alts: { en: 'Added manually' },
    });
    const uploadsFind = vi.fn<Client['uploads']['find']>();
    uploadsFind
      .mockResolvedValueOnce(initiallyMissing)
      .mockResolvedValueOnce(updatedMeanwhile);
    const uploadsUpdate = vi.fn<Client['uploads']['update']>();
    const generate = vi.fn<AltTextProvider['generate']>();
    generate.mockResolvedValue('Generated description');
    mockDependencies(uploadsFind, uploadsUpdate, generate);
    const { ctx, notice } = uploadContext(undefined, ['en']);

    await runAltGenerationForUploads(
      ctx,
      [selectedUpload('single')],
      'missing-only',
    );

    expect(uploadsUpdate).not.toHaveBeenCalled();
    expect(notice).toHaveBeenCalledWith(
      'No alt texts were changed because newer asset metadata was preserved.',
    );
  });

  it('requires the current-user token before loading selected uploads', async () => {
    const { ctx, alert } = uploadContext();
    ctx.currentUserAccessToken = undefined;

    await runAltGenerationForUploads(
      ctx,
      [selectedUpload('single')],
      'missing-only',
    );

    expect(alert).toHaveBeenCalledWith(
      'This plugin needs the currentUserAccessToken permission to update asset metadata. Grant the permission and try again.',
    );
    expect(buildClient).not.toHaveBeenCalled();
  });
});
