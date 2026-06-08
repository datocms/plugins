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
  getImageOutputFormat,
  getProviderCapabilities,
  isAbortError,
  normalizeProviderError,
} from '../utils/imageService';
import {
  aspectRatioOptions,
  getDefaultImageSize,
  supportsOutputControls,
  variationOptions,
} from '../utils/imageService/catalog';
import {
  createFailedGenerationBatch,
  readProviderErrorDetails,
} from '../utils/imageService/shared';
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
const MISSING_PROVIDER_MODEL_MESSAGE =
  'Select a model in plugin settings before generating images.';
const MISSING_PROMPT_MESSAGE = 'Enter a prompt before generating images.';
const REQUEST_TIMEOUT_MINUTES = 6;
const REQUEST_TIMEOUT_MS = REQUEST_TIMEOUT_MINUTES * 60_000;
const REQUEST_TIMEOUT_MESSAGE =
  `The request timed out after ${REQUEST_TIMEOUT_MINUTES} minutes. Try again with fewer images or a smaller size.`;
const REQUEST_CANCELLED_MESSAGE = 'Request cancelled.';
const GENERATING_LABEL = 'Generating…';
const SENDING_REQUEST_LABEL = 'Sending request…';
const WAITING_FOR_IMAGES_LABEL = 'Waiting for images…';
const STILL_WAITING_LABEL =
  'Still waiting. Large requests can take a minute or two.';
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

type UserFeedback = {
  kind: 'error' | 'notice';
  message: string;
};

type AbortReason = 'cancel' | 'timeout';

type ActiveGenerationRequest = {
  requestId: string;
  startedAtMs: number;
  elapsedSeconds: number;
  timeoutMs: number;
};

type RequestLogContext = {
  requestId: string;
  provider: ImageOperationRequest['provider'];
  model: string;
  aspectRatio: ImageOperationRequest['aspectRatio'];
  imageSize: ImageOperationRequest['imageSize'];
  variationCount: ImageOperationRequest['variationCount'];
  outputQuality?: ImageOperationRequest['outputQuality'];
  outputFormat?: ImageOperationRequest['outputFormat'];
  outputCompression?: ImageOperationRequest['outputCompression'];
  promptLength: number;
  timeoutMs: number;
  startedAt: string;
};

const AssetBrowser = () => {
  const ctx = useCtx<RenderAssetSourceCtx>();
  const rootRef = useRef<HTMLDivElement | null>(null);
  const activeControllerRef = useRef<AbortController | null>(null);
  const abortReasonRef = useRef<AbortReason | null>(null);
  const activeRequestLogContextRef = useRef<RequestLogContext | null>(null);
  const lastWaitingLogSecondRef = useRef<number | null>(null);
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
  const [feedbackMessage, setFeedbackMessage] = useState<UserFeedback | null>(
    null,
  );
  const [activeRequest, setActiveRequest] =
    useState<ActiveGenerationRequest | null>(null);

  const capabilities = useMemo(
    () => getProviderCapabilities(provider, model),
    [model, provider],
  );
  const outputControlsSupported = useMemo(
    () => supportsOutputControls(provider, model),
    [model, provider],
  );
  const hasProviderApiKey = Boolean(providerApiKey);
  const hasProviderModel = Boolean(model.trim());
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
    if (!activeRequest) {
      return;
    }

    const intervalId = window.setInterval(() => {
      setActiveRequest((current) => {
        if (!current) {
          return current;
        }

        return {
          ...current,
          elapsedSeconds: Math.floor(
            (Date.now() - current.startedAtMs) / 1000,
          ),
        };
      });
    }, 1000);

    return () => {
      window.clearInterval(intervalId);
    };
  }, [activeRequest?.requestId]);

  useEffect(() => {
    if (
      !activeRequest ||
      activeRequest.elapsedSeconds < 60 ||
      activeRequest.elapsedSeconds % 60 !== 0 ||
      lastWaitingLogSecondRef.current === activeRequest.elapsedSeconds
    ) {
      return;
    }

    const logContext = activeRequestLogContextRef.current;

    if (!logContext) {
      return;
    }

    lastWaitingLogSecondRef.current = activeRequest.elapsedSeconds;
    console.info(
      '[asset-source] request still waiting',
      withRequestDuration(logContext, activeRequest.elapsedSeconds * 1000),
    );
  }, [activeRequest]);

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
      outputQuality:
        outputControlsSupported && provider === 'openai'
          ? parameters.providers.openai.defaultQuality
          : undefined,
      outputFormat:
        outputControlsSupported && provider === 'openai'
          ? parameters.providers.openai.defaultOutputFormat
          : undefined,
      outputCompression:
        outputControlsSupported &&
        provider === 'openai' &&
        parameters.providers.openai.defaultOutputFormat !== 'png'
          ? parameters.providers.openai.defaultCompression
          : undefined,
    }),
    [
      aspectRatio,
      capabilities.supportsVariationCount,
      model,
      outputControlsSupported,
      parameters.providers.openai.defaultCompression,
      parameters.providers.openai.defaultOutputFormat,
      parameters.providers.openai.defaultQuality,
      prompt,
      provider,
      variationCount,
    ],
  );

  const submitValidationError = useMemo(
    () =>
      getSubmitValidationError(
        providerApiKey,
        normalizedRequest.model,
        normalizedRequest.prompt,
      ),
    [normalizedRequest.model, normalizedRequest.prompt, providerApiKey],
  );
  const canSubmit = !submitValidationError && !isSubmitting;

  const handlePromptChange = useCallback(
    (event: ChangeEvent<HTMLInputElement>) => {
      setPrompt(event.target.value);
      setFeedbackMessage(null);
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

  const handleCancelRequest = useCallback(() => {
    if (!activeControllerRef.current) {
      return;
    }

    abortReasonRef.current = 'cancel';
    activeControllerRef.current.abort();
  }, []);

  const handleSubmit = useCallback(
    async (event?: FormEvent) => {
      event?.preventDefault();

      const validationError = getSubmitValidationError(
        providerApiKey,
        normalizedRequest.model,
        normalizedRequest.prompt,
      );

      if (validationError) {
        setFeedbackMessage({
          kind: 'error',
          message: validationError,
        });
        setStatus('error');
        return;
      }

      const requestId = buildRequestId();
      const startedAtMs = Date.now();
      const controller = new AbortController();
      let timeoutId: number | undefined;
      const requestLogContext = buildRequestLogContext(
        requestId,
        normalizedRequest,
        startedAtMs,
      );

      activeControllerRef.current = controller;
      abortReasonRef.current = null;
      activeRequestLogContextRef.current = requestLogContext;
      lastWaitingLogSecondRef.current = null;
      setStatus('submitted');
      setFeedbackMessage(null);
      setActiveRequest({
        requestId,
        startedAtMs,
        elapsedSeconds: 0,
        timeoutMs: REQUEST_TIMEOUT_MS,
      });

      console.info('[asset-source] request started', requestLogContext);

      timeoutId = window.setTimeout(() => {
        if (activeControllerRef.current !== controller) {
          return;
        }

        abortReasonRef.current = 'timeout';
        console.warn(
          '[asset-source] request timeout reached',
          withRequestDuration(requestLogContext, Date.now() - startedAtMs),
        );
        controller.abort();
      }, REQUEST_TIMEOUT_MS);

      try {
        const result = await generateImages(providerApiKey, normalizedRequest, {
          signal: controller.signal,
        });
        const durationMs = Date.now() - startedAtMs;

        if (controller.signal.aborted) {
          logAbortedRequest(
            requestLogContext,
            durationMs,
            abortReasonRef.current,
          );
          return;
        }

        console.info('[asset-source] request completed', {
          ...withRequestDuration(requestLogContext, durationMs),
          imageCount: countGeneratedImages(result),
        });
        setRequests((current) => [result, ...current].slice(0, MAX_REQUESTS));
        setStatus('completed');
      } catch (error) {
        const durationMs = Date.now() - startedAtMs;

        if (controller.signal.aborted || isAbortError(error)) {
          const reason = getAbortReason(abortReasonRef.current);

          logAbortedRequest(requestLogContext, durationMs, reason);

          if (reason === 'timeout') {
            setRequests((current) =>
              [
                createFailedGenerationBatch(
                  normalizedRequest,
                  new Date().toISOString(),
                  REQUEST_TIMEOUT_MESSAGE,
                ),
                ...current,
              ].slice(0, MAX_REQUESTS),
            );
            setFeedbackMessage({
              kind: 'error',
              message: REQUEST_TIMEOUT_MESSAGE,
            });
            setStatus('error');
            return;
          }

          setFeedbackMessage({
            kind: 'notice',
            message: REQUEST_CANCELLED_MESSAGE,
          });
          setStatus('idle');
          return;
        }

        const nextErrorMessage = normalizeProviderError(provider, error);
        const details = readProviderErrorDetails(error);
        const errorLogDetails = readErrorLogDetails(error);

        console.error('[asset-source] request failed', {
          ...withRequestDuration(requestLogContext, durationMs),
          message: nextErrorMessage,
          status: details.status,
          ...errorLogDetails,
          error,
        });

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
        setFeedbackMessage({
          kind: 'error',
          message: nextErrorMessage,
        });
        setStatus('error');
      } finally {
        if (typeof timeoutId === 'number') {
          window.clearTimeout(timeoutId);
        }

        if (activeControllerRef.current === controller) {
          activeControllerRef.current = null;
        }

        abortReasonRef.current = null;
        activeRequestLogContextRef.current = null;
        lastWaitingLogSecondRef.current = null;
        setActiveRequest(null);
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

      {hasProviderApiKey && !hasProviderModel && (
        <div className={s.message} role="status">
          {MISSING_PROVIDER_MODEL_MESSAGE}
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

        {activeRequest && (
          <div className={s.requestStatus} role="status" aria-live="polite">
            <div className={s.requestStatusBody}>
              <div className={s.requestStatusText}>
                <span className={s.requestStatusTitle}>
                  {getActiveRequestLabel(activeRequest.elapsedSeconds)}
                </span>
                <span className={s.requestStatusMeta}>
                  <Spinner size={13} style={INLINE_SPINNER_STYLE} />
                  <span>
                    Elapsed {formatDuration(activeRequest.elapsedSeconds)}
                  </span>
                </span>
              </div>
              <button
                type="button"
                className={s.cancelButton}
                onClick={handleCancelRequest}
              >
                Cancel
              </button>
            </div>
          </div>
        )}

        {feedbackMessage && (
          <div
            className={
              feedbackMessage.kind === 'error'
                ? s.errorMessage
                : s.noticeMessage
            }
            role={feedbackMessage.kind === 'error' ? 'alert' : 'status'}
          >
            {feedbackMessage.message}
          </div>
        )}
      </div>

      <div className={s.results}>
        {!hasRequests && !isSubmitting ? (
          <div className={s.emptyState}>
            <span className={s.emptyStateTitle}>No images yet</span>
            <span className={s.emptyStateSubtitle}>
              Describe what you&apos;d like to see, then click Generate.
            </span>
          </div>
        ) : hasRequests ? (
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
        ) : null}
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
  model: string,
  prompt: string,
): string | null {
  if (!providerApiKey) {
    return MISSING_PROVIDER_KEY_MESSAGE;
  }

  if (!model.trim()) {
    return MISSING_PROVIDER_MODEL_MESSAGE;
  }

  if (!prompt) {
    return MISSING_PROMPT_MESSAGE;
  }

  return null;
}

function getActiveRequestLabel(elapsedSeconds: number): string {
  if (elapsedSeconds <= 2) {
    return SENDING_REQUEST_LABEL;
  }

  if (elapsedSeconds <= 29) {
    return WAITING_FOR_IMAGES_LABEL;
  }

  return STILL_WAITING_LABEL;
}

function formatDuration(seconds: number): string {
  const safeSeconds = Math.max(0, Math.floor(seconds));
  const minutes = Math.floor(safeSeconds / 60);
  const remainingSeconds = safeSeconds % 60;

  if (minutes === 0) {
    return `${remainingSeconds}s`;
  }

  return `${minutes}:${remainingSeconds.toString().padStart(2, '0')}`;
}

function buildRequestId(): string {
  return `request-${Date.now().toString(36)}-${Math.random()
    .toString(36)
    .slice(2, 8)}`;
}

function buildRequestLogContext(
  requestId: string,
  request: ImageOperationRequest,
  startedAtMs: number,
): RequestLogContext {
  const context: RequestLogContext = {
    requestId,
    provider: request.provider,
    model: request.model,
    aspectRatio: request.aspectRatio,
    imageSize: request.imageSize,
    variationCount: request.variationCount,
    promptLength: request.prompt.length,
    timeoutMs: REQUEST_TIMEOUT_MS,
    startedAt: new Date(startedAtMs).toISOString(),
  };

  if (request.outputQuality) {
    context.outputQuality = request.outputQuality;
  }

  if (request.outputFormat) {
    context.outputFormat = request.outputFormat;
  }

  if (typeof request.outputCompression === 'number') {
    context.outputCompression = request.outputCompression;
  }

  return context;
}

function withRequestDuration(
  context: RequestLogContext,
  durationMs: number,
): RequestLogContext & { durationMs: number } {
  return {
    ...context,
    durationMs,
  };
}

function countGeneratedImages(batch: NormalizedGenerationBatch): number {
  return batch.images.filter((image) => image.kind === 'success').length;
}

function getAbortReason(reason: AbortReason | null): AbortReason {
  return reason === 'timeout' ? 'timeout' : 'cancel';
}

function logAbortedRequest(
  context: RequestLogContext,
  durationMs: number,
  reason: AbortReason | null,
): void {
  const normalizedReason = getAbortReason(reason);
  const payload = {
    ...withRequestDuration(context, durationMs),
    reason: normalizedReason,
  };

  if (normalizedReason === 'timeout') {
    console.warn('[asset-source] request aborted by timeout', payload);
    return;
  }

  console.info('[asset-source] request cancelled', payload);
}

function readErrorLogDetails(
  error: unknown,
): { errorName?: string; errorMessage?: string } {
  if (error instanceof Error) {
    return {
      errorName: error.name,
      errorMessage: error.message,
    };
  }

  if (typeof error === 'string') {
    return {
      errorMessage: error,
    };
  }

  return {};
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
  const outputFormat = getImageOutputFormat(
    image,
    request.request.outputFormat,
  );

  return {
    resource: {
      base64: image.previewSrc,
      filename: buildImportFilename(
        request.request.prompt,
        request.createdAt,
        request.images.length > 1 ? image.position : undefined,
        outputFormat,
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
