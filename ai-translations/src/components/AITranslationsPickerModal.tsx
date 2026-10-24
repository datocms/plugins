/**
 * AITranslationsPickerModal.tsx
 * -----------------------------
 * Modal ("Translate records") that lets the user configure a bulk translation
 * for *a specific set of pre-selected records* — opened from the
 * records-action dropdown. The form mirrors the standalone bulk-translations
 * page, minus the model multi-select (models are derived from the selected
 * records), and reuses the same locale rules, per-model field picker and
 * disabled reasons. It ends with a footer: Cancel at the left, the submit at
 * the right. A dialog with a footer has no cross, so it opens with no host
 * cross (`closeDisabled`) and registers Escape as that Cancel. Both resolve
 * {@link PICKER_DISMISSED}.
 *
 * The content flows inside the host-drawn dialog (the host draws the title),
 * in the Canvas that main.tsx gives every frame.
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
import { useRegisterActions } from 'datocms-react-ui/Actions';
import Button from 'datocms-react-ui/Button';
import Callout from 'datocms-react-ui/Callout';
import FieldWrapper from 'datocms-react-ui/FieldWrapper';
import Heading from 'datocms-react-ui/Heading';
import Link from 'datocms-react-ui/Link';
import SelectInput from 'datocms-react-ui/SelectInput';
import {
  type FormEvent,
  type ReactNode,
  useEffect,
  useId,
  useMemo,
  useState,
} from 'react';
import type { ctxParamsType } from '../entrypoints/Config/ConfigScreen';
import {
  buildLocaleSettingsPath,
  buildPluginSettingsPath,
} from '../utils/dashboardPaths';
import { formatLocaleWithCode } from '../utils/localeUtils';
import {
  getTranslationReadiness,
  resolveTargetLocales,
} from '../utils/translation/BulkTranslationHelpers';
import { isProviderConfigured } from '../utils/translation/ProviderFactory';
import s from './AITranslationsPickerModal.module.css';
import {
  modelCount,
  PICK_FIELD_ERROR,
  PICK_LOCALE_ERROR,
  recordCount,
  translateRecordsLabel,
} from './BulkTranslations/bulkCopy';
import type { ChipOption } from './BulkTranslations/chipOption';
import { keepEnterInSelects } from './BulkTranslations/keepEnterInSelects';
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

type LocaleOption = ChipOption;

/**
 * Outcome the picker modal resolves with. A dismissal resolves it without
 * `config` ({@link PICKER_DISMISSED}, from the Cancel, Escape or the Close of
 * the error fallback).
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

/**
 * What a dismissal resolves (the Cancel, Escape, the Close of the error
 * fallback): no config, so the dropdown handler stops there.
 */
export const PICKER_DISMISSED: AITranslationsPickerModalResult = {};

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

const EXCLUDED_MODELS_LINE =
  'Records of models excluded in the plugin settings will be skipped.';
const PROVIDER_MISSING_TITLE = 'No AI vendor set up';
const SINGLE_LOCALE_TITLE = 'Only one locale';

/** The Escape of the dialog: the Cancel (or Close) of its footer. */
const CANCEL_ACTION_ID = 'aiTranslationsPicker.cancel';

/**
 * The page that fixes a problem, named in the text of its Callout: a link
 * when the role can open it, plain text otherwise. The link opens a new tab,
 * so the dialog stays open.
 */
function SettingsPageLink({
  to,
  allowed,
  children,
}: {
  to: string;
  allowed: boolean;
  children: string;
}): ReactNode {
  if (!allowed) return children;
  return (
    <Link to={to} target="_blank">
      {children}
    </Link>
  );
}

const noLocalesFound = () => 'No locales found';

export default function AITranslationsPickerModal({ ctx, parameters }: Props) {
  const { itemIds, pluginParams } = parameters;
  const localesHeadingId = useId();
  const fieldsHeadingId = useId();
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
        label: formatLocaleWithCode(locale),
        value: locale,
      })),
    [ctx.site.attributes.locales],
  );
  const isSingleLocale = ctx.site.attributes.locales.length < 2;
  const providerConfigured = isProviderConfigured(pluginParams);
  const permissions = ctx.currentRole.meta.final_permissions;
  // Counts get the separators of the language that the Canvas gives the kit.
  const locale = ctx.ui.locale;
  // The dialog is narrow: the pagination shows fewer page numbers.
  const { visibleModels, pagination } = useModelPickerPage(models, {
    compact: true,
  });

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
   * "Pick at least one field" under a model's field select: only once its
   * fields loaded and there is something to pick.
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
  const sourceValues = useMemo(
    () => (sourceLocale ? [sourceLocale.value] : []),
    [sourceLocale],
  );
  const targetValues = useMemo(
    () => targetLocaleOptions.map((option) => option.value),
    [targetLocaleOptions],
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

  const handleSubmit = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    handleStart();
  };

  // With a single locale there's nothing to start, so the way out is a
  // Close; otherwise it cancels the translation before it starts.
  const dismissLabel = isSingleLocale ? 'Close' : 'Cancel';
  const dismiss = () => ctx.resolve(PICKER_DISMISSED);

  // The host draws no cross on this dialog, so Escape is the Cancel of the
  // footer, as in the kit's dialogs. Its key only makes sense as a key.
  useRegisterActions([
    {
      id: CANCEL_ACTION_ID,
      name: dismissLabel,
      shortcut: { key: 'escape' },
      palette: 'hidden',
      run: dismiss,
    },
  ]);

  const intro =
    models.length === 1 ? (
      <>
        You selected <strong>{recordCount(itemIds.length, locale)}</strong> of
        the <strong>{models[0].label}</strong> model.
      </>
    ) : (
      <>
        You selected <strong>{recordCount(itemIds.length, locale)}</strong> from{' '}
        <strong>{modelCount(models.length, locale)}</strong>.
      </>
    );

  return (
    <form onSubmit={handleSubmit} onKeyDown={keepEnterInSelects} noValidate>
      {models.length < parameters.models.length && (
        <Callout tone="warning">{EXCLUDED_MODELS_LINE}</Callout>
      )}
      {!providerConfigured && (
        <Callout tone="warning" title={PROVIDER_MISSING_TITLE}>
          These records can't be translated yet. Add the credentials of an AI
          vendor in the{' '}
          <SettingsPageLink
            to={buildPluginSettingsPath(ctx)}
            allowed={permissions.can_edit_schema}
          >
            plugin settings
          </SettingsPageLink>
          .
        </Callout>
      )}
      {isSingleLocale && (
        <Callout tone="warning" title={SINGLE_LOCALE_TITLE}>
          There's nothing to translate these records into. Add another locale in
          the{' '}
          <SettingsPageLink
            to={buildLocaleSettingsPath(ctx)}
            allowed={permissions.can_edit_environment}
          >
            Locales & Timezone settings
          </SettingsPageLink>{' '}
          first.
        </Callout>
      )}
      <p className={s.intro}>{intro}</p>
      {!isSingleLocale && (
        <>
          <div
            role="group"
            aria-labelledby={localesHeadingId}
            className={s.group}
          >
            <Heading level={2} id={localesHeadingId} className={s.groupTitle}>
              Locales
            </Heading>
            <FieldWrapper
              label="Source locale"
              required
              hint={boundedSelectHint(
                sourceSelect.hint,
                'Content in this locale is translated into the target locales',
              )}
            >
              <SelectInput
                name="sourceLocale"
                {...sourceSelect.selectProps}
                value={sourceLocale?.value ?? null}
                onChange={handleSourceLocaleChange}
                clearable={false}
                noOptionsMessage={noLocalesFound}
              />
            </FieldWrapper>
            <FieldWrapper
              label="Target locales"
              required
              hint={boundedSelectHint(
                targetSelect.hint,
                '“All other locales” includes every locale except the source one',
              )}
              error={targetValues.length === 0 ? PICK_LOCALE_ERROR : undefined}
            >
              <SelectInput
                multiple
                name="targetLocales"
                {...targetSelect.selectProps}
                value={targetValues}
                onChange={handleTargetLocalesChange}
                placeholder={targetSelect.placeholder('Pick locales')}
                noOptionsMessage={noLocalesFound}
              />
            </FieldWrapper>
          </div>
          <div
            role="group"
            aria-labelledby={fieldsHeadingId}
            className={s.group}
          >
            <Heading level={2} id={fieldsHeadingId} className={s.groupTitle}>
              Fields
            </Heading>
            {pagination && <div className={s.pagination}>{pagination}</div>}
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
                  needsFieldError(model.value) ? PICK_FIELD_ERROR : undefined
                }
              />
            ))}
          </div>
        </>
      )}
      {/* Cancel at the left, the main action at the right. With a single
          locale there's nothing to start: Close alone is the way out. */}
      <div className={s.actions}>
        <Button
          tone="ghost"
          label={dismissLabel}
          className={s.cancel}
          onClick={dismiss}
        />
        {!isSingleLocale && (
          <Button
            submit
            tone="primary"
            label={translateRecordsLabel(itemIds.length, locale)}
            busy={isSubmitting}
            disabled={
              !isSubmitting && blockedReason !== null
                ? { reason: blockedReason }
                : undefined
            }
          />
        )}
      </div>
    </form>
  );
}
