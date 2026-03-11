import {
  type ChangeEvent,
  type FormEvent,
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
} from 'react';
import { type NewUpload, type RenderAssetSourceCtx } from 'datocms-plugin-sdk';
import { Button, Spinner, useCtx } from 'datocms-react-ui';
import Cell from '../components/Cell';
import type { ConfigParameters } from '../types';
import {
  getDefaultModelForProvider,
  getInitialProvider,
  getProviderApiKey,
  normalizeConfigParameters,
} from '../utils/config';
import {
  aspectRatioOptions,
  backgroundOptions,
  buildGenerationNotes,
  buildImportFilename,
  generateOrEditImages,
  getProviderCapabilities,
  normalizeProviderError,
  variationOptions,
  type AspectRatio,
  type BackgroundMode,
  type GenerationStatus,
  type ImageOperationRequest,
  type InputImage,
  type NormalizedGenerationBatch,
  type VariationCount,
} from '../utils/imageService';
import s from './styles.module.css';

const MAX_REQUESTS = 5;
const EMPTY_SOURCE_IMAGES: InputImage[] = [];

const shapePreviewClassNames: Record<AspectRatio, string> = {
  '1:1': s.shapePreviewSquare,
  '2:3': s.shapePreviewPortrait,
  '3:2': s.shapePreviewLandscape,
};

const AssetBrowser = () => {
  const ctx = useCtx<RenderAssetSourceCtx>();
  const rootRef = useRef<HTMLDivElement | null>(null);
  const parameters = useMemo(
    () =>
      normalizeConfigParameters(
        (ctx.plugin.attributes.parameters || {}) as ConfigParameters,
      ),
    [ctx.plugin.attributes.parameters],
  );

  const provider = getInitialProvider(parameters);
  const model = getDefaultModelForProvider(parameters, provider);
  const providerApiKey = getProviderApiKey(parameters, provider);
  const hasProviderApiKey = Boolean(providerApiKey);

  const [prompt, setPrompt] = useState('');
  const [aspectRatio, setAspectRatio] = useState<AspectRatio>('1:1');
  const [variationCount, setVariationCount] = useState<VariationCount>(1);
  const [background, setBackground] = useState<BackgroundMode>('auto');
  const [requests, setRequests] = useState<NormalizedGenerationBatch[]>([]);
  const [selectedImageIds, setSelectedImageIds] = useState<string[]>([]);
  const [status, setStatus] = useState<GenerationStatus>('idle');
  const [errorMessage, setErrorMessage] = useState<string | null>(null);

  const capabilities = useMemo(
    () => getProviderCapabilities(provider, 'generate', model),
    [model, provider],
  );

  useEffect(() => {
    if (!rootRef.current) {
      return;
    }

    const observer = new ResizeObserver(() => {
      ctx.updateHeight();
    });

    observer.observe(rootRef.current);

    return () => {
      observer.disconnect();
    };
  }, [ctx]);

  useEffect(() => {
    ctx.updateHeight();
  }, [ctx, errorMessage, requests.length, selectedImageIds.length, status]);

  useEffect(() => {
    if (!capabilities.supportsVariationCount && variationCount !== 1) {
      setVariationCount(1);
    }

    if (!capabilities.supportsTransparentBackground && background !== 'auto') {
      setBackground('auto');
    }
  }, [
    background,
    capabilities.supportsTransparentBackground,
    capabilities.supportsVariationCount,
    variationCount,
  ]);

  const normalizedRequest = useMemo<ImageOperationRequest>(
    () => ({
      provider,
      mode: 'generate',
      model,
      prompt: prompt.trim(),
      aspectRatio,
      variationCount: capabilities.supportsVariationCount ? variationCount : 1,
      background: capabilities.supportsTransparentBackground ? background : 'auto',
      sourceImages: EMPTY_SOURCE_IMAGES,
    }),
    [
      aspectRatio,
      background,
      capabilities.supportsTransparentBackground,
      capabilities.supportsVariationCount,
      model,
      prompt,
      provider,
      variationCount,
    ],
  );

  const canSubmit =
    hasProviderApiKey && Boolean(normalizedRequest.prompt) && status !== 'submitted';

  const handlePromptChange = useCallback(
    (event: ChangeEvent<HTMLTextAreaElement>) => {
      setPrompt(event.target.value);
      setErrorMessage(null);
    },
    [],
  );

  const handleAspectRatioChange = useCallback((nextValue: AspectRatio) => {
    setAspectRatio(nextValue);
  }, []);

  const handleVariationChange = useCallback((nextValue: VariationCount) => {
    setVariationCount(nextValue);
  }, []);

  const handleBackgroundChange = useCallback((nextValue: BackgroundMode) => {
    setBackground(nextValue);
  }, []);

  const toggleImageSelected = useCallback((imageId: string) => {
    setSelectedImageIds((current) =>
      current.includes(imageId)
        ? current.filter((id) => id !== imageId)
        : [...current, imageId],
    );
  }, []);

  const buildUpload = useCallback(
    (request: NormalizedGenerationBatch, image: NormalizedGenerationBatch['images'][number]): NewUpload => ({
      resource: {
        base64: image.previewSrc,
        filename: buildImportFilename(
          request.request.prompt,
          request.createdAt,
          request.images.length > 1 ? image.position : undefined,
        ),
      },
      notes: buildGenerationNotes(request, image),
      tags: ['generated-image'],
      default_field_metadata: ctx.site.attributes.locales.reduce(
        (acc, locale) => ({
          ...acc,
          [locale]: {
            alt: request.request.prompt,
            title: null,
            custom_data: {},
          },
        }),
        {},
      ),
    }),
    [ctx],
  );

  const handleUploadSelected = useCallback(
    (request: NormalizedGenerationBatch) => {
      const selectedImages = request.images.filter((image) =>
        selectedImageIds.includes(image.id),
      );

      if (!selectedImages.length) {
        return;
      }

      const uploads = selectedImages.map((image) => buildUpload(request, image));
      const batchCtx = ctx as RenderAssetSourceCtx & {
        selectMultiple?: (newUploads: NewUpload[]) => void;
      };

      if (uploads.length > 1 && typeof batchCtx.selectMultiple === 'function') {
        batchCtx.selectMultiple(uploads);
      } else {
        ctx.select(uploads[0]);
      }

      setSelectedImageIds((current) =>
        current.filter((id) => !selectedImages.some((image) => image.id === id)),
      );
    },
    [buildUpload, ctx, selectedImageIds],
  );

  const handleSubmit = useCallback(
    async (event?: FormEvent) => {
      event?.preventDefault();

      if (!providerApiKey) {
        setErrorMessage('Add a provider API key in plugin settings before generating images.');
        setStatus('error');
        return;
      }

      if (!normalizedRequest.prompt) {
        setErrorMessage('Enter a prompt before generating images.');
        setStatus('error');
        return;
      }

      setStatus('submitted');
      setErrorMessage(null);

      try {
        const result = await generateOrEditImages(providerApiKey, normalizedRequest);
        setRequests((current) => [result, ...current].slice(0, MAX_REQUESTS));
        setStatus('completed');
      } catch (error) {
        console.error('Image Generator plugin', error);
        setErrorMessage(normalizeProviderError(provider, error));
        setStatus('error');
      }
    },
    [normalizedRequest, provider, providerApiKey],
  );

  return (
    <div className={`image-generator-theme ${s.page}`} ref={rootRef}>
      {!hasProviderApiKey && (
        <div className={s.message} role="status">
          Add a provider API key in plugin settings before generating images.
        </div>
      )}

      <div className={s.panel}>
        <form className={s.generatorLayout} onSubmit={handleSubmit}>
          <div className={s.promptPanel}>
            <textarea
              id="prompt"
              name="prompt"
              className={s.promptTextarea}
              placeholder="Describe the image you want to create…"
              value={prompt}
              onChange={handlePromptChange}
            />
            <div className={s.promptActions}>
              <Button buttonType="primary" type="submit" disabled={!canSubmit}>
                {status === 'submitted' ? (
                  <span className={s.buttonContent}>
                    <Spinner
                      size={16}
                      style={{ marginLeft: 0, transform: 'none' }}
                    />
                    <span>Generating…</span>
                  </span>
                ) : (
                  'Generate'
                )}
              </Button>
            </div>
          </div>

          <div className={s.controlsPanel}>
            <div className={s.controlGroup}>
              <div className={s.groupLabel}>Aspect ratio</div>
              <div className={s.shapeList}>
                {aspectRatioOptions.map((option) => {
                  const checked = option.value === aspectRatio;

                  return (
                    <button
                      key={option.value}
                      type="button"
                      className={checked ? `${s.shapeOption} ${s.choiceButtonActive}` : s.shapeOption}
                      onClick={() => handleAspectRatioChange(option.value)}
                    >
                      <span
                        className={`${s.shapePreview} ${shapePreviewClassNames[option.value]}`}
                        aria-hidden="true"
                      />
                      <span className={s.shapeCopy}>
                        <span className={s.choiceTitle}>{option.label}</span>
                        <span className={s.choiceMeta}>{option.description}</span>
                      </span>
                    </button>
                  );
                })}
              </div>
            </div>

            <div className={s.controlGroup}>
              <div className={s.groupLabel}>Background</div>
              {capabilities.supportsTransparentBackground ? (
                <div className={s.compactGrid}>
                  {backgroundOptions.map((option) => {
                    const checked = option.value === background;

                    return (
                      <button
                        key={option.value}
                        type="button"
                        className={checked ? `${s.compactChoice} ${s.choiceButtonActive}` : s.compactChoice}
                        onClick={() => handleBackgroundChange(option.value)}
                      >
                        {option.label}
                      </button>
                    );
                  })}
                </div>
              ) : (
                <div className={s.helperText}>The selected model uses its default background handling.</div>
              )}
            </div>

            <div className={s.controlGroup}>
              <div className={s.groupLabel}>Variations</div>
              {capabilities.supportsVariationCount ? (
                <div className={s.compactGrid}>
                  {variationOptions.map((option) => {
                    const checked = option.value === variationCount;

                    return (
                      <button
                        key={option.value}
                        type="button"
                        className={checked ? `${s.compactChoice} ${s.choiceButtonActive}` : s.compactChoice}
                        onClick={() => handleVariationChange(option.value)}
                      >
                        {option.label}
                      </button>
                    );
                  })}
                </div>
              ) : (
                <div className={s.helperText}>This provider returns one image per request.</div>
              )}
            </div>
          </div>
        </form>

        {errorMessage && (
          <div className={s.errorMessage} role="alert">
            {errorMessage}
          </div>
        )}
      </div>

      <div className={s.results}>
        {status === 'submitted' && requests.length > 0 && (
          <div className={s.loadingInline} role="status">
            <Spinner size={18} style={{ marginLeft: 0, transform: 'none' }} />
            <span>Generating images…</span>
          </div>
        )}

        {!requests.length && status === 'submitted' ? (
          <div className={s.loadingState} role="status">
            <Spinner size={22} style={{ marginLeft: 0, transform: 'none' }} />
            <span>Generating images…</span>
          </div>
        ) : !requests.length ? (
          <div className={s.emptyState}>
            <span className={s.emptyStateTitle}>No images yet</span>
            <span className={s.emptyStateSubtitle}>Describe what you'd like to see, then click Generate</span>
          </div>
        ) : (
          requests.map((request) => {
            const selectedCount = request.images.filter((image) =>
              selectedImageIds.includes(image.id),
            ).length;

            return (
              <section className={s.resultGroup} key={request.id}>
                <div className={s.resultGrid}>
                  {request.images.map((image) => (
                    <Cell
                      key={image.id}
                      image={image}
                      selected={selectedImageIds.includes(image.id)}
                      onToggleSelected={() => toggleImageSelected(image.id)}
                    />
                  ))}
                </div>
                {selectedCount > 0 && (
                  <div className={s.resultActions}>
                    <span className={s.selectionSummary}>
                      {selectedCount} selected
                    </span>
                    <Button buttonType="primary" onClick={() => handleUploadSelected(request)}>
                      Upload selected
                    </Button>
                  </div>
                )}
              </section>
            );
          })
        )}
      </div>
    </div>
  );
};

export default AssetBrowser;
