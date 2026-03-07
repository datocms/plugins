import { type FormEvent, useCallback, useMemo, useState } from 'react';
import { RenderAssetSourceCtx } from 'datocms-plugin-sdk';
import { Spinner, useCtx } from 'datocms-react-ui';
import Cell from '../components/Cell';
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
  type GeneratedImage,
  type ImageRequestRecord,
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
  const [requests, setRequests] = useState<ImageRequestRecord[]>([]);
  const [selectedImageIds, setSelectedImageIds] = useState<string[]>([]);
  const [loading, setLoading] = useState(false);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);

  const hasApiKey = Boolean(trimmedApiKey);
  const normalizedState = useMemo(
    () => normalizeFormState(formState),
    [formState],
  );
  const canGenerate = hasApiKey && Boolean(normalizedState.prompt) && !loading;
  const shapePreviewClassNames: Record<ImageShape, string> = {
    square: s.shapePreviewSquare,
    portrait: s.shapePreviewPortrait,
    landscape: s.shapePreviewLandscape,
  };

  const handleShapeChange = useCallback((shape: ImageShape) => {
    setFormState((current) => ({ ...current, shape }));
  }, []);

  const handleVariationChange = useCallback((variations: VariationCount) => {
    setFormState((current) => ({ ...current, variations }));
  }, []);

  const handleBackgroundChange = useCallback((background: BackgroundMode) => {
    setFormState((current) => ({ ...current, background }));
  }, []);

  const toggleImageSelected = useCallback((imageId: string) => {
    setSelectedImageIds((current) =>
      current.includes(imageId)
        ? current.filter((id) => id !== imageId)
        : [...current, imageId],
    );
  }, []);

  const uploadImage = useCallback(
    (request: ImageRequestRecord, image: GeneratedImage) => {
      ctx.select({
        resource: {
          base64: image.previewSrc,
          filename: buildImportFilename(
            request.request.prompt,
            request.createdAt,
            request.images.length > 1 ? image.position : undefined,
          ),
        },
        notes: buildGenerationNotes(request.request),
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
      });
    },
    [ctx],
  );

  const handleUploadSelected = useCallback(
    (request: ImageRequestRecord) => {
      const selectedImages = request.images.filter((image) =>
        selectedImageIds.includes(image.id),
      );

      if (!selectedImages.length) {
        return;
      }

      selectedImages.forEach((image) => {
        uploadImage(request, image);
      });

      setSelectedImageIds((current) =>
        current.filter((id) => !selectedImages.some((image) => image.id === id)),
      );
    },
    [selectedImageIds, uploadImage],
  );

  const handleGenerate = useCallback(
    async (event?: FormEvent<HTMLFormElement>) => {
      event?.preventDefault();

      if (!hasApiKey) {
        setErrorMessage(
          'Add an OpenAI API key in plugin settings before generating images.',
        );
        return;
      }

      if (!normalizedState.prompt) {
        setErrorMessage('Enter a prompt before generating images.');
        return;
      }

      setLoading(true);
      setErrorMessage(null);

      try {
        const result = await generateImages(
          trimmedApiKey,
          normalizedState,
          selectedModel,
        );
        setRequests((current) => [result, ...current].slice(0, MAX_REQUESTS));
      } catch (error) {
        console.error('Image Generator plugin', error);
        setErrorMessage(normalizeOpenAiError(error));
      } finally {
        setLoading(false);
      }
    },
    [hasApiKey, normalizedState, selectedModel, trimmedApiKey],
  );

  return (
    <div className={s.page}>
      <div className={s.panel}>
        {!hasApiKey && (
          <div className={s.message} role="status">
            Add an OpenAI API key in plugin settings to start generating images.
          </div>
        )}

        <form className={s.generatorForm} onSubmit={handleGenerate}>
          <div className={s.generatorLayout}>
            <div className={s.promptColumn}>
              <textarea
                id="prompt"
                aria-label="Prompt"
                className={s.textarea}
                rows={6}
                value={formState.prompt}
                onChange={(event) =>
                  setFormState((current) => ({
                    ...current,
                    prompt: event.target.value,
                  }))
                }
                placeholder="Describe the image you want to generate"
              />
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
                            className={s.choiceInput}
                            type="radio"
                            name="shape"
                            value={option.value}
                            checked={checked}
                            onChange={() => handleShapeChange(option.value)}
                          />
                          <span
                            className={`${s.shapePreview} ${shapePreviewClassNames[option.value]}`}
                            aria-hidden="true"
                          />
                          <span className={s.shapeCopy}>
                            <span className={s.choiceTitle}>{option.label}</span>
                            <span className={s.choiceMeta}>
                              {option.description}
                            </span>
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
                            className={s.choiceInput}
                            type="radio"
                            name="variations"
                            value={option.value}
                            checked={checked}
                            onChange={() => handleVariationChange(option.value)}
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
                            className={s.choiceInput}
                            type="radio"
                            name="background"
                            value={option.value}
                            checked={checked}
                            onChange={() => handleBackgroundChange(option.value)}
                          />
                          <span>{option.label}</span>
                        </label>
                      );
                    })}
                  </div>
                </div>

                <div className={s.controlsFooter}>
                  <button
                    className={s.primaryButton}
                    type="submit"
                    disabled={!canGenerate}
                  >
                    {loading ? 'Generating…' : 'Generate'}
                  </button>
                </div>
              </div>
            </div>
          </div>

          {errorMessage && (
            <div className={s.errorMessage} role="alert">
              {errorMessage}
            </div>
          )}
        </form>
      </div>

      <div className={s.results}>
        {loading && <Spinner size={40} placement="centered" />}

        {!loading && requests.length === 0 && (
          <div className={s.emptyState}>Generated images will appear here</div>
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
                    key={image.id}
                    image={image}
                    selected={selectedImageIds.includes(image.id)}
                    onToggleSelected={() => toggleImageSelected(image.id)}
                  />
                ))}
              </div>

              {selectedCount > 0 && (
                <div className={s.resultActions}>
                  <button
                    className={s.primaryButton}
                    type="button"
                    onClick={() => handleUploadSelected(request)}
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
