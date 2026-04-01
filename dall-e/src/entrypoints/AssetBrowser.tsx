import type { NewUpload, RenderAssetSourceCtx } from 'datocms-plugin-sdk';
import { Button, Spinner, useCtx } from 'datocms-react-ui';
import {
  type ChangeEvent,
  type CSSProperties,
  type FormEvent,
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
} from 'react';
import Cell from '../components/Cell';
import type { ConfigParameters } from '../types';
import {
  getDefaultModelForProvider,
  getInitialProvider,
  getProviderApiKey,
  normalizeConfigParameters,
} from '../utils/config';
import {
  buildGenerationNotes,
  buildImportFilename,
  generateImages,
  getProviderCapabilities,
  normalizeProviderError,
} from '../utils/imageService';
import {
  aspectRatioOptions,
  getDefaultImageSize,
  variationOptions,
} from '../utils/imageService/catalog';
import { createFailedGenerationBatch } from '../utils/imageService/shared';
import type {
  AspectRatio,
  GenerationStatus,
  ImageOperationRequest,
  NormalizedGeneratedImage,
  NormalizedGenerationBatch,
  VariationCount,
} from '../utils/imageService/types';
import s from './styles.module.css';

const MAX_REQUESTS = 5;
const GENERATED_IMAGE_TAG = 'generated-image';
const MISSING_PROVIDER_KEY_MESSAGE =
  'Add a provider API key in plugin settings before generating images.';
const MISSING_PROMPT_MESSAGE = 'Enter a prompt before generating images.';
const GENERATING_LABEL = 'Generating…';
const GENERATING_IMAGES_LABEL = 'Generating images…';
const INLINE_SPINNER_STYLE: CSSProperties = {
  marginLeft: 0,
  transform: 'none',
};

const shapePreviewClassNames: Record<AspectRatio, string> = {
  '1:1': s.shapePreviewSquare,
  '2:3': s.shapePreviewPortrait,
  '3:2': s.shapePreviewLandscape,
};

type SelectedImage = {
  request: NormalizedGenerationBatch;
  image: NormalizedGeneratedImage;
};

type BatchSelectionContext = RenderAssetSourceCtx & {
  selectMultiple?: (newUploads: NewUpload[]) => void;
};

type DefaultFieldMetadata = NonNullable<NewUpload['default_field_metadata']>;

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

  const { model, provider, providerApiKey } = useMemo(() => {
    const initialProvider = getInitialProvider(parameters);

    return {
      provider: initialProvider,
      model: getDefaultModelForProvider(parameters, initialProvider),
      providerApiKey: getProviderApiKey(parameters, initialProvider),
    };
  }, [parameters]);

  const [prompt, setPrompt] = useState('');
  const [aspectRatio, setAspectRatio] = useState<AspectRatio>('1:1');
  const [variationCount, setVariationCount] = useState<VariationCount>(1);
  const [requests, setRequests] = useState<NormalizedGenerationBatch[]>([]);
  const [selectedImageIds, setSelectedImageIds] = useState<string[]>([]);
  const [status, setStatus] = useState<GenerationStatus>('idle');
  const [errorMessage, setErrorMessage] = useState<string | null>(null);

  const capabilities = useMemo(
    () => getProviderCapabilities(provider, model),
    [model, provider],
  );
  const hasProviderApiKey = Boolean(providerApiKey);
  const isSubmitting = status === 'submitted';
  const hasRequests = requests.length > 0;
  const selectedImageIdSet = useMemo(
    () => new Set(selectedImageIds),
    [selectedImageIds],
  );
  const selectedImages = useMemo(
    () => getSelectedImages(requests, selectedImageIdSet),
    [requests, selectedImageIdSet],
  );
  const totalSelectedCount = selectedImages.length;

  // Keep the modal height aligned with async content such as generated images.
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
  }, [ctx]);

  useEffect(() => {
    if (!capabilities.supportsVariationCount && variationCount !== 1) {
      setVariationCount(1);
    }
  }, [capabilities.supportsVariationCount, variationCount]);

  const normalizedRequest = useMemo<ImageOperationRequest>(
    () => ({
      provider,
      model,
      prompt: prompt.trim(),
      aspectRatio,
      imageSize: getDefaultImageSize(provider, model, aspectRatio),
      variationCount: capabilities.supportsVariationCount ? variationCount : 1,
    }),
    [
      aspectRatio,
      capabilities.supportsVariationCount,
      model,
      prompt,
      provider,
      variationCount,
    ],
  );

  const submitValidationError = useMemo(
    () => getSubmitValidationError(providerApiKey, normalizedRequest.prompt),
    [normalizedRequest.prompt, providerApiKey],
  );
  const canSubmit = !submitValidationError && !isSubmitting;

  const handlePromptChange = useCallback(
    (event: ChangeEvent<HTMLInputElement>) => {
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

  const toggleImageSelected = useCallback((imageId: string) => {
    setSelectedImageIds((current) => toggleSelectedImage(current, imageId));
  }, []);

  const handleUploadSelected = useCallback(() => {
    if (!selectedImages.length) {
      return;
    }

    const uploads = selectedImages.map(({ request, image }) =>
      buildUpload(ctx.site.attributes.locales, request, image),
    );

    selectUploads(ctx, uploads);
    setSelectedImageIds((current) =>
      current.filter(
        (id) =>
          !selectedImages.some(
            (selectedImage) => selectedImage.image.id === id,
          ),
      ),
    );
  }, [ctx, selectedImages]);

  const handleSubmit = useCallback(
    async (event?: FormEvent) => {
      event?.preventDefault();

      const validationError = getSubmitValidationError(
        providerApiKey,
        normalizedRequest.prompt,
      );

      if (validationError) {
        setErrorMessage(validationError);
        setStatus('error');
        return;
      }

      setStatus('submitted');
      setErrorMessage(null);

      try {
        const result = await generateImages(providerApiKey, normalizedRequest);
        setRequests((current) => [result, ...current].slice(0, MAX_REQUESTS));
        setStatus('completed');
      } catch (error) {
        console.error('Image Generator plugin', error);
        const nextErrorMessage = normalizeProviderError(provider, error);

        setRequests((current) =>
          [
            createFailedGenerationBatch(
              normalizedRequest,
              new Date().toISOString(),
              nextErrorMessage,
            ),
            ...current,
          ].slice(0, MAX_REQUESTS),
        );
        setErrorMessage(nextErrorMessage);
        setStatus('error');
      }
    },
    [normalizedRequest, provider, providerApiKey],
  );

  return (
    <div className={`image-generator-theme ${s.page}`} ref={rootRef}>
      {!hasProviderApiKey && (
        <div className={s.message} role="status">
          {MISSING_PROVIDER_KEY_MESSAGE}
        </div>
      )}

      <div className={s.panel}>
        <form className={s.generatorForm} onSubmit={handleSubmit}>
          <div className={s.promptRow}>
            <input
              id="prompt"
              name="prompt"
              type="text"
              aria-label="Prompt"
              className={s.promptInput}
              placeholder="Start with a detailed description, like &quot;High-quality photo of a monkey astronaut...&quot;"
              value={prompt}
              onChange={handlePromptChange}
            />

            <Button
              buttonType="primary"
              type="submit"
              className={s.generateButton}
              disabled={!canSubmit}
            >
              {isSubmitting ? (
                <span className={s.buttonContent}>
                  <Spinner size={16} style={INLINE_SPINNER_STYLE} />
                  <span>{GENERATING_LABEL}</span>
                </span>
              ) : (
                'Generate'
              )}
            </Button>
          </div>

          <div className={s.controlsRow}>
            <div className={s.inlineControl}>
              <div className={s.groupLabel}>Image ratio</div>
              <div className={`${s.choiceRow} ${s.choiceRowNoWrap}`}>
                {aspectRatioOptions.map((option) => {
                  const checked = option.value === aspectRatio;

                  return (
                    <button
                      key={option.value}
                      type="button"
                      aria-label={`${option.label} (${option.description})`}
                      title={`${option.label} (${option.description})`}
                      className={getChoiceClassName(
                        `${s.compactChoice} ${s.iconChoice}`,
                        s.choiceButtonActive,
                        checked,
                      )}
                      onClick={() => handleAspectRatioChange(option.value)}
                    >
                      <span
                        className={`${s.shapePreview} ${shapePreviewClassNames[option.value]}`}
                        aria-hidden="true"
                      />
                    </button>
                  );
                })}
              </div>
            </div>

            <div className={s.inlineControl}>
              <div className={s.groupLabel}>Variations</div>
              <div className={`${s.choiceRow} ${s.choiceRowNoWrap}`}>
                {(capabilities.supportsVariationCount
                  ? variationOptions
                  : variationOptions.filter((option) => option.value === 1)
                ).map((option) => {
                  const checked = option.value === variationCount;
                  const locked = !capabilities.supportsVariationCount;

                  return (
                    <button
                      key={option.value}
                      type="button"
                      className={[
                        getChoiceClassName(
                          `${s.compactChoice} ${s.squareChoice}`,
                          s.choiceButtonActive,
                          checked,
                        ),
                        locked ? s.choiceButtonLocked : '',
                      ]
                        .filter(Boolean)
                        .join(' ')}
                      disabled={locked}
                      onClick={() => handleVariationChange(option.value)}
                    >
                      {option.label}
                    </button>
                  );
                })}
              </div>
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
        {isSubmitting && hasRequests && (
          <div className={s.loadingInline} role="status">
            <Spinner size={18} style={INLINE_SPINNER_STYLE} />
            <span>{GENERATING_IMAGES_LABEL}</span>
          </div>
        )}

        {!hasRequests && isSubmitting ? (
          <div className={s.loadingState} role="status">
            <Spinner size={22} style={INLINE_SPINNER_STYLE} />
            <span>{GENERATING_IMAGES_LABEL}</span>
          </div>
        ) : !hasRequests ? (
          <div className={s.emptyState}>
            <span className={s.emptyStateTitle}>No images yet</span>
            <span className={s.emptyStateSubtitle}>
              Describe what you&apos;d like to see, then click Generate.
            </span>
          </div>
        ) : (
          requests.map((request, index) => (
            <section className={s.resultGroup} key={request.id}>
              {index === 0 && totalSelectedCount > 0 && (
                <div className={s.resultHeader}>
                  <div className={s.resultActions}>
                    <span className={s.selectionSummary}>
                      {totalSelectedCount} selected
                    </span>
                    <Button buttonType="primary" onClick={handleUploadSelected}>
                      Upload selected
                    </Button>
                  </div>
                </div>
              )}
              <div className={s.resultGrid}>
                {request.images.map((image) => (
                  <Cell
                    key={image.id}
                    image={image}
                    selected={selectedImageIdSet.has(image.id)}
                    onToggleSelected={() => toggleImageSelected(image.id)}
                  />
                ))}
              </div>
            </section>
          ))
        )}
      </div>
    </div>
  );
};

export default AssetBrowser;

function getChoiceClassName(
  baseClassName: string,
  activeClassName: string,
  active: boolean,
): string {
  return active ? `${baseClassName} ${activeClassName}` : baseClassName;
}

function getSubmitValidationError(
  providerApiKey: string,
  prompt: string,
): string | null {
  if (!providerApiKey) {
    return MISSING_PROVIDER_KEY_MESSAGE;
  }

  if (!prompt) {
    return MISSING_PROMPT_MESSAGE;
  }

  return null;
}

function getSelectedImages(
  requests: NormalizedGenerationBatch[],
  selectedIds: Set<string>,
): SelectedImage[] {
  return requests.flatMap((request) =>
    request.images
      .filter(isGeneratedImage)
      .filter((image) => selectedIds.has(image.id))
      .map((image) => ({ request, image })),
  );
}

function toggleSelectedImage(current: string[], imageId: string): string[] {
  return current.includes(imageId)
    ? current.filter((id) => id !== imageId)
    : [...current, imageId];
}

function buildUpload(
  locales: string[],
  request: NormalizedGenerationBatch,
  image: NormalizedGeneratedImage,
): NewUpload {
  return {
    resource: {
      base64: image.previewSrc,
      filename: buildImportFilename(
        request.request.prompt,
        request.createdAt,
        request.images.length > 1 ? image.position : undefined,
      ),
    },
    notes: buildGenerationNotes(request, image),
    tags: [GENERATED_IMAGE_TAG],
    default_field_metadata: buildDefaultFieldMetadata(
      locales,
      request.request.prompt,
    ),
  };
}

function buildDefaultFieldMetadata(
  locales: string[],
  prompt: string,
): DefaultFieldMetadata {
  return locales.reduce<DefaultFieldMetadata>((metadata, locale) => {
    metadata[locale] = {
      alt: prompt,
      title: null,
      custom_data: {},
    };

    return metadata;
  }, {} as DefaultFieldMetadata);
}

function selectUploads(ctx: RenderAssetSourceCtx, uploads: NewUpload[]): void {
  const batchCtx = ctx as BatchSelectionContext;

  if (uploads.length > 1 && typeof batchCtx.selectMultiple === 'function') {
    batchCtx.selectMultiple(uploads);
    return;
  }

  for (const upload of uploads) {
    ctx.select(upload);
  }
}

function isGeneratedImage(
  image: NormalizedGenerationBatch['images'][number],
): image is NormalizedGeneratedImage {
  return image.kind === 'success';
}
