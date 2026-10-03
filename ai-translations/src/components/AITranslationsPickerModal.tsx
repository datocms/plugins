/**
 * AITranslationsPickerModal.tsx
 * -----------------------------
 * Modal ("Translate records") that lets the user configure a bulk translation
 * for *a specific set of pre-selected records* — opened from the
 * records-action dropdown. The form mirrors the standalone bulk-translations
 * page, minus the model multi-select (models are derived from the selected
 * records), and reuses the same locale rules, per-model field picker and
 * disabled-reason tooltip. It ends with one full-width submit and has no
 * Cancel: the host's ✕ and Esc dismiss it (resolving `undefined`).
 *
 * Flow:
 *   1. User picks source locale, target locales, and which fields to
 *      translate per model.
 *   2. Clicks "Translate N records" → the modal resolves with the chosen
 *      config and closes.
 *   3. The items-dropdown handler (a non-modal context) runs the confirm +
 *      progress modal. Opening those from inside this modal would nest a
 *      modal inside a modal, which DatoCMS renders *behind* the current modal
 *      and leaves hanging forever on "Working…".
 */
import type { RenderModalCtx } from 'datocms-plugin-sdk';
import {
  Canvas,
  FieldGroup,
  Form,
  SelectField,
  Spinner,
} from 'datocms-react-ui';
import { useEffect, useMemo, useState } from 'react';
import type { ctxParamsType } from '../entrypoints/Config/ConfigScreen';
import { Button } from '../ui/Button';
import { DisabledReason } from '../ui/DisabledReason';
import { formatLocaleLabel } from '../utils/localeUtils';
import {
  getTranslationReadiness,
  resolveTargetLocales,
} from '../utils/translation/BulkTranslationHelpers';
import { isProviderConfigured } from '../utils/translation/ProviderFactory';
import s from './AITranslationsPickerModal.module.css';
import {
  FIELD_REQUIRED,
  modelCount,
  recordCount,
  translateRecordsLabel,
} from './BulkTranslations/bulkCopy';
import {
  type ChipOption,
  formatCodeMultiOption,
  formatCodeOption,
} from './BulkTranslations/chipOption';
import {
  ALL_LOCALES_OPTION,
  nextTargetSelection,
  targetsForNewSource,
} from './BulkTranslations/localeSelection';
import { ModelFieldPicker } from './BulkTranslations/ModelFieldPicker';
import { getStartBlockedReason } from './BulkTranslations/startBlockedReason';
import {
  boundedSelectHint,
  useBoundedChipSelect,
} from './BulkTranslations/useBoundedChipSelect';
import { useModelFields } from './BulkTranslations/useModelFields';
import { useModelPickerPage } from './BulkTranslations/useModelPickerPage';
import type { ConfirmModelSummary } from './TranslationConfirmModal';

type SingleValue<T> = T | null;
type MultiValue<T> = readonly T[];

type LocaleOption = ChipOption;

/**
 * Outcome the picker modal resolves with. Dismissing the modal (✕ or Esc)
 * resolves `undefined` instead.
 */
export interface AITranslationsPickerModalResult {
  /**
   * Present when the user confirmed a run. The top-level items-dropdown
   * handler (a non-modal context) uses it to open the confirm + progress
   * modal. Those calls must not happen here: opening a modal/confirm from
   * inside this modal nests modal-on-modal, which DatoCMS renders behind the
   * current modal and never resolves.
   */
  config?: {
    fromLocale: string;
    toLocales: string[];
    selectedFieldsByModel: Record<string, string[]>;
    /** Per-model field breakdown for the confirm modal's review section. */
    models: ConfirmModelSummary[];
  };
}

export interface AITranslationsPickerModalParams {
  itemIds: string[];
  /**
   * Models present in the selected items, each shaped as a chip-option so
   * `ModelFieldPicker` can render the label + api_key directly.
   */
  models: Array<{ label: string; value: string; code: string }>;
  pluginParams: ctxParamsType;
  accessToken: string;
}

interface Props {
  ctx: RenderModalCtx;
  parameters: AITranslationsPickerModalParams;
}

const PROVIDER_MISSING_LINE =
  'No AI vendor is set up yet. Add its credentials in the plugin settings to start translating.';

export default function AITranslationsPickerModal({ ctx, parameters }: Props) {
  const { itemIds, pluginParams } = parameters;
  const excludedModelCodes = useMemo(
    () => new Set(pluginParams.modelsToBeExcludedFromThisPlugin ?? []),
    [pluginParams.modelsToBeExcludedFromThisPlugin],
  );
  const models = useMemo(
    () =>
      parameters.models.filter((model) => !excludedModelCodes.has(model.code)),
    [parameters.models, excludedModelCodes],
  );

  const locales = useMemo<LocaleOption[]>(
    () =>
      ctx.site.attributes.locales.map((locale: string) => ({
        label: formatLocaleLabel(locale),
        value: locale,
        code: locale,
      })),
    [ctx.site.attributes.locales],
  );
  const isSingleLocale = ctx.site.attributes.locales.length < 2;
  const providerConfigured = isProviderConfigured(pluginParams);
  const { visibleModels, controls: modelPageControls } =
    useModelPickerPage(models);

  const [sourceLocale, setSourceLocale] = useState<LocaleOption | null>(
    locales[0] ?? null,
  );
  // Default to "All other locales" so the common case takes zero clicks.
  const [targetLocaleOptions, setTargetLocaleOptions] = useState<
    LocaleOption[]
  >([ALL_LOCALES_OPTION]);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const selectedModelIds = useMemo(() => models.map((m) => m.value), [models]);
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
      parameters.accessToken,
    ]),
    loadFields: (modelId) => ctx.loadItemTypeFields(modelId),
    translationFields: pluginParams.translationFields,
    excludedApiKeys: pluginParams.apiKeysToBeExcludedFromThisPlugin,
  });

  useEffect(() => {
    const valid = new Set(locales.map((locale) => locale.value));
    setSourceLocale((prev) =>
      prev && valid.has(prev.value) ? prev : (locales[0] ?? null),
    );
    setTargetLocaleOptions((prev) =>
      targetsForNewSource(
        prev.filter(
          (option) =>
            option.value === ALL_LOCALES_OPTION.value ||
            valid.has(option.value),
        ),
        sourceLocale?.value ?? '',
      ),
    );
  }, [locales, sourceLocale]);

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

  // Models whose fields haven't arrived yet (in flight, or not fetched and
  // not failed).
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
    models,
    pendingModelIds,
    failedModelIds: failedFieldModels,
    fieldsByModel,
    requireModels: false,
  });

  /**
   * "Field is required" under a model's field select: only once its fields
   * loaded and there is something to pick.
   */
  const needsFieldError = (modelId: string) =>
    readiness.modelsMissingFields.includes(modelId) &&
    (fieldsByModel[modelId]?.length ?? 0) > 0;

  const targetOptions = useMemo<LocaleOption[]>(
    () => [
      ALL_LOCALES_OPTION,
      ...locales.filter((l) => l.value !== sourceLocale?.value),
    ],
    [locales, sourceLocale],
  );

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
        ? [newValue]
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

  /**
   * Resolve the picker with the chosen config and close. The confirm +
   * progress modal run in the items-dropdown handler's (non-modal) context;
   * see {@link AITranslationsPickerModalResult} for why they can't run here.
   */
  const handleStart = () => {
    if (blockedReason !== null || isSubmitting || !sourceLocale) return;
    if (!isProviderConfigured(pluginParams)) {
      ctx.alert("Couldn't start the translation, as no AI vendor is set up!");
      return;
    }

    setIsSubmitting(true);

    // Build the per-model field breakdown here, where the field metadata is
    // already loaded, so the confirm modal can show exactly what will run.
    const modelSummaries: ConfirmModelSummary[] = models.map((model) => {
      const selectedKeys = new Set(selectedFieldsByModel[model.value] ?? []);
      return {
        label: model.label,
        code: model.code,
        fields: (fieldsByModel[model.value] ?? [])
          .filter((field) => selectedKeys.has(field.apiKey))
          .map((field) => ({ label: field.label, apiKey: field.apiKey })),
      };
    });

    ctx.resolve({
      config: {
        fromLocale: sourceLocale.value,
        toLocales: targetLocales,
        selectedFieldsByModel: Object.fromEntries(
          parameters.models.map((model) => [
            model.value,
            selectedFieldsByModel[model.value] ?? [],
          ]),
        ),
        models: modelSummaries,
      },
    } satisfies AITranslationsPickerModalResult);
  };

  const intro =
    models.length === 1 ? (
      <>
        You selected <strong>{recordCount(itemIds.length)}</strong> of the{' '}
        <strong>{models[0].label}</strong> model.
      </>
    ) : (
      <>
        You selected <strong>{recordCount(itemIds.length)}</strong> from{' '}
        <strong>{modelCount(models.length)}</strong>.
      </>
    );

  return (
    <Canvas ctx={ctx}>
      <Form onSubmit={handleStart}>
        {models.length < parameters.models.length && (
          <div className="dl-callout dl-callout--warning dl-callout--flush">
            Records of models excluded in the plugin settings will be skipped.
          </div>
        )}
        {!providerConfigured && (
          <div className="dl-callout dl-callout--warning dl-callout--flush">
            {PROVIDER_MISSING_LINE}
          </div>
        )}
        {isSingleLocale && (
          <div className="dl-callout dl-callout--warning dl-callout--flush">
            This environment has only one locale, so there's nothing to
            translate these records into. Add another locale in the Locales
            &amp; Timezone settings first.
          </div>
        )}
        <p className={s.intro}>{intro}</p>
        {!isSingleLocale && (
          <div role="group" aria-labelledby="picker-locales">
            <h2
              id="picker-locales"
              className="dl-micro-label"
              style={{ marginBottom: 'var(--spacing-m)' }}
            >
              Locales
            </h2>
            <FieldGroup>
              <SelectField
                id="sourceLocale"
                name="sourceLocale"
                label="Source locale"
                required
                hint={boundedSelectHint(
                  sourceSelect.hint,
                  'Content in this locale is translated into the target locales',
                )}
                value={sourceLocale}
                onChange={handleSourceLocaleChange}
                selectInputProps={{
                  ...sourceSelect.selectProps,
                  formatOptionLabel: formatCodeOption,
                  isClearable: false,
                }}
              />
              <SelectField
                id="targetLocales"
                name="targetLocales"
                label="Target locales"
                required
                hint={boundedSelectHint(
                  targetSelect.hint,
                  '"All other locales" includes every locale except the source one',
                )}
                placeholder={targetSelect.placeholder('Select locales…')}
                error={
                  targetLocaleOptions.length === 0 ? FIELD_REQUIRED : undefined
                }
                value={targetLocaleOptions}
                onChange={handleTargetLocalesChange}
                selectInputProps={{
                  isMulti: true,
                  ...targetSelect.selectProps,
                  formatOptionLabel: formatCodeMultiOption,
                  noOptionsMessage: () => 'No locales found',
                }}
              />
            </FieldGroup>
          </div>
        )}
        {!isSingleLocale && (
          <div role="group" aria-labelledby="picker-fields">
            <h2
              id="picker-fields"
              className="dl-micro-label"
              style={{ marginBottom: 'var(--spacing-m)' }}
            >
              Fields
            </h2>
            <FieldGroup>
              {modelPageControls}
              {visibleModels.map((model) => (
                <ModelFieldPicker
                  key={model.value}
                  model={model}
                  fields={fieldsByModel[model.value]}
                  isLoading={loadingFieldsForModel.has(model.value)}
                  loadFailed={failedFieldModels.has(model.value)}
                  selectedApiKeys={selectedFieldsByModel[model.value] ?? []}
                  onChange={(apiKeys) => setModelFields(model.value, apiKeys)}
                  onRetry={() => retryFields(model.value)}
                  validationMessage={
                    needsFieldError(model.value) ? FIELD_REQUIRED : undefined
                  }
                />
              ))}
            </FieldGroup>
          </div>
        )}
        {!isSingleLocale && (
          <DisabledReason
            reason={isSubmitting ? null : blockedReason}
            placement="top"
            block
          >
            <Button
              type="submit"
              buttonType="primary"
              buttonSize="xl"
              fullWidth
              disabled={isSubmitting || blockedReason !== null}
            >
              {isSubmitting ? (
                <>
                  Please wait&nbsp;
                  <Spinner size={20} />
                </>
              ) : (
                translateRecordsLabel(itemIds.length)
              )}
            </Button>
          </DisabledReason>
        )}
      </Form>
    </Canvas>
  );
}
