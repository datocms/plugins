import type { RenderAssetSourceCtx } from 'datocms-plugin-sdk';
import BlankSlate from 'datocms-react-ui/BlankSlate';
import Button from 'datocms-react-ui/Button';
import Callout from 'datocms-react-ui/Callout';
import { useCtx } from 'datocms-react-ui/Canvas';
import FieldWrapper from 'datocms-react-ui/FieldWrapper';
import RadioGroupInput from 'datocms-react-ui/RadioGroupInput';
import StringInput from 'datocms-react-ui/StringInput';
import {
  type FormEvent,
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useReducer,
  useState,
} from 'react';
import Cell from '../components/Cell';
import { ImageIcon } from '../icons';
import type { ConfigParameters } from '../types';
import {
  getDefaultModelForProvider,
  getInitialProvider,
  getProviderApiKey,
  normalizeConfigParameters,
} from '../utils/config';
import {
  generateImages,
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
  NormalizedGenerationBatch,
  VariationCount,
} from '../utils/imageService/types';
import { abortable } from '../utils/abortable';
import { selectImages } from '../utils/assetSelection';
import {
  getSelectedImages,
  imageBrowserReducer,
  initialImageBrowserState,
} from '../utils/imageBrowserState';
import s from './styles.module.css';

const MISSING_PROVIDER_KEY_MESSAGE =
  'Add a provider API key in plugin settings before generating images.';
const MISSING_PROVIDER_MODEL_MESSAGE =
  'Select a model in plugin settings before generating images.';
const MISSING_PROMPT_MESSAGE = 'Enter a prompt before generating images.';
const REQUEST_TIMEOUT_MINUTES = 10;
const REQUEST_TIMEOUT_MS = REQUEST_TIMEOUT_MINUTES * 60_000;
const REQUEST_TIMEOUT_MESSAGE = `The request timed out after ${REQUEST_TIMEOUT_MINUTES} minutes. Provider processing may still complete and incur charges. Check provider usage before trying again.`;
const GENERATION_DURATION_WARNING = 'Images can take 5-10 minutes to generate.';
const REQUEST_CANCELLED_MESSAGE =
  'Request cancelled. The provider may still complete processing and charge for it.';
const SENDING_REQUEST_LABEL = 'Sending request…';
const WAITING_FOR_IMAGES_LABEL = 'Waiting for images…';
const STILL_WAITING_LABEL =
  'Still waiting. Large requests can take several minutes.';
const aspectRatioRadioOptions = aspectRatioOptions.map(
  ({ value, label, description }) => ({ value, label, hint: description }),
);
const variationRadioOptions = variationOptions.map(({ value, label }) => ({
  value: String(value),
  label,
}));

type UserFeedback = {
  kind: 'error' | 'notice';
  title?: string;
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
  const mountedRef = useRef(true);
  const handoffLockRef = useRef(false);
  const sentIdsRef = useRef(new Set<string>());
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
  const [promptError, setPromptError] = useState<string | null>(null);
  const [aspectRatio, setAspectRatio] = useState<AspectRatio>('1:1');
  const [variationCount, setVariationCount] = useState<VariationCount>(1);
  const [browserState, dispatch] = useReducer(
    imageBrowserReducer,
    initialImageBrowserState,
  );
  const { requests, selectedIds: selectedImageIdSet } = browserState;
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
  const selectedImages = useMemo(
    () => getSelectedImages(browserState),
    [browserState],
  );

  useEffect(() => {
    mountedRef.current = true;
    return () => {
      mountedRef.current = false;
      activeControllerRef.current?.abort();
    };
  }, []);

  useEffect(() => {
    sentIdsRef.current = new Set(browserState.sentIds);
  }, [browserState.sentIds]);

  const historyId = requests[0]?.id;
  useEffect(() => {
    if (historyId && browserState.evictedSelectedCount > 0) {
      const count = browserState.evictedSelectedCount;
      setFeedbackMessage({
        kind: 'notice',
        title: 'Selected images removed',
        message: `${count} selected ${count === 1 ? 'image' : 'images'} left the recent history. Upload selected images before generating more.`,
      });
    }
  }, [historyId, browserState.evictedSelectedCount]);

  const totalSelectedCount = selectedImages.length;

  const activeRequestId = activeRequest?.requestId;
  useEffect(() => {
    if (!activeRequestId) {
      return;
    }

    const intervalId = window.setInterval(() => {
      setActiveRequest((current) => {
        if (!current) {
          return current;
        }

        return {
          ...current,
          elapsedSeconds: Math.floor((Date.now() - current.startedAtMs) / 1000),
        };
      });
    }, 1000);

    return () => {
      window.clearInterval(intervalId);
    };
  }, [activeRequestId]);

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
  const handlePromptChange = useCallback((next: string | null) => {
    setPrompt(next ?? '');
    setPromptError(null);
    setFeedbackMessage(null);
  }, []);

  const toggleImageSelected = useCallback((imageId: string) => {
    dispatch({ type: 'toggle', id: imageId });
  }, []);

  const handleUploadSelected = useCallback(() => {
    if (!selectedImages.length || handoffLockRef.current) return;
    handoffLockRef.current = true;
    // The host closes the source after receiving a resource. Stop any generation
    // before handing images off so it cannot continue unseen in the background.
    if (activeControllerRef.current) {
      abortReasonRef.current = 'cancel';
      activeControllerRef.current.abort();
    }
    try {
      const result = selectImages(
        ctx,
        ctx.site.attributes.locales,
        selectedImages,
        sentIdsRef.current,
        (id) => {
          if (!mountedRef.current) return;
          dispatch({ type: 'rejected', id });
          setFeedbackMessage({
            kind: 'error',
            title: 'Upload failed',
            message:
              'An image could not be sent to the Media Area. Check its upload queue before retrying.',
          });
        },
      );
      dispatch({ type: 'sent', ids: result.sent });
      if (result.failed.length) {
        const count = result.failed.length;
        setFeedbackMessage({
          kind: 'error',
          title: 'Upload failed',
          message: `${count} ${count === 1 ? 'image' : 'images'} could not be sent to the Media Area. They remain selected.`,
        });
      }
    } catch {
      setFeedbackMessage({
        kind: 'error',
        title: 'Selection too large',
        message:
          'This selection exceeds the asset source memory limit. Select fewer images before uploading.',
      });
    } finally {
      handoffLockRef.current = false;
    }
  }, [ctx, selectedImages]);

  const handleCancelRequest = useCallback(() => {
    if (!activeControllerRef.current) {
      return;
    }

    abortReasonRef.current = 'cancel';
    activeControllerRef.current.abort();
  }, []);

  const handleRequestFailure = useCallback(
    (
      error: unknown,
      controller: AbortController,
      requestLogContext: RequestLogContext,
      durationMs: number,
    ) => {
      if (controller.signal.aborted || isAbortError(error)) {
        const reason = getAbortReason(abortReasonRef.current);

        logAbortedRequest(requestLogContext, durationMs, reason);

        if (reason === 'timeout') {
          dispatch({
            type: 'add',
            batch: createFailedGenerationBatch(
              normalizedRequest,
              new Date().toISOString(),
              REQUEST_TIMEOUT_MESSAGE,
            ),
          });
          setFeedbackMessage({
            kind: 'error',
            title: 'Request timed out',
            message: REQUEST_TIMEOUT_MESSAGE,
          });
          setStatus('error');
          return;
        }

        ctx.customToast({
          type: 'warning',
          message: REQUEST_CANCELLED_MESSAGE,
          dismissAfterTimeout: true,
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
      });

      dispatch({
        type: 'add',
        batch: createFailedGenerationBatch(
          normalizedRequest,
          new Date().toISOString(),
          nextErrorMessage,
        ),
      });
      setFeedbackMessage({
        kind: 'error',
        message: nextErrorMessage,
      });
      setStatus('error');
    },
    [ctx, normalizedRequest, provider],
  );

  const createRequestTimeout = useCallback(
    (
      controller: AbortController,
      requestLogContext: RequestLogContext,
      startedAtMs: number,
    ) => {
      return window.setTimeout(() => {
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
    },
    [],
  );

  const canUpdateRequest = useCallback(
    (controller: AbortController) =>
      mountedRef.current && activeControllerRef.current === controller,
    [],
  );

  const finishRequest = useCallback(
    (controller: AbortController, timeoutId: number) => {
      window.clearTimeout(timeoutId);
      if (activeControllerRef.current !== controller) return;
      activeControllerRef.current = null;
      abortReasonRef.current = null;
      activeRequestLogContextRef.current = null;
      lastWaitingLogSecondRef.current = null;
      if (mountedRef.current) setActiveRequest(null);
    },
    [],
  );

  // A missing prompt is the error of the prompt field. A missing key or model
  // is a problem of the plugin settings, so it shows in the callout.
  const showValidationError = useCallback((message: string) => {
    if (message === MISSING_PROMPT_MESSAGE) {
      setPromptError(message);
    } else {
      setFeedbackMessage({ kind: 'error', message });
    }
    setStatus('error');
  }, []);

  const handleSubmit = useCallback(
    async (event?: FormEvent) => {
      event?.preventDefault();
      if (activeControllerRef.current || handoffLockRef.current) return;

      const validationError = getSubmitValidationError(
        providerApiKey,
        normalizedRequest.model,
        normalizedRequest.prompt,
      );

      if (validationError) {
        showValidationError(validationError);
        return;
      }

      const requestId = buildRequestId();
      const startedAtMs = Date.now();
      const controller = new AbortController();
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

      const timeoutId = createRequestTimeout(
        controller,
        requestLogContext,
        startedAtMs,
      );

      try {
        const result = await abortable(
          generateImages(providerApiKey, normalizedRequest, {
            signal: controller.signal,
          }),
          controller.signal,
        );
        const durationMs = Date.now() - startedAtMs;

        if (!canUpdateRequest(controller)) return;

        console.info('[asset-source] request completed', {
          ...withRequestDuration(requestLogContext, durationMs),
          imageCount: countGeneratedImages(result),
        });
        dispatch({ type: 'add', batch: result });
        if (result.warnings?.length) {
          setFeedbackMessage({
            kind: 'notice',
            message: result.warnings.join(' '),
          });
        }
        setStatus('completed');
      } catch (error) {
        const durationMs = Date.now() - startedAtMs;
        if (!canUpdateRequest(controller)) return;

        handleRequestFailure(error, controller, requestLogContext, durationMs);
      } finally {
        finishRequest(controller, timeoutId);
      }
    },
    [
      normalizedRequest,
      providerApiKey,
      showValidationError,
      handleRequestFailure,
      createRequestTimeout,
      finishRequest,
      canUpdateRequest,
    ],
  );

  return (
    <div className={s.page}>
      {!hasProviderApiKey && (
        <Callout className={s.callout} tone="warning">
          {MISSING_PROVIDER_KEY_MESSAGE}
        </Callout>
      )}

      {hasProviderApiKey && !hasProviderModel && (
        <Callout className={s.callout} tone="warning">
          {MISSING_PROVIDER_MODEL_MESSAGE}
        </Callout>
      )}

      <form onSubmit={handleSubmit}>
        <FieldWrapper
          label="Prompt"
          hint="Start with a detailed description."
          error={promptError ?? undefined}
        >
          <StringInput
            value={prompt}
            onChange={handlePromptChange}
            placeholder="High-quality photo of a monkey astronaut"
          />
        </FieldWrapper>

        <div className="form__field form__row">
          <div className="form__row__cell">
            <FieldWrapper label="Image ratio">
              <RadioGroupInput
                options={aspectRatioRadioOptions}
                value={aspectRatio}
                onChange={(next) => next && setAspectRatio(next)}
              />
            </FieldWrapper>
          </div>
          <div className="form__row__cell">
            <FieldWrapper
              label="Variations"
              hint={
                capabilities.supportsVariationCount
                  ? undefined
                  : 'This model generates one image per request.'
              }
            >
              <RadioGroupInput
                options={variationRadioOptions}
                value={String(variationCount)}
                onChange={(next) =>
                  next && setVariationCount(Number(next) as VariationCount)
                }
                disabled={!capabilities.supportsVariationCount}
              />
            </FieldWrapper>
          </div>
        </div>

        <Button
          submit
          tone="primary"
          label="Generate"
          expand={false}
          busy={isSubmitting}
          disabled={
            submitValidationError
              ? { reason: submitValidationError }
              : undefined
          }
        />
      </form>

      {activeRequest && (
        <BlankSlate
          placement="section"
          loading
          title={getActiveRequestLabel(activeRequest.elapsedSeconds)}
          description={GENERATION_DURATION_WARNING}
          caption={`Elapsed ${formatDuration(activeRequest.elapsedSeconds)}`}
          actions={
            <Button tone="ghost" label="Cancel" onClick={handleCancelRequest} />
          }
        />
      )}

      {feedbackMessage && (
        <Callout
          className={s.callout}
          tone={feedbackMessage.kind === 'error' ? 'danger' : 'warning'}
          title={feedbackMessage.title}
        >
          {feedbackMessage.message}
        </Callout>
      )}

      {!hasRequests && !isSubmitting && (
        <BlankSlate
          placement="section"
          icon={<ImageIcon />}
          title="No images yet"
          description="Describe what you'd like to see, then click Generate."
        />
      )}

      {totalSelectedCount > 0 && (
        <div className={s.selection}>
          <span>
            {totalSelectedCount} {totalSelectedCount === 1 ? 'image' : 'images'}{' '}
            selected
          </span>
          <Button
            tone="primary"
            label="Upload selected"
            onClick={handleUploadSelected}
          />
        </div>
      )}

      {requests.map((request) => (
        <div key={request.id} className={s.grid}>
          {request.images.map((image) => (
            <Cell
              key={image.id}
              image={image}
              selected={selectedImageIdSet.has(image.id)}
              sent={browserState.sentIds.has(image.id)}
              hasSelection={totalSelectedCount > 0}
              onPreviewFailed={() =>
                dispatch({ type: 'unavailable', id: image.id })
              }
              onToggleSelected={() => toggleImageSelected(image.id)}
            />
          ))}
        </div>
      ))}
    </div>
  );
};

export default AssetBrowser;

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

function readErrorLogDetails(error: unknown): {
  errorName?: string;
  errorMessage?: string;
} {
  if (error instanceof Error) {
    return {
      errorName: error.name,
      errorMessage: error.message.slice(0, 1000),
    };
  }

  if (typeof error === 'string') {
    return {
      errorMessage: error.slice(0, 1000),
    };
  }

  return {};
}
