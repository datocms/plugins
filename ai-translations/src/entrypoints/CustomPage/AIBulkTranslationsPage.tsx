/**
 * AIBulkTranslationsPage.tsx
 * Custom settings page ("Bulk translations") that lets admins translate every
 * record of the selected models from a source locale into other locales.
 *
 * Layout: a single pane with one 60px toolbar (title, run summary and the one
 * primary "Translate records" action) over a scrolling 800px column. The
 * column holds two sections: "Locales" (source and target selects side by
 * side) and "Models" (a full-width models select, then one field picker per
 * selected model in a two-column grid); both grids collapse to one column on
 * narrow frames. The provider-missing callout and the record discovery
 * notice sit above the sections. Whole-body states cover loading, load
 * errors, a single-locale environment and a project without models.
 *
 * The page composes pure helpers from `BulkTranslationHelpers`:
 *   - `filterTranslatableFields` — narrows a model's fields to those the
 *     plugin can translate, given the user's allowed editor types and
 *     api_key exclusions in plugin settings.
 *   - `resolveTargetLocales` — expands the "All other locales" sentinel into
 *     a concrete deduplicated list, dropping the source locale.
 *   - `getTranslationReadiness` — which required inputs are still missing;
 *     `getStartBlockedReason` turns it into the one reason shown in the
 *     disabled primary's tooltip.
 *   - `defaultFieldSelection` / `pruneFieldSelection` — manage the per-model
 *     field selection map as the user adds and removes models.
 *
 * After discovering records and confirming the selection, one progress modal
 * translates every target locale in bounded record batches.
 */
import type { RenderPageCtx } from 'datocms-plugin-sdk';
import {
  Canvas,
  Section,
  SelectField,
  Spinner,
  Toolbar,
  ToolbarStack,
  ToolbarTitle,
} from 'datocms-react-ui';
import { type Ref, useEffect, useMemo, useRef, useState } from 'react';
import { FaCircleExclamation } from 'react-icons/fa6';
import {
  confirmTranslationTitle,
  discoveryStatus,
  FIELD_REQUIRED,
  NO_RECORDS_WARNING,
  PROGRESS_MODAL_TITLE,
  reportTranslationOutcome,
  runSummary,
} from '../../components/BulkTranslations/bulkCopy';
import {
  type ChipOption,
  formatCodeMultiOption,
  formatCodeOption,
} from '../../components/BulkTranslations/chipOption';
import {
  ALL_LOCALES_OPTION,
  nextTargetSelection,
  targetsForNewSource,
} from '../../components/BulkTranslations/localeSelection';
import { ModelFieldPicker } from '../../components/BulkTranslations/ModelFieldPicker';
import { getStartBlockedReason } from '../../components/BulkTranslations/startBlockedReason';
import {
  boundedSelectHint,
  useBoundedChipSelect,
} from '../../components/BulkTranslations/useBoundedChipSelect';
import { useModelFields } from '../../components/BulkTranslations/useModelFields';
import { useModelPickerPage } from '../../components/BulkTranslations/useModelPickerPage';
import type { TranslationConfirmModalParams } from '../../components/TranslationConfirmModal';
import type { ctxParamsType } from '../../entrypoints/Config/ConfigScreen';
import { Button } from '../../ui/Button';
import { DisabledReason } from '../../ui/DisabledReason';
import { useDelayedFlag } from '../../ui/useDelayedFlag';
import { buildDatoCMSClient } from '../../utils/clients';
import {
  buildLocaleSettingsPath,
  buildPluginSettingsPath,
  buildSchemaPath,
} from '../../utils/dashboardPaths';
import { formatLocaleLabel } from '../../utils/localeUtils';
import { collectRecordIds } from '../../utils/translation/BulkRecordLoader';
import {
  getTranslationReadiness,
  pruneFieldSelection,
  resolveTargetLocales,
} from '../../utils/translation/BulkTranslationHelpers';
import { handleUIError } from '../../utils/translation/ProviderErrors';
import { isProviderConfigured } from '../../utils/translation/ProviderFactory';
import s from './AIBulkTranslationsPage.module.css';

// Light local equivalents of react-select types to avoid adding the package
type SingleValue<T> = T | null;
type MultiValue<T> = readonly T[];

type PropTypes = {
  ctx: RenderPageCtx;
};

type ModelOption = ChipOption & { code: string };
type LocaleOption = ChipOption;

interface TranslationModalResult {
  completed?: boolean;
  canceled?: boolean;
}

type CollectionProgress = {
  loaded: number;
  total?: number;
  modelId: string;
};

type LoadState =
  | { status: 'loading' }
  | { status: 'ready' }
  | { status: 'error'; cause: 'request' | 'no-token' };

type View = 'loading' | 'error' | 'single-locale' | 'no-models' | 'form';

/** Views rendered inside a centered page column (650, or 800 for the form). */
const COLUMN_VIEWS: readonly View[] = ['single-locale', 'no-models', 'form'];

const PROVIDER_MISSING_LINE =
  'No AI vendor is set up yet. Add its credentials in the plugin settings to start translating.';

/** Selects, "Remove model" and "Try again" lock only after this long busy. */
const FIELD_LOCK_DELAY_MS = 1000;

function modelExclusionsKey(pluginParams: ctxParamsType) {
  return JSON.stringify(pluginParams.modelsToBeExcludedFromThisPlugin ?? []);
}

function retainSelectedModels(selected: ModelOption[], models: ModelOption[]) {
  const current = new Map(models.map((model) => [model.value, model]));
  return selected.flatMap((model) => {
    const next = current.get(model.value);
    return next ? [next] : [];
  });
}

function retainedSource(source: LocaleOption | null, locales: LocaleOption[]) {
  return (
    locales.find((locale) => locale.value === source?.value) ??
    locales[0] ??
    null
  );
}

function refreshedTargets(
  targets: LocaleOption[],
  locales: LocaleOption[],
  source: LocaleOption | null,
  sourceChanged: boolean,
) {
  const valid = new Set(locales.map((locale) => locale.value));
  const current = targets.filter(
    (option) =>
      option.value === ALL_LOCALES_OPTION.value || valid.has(option.value),
  );
  return sourceChanged && source
    ? targetsForNewSource(current, source.value)
    : current;
}

function deriveView(
  loadState: LoadState,
  localeCount: number,
  modelCount: number,
): View {
  if (loadState.status === 'loading' || loadState.status === 'error') {
    return loadState.status;
  }
  if (localeCount < 2) return 'single-locale';
  if (modelCount === 0) return 'no-models';
  return 'form';
}

function LoadErrorState({
  cause,
  onOpenPluginSettings,
  onRetry,
}: {
  cause: 'request' | 'no-token';
  onOpenPluginSettings: () => void;
  onRetry: () => void;
}) {
  return (
    <div className="dl-pane-state">
      <div className="dl-pane-state__icon">
        <FaCircleExclamation aria-hidden />
      </div>
      <div className="dl-pane-state__title">
        Couldn't load models and locales
      </div>
      {cause === 'no-token' ? (
        <>
          <p>
            The plugin needs permission to use your API token. Grant it in the
            plugin settings.
          </p>
          <Button buttonSize="s" onClick={onOpenPluginSettings}>
            Go to plugin settings
          </Button>
        </>
      ) : (
        <>
          <p>Something went wrong while loading this environment.</p>
          <Button buttonSize="s" onClick={onRetry}>
            Try again
          </Button>
        </>
      )}
    </div>
  );
}

function SingleLocaleSlate({
  locale,
  canEditEnvironment,
  onOpenLocaleSettings,
}: {
  locale: LocaleOption | undefined;
  canEditEnvironment: boolean;
  onOpenLocaleSettings: () => void;
}) {
  return (
    <div className="dl-blank-slate">
      <div className="dl-blank-slate__title">Add another locale</div>
      <div className="dl-blank-slate__description">
        <p>
          Bulk translations copy content from one locale into others, and this
          environment only has {locale?.label} ({locale?.code}).
        </p>
        <p>
          {canEditEnvironment
            ? 'Add a locale in the Locales & Timezone settings, then come back here.'
            : 'Ask a project admin to add another locale.'}
        </p>
      </div>
      {canEditEnvironment && (
        <Button
          buttonType="primary"
          buttonSize="l"
          onClick={onOpenLocaleSettings}
        >
          Go to locale settings
        </Button>
      )}
    </div>
  );
}

function NoModelsSlate({ onOpenSchema }: { onOpenSchema: () => void }) {
  return (
    <div className="dl-blank-slate">
      <div className="dl-blank-slate__title">Still no models</div>
      <div className="dl-blank-slate__description">
        <p>Create your first model!</p>
      </div>
      <Button buttonType="primary" buttonSize="l" onClick={onOpenSchema}>
        Go to Schema
      </Button>
    </div>
  );
}

/**
 * The pane's one primary action. While starting it shows "Please wait" and
 * no tooltip; while blocked it's disabled and explains why.
 */
function PrimaryAction({
  slotRef,
  isStarting,
  blockedReason,
  onStart,
}: {
  slotRef: Ref<HTMLSpanElement>;
  isStarting: boolean;
  blockedReason: string | null;
  onStart: () => void;
}) {
  return (
    <span ref={slotRef} className={s.primarySlot}>
      {/* End-aligned: the kit's shift() has no padding, so a centered 280px
          tooltip would sit flush against the iframe's right edge. */}
      <DisabledReason
        reason={isStarting ? null : blockedReason}
        placement="bottom-end"
      >
        <Button
          buttonType="primary"
          buttonSize="s"
          onClick={onStart}
          disabled={isStarting || blockedReason !== null}
        >
          {isStarting ? (
            <>
              Please wait&nbsp;
              <Spinner size={20} />
            </>
          ) : (
            'Translate records'
          )}
        </Button>
      </DisabledReason>
    </span>
  );
}

function DiscoveryNotice({
  progress,
  actionsRef,
  onCancel,
}: {
  progress: CollectionProgress;
  actionsRef: Ref<HTMLDivElement>;
  onCancel: () => void;
}) {
  const { loaded, total } = progress;
  return (
    <div className="dl-notice">
      <div className="dl-notice__content">
        <div className="dl-notice__title">Finding records…</div>
        <div className="dl-notice__description" role="status">
          {discoveryStatus(progress)}
        </div>
        <div
          className={`dl-progress ${s.discoveryBar}`}
          role="progressbar"
          aria-label="Record loading progress"
          aria-valuemin={0}
          aria-valuemax={total}
          aria-valuenow={
            total === undefined ? undefined : Math.min(loaded, total)
          }
        >
          <div
            className="dl-progress__bar"
            style={{
              width: `${total ? Math.min(100, (loaded / total) * 100) : 0}%`,
            }}
          />
        </div>
      </div>
      <div ref={actionsRef} className="dl-notice__actions">
        <Button buttonSize="s" onClick={onCancel}>
          Cancel
        </Button>
      </div>
    </div>
  );
}

/**
 * "Locales": source and target selects side by side. Each SelectField
 * renders a Fragment, so each gets its own grid cell.
 */
function LocalesSection({
  locales,
  sourceLocale,
  targetOptions,
  targetLocaleOptions,
  isLocked,
  onSourceChange,
  onTargetsChange,
}: {
  locales: LocaleOption[];
  sourceLocale: LocaleOption | null;
  targetOptions: LocaleOption[];
  targetLocaleOptions: LocaleOption[];
  isLocked: boolean;
  onSourceChange: (
    value: SingleValue<LocaleOption> | MultiValue<LocaleOption>,
  ) => void;
  onTargetsChange: (
    value: SingleValue<LocaleOption> | MultiValue<LocaleOption>,
  ) => void;
}) {
  const sourceSelect = useBoundedChipSelect(
    locales,
    sourceLocale ? [sourceLocale] : [],
    'locales',
    false,
  );
  const targetSelect = useBoundedChipSelect(
    targetOptions,
    targetLocaleOptions,
    'locales',
  );
  return (
    <Section
      title="Locales"
      titleClassName="dl-section-parity"
      headerStyle={{ marginBottom: 'var(--spacing-m)' }}
    >
      <div className={s.grid}>
        <div>
          <SelectField
            id="sourceLocale"
            name="sourceLocale"
            label="Source locale"
            required
            hint={boundedSelectHint(
              sourceSelect.hint,
              'Content is translated from this locale',
            )}
            value={sourceLocale}
            onChange={onSourceChange}
            selectInputProps={{
              ...sourceSelect.selectProps,
              formatOptionLabel: formatCodeOption,
              isClearable: false,
              isDisabled: isLocked,
            }}
          />
        </div>
        <div>
          <SelectField
            id="targetLocales"
            name="targetLocales"
            label="Target locales"
            required
            hint={boundedSelectHint(
              targetSelect.hint,
              '"All other locales" skips the source locale',
            )}
            placeholder={targetSelect.placeholder('Select locales…')}
            error={
              targetLocaleOptions.length === 0 ? FIELD_REQUIRED : undefined
            }
            value={targetLocaleOptions}
            onChange={onTargetsChange}
            selectInputProps={{
              isMulti: true,
              ...targetSelect.selectProps,
              formatOptionLabel: formatCodeMultiOption,
              noOptionsMessage: () => 'No locales found',
              isDisabled: isLocked,
            }}
          />
        </div>
      </div>
    </Section>
  );
}

export default function AIBulkTranslationsPage({ ctx }: PropTypes) {
  const pluginParams = ctx.plugin.attributes.parameters as ctxParamsType;
  const exclusionsKey = modelExclusionsKey(pluginParams);
  const [models, setModels] = useState<ModelOption[]>([]);
  const [selectedModels, setSelectedModels] = useState<ModelOption[]>([]);
  // "Field is required" on the models select only once the user emptied it.
  const [modelsTouched, setModelsTouched] = useState(false);
  const [locales, setLocales] = useState<LocaleOption[]>([]);
  const [sourceLocale, setSourceLocale] = useState<LocaleOption | null>(null);
  // Default to "All other locales" so the common case (translate into every
  // other locale) takes zero clicks; the user can narrow it if they want.
  const [targetLocaleOptions, setTargetLocaleOptions] = useState<
    LocaleOption[]
  >([ALL_LOCALES_OPTION]);
  const [loadState, setLoadState] = useState<LoadState>({ status: 'loading' });
  const [reloadToken, setReloadToken] = useState(0);
  const [isStartingTranslation, setIsStartingTranslation] = useState(false);
  const [collectionProgress, setCollectionProgress] =
    useState<CollectionProgress | null>(null);
  const collectionAbortRef = useRef<AbortController | null>(null);
  const bodyRef = useRef<HTMLDivElement>(null);
  const noticeActionsRef = useRef<HTMLDivElement>(null);
  const primarySlotRef = useRef<HTMLSpanElement>(null);
  const restoreFocusRef = useRef(false);
  // The current source, read by the load effect when a host ctx update
  // re-runs it, so a refresh keeps the user's pick instead of resetting it.
  const sourceLocaleRef = useRef<LocaleOption | null>(null);

  useEffect(() => () => collectionAbortRef.current?.abort(), []);

  useEffect(() => {
    sourceLocaleRef.current = sourceLocale;
  }, [sourceLocale]);

  // Initial load: models + locales. Only `retryLoad` puts the page back into
  // the loading state, so host ctx updates re-run this without a spinner.
  // biome-ignore lint/correctness/useExhaustiveDependencies: `reloadToken` re-runs the load when the user clicks "Try again".
  useEffect(() => {
    let stale = false;
    async function loadData() {
      if (!ctx.currentUserAccessToken) {
        setLoadState({ status: 'error', cause: 'no-token' });
        return;
      }

      try {
        const client = buildDatoCMSClient(
          ctx.currentUserAccessToken,
          ctx.environment,
          ctx.cmaBaseUrl,
        );

        const [itemTypes, site] = await Promise.all([
          client.itemTypes.list(),
          client.site.find(),
        ]);
        if (stale) return;
        const exclusions = new Set(JSON.parse(exclusionsKey) as string[]);
        const nextModels = itemTypes
          .filter(
            (model) => !model.modular_block && !exclusions.has(model.api_key),
          )
          .map((model) => ({
            label: model.name,
            value: model.id,
            code: model.api_key,
          }));
        setModels(nextModels);
        setSelectedModels((prev) => retainSelectedModels(prev, nextModels));

        const localeOptions: LocaleOption[] = site.locales.map(
          (locale: string) => ({
            label: formatLocaleLabel(locale),
            value: locale,
            code: locale,
          }),
        );
        setLocales(localeOptions);
        // Default to the first locale, but keep the current source while it
        // still exists. When it falls back, prune the targets like a user
        // source change does, so no phantom target chip is left behind.
        const currentSource = sourceLocaleRef.current;
        const nextSource = retainedSource(currentSource, localeOptions);
        sourceLocaleRef.current = nextSource;
        setSourceLocale(nextSource);
        setTargetLocaleOptions((prev) =>
          refreshedTargets(
            prev,
            localeOptions,
            nextSource,
            nextSource?.value !== currentSource?.value,
          ),
        );
        setLoadState({ status: 'ready' });
      } catch (error) {
        if (stale) return;
        console.error('Error loading data:', error);
        // Only the initial load (or a "Try again") shows the error pane. A
        // failed background refresh keeps the loaded form, including a
        // running discovery and its Cancel.
        setLoadState((prev) =>
          prev.status === 'ready'
            ? prev
            : { status: 'error', cause: 'request' },
        );
      }
    }

    void loadData();
    return () => {
      stale = true;
    };
  }, [ctx, reloadToken, exclusionsKey]);

  const retryLoad = () => {
    setLoadState({ status: 'loading' });
    setReloadToken((token) => token + 1);
  };

  const providerConfigured = isProviderConfigured(pluginParams);
  const modelSelect = useBoundedChipSelect(models, selectedModels, 'models');
  const { visibleModels, controls: modelPageControls } =
    useModelPickerPage(selectedModels);

  const selectedModelIds = useMemo(
    () => selectedModels.map((model) => model.value),
    [selectedModels],
  );
  const {
    fieldsByModel,
    selectedFieldsByModel,
    loadingFieldsForModel,
    failedFieldModels,
    setModelFields,
    retryFields,
  } = useModelFields({
    modelIds: selectedModelIds,
    scopeKey: JSON.stringify([
      ctx.environment,
      ctx.cmaBaseUrl,
      ctx.currentUserAccessToken,
    ]),
    loadFields: (modelId) => ctx.loadItemTypeFields(modelId),
    translationFields: pluginParams.translationFields,
    excludedApiKeys: pluginParams.apiKeysToBeExcludedFromThisPlugin,
  });

  // Derive concrete target locales from the user's multi-select state.
  const allLocaleValues = useMemo(() => locales.map((l) => l.value), [locales]);
  const targetLocales = useMemo(
    () =>
      sourceLocale
        ? resolveTargetLocales(
            targetLocaleOptions.map((o) => o.value),
            allLocaleValues,
            sourceLocale.value,
          )
        : [],
    [sourceLocale, targetLocaleOptions, allLocaleValues],
  );

  const readiness = useMemo(
    () =>
      getTranslationReadiness({
        sourceLocale: sourceLocale?.value ?? null,
        targetLocales,
        selectedModelIds,
        selectedFieldsByModel,
      }),
    [sourceLocale, targetLocales, selectedModelIds, selectedFieldsByModel],
  );
  const isReady = readiness.isReady;

  // Selected models whose fields haven't arrived yet (in flight, or not
  // fetched and not failed).
  const pendingModelIds = useMemo(
    () =>
      new Set(
        selectedModelIds.filter(
          (id) =>
            loadingFieldsForModel.has(id) ||
            (fieldsByModel[id] === undefined && !failedFieldModels.has(id)),
        ),
      ),
    [selectedModelIds, loadingFieldsForModel, fieldsByModel, failedFieldModels],
  );

  const blockedReason = getStartBlockedReason({
    providerConfigured,
    readiness,
    models: selectedModels,
    pendingModelIds,
    failedModelIds: failedFieldModels,
    fieldsByModel,
    requireModels: true,
  });

  const fieldsLocked = useDelayedFlag(
    isStartingTranslation,
    FIELD_LOCK_DELAY_MS,
  );
  const isCollecting = collectionProgress !== null;

  /**
   * "Field is required" under a model's field select: only once its fields
   * loaded and there is something to pick (pending, failed and dead-end
   * models explain themselves instead).
   */
  const needsFieldError = (modelId: string) =>
    readiness.modelsMissingFields.includes(modelId) &&
    (fieldsByModel[modelId]?.length ?? 0) > 0;

  /**
   * Multi-select onChange for the target locales, through the soft mutex in
   * `nextTargetSelection` ("All other locales" vs specific picks).
   */
  const handleTargetLocalesChange = (
    newValue: SingleValue<LocaleOption> | MultiValue<LocaleOption>,
  ) => {
    const next: LocaleOption[] = Array.isArray(newValue)
      ? [...newValue]
      : newValue
        ? [newValue as LocaleOption]
        : [];
    setTargetLocaleOptions(nextTargetSelection(targetLocaleOptions, next));
  };

  /** Picks the source and drops it from the specific target picks. */
  const handleSourceLocaleChange = (
    newValue: SingleValue<LocaleOption> | MultiValue<LocaleOption>,
  ) => {
    if (newValue && !Array.isArray(newValue)) {
      const source = newValue as LocaleOption;
      setSourceLocale(source);
      setTargetLocaleOptions((prev) => targetsForNewSource(prev, source.value));
    }
  };

  const handleModelChange = (
    newValue: SingleValue<ModelOption> | MultiValue<ModelOption>,
  ) => {
    const next: ModelOption[] = Array.isArray(newValue)
      ? [...newValue]
      : newValue
        ? [newValue as ModelOption]
        : [];
    setSelectedModels(next);
    setModelsTouched(true);
  };

  /** Drops a model from the selection (the prune effect clears its caches). */
  const removeModel = (modelId: string) => {
    setSelectedModels((prev) => prev.filter((m) => m.value !== modelId));
  };

  const openPluginSettings = () => {
    void ctx.navigateTo(buildPluginSettingsPath(ctx));
  };
  const openLocaleSettings = () => {
    void ctx.navigateTo(buildLocaleSettingsPath(ctx));
  };
  const openSchema = () => {
    void ctx.navigateTo(buildSchemaPath(ctx));
  };

  // Discovery starts: bring the notice into view and focus its Cancel.
  useEffect(() => {
    if (!isCollecting) return;
    if (bodyRef.current) bodyRef.current.scrollTop = 0;
    noticeActionsRef.current
      ?.querySelector('button')
      ?.focus({ preventScroll: true });
  }, [isCollecting]);

  const cancelDiscovery = () => {
    restoreFocusRef.current = true;
    collectionAbortRef.current?.abort();
  };

  // After a user cancel, give focus back to the primary. Not after the host
  // confirm or progress modals close: the iframe may not own focus then.
  useEffect(() => {
    if (isStartingTranslation || !restoreFocusRef.current) return;
    restoreFocusRef.current = false;
    primarySlotRef.current
      ?.querySelector('button')
      ?.focus({ preventScroll: true });
  }, [isStartingTranslation]);

  // biome-ignore lint/complexity/noExcessiveCognitiveComplexity: Keeps the launch flow readable at the call site.
  const startTranslation = async () => {
    if (!isReady) return;
    if (!ctx.currentUserAccessToken) {
      ctx.alert(
        "Couldn't start the translation, as the plugin can't access your API token!",
      );
      return;
    }
    if (!sourceLocale) return;
    if (!isProviderConfigured(pluginParams)) {
      ctx.alert("Couldn't start the translation, as no AI vendor is set up!");
      return;
    }

    setIsStartingTranslation(true);
    const collectionController = new AbortController();
    collectionAbortRef.current = collectionController;
    setCollectionProgress({ loaded: 0, modelId: selectedModelIds[0] ?? '' });

    try {
      const client = buildDatoCMSClient(
        ctx.currentUserAccessToken,
        ctx.environment,
        ctx.cmaBaseUrl,
        collectionController.signal,
      );
      const allRecordIds = await collectRecordIds(client, selectedModelIds, {
        onProgress: setCollectionProgress,
        checkCancellation: () => collectionController.signal.aborted,
        abortSignal: collectionController.signal,
      });
      if (collectionController.signal.aborted) return;
      setCollectionProgress(null);

      if (allRecordIds.length === 0) {
        void ctx.customToast({
          type: 'warning',
          message: NO_RECORDS_WARNING,
          dismissOnPageChange: true,
        });
        return;
      }

      // Confirm before the destructive operation via the styled confirm
      // modal, passing the full models → selected-fields breakdown so the
      // user can review exactly what will be translated.
      const confirmParams: TranslationConfirmModalParams = {
        recordCount: allRecordIds.length,
        fromLocale: sourceLocale.value,
        toLocales: targetLocales,
        models: selectedModels.map((model) => {
          const selectedKeys = new Set(
            selectedFieldsByModel[model.value] ?? [],
          );
          return {
            label: model.label,
            code: model.code,
            fields: (fieldsByModel[model.value] ?? [])
              .filter((field) => selectedKeys.has(field.apiKey))
              .map((field) => ({ label: field.label, apiKey: field.apiKey })),
          };
        }),
      };
      const confirmed = await ctx.openModal({
        id: 'translationConfirmModal',
        title: confirmTranslationTitle(allRecordIds.length),
        width: 'm',
        parameters: confirmParams as unknown as Record<string, unknown>,
      });

      if (confirmed !== true) return;

      // Single modal handles the whole job: each record is translated into
      // every target locale and saved in one CMA write per record. Only the
      // selected models' field picks are sent.
      const modalPromise = ctx.openModal({
        id: 'translationProgressModal',
        title: PROGRESS_MODAL_TITLE,
        width: 'l',
        parameters: {
          totalRecords: allRecordIds.length,
          fromLocale: sourceLocale.value,
          toLocales: targetLocales,
          accessToken: ctx.currentUserAccessToken,
          pluginParams,
          itemIds: allRecordIds,
          selectedFieldsByModel: pruneFieldSelection(
            selectedFieldsByModel,
            selectedModelIds,
          ),
        },
      });

      const result = (await modalPromise) as TranslationModalResult | undefined;

      // Not awaited: "Please wait" clears as soon as the progress modal closes.
      reportTranslationOutcome(ctx, result, allRecordIds.length);
    } catch (error) {
      if (!collectionController.signal.aborted) {
        handleUIError(error, pluginParams.vendor, ctx);
      }
    } finally {
      collectionAbortRef.current = null;
      setCollectionProgress(null);
      setIsStartingTranslation(false);
    }
  };

  const targetOptions = useMemo<LocaleOption[]>(
    () => [
      ALL_LOCALES_OPTION,
      ...locales.filter((l) => l.value !== sourceLocale?.value),
    ],
    [locales, sourceLocale],
  );

  const view = deriveView(loadState, locales.length, models.length);
  const showRunSummary =
    view === 'form' && selectedModels.length > 0 && targetLocales.length > 0;

  return (
    <Canvas ctx={ctx} noAutoResizer>
      <div className={`dl-pane dl-pane--last ${s.pane}`}>
        {/* 60px including the hairline in every view, level with the host's
            toolbars: the stack drops the kit's 10px vertical padding, which
            would push the row past 60 around the `s` primary. */}
        <Toolbar style={{ minHeight: 60, boxSizing: 'border-box' }}>
          <ToolbarStack
            style={{
              gap: 'var(--spacing-m)',
              minWidth: 0,
              paddingTop: 0,
              paddingBottom: 0,
            }}
          >
            <ToolbarTitle className="dl-toolbar__title">
              Bulk translations
            </ToolbarTitle>
            <div style={{ flex: 1 }} />
            {showRunSummary && (
              <span className={`dl-toolbar__subtitle ${s.toolbarMeta}`}>
                {runSummary(selectedModels.length, targetLocales.length)}
              </span>
            )}
            {view === 'form' && (
              <PrimaryAction
                slotRef={primarySlotRef}
                isStarting={isStartingTranslation}
                blockedReason={blockedReason}
                onStart={startTranslation}
              />
            )}
          </ToolbarStack>
        </Toolbar>

        <div ref={bodyRef} className="dl-pane__body">
          {view === 'loading' && (
            <div role="status" aria-label="Loading models and locales">
              <Spinner size={80} placement="centered" />
            </div>
          )}

          {loadState.status === 'error' && (
            <LoadErrorState
              cause={loadState.cause}
              onOpenPluginSettings={openPluginSettings}
              onRetry={retryLoad}
            />
          )}

          {COLUMN_VIEWS.includes(view) && (
            <div
              className={view === 'form' ? `dl-page ${s.formPage}` : 'dl-page'}
            >
              <div className="dl-page__content">
                {view === 'single-locale' && (
                  <SingleLocaleSlate
                    locale={locales[0]}
                    canEditEnvironment={
                      ctx.currentRole.meta.final_permissions
                        .can_edit_environment
                    }
                    onOpenLocaleSettings={openLocaleSettings}
                  />
                )}

                {view === 'no-models' && (
                  <NoModelsSlate onOpenSchema={openSchema} />
                )}

                {view === 'form' && (
                  <>
                    {!providerConfigured && !isCollecting && (
                      <div className="dl-callout dl-callout--warning dl-callout--with-action">
                        <div>{PROVIDER_MISSING_LINE}</div>
                        <Button buttonSize="s" onClick={openPluginSettings}>
                          Go to plugin settings
                        </Button>
                      </div>
                    )}

                    {collectionProgress && (
                      <DiscoveryNotice
                        progress={collectionProgress}
                        actionsRef={noticeActionsRef}
                        onCancel={cancelDiscovery}
                      />
                    )}

                    <div className="dl-kit-sections">
                      <LocalesSection
                        locales={locales}
                        sourceLocale={sourceLocale}
                        targetOptions={targetOptions}
                        targetLocaleOptions={targetLocaleOptions}
                        isLocked={fieldsLocked}
                        onSourceChange={handleSourceLocaleChange}
                        onTargetsChange={handleTargetLocalesChange}
                      />

                      <Section
                        title="Models"
                        titleClassName="dl-section-parity"
                        headerStyle={{ marginBottom: 'var(--spacing-m)' }}
                      >
                        <div>
                          <SelectField
                            id="selectedModels"
                            name="selectedModels"
                            label="Models"
                            required
                            hint={boundedSelectHint(
                              modelSelect.hint,
                              'All records of these models are translated',
                            )}
                            placeholder={modelSelect.placeholder(
                              'Select models…',
                            )}
                            error={
                              modelsTouched && selectedModels.length === 0
                                ? FIELD_REQUIRED
                                : undefined
                            }
                            value={selectedModels}
                            onChange={handleModelChange}
                            selectInputProps={{
                              isMulti: true,
                              ...modelSelect.selectProps,
                              formatOptionLabel: formatCodeMultiOption,
                              noOptionsMessage: () => 'No models found',
                              isDisabled: fieldsLocked,
                            }}
                          />
                        </div>

                        {selectedModels.length > 0 && (
                          <div className={s.modelGrid}>
                            {modelPageControls}
                            {visibleModels.map((model) => (
                              <div key={model.value}>
                                <ModelFieldPicker
                                  model={model}
                                  fields={fieldsByModel[model.value]}
                                  isLoading={loadingFieldsForModel.has(
                                    model.value,
                                  )}
                                  loadFailed={failedFieldModels.has(
                                    model.value,
                                  )}
                                  isDisabled={fieldsLocked}
                                  selectedApiKeys={
                                    selectedFieldsByModel[model.value] ?? []
                                  }
                                  onChange={(apiKeys) =>
                                    setModelFields(model.value, apiKeys)
                                  }
                                  onRemove={() => removeModel(model.value)}
                                  onRetry={() => retryFields(model.value)}
                                  onOpenPluginSettings={openPluginSettings}
                                  validationMessage={
                                    needsFieldError(model.value)
                                      ? FIELD_REQUIRED
                                      : undefined
                                  }
                                />
                              </div>
                            ))}
                          </div>
                        )}
                      </Section>
                    </div>
                  </>
                )}
              </div>
            </div>
          )}
        </div>
      </div>
    </Canvas>
  );
}
