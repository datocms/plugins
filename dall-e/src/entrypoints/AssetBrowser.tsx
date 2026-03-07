import { type FormEvent, useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { type NewUpload, type RenderAssetSourceCtx } from 'datocms-plugin-sdk';
import { Spinner, useCtx } from 'datocms-react-ui';
import Cell from '../components/Cell';
import {
  PromptInput,
  PromptInputBody,
  PromptInputFooter,
  PromptInputSubmit,
  PromptInputTextarea,
} from '../components/ai-elements/prompt-input';
import type { ConfigParameters } from '../types';
import {
  backgroundOptions,
  buildGenerationNotes,
  buildImportFilename,
  defaultGenerateFormState,
  generateImages,
  getConfiguredModel,
  normalizeFormState,
  normalizeOpenAiError,
  shapeOptions,
  variationOptions,
  type BackgroundMode,
  type GenerateFormState,
  type GeneratedAssetImage,
  type GenerationBatch,
  type GenerationStatus,
  type ImageShape,
  type VariationCount,
} from '../utils/openaiImages';
import s from './styles.module.css';

const MAX_REQUESTS = 5;

const AssetBrowser = () => {
  const ctx = useCtx<RenderAssetSourceCtx>();
  const parameters = (ctx.plugin.attributes.parameters || {}) as ConfigParameters;
  const trimmedApiKey = parameters.apiKey?.trim() || '';
  const selectedModel = getConfiguredModel(parameters.model);
  const [formState, setFormState] = useState<GenerateFormState>(
    defaultGenerateFormState,
  );
  const [requests, setRequests] = useState<GenerationBatch[]>([]);
  const [selectedImageIds, setSelectedImageIds] = useState<string[]>([]);
  const [status, setStatus] = useState<GenerationStatus>('idle');
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  const rootRef = useRef<HTMLDivElement | null>(null);

  const hasApiKey = Boolean(trimmedApiKey);
  const normalizedState = useMemo(
    () => normalizeFormState(formState),
    [formState],
  );
  const canGenerate =
    hasApiKey && Boolean(normalizedState.prompt) && status !== 'submitted';
  const activePromptStatus =
    status === 'submitted' ? 'submitted' : errorMessage ? 'error' : undefined;
  const shapePreviewClassNames: Record<ImageShape, string> = {
    square: s.shapePreviewSquare,
    portrait: s.shapePreviewPortrait,
    landscape: s.shapePreviewLandscape,
  };

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

  const handleShapeChange = useCallback((shape: ImageShape) => {
    setFormState((current) => ({ ...current, shape }));
  }, []);

  const handleVariationChange = useCallback((variations: VariationCount) => {
    setFormState((current) => ({ ...current, variations }));
  }, []);

  const handleBackgroundChange = useCallback((background: BackgroundMode) => {
    setFormState((current) => ({ ...current, background }));
  }, []);

  const handlePromptChange = useCallback(
    (event: React.ChangeEvent<HTMLTextAreaElement>) => {
      const nextPrompt = event.target.value;
      setFormState((current) => ({ ...current, prompt: nextPrompt }));
    },
    [],
  );

  const toggleImageSelected = useCallback((imageId: string) => {
    setSelectedImageIds((current) =>
      current.includes(imageId)
        ? current.filter((id) => id !== imageId)
        : [...current, imageId],
    );
  }, []);

  const buildUpload = useCallback(
    (request: GenerationBatch, image: GeneratedAssetImage): NewUpload => ({
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
    (request: GenerationBatch) => {
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

  const handleGenerate = useCallback(
    async (submittedPrompt?: string, event?: FormEvent) => {
      event?.preventDefault();

      const nextState = normalizeFormState({
        ...formState,
        prompt: submittedPrompt ?? formState.prompt,
      });

      setFormState(nextState);

      if (!hasApiKey) {
        setErrorMessage(
          'Add an OpenAI API key in plugin settings before generating images.',
        );
        setStatus('error');
        return;
      }

      if (!nextState.prompt) {
        setErrorMessage('Enter a prompt before generating images.');
        setStatus('error');
        return;
      }

      setStatus('submitted');
      setErrorMessage(null);

      try {
        const result = await generateImages(trimmedApiKey, nextState, selectedModel);
        setRequests((current) => [result, ...current].slice(0, MAX_REQUESTS));
        setStatus('completed');
      } catch (error) {
        console.error('Image Generator plugin', error);
        setErrorMessage(normalizeOpenAiError(error));
        setStatus('error');
      }
    },
    [formState, hasApiKey, selectedModel, trimmedApiKey],
  );

  return (
    <div className={`image-generator-theme ${s.page}`} ref={rootRef}>
      <div className={s.panel}>
        {!hasApiKey && (
          <div className={s.message} role="status">
            Add an OpenAI API key in plugin settings to start generating images.
          </div>
        )}

        <div className={s.generatorLayout}>
          <div className={s.promptColumn}>
            <div className={s.promptPanel}>
              <PromptInput
                className={s.promptForm}
                onSubmit={({ text }, event) => handleGenerate(text, event)}
              >
                <PromptInputBody>
                  <PromptInputTextarea
                    aria-label="Prompt"
                    className={s.promptTextarea}
                    name="prompt"
                    onChange={handlePromptChange}
                    placeholder="Describe the image you want to generate"
                    value={formState.prompt}
                  />
                </PromptInputBody>
                <PromptInputFooter className={s.promptFooter}>
                  <PromptInputSubmit
                    disabled={!canGenerate}
                    status={activePromptStatus}
                  >
                    {status === 'submitted' ? 'Generating…' : 'Generate'}
                  </PromptInputSubmit>
                </PromptInputFooter>
              </PromptInput>
            </div>
          </div>

          <div className={s.controlsColumn}>
            <div className={s.controlsPanel}>
              <div className={s.controlGroup}>
                <div className={s.groupLabel}>Aspect ratio</div>
                <div className={s.shapeList}>
                  {shapeOptions.map((option) => {
                    const checked = option.value === formState.shape;

                    return (
                      <label
                        key={option.value}
                        className={
                          checked
                            ? `${s.shapeOption} ${s.choiceButtonActive}`
                            : s.shapeOption
                        }
                      >
                        <input
                          checked={checked}
                          className={s.choiceInput}
                          name="shape"
                          onChange={() => handleShapeChange(option.value)}
                          type="radio"
                          value={option.value}
                        />
                        <span
                          aria-hidden="true"
                          className={`${s.shapePreview} ${shapePreviewClassNames[option.value]}`}
                        />
                        <span className={s.shapeCopy}>
                          <span className={s.choiceTitle}>{option.label}</span>
                          <span className={s.choiceMeta}>{option.description}</span>
                        </span>
                      </label>
                    );
                  })}
                </div>
              </div>

              <div className={s.controlGroup}>
                <div className={s.groupLabel}>Variations</div>
                <div className={s.variationGrid}>
                  {variationOptions.map((option) => {
                    const checked = option.value === formState.variations;

                    return (
                      <label
                        key={option.value}
                        className={
                          checked
                            ? `${s.compactChoice} ${s.choiceButtonActive}`
                            : s.compactChoice
                        }
                      >
                        <input
                          checked={checked}
                          className={s.choiceInput}
                          name="variations"
                          onChange={() => handleVariationChange(option.value)}
                          type="radio"
                          value={option.value}
                        />
                        <span>{option.label}</span>
                      </label>
                    );
                  })}
                </div>
              </div>

              <div className={s.controlGroup}>
                <div className={s.groupLabel}>Background</div>
                <div className={s.backgroundGrid}>
                  {backgroundOptions.map((option) => {
                    const checked = option.value === formState.background;

                    return (
                      <label
                        key={option.value}
                        className={
                          checked
                            ? `${s.compactChoice} ${s.choiceButtonActive}`
                            : s.compactChoice
                        }
                      >
                        <input
                          checked={checked}
                          className={s.choiceInput}
                          name="background"
                          onChange={() => handleBackgroundChange(option.value)}
                          type="radio"
                          value={option.value}
                        />
                        <span>{option.label}</span>
                      </label>
                    );
                  })}
                </div>
              </div>
            </div>
          </div>
        </div>

        {errorMessage && (
          <div className={s.errorMessage} role="alert">
            {errorMessage}
          </div>
        )}
      </div>

      <div className={s.results}>
        {status === 'submitted' && (
          <div className={s.loadingState}>
            <Spinner size={18} style={{ marginLeft: 0, transform: 'none' }} />
            <span>Generating images…</span>
          </div>
        )}

        {status !== 'submitted' && requests.length === 0 && (
          <div className={s.emptyState}>Generated images will appear here.</div>
        )}

        {requests.map((request) => {
          const selectedCount = request.images.filter((image) =>
            selectedImageIds.includes(image.id),
          ).length;

          return (
            <div className={s.resultGroup} key={request.id}>
              <div className={s.resultGrid}>
                {request.images.map((image) => (
                  <Cell
                    image={image}
                    key={image.id}
                    onToggleSelected={() => toggleImageSelected(image.id)}
                    selected={selectedImageIds.includes(image.id)}
                  />
                ))}
              </div>

              {selectedCount > 0 && (
                <div className={s.resultActions}>
                  <button
                    className={s.primaryButton}
                    onClick={() => handleUploadSelected(request)}
                    type="button"
                  >
                    Upload selected ({selectedCount})
                  </button>
                </div>
              )}
            </div>
          );
        })}
      </div>
    </div>
  );
};

export default AssetBrowser;
