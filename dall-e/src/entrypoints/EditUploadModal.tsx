import { buildClient } from '@datocms/cma-client-browser';
import type { RenderModalCtx } from 'datocms-plugin-sdk';
import { Button, Canvas, Spinner } from 'datocms-react-ui';
import {
  type ChangeEvent,
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
} from 'react';
import MaskStage, {
  type MaskStageHandle,
  type SelectionRect,
} from '../components/edit/MaskStage';
import type { ConfigParameters } from '../types';
import {
  getDefaultModelForProvider,
  getInitialProvider,
  getProviderApiKey,
  normalizeConfigParameters,
} from '../utils/config';
import {
  buildProviderMaskImageFromSelection,
  createWorkingImage,
  dataUrlToFile,
  readImageFromUrl,
  type WorkingImage,
} from '../utils/inputImages';
import {
  buildGenerationNotes,
  buildImportFilename,
  generateOrEditImages,
  getProviderCapabilities,
  modelSupportsMode,
  normalizeProviderError,
  type AspectRatio,
  type EditScope,
  type GenerationStatus,
  type NormalizedGenerationBatch,
} from '../utils/imageService';
import s from './styles.module.css';

type Props = {
  ctx: RenderModalCtx;
};

type EditUploadModalParameters = {
  uploadId: string;
  uploadUrl: string;
  filename: string;
  width: number | null;
  height: number | null;
};

type StageView = 'edit' | 'result';

type EditDraft = {
  activeStage: StageView;
  prompt: string;
  scope: EditScope;
  selection?: SelectionRect;
};

const INITIAL_DRAFT: EditDraft = {
  activeStage: 'edit',
  prompt: '',
  scope: 'full',
  selection: undefined,
};

export default function EditUploadModal({ ctx }: Props) {
  const rootRef = useRef<HTMLDivElement | null>(null);
  const maskStageRef = useRef<MaskStageHandle | null>(null);
  const parameters = ctx.parameters as unknown as EditUploadModalParameters;
  const pluginParameters = normalizeConfigParameters(
    (ctx.plugin.attributes.parameters || {}) as ConfigParameters,
  );
  const provider = getInitialProvider(pluginParameters);
  const model = getDefaultModelForProvider(pluginParameters, provider);
  const providerApiKey = getProviderApiKey(pluginParameters, provider);
  const capabilities = getProviderCapabilities(provider, 'edit', model);
  const canEdit = modelSupportsMode(provider, model, 'edit');
  const [draft, setDraft] = useState<EditDraft>(INITIAL_DRAFT);
  const [workingImage, setWorkingImage] = useState<WorkingImage | null>(null);
  const [status, setStatus] = useState<GenerationStatus>('idle');
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  const [loadingSource, setLoadingSource] = useState(true);
  const [uploading, setUploading] = useState(false);
  const [result, setResult] = useState<NormalizedGenerationBatch | null>(null);

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
  }, [ctx, draft.activeStage, draft.scope, errorMessage, loadingSource, result, status, uploading]);

  useEffect(() => {
    if (!capabilities.supportsMask && draft.scope !== 'full') {
      setDraft((current) => ({
        ...current,
        activeStage: 'edit',
        scope: 'full',
        selection: undefined,
      }));
    }
  }, [capabilities.supportsMask, draft.scope]);

  useEffect(() => {
    let cancelled = false;

    async function loadSourceImage() {
      setLoadingSource(true);
      setErrorMessage(null);

      try {
        const image = await readImageFromUrl(parameters.uploadUrl, parameters.filename, {
          width: parameters.width,
          height: parameters.height,
        });
        const nextWorkingImage = await createWorkingImage(image);

        if (!cancelled) {
          setWorkingImage(nextWorkingImage);
        }
      } catch (error) {
        console.error('Image Generator plugin', error);
        if (!cancelled) {
          setErrorMessage('Unable to load the current image for editing.');
        }
      } finally {
        if (!cancelled) {
          setLoadingSource(false);
        }
      }
    }

    void loadSourceImage();

    return () => {
      cancelled = true;
    };
  }, [parameters.filename, parameters.height, parameters.uploadUrl, parameters.width]);

  const aspectRatio = useMemo<AspectRatio>(() => {
    if (!workingImage?.width || !workingImage.height) {
      if (!parameters.width || !parameters.height) {
        return '1:1';
      }

      return getAspectRatio(parameters.width, parameters.height);
    }

    return getAspectRatio(workingImage.width, workingImage.height);
  }, [parameters.height, parameters.width, workingImage]);

  const invalidateResult = useCallback(() => {
    setResult(null);
    setStatus('idle');
    setDraft((current) =>
      current.activeStage === 'result'
        ? { ...current, activeStage: 'edit' }
        : current,
    );
  }, []);

  const canSubmit =
    Boolean(providerApiKey) &&
    Boolean(draft.prompt.trim()) &&
    Boolean(workingImage) &&
    status !== 'submitted' &&
    canEdit;

  const handleGenerate = useCallback(async () => {
    if (!canEdit) {
      setErrorMessage('The configured model does not support editing.');
      setStatus('error');
      return;
    }

    if (!providerApiKey) {
      setErrorMessage('Add a provider API key in plugin settings before editing.');
      setStatus('error');
      return;
    }

    if (!workingImage) {
      setErrorMessage('The source image is still loading.');
      setStatus('error');
      return;
    }

    if (!draft.prompt.trim()) {
      setErrorMessage('Enter a prompt before editing.');
      setStatus('error');
      return;
    }

    setStatus('submitted');
    setErrorMessage(null);

    try {
      let maskImage;

      if (capabilities.supportsMask && draft.scope === 'mask') {
        if (!draft.selection) {
          setErrorMessage('Select the area you want to change before generating.');
          setStatus('error');
          return;
        }

        maskImage = await buildProviderMaskImageFromSelection(
          draft.selection,
          workingImage,
        );
      }

      const batch = await generateOrEditImages(providerApiKey, {
        provider,
        mode: 'edit',
        model,
        prompt: draft.prompt.trim(),
        aspectRatio,
        variationCount: 1,
        background: 'auto',
        editScope: capabilities.supportsMask ? draft.scope : 'full',
        sourceImages: [workingImage],
        maskImage,
      });

      setResult(batch);
      setDraft((current) => ({ ...current, activeStage: 'result' }));
      setStatus('completed');
    } catch (error) {
      console.error('Image Generator plugin', error);
      setErrorMessage(normalizeProviderError(provider, error));
      setStatus('error');
    }
  }, [aspectRatio, canEdit, capabilities.supportsMask, draft.prompt, draft.scope, draft.selection, model, provider, providerApiKey, workingImage]);

  const handleCreateAsset = useCallback(async () => {
    if (!result) {
      return;
    }

    if (!ctx.currentUserAccessToken) {
      setErrorMessage('This plugin needs project API access to create edited assets.');
      return;
    }

    const image = result.images[0];

    if (!image) {
      setErrorMessage('Generate an edited image before creating the asset.');
      return;
    }

    setUploading(true);
    setErrorMessage(null);

    try {
      const client = buildClient({
        apiToken: ctx.currentUserAccessToken,
        environment: ctx.environment,
      });
      const filename = buildImportFilename(result.request.prompt, result.createdAt);
      const file = dataUrlToFile(image.previewSrc, filename);

      const upload = await client.uploads.createFromFileOrBlob({
        fileOrBlob: file,
        filename,
        notes: buildGenerationNotes(result, image),
        tags: ['generated-image'],
        default_field_metadata: ctx.site.attributes.locales.reduce(
          (acc, locale) => ({
            ...acc,
            [locale]: {
              alt: result.request.prompt,
              title: null,
              custom_data: {},
            },
          }),
          {},
        ),
      });

      ctx.notice('Edited asset created successfully.');
      await ctx.resolve({ uploadId: upload.id, sourceUploadId: parameters.uploadId });
    } catch (error) {
      console.error('Image Generator plugin', error);
      setErrorMessage('Unable to create the edited asset right now.');
    } finally {
      setUploading(false);
    }
  }, [ctx, parameters.uploadId, result]);

  const resultImage = result?.images[0];

  return (
    <Canvas ctx={ctx}>
      <div className={s.modalEditorPage} ref={rootRef}>
        {!canEdit && (
          <div className={s.errorMessage} role="alert">
            The configured model does not support editing.
          </div>
        )}

        {loadingSource ? (
          <div className={s.loadingState} role="status">
            <Spinner size={22} style={{ marginLeft: 0, transform: 'none' }} />
            <span>Loading image…</span>
          </div>
        ) : workingImage ? (
          <div className={s.modalEditor}>
            {errorMessage && (
              <div className={s.errorMessage} role="alert">
                {errorMessage}
              </div>
            )}

            <div className={s.editorBodyTight}>
              <div className={s.stagePanelClean}>
                <div className={s.stageTopBar}>
                  <div className={s.stageTabsCompact}>
                    <button
                      className={`${s.stageTab} ${draft.activeStage === 'edit' ? s.stageTabActive : ''}`}
                      type="button"
                      onClick={() => setDraft((current) => ({ ...current, activeStage: 'edit' }))}
                    >
                      Edit
                    </button>
                    <button
                      className={`${s.stageTab} ${draft.activeStage === 'result' ? s.stageTabActive : ''}`}
                      type="button"
                      onClick={() => setDraft((current) => ({ ...current, activeStage: 'result' }))}
                      disabled={!resultImage}
                    >
                      Result
                    </button>
                  </div>
                  <div className={s.stageMetaText}>
                    {draft.scope === 'mask' && capabilities.supportsMask
                      ? draft.selection
                        ? formatSelectionSummary(draft.selection)
                        : 'Draw an area to edit'
                      : formatImageSize(workingImage)}
                  </div>
                </div>

                <div className={s.stageFrameClean}>
                  {draft.activeStage === 'edit' ? (
                    <MaskStage
                      image={workingImage}
                      onSelectionChange={(value) => {
                        invalidateResult();
                        setDraft((current) => ({ ...current, selection: value }));
                        setErrorMessage(null);
                      }}
                      ref={maskStageRef}
                      scope={capabilities.supportsMask ? draft.scope : 'full'}
                      selection={draft.selection}
                    />
                  ) : resultImage ? (
                    <div className={s.resultStageClean}>
                      <img
                        alt="Edited preview"
                        className={s.resultStageImage}
                        src={resultImage.previewSrc}
                      />
                    </div>
                  ) : null}
                </div>
              </div>

              <div className={s.sideRailClean}>
                <div className={s.railSectionClean}>
                  <textarea
                    className={s.editorPromptCompact}
                    placeholder="Describe the change you want..."
                    value={draft.prompt}
                    onChange={(event: ChangeEvent<HTMLTextAreaElement>) => {
                      const nextPrompt = event.target.value;
                      invalidateResult();
                      setDraft((current) => ({ ...current, prompt: nextPrompt }));
                      setErrorMessage(null);
                    }}
                  />
                </div>

                {capabilities.supportsMask && (
                  <div className={s.railSectionClean}>
                    <div className={s.scopeRowStacked}>
                      <button
                        className={`${s.compactChoice} ${draft.scope === 'full' ? s.choiceButtonActive : ''}`}
                        type="button"
                        onClick={() => {
                          invalidateResult();
                          setDraft((current) => ({
                            ...current,
                            scope: 'full',
                            selection: undefined,
                          }));
                          setErrorMessage(null);
                        }}
                      >
                        Whole image
                      </button>
                      <button
                        className={`${s.compactChoice} ${draft.scope === 'mask' ? s.choiceButtonActive : ''}`}
                        type="button"
                        onClick={() => {
                          invalidateResult();
                          setDraft((current) => ({ ...current, scope: 'mask' }));
                          setErrorMessage(null);
                        }}
                      >
                        Selected area
                      </button>
                    </div>
                  </div>
                )}

                {capabilities.supportsMask && draft.scope === 'mask' && (
                  <div className={s.railSectionClean}>
                    <div className={s.selectionRowInline}>
                      <span className={s.helperText}>
                        {draft.selection
                          ? formatSelectionSummary(draft.selection)
                          : 'Drag on the image to select'}
                      </span>
                      <Button
                        buttonType="muted"
                        type="button"
                        buttonSize="xxs"
                        onClick={() => {
                          invalidateResult();
                          maskStageRef.current?.clear();
                          setErrorMessage(null);
                        }}
                        disabled={!draft.selection}
                      >
                        Clear
                      </Button>
                    </div>
                  </div>
                )}

                <div className={`${s.railSectionClean} ${s.railFooter}`}>
                  <Button
                    buttonType="primary"
                    type="button"
                    fullWidth
                    disabled={!canSubmit}
                    onClick={() => void handleGenerate()}
                  >
                    {status === 'submitted' ? (
                      <span className={s.buttonContent}>
                        <Spinner size={16} style={{ marginLeft: 0, transform: 'none' }} />
                        <span>Generating…</span>
                      </span>
                    ) : (
                      'Generate'
                    )}
                  </Button>

                  {resultImage ? (
                    <Button
                      buttonType="muted"
                      fullWidth
                      type="button"
                      onClick={() => void handleCreateAsset()}
                      disabled={uploading}
                    >
                      {uploading ? (
                        <span className={s.buttonContent}>
                          <Spinner size={16} style={{ marginLeft: 0, transform: 'none' }} />
                          <span>Creating asset…</span>
                        </span>
                      ) : (
                        'Create asset'
                      )}
                    </Button>
                  ) : (
                    <div className={s.helperText}>Generate a result to create a new asset.</div>
                  )}
                </div>
              </div>
            </div>
          </div>
        ) : null}
      </div>
    </Canvas>
  );
}

function getAspectRatio(width: number, height: number): AspectRatio {
  if (width > height) {
    return '3:2';
  }

  if (height > width) {
    return '2:3';
  }

  return '1:1';
}

function formatImageSize(image: WorkingImage) {
  const width = image.width ?? image.originalWidth;
  const height = image.height ?? image.originalHeight;
  return `${width} × ${height}`;
}

function formatSelectionSummary(selection: SelectionRect) {
  return `${selection.width} × ${selection.height} selected`;
}
