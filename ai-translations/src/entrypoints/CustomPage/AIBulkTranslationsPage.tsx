/**
 * AIBulkTranslationsPage.tsx
 * Custom settings page ("Bulk translations") that lets schema editors
 * translate every record of the selected models from a source locale into
 * other locales.
 *
 * Layout: a full-height form page. `Main` is the layout box that fills the
 * frame; inside it one `<form>` holds a `Pane` whose `Pane.FormHeader` has
 * the title (the page's h1, with its help) and the submit button "Translate
 * records". The content is either a blank slate (loading, load error, a
 * single-locale project, a project without models) or the form: an
 * 800px `Page` with the "AI provider" problem group (when no vendor is set
 * up), the "Finding records" group (while the run discovers records), then
 * the "Locales" and "Models" groups.
 *
 * The page composes pure helpers from `BulkTranslationHelpers`:
 *   - `filterTranslatableFields` (through `useModelFields`) — narrows a
 *     model's fields to those the plugin can translate, given the user's
 *     allowed editor types and api_key exclusions in plugin settings.
 *   - `resolveTargetLocales` — expands the "All other locales" sentinel into
 *     a concrete deduplicated list, dropping the source locale.
 *   - `getTranslationReadiness` — which required inputs are still missing;
 *     `getStartBlockedReason` turns it into the one reason that the disabled
 *     submit button gives.
 *   - `pruneFieldSelection` — keeps only the selected models' field picks.
 *
 * After discovering records and confirming the selection, one progress modal
 * translates every target locale in bounded record batches.
 */
import type { RenderPageCtx } from 'datocms-plugin-sdk';
import BlankSlate from 'datocms-react-ui/BlankSlate';
import Button from 'datocms-react-ui/Button';
import Callout from 'datocms-react-ui/Callout';
import { useCtx } from 'datocms-react-ui/Canvas';
import FieldWrapper from 'datocms-react-ui/FieldWrapper';
import { useDebounceOnBoolean } from 'datocms-react-ui/hooks/useDebounceOnBoolean';
import Main from 'datocms-react-ui/Main';
import { Page } from 'datocms-react-ui/Page';
import Pane from 'datocms-react-ui/Pane';
import Pill from 'datocms-react-ui/Pill';
import ProgressBar from 'datocms-react-ui/ProgressBar';
import SelectInput from 'datocms-react-ui/SelectInput';
import SettingsList from 'datocms-react-ui/SettingsList';
import Spinner from 'datocms-react-ui/Spinner';
import Toolbar from 'datocms-react-ui/Toolbar';
import {
  type FormEvent,
  type RefObject,
  useEffect,
  useId,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
} from 'react';
import {
  confirmTranslationTitle,
  discoveryStatus,
  NO_RECORDS_WARNING,
  PICK_FIELD_ERROR,
  PICK_LOCALE_ERROR,
  PICK_MODEL_ERROR,
  PROGRESS_MODAL_TITLE,
  reportTranslationOutcome,
} from '../../components/BulkTranslations/bulkCopy';
import {
  type ChipOption,
  formatApiKeyOptionLabel,
} from '../../components/BulkTranslations/chipOption';
import { keepEnterInSelects } from '../../components/BulkTranslations/keepEnterInSelects';
import {
  ALL_LOCALES_OPTION,
  nextTargetSelection,
  targetsForNewSource,
} from '../../components/BulkTranslations/localeSelection';
import { ModelFieldPicker } from '../../components/BulkTranslations/ModelFieldPicker';
import { getStartBlockedReason } from '../../components/BulkTranslations/startBlockedReason';
import { useBoundedChipSelect } from '../../components/BulkTranslations/useBoundedChipSelect';
import { useModelFields } from '../../components/BulkTranslations/useModelFields';
import { useModelPickerPage } from '../../components/BulkTranslations/useModelPickerPage';
import type { TranslationConfirmModalParams } from '../../components/TranslationConfirmModal';
import type { ctxParamsType } from '../../entrypoints/Config/ConfigScreen';
import { CircleExclamationIcon, LanguageIcon, ModelIcon } from '../../icons';
import { buildDatoCMSClient } from '../../utils/clients';
import {
  buildLocaleSettingsPath,
  buildPluginSettingsPath,
  buildSchemaPath,
} from '../../utils/dashboardPaths';
import { formatLocaleWithCode } from '../../utils/localeUtils';
import { useRetryFocus } from '../../utils/retryFocus';
import { collectRecordIds } from '../../utils/translation/BulkRecordLoader';
import {
  getTranslationReadiness,
  pruneFieldSelection,
  resolveTargetLocales,
} from '../../utils/translation/BulkTranslationHelpers';
import {
  handleUIError,
  normalizeProviderError,
  vendorName,
} from '../../utils/translation/ProviderErrors';
import { isProviderConfigured } from '../../utils/translation/ProviderFactory';
import s from './AIBulkTranslationsPage.module.css';

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
  | { status: 'error'; cause: 'request'; message?: string }
  | { status: 'error'; cause: 'no-token' };

type View = 'loading' | 'error' | 'single-locale' | 'no-models' | 'form';

const HELP_TEXT =
  'Translate every record of the selected models from one locale into others. Each record is saved as soon as it is translated.';
const DOCS_URL =
  'https://github.com/datocms/plugins/tree/master/ai-translations#readme';

/** Selects, "Remove model" and "Try again" lock only after this long busy. */
const FIELD_LOCK_DELAY_MS = 1000;

const noLocalesFound = () => 'No locales found';
const noModelsFound = () => 'No models found';

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

/**
 * The element that scrolls `element`: the nearest ancestor whose content
 * overflows on the vertical axis (the content of the pane).
 */
function scrollContainerOf(element: HTMLElement | null): HTMLElement | null {
  let node = element?.parentElement ?? null;
  while (node) {
    if (/(auto|scroll|overlay)/.test(getComputedStyle(node).overflowY)) {
      return node;
    }
    node = node.parentElement;
  }
  return null;
}

/**
 * The "Finding records" body: the live status line, then the bar. The status
 * line can hold the focus (`statusRef`), for the time the busy Cancel can't.
 */
function DiscoveryProgress({
  progress,
  statusRef,
}: {
  progress: CollectionProgress;
  statusRef: RefObject<HTMLDivElement | null>;
}) {
  const { loaded, total } = progress;
  // Counts get the separators of the language that the Canvas gives the kit.
  const { locale } = useCtx().ui;
  return (
    <div className={s.discovery}>
      <div ref={statusRef} role="status" tabIndex={-1} className={s.status}>
        {total === undefined && <Spinner inline label={false} />}
        {discoveryStatus(progress, locale)}
      </div>
      {total !== undefined && (
        <ProgressBar
          value={total === 0 ? 1 : loaded / total}
          ariaLabel="Finding records"
        />
      )}
    </div>
  );
}

/**
 * The content of every view but the form: loading, a failed load (with
 * "Try again", or the plugin settings when the API token is missing), a
 * single-locale project and a project without models. No title level:
 * the title of the form header is the page's h1. `actionRef` gets the
 * button of the slate that shows, if it has one: it takes the focus when a
 * retry of the load settles.
 */
function StateSlate({
  ctx,
  loadState,
  view,
  onlyLocale,
  onRetry,
  actionRef,
}: {
  ctx: RenderPageCtx;
  loadState: LoadState;
  view: Exclude<View, 'form'>;
  onlyLocale: LocaleOption | undefined;
  onRetry: () => void;
  actionRef: RefObject<HTMLElement | null>;
}) {
  if (loadState.status === 'loading') {
    return (
      <BlankSlate placement="area" loading title="Loading models and locales" />
    );
  }

  if (loadState.status === 'error' && loadState.cause === 'no-token') {
    return (
      <BlankSlate
        placement="area"
        error
        icon={<CircleExclamationIcon />}
        title="No access to your API token"
        description="The plugin needs your API token to read the records."
        actions={
          <Button
            ref={actionRef}
            label="Open plugin settings"
            to={buildPluginSettingsPath(ctx)}
          />
        }
      />
    );
  }

  if (loadState.status === 'error') {
    return (
      <BlankSlate
        placement="area"
        error
        icon={<CircleExclamationIcon />}
        title="Couldn't load models and locales"
        code={loadState.message}
        description="Try again, or reload the page if it keeps failing."
        actions={<Button ref={actionRef} label="Try again" onClick={onRetry} />}
      />
    );
  }

  if (view === 'single-locale') {
    const canEditEnvironment =
      ctx.currentRole.meta.final_permissions.can_edit_environment;
    // The "Go to locale settings" button is the way there: the text says
    // only what to add, or who to ask.
    const nextStep = canEditEnvironment
      ? 'Add another locale to translate into.'
      : 'Ask an admin to add another locale.';
    return (
      <BlankSlate
        placement="area"
        icon={<LanguageIcon />}
        title="Only one locale"
        description={`This project has only ${onlyLocale?.label ?? 'one locale'}. ${nextStep}`}
        actions={
          canEditEnvironment && (
            <Button
              ref={actionRef}
              tone="primary"
              label="Go to locale settings"
              to={buildLocaleSettingsPath(ctx)}
            />
          )
        }
      />
    );
  }

  return (
    <BlankSlate
      placement="area"
      icon={<ModelIcon />}
      title="No models yet"
      description="Bulk translations work on the records of your models. Create a model first."
      actions={
        <Button
          ref={actionRef}
          tone="primary"
          label="Go to schema"
          to={buildSchemaPath(ctx)}
        />
      }
    />
  );
}

/**
 * "Locales": the source and target selects side by side (one under the
 * other when the row is narrow).
 */
function LocalesGroup({
  locales,
  sourceLocale,
  targetOptions,
  targetValues,
  isLocked,
  onSourceChange,
  onTargetsChange,
}: {
  locales: LocaleOption[];
  sourceLocale: LocaleOption | null;
  targetOptions: LocaleOption[];
  targetValues: string[];
  isLocked: boolean;
  onSourceChange: (value: string | null, option: LocaleOption | null) => void;
  onTargetsChange: (values: string[] | null, options: LocaleOption[]) => void;
}) {
  const { locale } = useCtx().ui;
  const sourceValues = useMemo(
    () => (sourceLocale ? [sourceLocale.value] : []),
    [sourceLocale],
  );
  const sourceSelect = useBoundedChipSelect(locales, sourceValues, 'locales', {
    multi: false,
    locale,
  });
  const targetSelect = useBoundedChipSelect(
    targetOptions,
    targetValues,
    'locales',
    { locale },
  );
  return (
    <Page.Group title="Locales">
      <div className="form__field form__row">
        <div className="form__row__cell">
          <FieldWrapper label="Translate from" hint={sourceSelect.hint}>
            <SelectInput
              name="sourceLocale"
              {...sourceSelect.selectProps}
              value={sourceLocale?.value ?? null}
              onChange={onSourceChange}
              clearable={false}
              noOptionsMessage={noLocalesFound}
              disabled={isLocked}
            />
          </FieldWrapper>
        </div>
        <div className="form__row__cell">
          <FieldWrapper
            label="Translate into"
            hint={targetSelect.hint}
            error={targetValues.length === 0 ? PICK_LOCALE_ERROR : undefined}
          >
            <SelectInput
              multiple
              name="targetLocales"
              {...targetSelect.selectProps}
              value={targetValues}
              onChange={onTargetsChange}
              placeholder={targetSelect.placeholder('Pick locales')}
              noOptionsMessage={noLocalesFound}
              disabled={isLocked}
            />
          </FieldWrapper>
        </div>
      </div>
    </Page.Group>
  );
}

export default function AIBulkTranslationsPage({ ctx }: PropTypes) {
  const pluginParams = ctx.plugin.attributes.parameters as ctxParamsType;
  const exclusionsKey = modelExclusionsKey(pluginParams);
  const [models, setModels] = useState<ModelOption[]>([]);
  const [selectedModels, setSelectedModels] = useState<ModelOption[]>([]);
  // "Pick at least one model" on the models select only once the user
  // emptied it.
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
  // The discovery stops only when its current page of records arrives:
  // until then its Cancel stays busy.
  const [isCancellingDiscovery, setIsCancellingDiscovery] = useState(false);
  const cancelDiscoveryRef = useRef<HTMLElement>(null);
  const discoveryStatusRef = useRef<HTMLDivElement>(null);
  // The submit button is found by its id, not a ref: while it is disabled
  // with a reason, the kit's tooltip clones it and reads `element.ref`,
  // which React 19 warns about.
  const primaryId = useId();
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
            label: formatLocaleWithCode(locale),
            value: locale,
          }),
        );
        setLocales(localeOptions);
        // Default to the first locale, but keep the current source while it
        // still exists. When it falls back, prune the targets like a user
        // source change does, so no phantom target pill is left behind.
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
        // Only the initial load (or a "Try again") shows the error state. A
        // failed background refresh keeps the loaded form, including a
        // running discovery and its Cancel. The slate shows the short cause
        // ("DatoCMS request failed (500 Internal Server Error)."), not the
        // whole request.
        setLoadState((prev) =>
          prev.status === 'ready'
            ? prev
            : {
                status: 'error',
                cause: 'request',
                // A request to DatoCMS: the vendor plays no part here.
                message: normalizeProviderError(error, 'openai').message,
              },
        );
      }
    }

    void loadData();
    return () => {
      stale = true;
    };
  }, [ctx, reloadToken, exclusionsKey]);

  const view = deriveView(loadState, locales.length, models.length);

  // "Try again" of a failed load: the loading slate replaces the button,
  // which drops the focus to the body. `Main` holds it until the load
  // settles, then the new "Try again", the submit button of the form, or the
  // button of the slate that shows takes it.
  const mainRef = useRef<HTMLElement>(null);
  const slateActionRef = useRef<HTMLElement>(null);
  const followLoadRetry = useRetryFocus(
    view,
    'loading',
    () => mainRef.current,
    (settled) =>
      settled === 'form'
        ? document.getElementById(primaryId)
        : slateActionRef.current,
  );

  const retryLoad = () => {
    followLoadRetry();
    setLoadState({ status: 'loading' });
    setReloadToken((token) => token + 1);
  };

  const pluginSettingsPath = buildPluginSettingsPath(ctx);
  const providerConfigured = isProviderConfigured(pluginParams);

  const selectedModelIds = useMemo(
    () => selectedModels.map((model) => model.value),
    [selectedModels],
  );
  // Counts get the separators of the language that the Canvas gives the kit.
  const locale = ctx.ui.locale;
  const modelSelect = useBoundedChipSelect(models, selectedModelIds, 'models', {
    locale,
  });
  const { visibleModels, pagination } = useModelPickerPage(selectedModels);

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

  const targetOptions = useMemo<LocaleOption[]>(
    () => [
      ALL_LOCALES_OPTION,
      ...locales.filter((l) => l.value !== sourceLocale?.value),
    ],
    [locales, sourceLocale],
  );
  const targetValues = useMemo(
    () => targetLocaleOptions.map((option) => option.value),
    [targetLocaleOptions],
  );

  // Derive concrete target locales from the user's multi-select state.
  const allLocaleValues = useMemo(() => locales.map((l) => l.value), [locales]);
  const targetLocales = useMemo(
    () =>
      sourceLocale
        ? resolveTargetLocales(
            targetValues,
            allLocaleValues,
            sourceLocale.value,
          )
        : [],
    [sourceLocale, targetValues, allLocaleValues],
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

  // Turns on only after the start has lasted a second, and off at once: a
  // short start never disables the selects.
  const fieldsLocked =
    useDebounceOnBoolean(isStartingTranslation, FIELD_LOCK_DELAY_MS, 0) &&
    isStartingTranslation;
  const isCollecting = collectionProgress !== null;
  const showModelsError = modelsTouched && selectedModels.length === 0;

  /**
   * "Pick at least one field" under a model's field select: only once its
   * fields loaded and there is something to pick (pending, failed and
   * dead-end models explain themselves instead).
   */
  const fieldError = (modelId: string) =>
    readiness.modelsMissingFields.includes(modelId) &&
    (fieldsByModel[modelId]?.length ?? 0) > 0
      ? PICK_FIELD_ERROR
      : undefined;

  /**
   * Multi-select onChange for the target locales, through the soft mutex in
   * `nextTargetSelection` ("All other locales" vs specific picks).
   */
  const handleTargetLocalesChange = (
    _values: string[] | null,
    options: LocaleOption[],
  ) => {
    setTargetLocaleOptions(nextTargetSelection(targetLocaleOptions, options));
  };

  /** Picks the source and drops it from the specific target picks. */
  const handleSourceLocaleChange = (
    _value: string | null,
    option: LocaleOption | null,
  ) => {
    if (!option) return;
    setSourceLocale(option);
    setTargetLocaleOptions((prev) => targetsForNewSource(prev, option.value));
  };

  const handleModelChange = (
    _values: string[] | null,
    options: ModelOption[],
  ) => {
    setSelectedModels([...options]);
    setModelsTouched(true);
  };

  /** Drops a model from the selection (the prune effect clears its caches). */
  const removeModel = (modelId: string) => {
    setSelectedModels((prev) => prev.filter((m) => m.value !== modelId));
  };

  // Discovery starts: its group is the first of the content (the vendor
  // group hides while collecting), so scroll the content to the top and
  // focus the group's Cancel.
  useEffect(() => {
    if (!isCollecting) return;
    const cancel = cancelDiscoveryRef.current;
    const container = scrollContainerOf(cancel);
    if (container) container.scrollTop = 0;
    cancel?.focus({ preventScroll: true });
  }, [isCollecting]);

  const cancelDiscovery = () => {
    restoreFocusRef.current = true;
    // A busy button is disabled, and a disabled button drops the focus to
    // the body until the discovery stops. Before that, the focused Cancel
    // hands the focus to the status line of the group.
    if (document.activeElement === cancelDiscoveryRef.current) {
      discoveryStatusRef.current?.focus({ preventScroll: true });
    }
    setIsCancellingDiscovery(true);
    collectionAbortRef.current?.abort();
  };

  // When discovery ends inside the page (a user cancel, no records to
  // translate, an error that shows as a toast), the Finding records group
  // unmounts with the focused Cancel: give focus back to the submit button.
  // A layout effect, so it moves in the commit that unmounts the group,
  // before the browser paints the page with the focus on the body. Not
  // after the host confirm or progress modals close: the iframe may not own
  // focus then.
  useLayoutEffect(() => {
    if (isStartingTranslation || !restoreFocusRef.current) return;
    restoreFocusRef.current = false;
    document.getElementById(primaryId)?.focus({ preventScroll: true });
  }, [isStartingTranslation, primaryId]);

  // biome-ignore lint/complexity/noExcessiveCognitiveComplexity: Keeps the launch flow readable at the call site.
  const startTranslation = async () => {
    if (isStartingTranslation || !isReady) return;
    if (!ctx.currentUserAccessToken) {
      ctx.alert(
        "The plugin can't access your API token. Allow it in the plugin settings.",
      );
      return;
    }
    if (!sourceLocale) return;
    if (!isProviderConfigured(pluginParams)) {
      ctx.alert('No AI provider is set up yet.');
      return;
    }

    setIsStartingTranslation(true);
    const collectionController = new AbortController();
    collectionAbortRef.current = collectionController;
    setCollectionProgress({ loaded: 0, modelId: selectedModelIds[0] ?? '' });
    // Until the confirm modal opens, the run ends inside the page.
    let openedHostModal = false;

    try {
      const client = buildDatoCMSClient(
        ctx.currentUserAccessToken,
        ctx.environment,
        ctx.cmaBaseUrl,
      );
      const allRecordIds = await collectRecordIds(client, selectedModelIds, {
        onProgress: setCollectionProgress,
        checkCancellation: () => collectionController.signal.aborted,
        abortSignal: collectionController.signal,
      });
      if (collectionController.signal.aborted) return;
      setCollectionProgress(null);

      if (allRecordIds.length === 0) {
        restoreFocusRef.current = true;
        void ctx.customToast({
          type: 'warning',
          message: NO_RECORDS_WARNING,
          dismissOnPageChange: true,
        });
        return;
      }

      // Confirm before the destructive operation via the confirm modal,
      // passing the full models → selected-fields breakdown so the user can
      // review exactly what will be translated.
      const confirmParams: TranslationConfirmModalParams = {
        recordCount: allRecordIds.length,
        fromLocale: sourceLocale.value,
        toLocales: targetLocales,
        vendorName: pluginParams.vendor
          ? vendorName(pluginParams.vendor)
          : undefined,
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
      // The review and the progress dialogs draw a footer with Cancel at the
      // left, so the host draws no cross (`closeDisabled`): their own
      // buttons, and the Escape they register, are the ways out. A cross on
      // the progress dialog would close it mid-run and abort the job without
      // its summary.
      openedHostModal = true;
      const confirmed = await ctx.openModal({
        id: 'translationConfirmModal',
        title: confirmTranslationTitle(allRecordIds.length, locale),
        width: 'm',
        closeDisabled: true,
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
        closeDisabled: true,
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

      // Not awaited: the button stops being busy as soon as the progress
      // modal closes.
      reportTranslationOutcome(ctx, result, allRecordIds.length, locale);
    } catch (error) {
      if (!collectionController.signal.aborted) {
        if (!openedHostModal) restoreFocusRef.current = true;
        handleUIError(error, pluginParams.vendor, ctx);
      }
    } finally {
      collectionAbortRef.current = null;
      setCollectionProgress(null);
      setIsCancellingDiscovery(false);
      setIsStartingTranslation(false);
    }
  };

  const handleSubmit = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    void startTranslation();
  };

  const content =
    view === 'form' ? (
      <Page variant="large">
        <Page.Content>
          {!providerConfigured && !isCollecting && (
            <Page.Group
              title="AI provider"
              tone="warning"
              status={<Pill tone="warning">Not set up</Pill>}
            >
              {/* The callout says the problem in one sentence; the row
                  below has the action that fixes it. */}
              <Callout tone="warning">
                No AI provider is set up yet, so records can't be translated.
              </Callout>
              <SettingsList>
                <SettingsList.Row
                  title="Vendor credentials"
                  description="Pick the vendor that translates the records, and enter its API key."
                  action={
                    <Button
                      tone="ghost"
                      label="Open plugin settings"
                      to={pluginSettingsPath}
                    />
                  }
                />
              </SettingsList>
            </Page.Group>
          )}

          {collectionProgress && (
            <Page.Group
              title="Finding records"
              actions={
                <Button
                  ref={cancelDiscoveryRef}
                  tone="ghost"
                  label="Cancel"
                  busy={isCancellingDiscovery}
                  onClick={cancelDiscovery}
                />
              }
            >
              <DiscoveryProgress
                progress={collectionProgress}
                statusRef={discoveryStatusRef}
              />
            </Page.Group>
          )}

          <LocalesGroup
            locales={locales}
            sourceLocale={sourceLocale}
            targetOptions={targetOptions}
            targetValues={targetValues}
            isLocked={fieldsLocked}
            onSourceChange={handleSourceLocaleChange}
            onTargetsChange={handleTargetLocalesChange}
          />

          <Page.Group title="Models" footer={pagination}>
            {/* The title of the group names the select. */}
            <FieldWrapper
              label="Models"
              labelExtras={{ hidden: true }}
              required
              hint={modelSelect.hint}
              error={showModelsError ? PICK_MODEL_ERROR : undefined}
            >
              <SelectInput
                multiple
                name="selectedModels"
                {...modelSelect.selectProps}
                value={selectedModelIds}
                onChange={handleModelChange}
                placeholder={modelSelect.placeholder('Pick models')}
                formatOptionLabel={formatApiKeyOptionLabel}
                noOptionsMessage={noModelsFound}
                disabled={fieldsLocked}
              />
            </FieldWrapper>

            {visibleModels.map((model) => (
              <ModelFieldPicker
                key={model.value}
                model={model}
                fields={fieldsByModel[model.value]}
                isLoading={loadingFieldsForModel.has(model.value)}
                loadFailed={failedFieldModels.has(model.value)}
                isDisabled={fieldsLocked}
                selectedApiKeys={selectedFieldsByModel[model.value] ?? []}
                onChange={(apiKeys) => setModelFields(model.value, apiKeys)}
                onRemove={() => removeModel(model.value)}
                onRetry={() => retryFields(model.value)}
                pluginSettingsPath={pluginSettingsPath}
                validationMessage={fieldError(model.value)}
              />
            ))}
          </Page.Group>
        </Page.Content>
      </Page>
    ) : (
      <StateSlate
        ctx={ctx}
        loadState={loadState}
        view={view}
        onlyLocale={locales[0]}
        onRetry={retryLoad}
        actionRef={slateActionRef}
      />
    );

  return (
    <Main ref={mainRef} className={s.layout}>
      <form onSubmit={handleSubmit} onKeyDown={keepEnterInSelects} noValidate>
        <Pane
          header={
            <Pane.FormHeader>
              <Pane.FormHeader.Title
                help={
                  <Toolbar.Help docsUrl={DOCS_URL}>{HELP_TEXT}</Toolbar.Help>
                }
              >
                Bulk translations
              </Pane.FormHeader.Title>
              {view === 'form' && (
                <Pane.FormHeader.Submit>
                  <Toolbar.Button
                    id={primaryId}
                    tone="primary"
                    submit
                    label="Translate records"
                    busy={isStartingTranslation}
                    disabled={
                      !isStartingTranslation && blockedReason !== null
                        ? { reason: blockedReason }
                        : undefined
                    }
                  />
                </Pane.FormHeader.Submit>
              )}
            </Pane.FormHeader>
          }
        >
          {content}
        </Pane>
      </form>
    </Main>
  );
}
