import type { RenderAssetSourceCtx } from 'datocms-plugin-sdk';
import { useRegisterActions } from 'datocms-react-ui/Actions';
import BlankSlate from 'datocms-react-ui/BlankSlate';
import Button from 'datocms-react-ui/Button';
import Callout from 'datocms-react-ui/Callout';
import { useCtx } from 'datocms-react-ui/Canvas';
import FieldWrapper from 'datocms-react-ui/FieldWrapper';
import Link from 'datocms-react-ui/Link';
import type { Message } from 'datocms-react-ui/Message';
import RadioGroupInput from 'datocms-react-ui/RadioGroupInput';
import TextareaInput from 'datocms-react-ui/TextareaInput';
import {
  type FormEvent,
  type ReactElement,
  type ReactNode,
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
  providerBillingUrls,
  providerOptions,
  supportsOutputControls,
  variationOptions,
} from '../utils/imageService/catalog';
import { readProviderErrorDetails } from '../utils/imageService/shared';
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
  MAX_REQUESTS,
} from '../utils/imageBrowserState';
import s from './styles.module.css';

const MISSING_PROVIDER_KEY_MESSAGE =
  'Add a provider API key in plugin settings before generating images.';
const MISSING_PROVIDER_MODEL_MESSAGE =
  'Select a model in plugin settings before generating images.';
const MISSING_PROMPT_MESSAGE = 'Describe the image first.';
/** The action of Generate, with its keys (Cmd/Ctrl+Enter). */
const GENERATE_ACTION_ID = 'aiAssetSource.generate';
const REQUEST_TIMEOUT_MINUTES = 10;
const REQUEST_TIMEOUT_MS = REQUEST_TIMEOUT_MINUTES * 60_000;
const REQUEST_TIMEOUT_TITLE = `No images after ${REQUEST_TIMEOUT_MINUTES} minutes`;
const aspectRatioRadioOptions = aspectRatioOptions.map(
  ({ value, label, description }) => ({ value, label, hint: description }),
);
const variationRadioOptions = variationOptions.map(({ value, label }) => ({
  value: String(value),
  label,
}));

type UserFeedback = {
  tone: 'danger' | 'warning';
  title: Message;
  body: ReactNode;
};

type AbortReason = 'cancel' | 'timeout';

type ActiveGenerationRequest = {
  requestId: string;
  startedAtMs: number;
  elapsedSeconds: number;
  timeoutMs: number;
  imageCount: number;
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
  const providerLabel = getProviderLabel(provider);
  const hasProviderApiKey = Boolean(providerApiKey);
  const hasProviderModel = Boolean(model.trim());
  const isSubmitting = status === 'submitted';
  const hasRequests = requests.length > 0;
  const selectedImages = useMemo(
    () => getSelectedImages(browserState),
    [browserState],
  );
  const hasSelectableImages = requests.some((request) =>
    request.images.some(
      (image) =>
        image.kind === 'success' && !browserState.sentIds.has(image.id),
    ),
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
      setFeedbackMessage({
        tone: 'warning',
        title: {
          id: 'aiAssetSource.evicted',
          values: { count: browserState.evictedSelectedCount },
        },
        body: `Only the images of your last ${MAX_REQUESTS} generations are kept. Add the ones you want before you generate more.`,
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

  // A preview that fails takes its image out of the grid. When the newest
  // request loses an image this way, the message counts it with the images
  // that weren't created. The count comes from the state, so previews that
  // fail together are all counted.
  const newestRequest = requests[0];
  const newestCountRef = useRef<{ id: string; count: number } | null>(null);
  useEffect(() => {
    if (!newestRequest) {
      return;
    }

    const count = countGeneratedImages(newestRequest);
    const previous = newestCountRef.current;
    newestCountRef.current = { id: newestRequest.id, count };
    if (previous?.id !== newestRequest.id || count >= previous.count) {
      return;
    }

    const feedback = describeMissingImages(
      newestRequest.request.variationCount,
      count,
    );
    if (feedback) {
      setFeedbackMessage(feedback);
    }
  }, [newestRequest]);

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
            tone: 'danger',
            title: "An image couldn't be added to the Media Area",
            body: "It's selected again, so you can try again.",
          });
        },
      );
      dispatch({ type: 'sent', ids: result.sent });
      if (result.failed.length) {
        setFeedbackMessage({
          tone: 'danger',
          title: {
            id: 'aiAssetSource.uploadFailed',
            values: { count: result.failed.length },
          },
          body: 'Your selection is kept, so you can try again.',
        });
      }
    } catch {
      setFeedbackMessage({
        tone: 'danger',
        title: 'Too many images to add at once',
        body: 'Select fewer and try again.',
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

  // A request that made no image shows only its Callout: it adds no cards
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
          const nextStep =
            requestLogContext.variationCount > 1
              ? 'Try again, or ask for fewer images.'
              : 'Try again.';
          setFeedbackMessage({
            tone: 'danger',
            title: REQUEST_TIMEOUT_TITLE,
            body: `It was stopped, and ${providerLabel} may still charge for it. ${nextStep}`,
          });
          setStatus('error');
          return;
        }

        ctx.customToast({
          type: 'warning',
          message: `Stopped. ${providerLabel} may still charge for ${
            requestLogContext.variationCount === 1 ? 'the image' : 'the images'
          }.`,
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

      setFeedbackMessage(
        describeFailure(
          ctx,
          provider,
          requestLogContext.variationCount,
          details.status,
          nextErrorMessage,
        ),
      );
      setStatus('error');
    },
    [ctx, provider, providerLabel],
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

  // A missing prompt is the error of the prompt field. With a missing key or
  // model, the form doesn't show.
  const showValidationError = useCallback((message: string) => {
    if (message === MISSING_PROMPT_MESSAGE) {
      setPromptError(message);
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
        imageCount: normalizedRequest.variationCount,
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

        // A provider can send more images than asked. They show with no
        // message (past the memory limit, only the first ones): nothing that
        // the editor asked for is missing. A request that made no image adds
        // nothing to the history.
        const createdCount = countGeneratedImages(result);
        console.info('[asset-source] request completed', {
          ...withRequestDuration(requestLogContext, durationMs),
          imageCount: createdCount,
          warnings: result.warnings,
        });
        if (createdCount > 0) {
          dispatch({ type: 'add', batch: result });
        }
        setFeedbackMessage(
          describeMissingImages(normalizedRequest.variationCount, createdCount),
        );
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

  // Cmd/Ctrl+Enter generates, also from the prompt, where Enter adds a line
  // break. The Generate button shows the keys in its tooltip.
  useRegisterActions([
    {
      id: GENERATE_ACTION_ID,
      name: 'Generate',
      shortcut: { key: 'enter', mod: true, runWithInputFocus: true },
      applicable: () => hasProviderApiKey && hasProviderModel,
      run: () => {
        void handleSubmit();
      },
    },
  ]);

  if (!hasProviderApiKey || !hasProviderModel) {
    return (
      <SetupBlankSlate
        ctx={ctx}
        task={
          hasProviderApiKey
            ? 'pick an image model'
            : 'add an OpenAI or Google API key'
        }
      />
    );
  }

  const ratioField = (
    <FieldWrapper label="Image ratio">
      <RadioGroupInput
        options={aspectRatioRadioOptions}
        value={aspectRatio}
        onChange={(next) => next && setAspectRatio(next)}
      />
    </FieldWrapper>
  );

  return (
    <div className={s.page}>
      <form onSubmit={handleSubmit}>
        <FieldWrapper
          label="Describe the image"
          error={promptError ?? undefined}
        >
          <TextareaInput
            value={prompt}
            onChange={handlePromptChange}
            placeholder="High-quality photo of a monkey astronaut"
            maxRows={6}
          />
        </FieldWrapper>

        {capabilities.supportsVariationCount ? (
          <div className="form__field form__row">
            <div className="form__row__cell">{ratioField}</div>
            <div className="form__row__cell">
              <FieldWrapper label="Number of images">
                <RadioGroupInput
                  small
                  options={variationRadioOptions}
                  value={String(variationCount)}
                  onChange={(next) =>
                    next && setVariationCount(Number(next) as VariationCount)
                  }
                />
              </FieldWrapper>
            </div>
          </div>
        ) : (
          // A model that makes one image per request has no number to pick
          ratioField
        )}

        <Button
          submit
          tone={totalSelectedCount > 0 ? 'soft' : 'primary'}
          label="Generate"
          expand={false}
          disabled={getGenerateDisabled(isSubmitting, submitValidationError)}
          tooltip={{ action: GENERATE_ACTION_ID }}
        />
      </form>

      {activeRequest && (
        <BlankSlate
          placement="section"
          small
          loading
          title={{
            id: 'aiAssetSource.creating',
            values: { count: activeRequest.imageCount },
          }}
          description="This can take a few minutes."
          caption={`${formatDuration(activeRequest.elapsedSeconds)} so far`}
          actions={
            <Button tone="ghost" label="Cancel" onClick={handleCancelRequest} />
          }
        />
      )}

      {feedbackMessage && (
        <Callout
          className={s.callout}
          tone={feedbackMessage.tone}
          title={feedbackMessage.title}
        >
          {feedbackMessage.body}
        </Callout>
      )}

      {!hasRequests && !isSubmitting && !feedbackMessage && (
        <BlankSlate
          placement="section"
          small
          icon={<ImageIcon />}
          title="No images yet"
          description="The images you generate show here."
        />
      )}

      {hasSelectableImages && (
        <div className={s.selection}>
          <span>{getSelectionStatus(totalSelectedCount)}</span>
          <Button
            tone="primary"
            label="Add to the Media Area"
            onClick={handleUploadSelected}
            disabled={
              totalSelectedCount === 0
                ? { reason: 'Select at least one image.' }
                : undefined
            }
          />
        </div>
      )}

      {hasRequests && (
        // One grid for all the requests, the newest first, with only the
        // images that were created
        <div className={s.grid}>
          {requests.flatMap((request) =>
            request.images
              .filter((image) => image.kind === 'success')
              .map((image) => (
                <Cell
                  key={image.id}
                  image={image}
                  caption={request.request.prompt}
                  selected={selectedImageIdSet.has(image.id)}
                  anySelected={totalSelectedCount > 0}
                  sent={browserState.sentIds.has(image.id)}
                  onPreviewFailed={() =>
                    dispatch({ type: 'unavailable', id: image.id })
                  }
                  onToggleSelected={() => toggleImageSelected(image.id)}
                />
              )),
          )}
        </div>
      )}
    </div>
  );
};

export default AssetBrowser;

function getGenerateDisabled(
  isSubmitting: boolean,
  validationError: string | null,
): { reason: string } | undefined {
  if (isSubmitting) {
    return { reason: 'The images are being created.' };
  }

  return validationError ? { reason: validationError } : undefined;
}

function getSelectionStatus(count: number): string {
  if (count === 0) {
    return 'Select the images to add';
  }

  return `${count} ${count === 1 ? 'image' : 'images'} selected`;
}

function getProviderLabel(provider: ImageOperationRequest['provider']): string {
  return (
    providerOptions.find((option) => option.value === provider)?.label ??
    provider
  );
}

/**
 * A plugin with no key or model yet is a first use, not an error. The roles
 * that can open the plugin settings get a button there, in a new tab, so the
 * dialog stays open. The other roles are told to ask an admin.
 */
function SetupBlankSlate({
  ctx,
  task,
}: {
  ctx: RenderAssetSourceCtx;
  task: string;
}) {
  if (!ctx.currentRole.meta.final_permissions.can_edit_schema) {
    return (
      <BlankSlate
        placement="inline"
        icon={<ImageIcon />}
        title="Image generation isn't set up yet"
        description={`Ask an admin to ${task} in the plugin settings.`}
      />
    );
  }

  return (
    <BlankSlate
      placement="inline"
      icon={<ImageIcon />}
      title="Image generation isn't set up yet"
      description={`${task.charAt(0).toUpperCase()}${task.slice(1)}.`}
      actions={
        <Button
          tone="primary"
          label="Open the plugin settings"
          to={pluginSettingsPath(ctx)}
          newTab
        />
      }
    />
  );
}

/** The page of the plugin settings, in the current environment */
function pluginSettingsPath(ctx: RenderAssetSourceCtx): string {
  const environment = ctx.isEnvironmentPrimary
    ? ''
    : `/environments/${ctx.environment}`;

  return `${environment}/configuration/plugins/${ctx.plugin.id}/edit`;
}

/**
 * The step that an admin takes in the plugin settings, as a sentence. For the
 * roles that can open the settings, their name is a link there, in a new tab,
 * so the dialog stays open. The other roles are told to ask an admin.
 */
function pluginSettingsStep(
  ctx: RenderAssetSourceCtx,
  task: string,
): ReactElement {
  if (!ctx.currentRole.meta.final_permissions.can_edit_schema) {
    return <span>Ask an admin to {task} in the plugin settings.</span>;
  }

  // One element, so the sentence stays on one line in a description
  return (
    <span>
      {task.charAt(0).toUpperCase()}
      {task.slice(1)} in the{' '}
      <Link to={pluginSettingsPath(ctx)} target="_blank">
        plugin settings
      </Link>
      .
    </span>
  );
}

/**
 * The Callout of a request that failed, in plain words with the next step.
 * The provider's own message shows, quoted, only when no plainer one fits.
 */
function describeFailure(
  ctx: RenderAssetSourceCtx,
  provider: ImageOperationRequest['provider'],
  imageCount: number,
  status: number | undefined,
  message: string,
): UserFeedback {
  const providerLabel = getProviderLabel(provider);
  const accountFailure = describeAccountFailure(ctx, provider, status, message);

  if (accountFailure) {
    return accountFailure;
  }

  if (/safety|moderation|content.?policy/i.test(message)) {
    return {
      tone: 'danger',
      title: `${providerLabel} refused this description`,
      body: `It goes against ${providerLabel}'s safety rules. Change the wording and generate again.`,
    };
  }

  if (status && status >= 500) {
    return {
      tone: 'danger',
      title: `${providerLabel} had a problem`,
      body: 'No images were created. Try again in a few minutes.',
    };
  }

  if (status === 429) {
    return {
      tone: 'danger',
      title: 'Too many images in a short time',
      body: 'Wait a minute, then try again.',
    };
  }

  // The model can't make the size of the picked ratio
  if (status === 400 && /size|aspect|resolution/i.test(message)) {
    return {
      tone: 'danger',
      title: `${providerLabel} can't make this image ratio`,
      body: 'Pick another image ratio, then generate again.',
    };
  }

  // A network error has no status, and its message ("Failed to fetch") says
  // nothing to an editor
  if (!status && /fetch|network|connect/i.test(message)) {
    return {
      tone: 'danger',
      title: `Couldn't reach ${providerLabel}`,
      body: 'Check your connection, then try again.',
    };
  }

  // The model answered with no image, for example with text only
  if (/did not return image data/i.test(message)) {
    return {
      tone: 'danger',
      title: `${providerLabel} didn't create an image`,
      body: 'Describe the image in another way, then generate again.',
    };
  }

  // With a status, the message is the provider's answer: it shows as a quote.
  // Without one, it is the plugin's own.
  const trimmed = message.trim();
  const sentence = /[.!?]$/.test(trimmed) ? trimmed : `${trimmed}.`;
  return {
    tone: 'danger',
    title: {
      id: 'aiAssetSource.failed',
      values: { count: imageCount, provider: providerLabel },
    },
    body: (
      <span>
        {status ? `${providerLabel} said: “${sentence}”` : sentence} If it
        happens again,{' '}
        {ctx.currentRole.meta.final_permissions.can_edit_schema ? (
          <>
            check the{' '}
            <Link to={pluginSettingsPath(ctx)} target="_blank">
              plugin settings
            </Link>
            .
          </>
        ) : (
          'ask an admin to check the plugin settings.'
        )}
      </span>
    ),
  };
}

/**
 * The Callout of a failure that an admin fixes in the provider account: the
 * key, the verification of the organization, the quota. For the roles that
 * can open the plugin settings, the step is a link to the page that fixes it,
 * in a new tab. The other roles are told to ask an admin.
 */
function describeAccountFailure(
  ctx: RenderAssetSourceCtx,
  provider: ImageOperationRequest['provider'],
  status: number | undefined,
  message: string,
): UserFeedback | null {
  const providerLabel = getProviderLabel(provider);
  const isAdmin = ctx.currentRole.meta.final_permissions.can_edit_schema;

  // OpenAI also answers 403 to a key that works, for example when the
  // organization isn't verified: only a message about the key blames it
  if (
    status === 401 ||
    ((status === 400 || status === 403) && /api.?key/i.test(message))
  ) {
    return {
      tone: 'danger',
      title: `${providerLabel} didn't accept the saved API key`,
      body: pluginSettingsStep(ctx, 'update it'),
    };
  }

  if (provider === 'openai' && status === 403 && /verif/i.test(message)) {
    return {
      tone: 'danger',
      title: 'OpenAI needs a verified organization',
      body: isAdmin ? (
        <span>
          Verify it in the{' '}
          <a
            href="https://platform.openai.com/settings/organization/general"
            target="_blank"
            rel="noreferrer"
          >
            OpenAI settings
          </a>
          , then try again.
        </span>
      ) : (
        'Ask an admin to verify the OpenAI organization.'
      ),
    };
  }

  if (/quota|billing/i.test(message)) {
    return {
      tone: 'danger',
      title: `This ${providerLabel} account is over its quota`,
      body: isAdmin ? (
        <span>
          <a
            href={providerBillingUrls[provider]}
            target="_blank"
            rel="noreferrer"
          >
            Check its billing
          </a>
          , then try again.
        </span>
      ) : (
        'Ask an admin to check its billing.'
      ),
    };
  }

  return null;
}

/**
 * The Callout of a request that made fewer images than asked: one message
 * for all the images that weren't created, which get no card.
 */
function describeMissingImages(
  requestedCount: number,
  createdCount: number,
): UserFeedback | null {
  const missingCount = requestedCount - createdCount;

  if (missingCount <= 0) {
    return null;
  }

  return {
    tone: createdCount > 0 ? 'warning' : 'danger',
    title: { id: 'aiAssetSource.notCreated', values: { count: missingCount } },
    body: createdCount > 0 ? 'Generate again to get more.' : 'Generate again.',
  };
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

function formatDuration(seconds: number): string {
  const safeSeconds = Math.max(0, Math.floor(seconds));
  const minutes = Math.floor(safeSeconds / 60);
  const remainingSeconds = safeSeconds % 60;

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
