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
 * {@link PICKER_DISMISSED}. When the records can't be translated (no AI
 * vendor, a single locale, no field to translate), it shows the problem and a
 * Close instead of the form.
 *
 * The content flows inside the host-drawn dialog (the host draws the title),
 * in the Canvas that main.tsx gives every frame.
 *
 * Flow:
 *   1. User picks source locale, target locales, and which fields to
 *      translate per model.
 *   2. Clicks "Translate N records" → the modal resolves with the chosen
 *      config and closes. The line above the button says what the run does
 *      to the records, so this click is the commitment: no confirm follows.
 *   3. The items-dropdown handler (a non-modal context) runs the progress
 *      modal. Opening it from inside this modal would nest a modal inside a
 *      modal, which DatoCMS renders *behind* the current modal and leaves
 *      hanging forever on "Working…".
 */
import type { RenderModalCtx } from 'datocms-plugin-sdk';
import { useRegisterActions } from 'datocms-react-ui/Actions';
import Button from 'datocms-react-ui/Button';
import Callout from 'datocms-react-ui/Callout';
import { DisclosureChevron } from 'datocms-react-ui/Chevron';
import FieldWrapper from 'datocms-react-ui/FieldWrapper';
import Link from 'datocms-react-ui/Link';
import RawButton from 'datocms-react-ui/RawButton';
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
import { formatList, formatLocaleWithCode } from '../utils/localeUtils';
import {
  getTranslationReadiness,
  resolveTargetLocales,
} from '../utils/translation/BulkTranslationHelpers';
import { vendorName } from '../utils/translation/ProviderErrors';
import { isProviderConfigured } from '../utils/translation/ProviderFactory';
import s from './AITranslationsPickerModal.module.css';
import {
  BULK_RUN_CONSEQUENCE,
  formatCount,
  isLargeRun,
  LARGE_RUN_TITLE,
  largeRunWarning,
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
import { useBoundedChipSelect } from './BulkTranslations/useBoundedChipSelect';
import { useModelFields } from './BulkTranslations/useModelFields';
import { useModelPickerPage } from './BulkTranslations/useModelPickerPage';

type LocaleOption = ChipOption;

/**
 * Outcome the picker modal resolves with. A dismissal resolves it without
 * `config` ({@link PICKER_DISMISSED}, from the Cancel, Escape or the Close of
 * the error fallback).
 */
export interface AITranslationsPickerModalResult {
  /**
   * Present when the user started a run. The top-level items-dropdown
   * handler (a non-modal context) uses it to open the progress modal. That
   * call must not happen here: opening a modal from inside this modal nests
   * modal-on-modal, which DatoCMS renders behind the current modal and never
   * resolves.
   */
  config?: {
    fromLocale: string;
    toLocales: string[];
    selectedFieldsByModel: Record<string, string[]>;
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
   * `ModelFieldPicker` can render the label directly, with the number of
   * selected records of the model (when the caller counted them).
   */
  models: Array<{
    label: string;
    value: string;
    code: string;
    recordCount?: number;
  }>;
  pluginParams: ctxParamsType;
  accessToken: string;
}

interface Props {
  ctx: RenderModalCtx;
  parameters: AITranslationsPickerModalParams;
}

const PROVIDER_MISSING_TITLE = 'No AI vendor set up';
/**
 * The title for a role that can't open the plugin settings: the vendor is a
 * setting it never sees.
 */
const TRANSLATION_MISSING_TITLE = 'Translation not set up';

/**
 * From this many models on, the field selects of the models start closed
 * behind "Fields of each model": every field of every model is picked until
 * the user opens them.
 */
const MANY_MODELS = 6;
const SINGLE_LOCALE_TITLE = 'Only one locale';
const NOTHING_TO_TRANSLATE_TITLE = 'Nothing to translate';

/**
 * The line about the selected records of the models excluded in the plugin
 * settings: "2 Author records will be skipped: Author is excluded in the
 * plugin settings."
 */
function excludedModelsLine(
  excluded: AITranslationsPickerModalParams['models'],
  locale: string,
): string {
  const names = formatList(excluded.map((model) => model.label));
  const counted = excluded.every((model) => model.recordCount !== undefined);
  const total = excluded.reduce(
    (sum, model) => sum + (model.recordCount ?? 0),
    0,
  );
  let records = 'The records of these models';
  if (counted && excluded.length === 1) {
    records = `${formatCount(total, locale)} ${excluded[0]?.label} ${total === 1 ? 'record' : 'records'}`;
  } else if (counted) {
    records = recordCount(total, locale);
  } else if (excluded.length === 1) {
    records = `The ${excluded[0]?.label} records`;
  }
  return `${records} will be skipped: ${names} ${excluded.length === 1 ? 'is' : 'are'} excluded in the plugin settings.`;
}

/** The selected records of the excluded models, when the caller counted them. */
function skippedRecordCount(
  excluded: AITranslationsPickerModalParams['models'],
): number {
  return excluded.reduce((sum, model) => sum + (model.recordCount ?? 0), 0);
}

/**
 * Why nothing can start, with the page that fixes it for a role that can
 * open it, else who to ask: no AI vendor set up, a single locale, or no
 * field to translate in the selected models.
 */
function NotTranslatableCallout({
  ctx,
  providerConfigured,
  isSingleLocale,
  models,
}: {
  ctx: RenderModalCtx;
  providerConfigured: boolean;
  isSingleLocale: boolean;
  /** The selected models, when none has a field to translate. */
  models: AITranslationsPickerModalParams['models'];
}) {
  const permissions = ctx.currentRole.meta.final_permissions;
  if (!providerConfigured) {
    if (!permissions.can_edit_schema) {
      return (
        <Callout tone="warning" title={TRANSLATION_MISSING_TITLE}>
          Ask an admin to set it up.
        </Callout>
      );
    }
    return (
      <Callout tone="warning" title={PROVIDER_MISSING_TITLE}>
        These records can't be translated yet. Add the credentials of an AI
        vendor in the {/* A new tab, so the dialog stays open. */}
        <Link to={buildPluginSettingsPath(ctx)} target="_blank">
          plugin settings
        </Link>
        .
      </Callout>
    );
  }
  if (!isSingleLocale) {
    const names = formatList(models.map((model) => model.label));
    const lead = `${names} ${models.length === 1 ? 'has' : 'have'} no fields that the plugin translates.`;
    return (
      <Callout tone="warning" title={NOTHING_TO_TRANSLATE_TITLE}>
        {permissions.can_edit_schema ? (
          <>
            {lead} Allow more field types in the{' '}
            <Link to={buildPluginSettingsPath(ctx)} target="_blank">
              plugin settings
            </Link>
            .
          </>
        ) : (
          `${lead} Ask an admin to allow more field types.`
        )}
      </Callout>
    );
  }
  return (
    <Callout tone="warning" title={SINGLE_LOCALE_TITLE}>
      {permissions.can_edit_environment ? (
        <>
          There's nothing to translate these records into. Add another locale in
          the{' '}
          <Link to={buildLocaleSettingsPath(ctx)} target="_blank">
            Locales & Timezone settings
          </Link>{' '}
          first.
        </>
      ) : (
        "There's nothing to translate these records into. Ask an admin to add another locale."
      )}
    </Callout>
  );
}

/**
 * True once every selected model loaded its fields and none has one to
 * translate: the run can't start.
 */
function hasNoFieldToTranslate(
  models: AITranslationsPickerModalParams['models'],
  fieldsByModel: Record<string, readonly unknown[] | undefined>,
): boolean {
  return (
    models.length > 0 &&
    models.every((model) => fieldsByModel[model.value]?.length === 0)
  );
}

/** The plugin settings, for a role that can open them. */
function pluginSettingsPathFor(ctx: RenderModalCtx): string | undefined {
  return ctx.currentRole.meta.final_permissions.can_edit_schema
    ? buildPluginSettingsPath(ctx)
    : undefined;
}

/**
 * What the user selected: "You selected 3 records of the Article model.", or
 * "You selected 5 records from 2 models." The records of excluded models
 * count too: the callout under it says that they are skipped.
 */
function SelectionIntro({
  records,
  models,
  excluded,
  locale,
}: {
  records: number;
  models: AITranslationsPickerModalParams['models'];
  /** The selected models that are excluded in the plugin settings. */
  excluded: AITranslationsPickerModalParams['models'];
  locale: string;
}) {
  const [onlyModel] = models;
  return (
    <>
      <p className={s.intro}>
        You selected <strong>{recordCount(records, locale)}</strong>{' '}
        {models.length === 1 && onlyModel ? (
          <>
            of the <strong>{onlyModel.label}</strong> model.
          </>
        ) : (
          <>
            from <strong>{modelCount(models.length, locale)}</strong>.
          </>
        )}
      </p>
      {excluded.length > 0 && (
        <Callout tone="warning">{excludedModelsLine(excluded, locale)}</Callout>
      )}
    </>
  );
}

/**
 * The field selects of many models, behind "Fields of each model": closed,
 * a note says which fields are translated. A model that needs the user (its
 * fields failed to load, it has none to translate, none is picked) keeps
 * them open, and the note under the disabled toggle says why.
 */
function ManyModelsDisclosure({
  needsUser,
  allFieldsPicked,
  children,
}: {
  needsUser: boolean;
  /** Every field of every loaded model is picked. */
  allFieldsPicked: boolean;
  children: ReactNode;
}) {
  const [open, setOpen] = useState(false);
  const id = useId();
  const reasonId = useId();
  const show = open || needsUser;
  return (
    <>
      <div className={s.disclosureBlock}>
        <RawButton
          className={s.disclosure}
          expandable={{ open: show, controls: id }}
          disabled={needsUser ? 'focusable' : undefined}
          aria-describedby={needsUser ? reasonId : undefined}
          onClick={() => setOpen((value) => !value)}
        >
          <DisclosureChevron open={show} />
          Fields of each model
        </RawButton>
        {needsUser ? (
          <p id={reasonId} className={s.disclosureNote}>
            A model needs your attention, so the fields stay open.
          </p>
        ) : (
          !show && (
            <p className={s.disclosureNote}>
              {allFieldsPicked
                ? 'All the fields of every model are translated.'
                : 'Only the fields you picked are translated.'}
            </p>
          )
        )}
      </div>
      <div id={id} hidden={!show}>
        {show && children}
      </div>
    </>
  );
}

/** The Escape of the dialog: the Cancel (or Close) of its footer. */
const CANCEL_ACTION_ID = 'aiTranslationsPicker.cancel';

const noLocalesFound = () => 'No locales found';

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
  const excludedModels = parameters.models.filter((model) =>
    excludedModelCodes.has(model.code),
  );
  // The records that the run translates: the selected ones without those of
  // the excluded models (the dropdown handler leaves them out of the run).
  // The submit button says this count; the intro says the selection.
  const recordsToTranslate = Math.max(
    0,
    itemIds.length - skippedRecordCount(excludedModels),
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

  // Every model loaded its fields and none has one to translate: the run
  // can't start, so nothing says what it would do.
  const nothingToTranslate = models.every(
    (model) => fieldsByModel[model.value]?.length === 0,
  );
  // Without a vendor, a second locale or a field to translate, nothing can
  // start: the dialog shows the problem and a Close, not a form that can't
  // be used. A selection with some fields to translate keeps the form, with
  // the problem under each model that has none.
  const canTranslate =
    providerConfigured &&
    !isSingleLocale &&
    !hasNoFieldToTranslate(models, fieldsByModel);

  // A role that can open the plugin settings gets the link to allow more
  // field types; the others are told to ask an admin.
  const pluginSettingsPath = pluginSettingsPathFor(ctx);

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
      ctx.alert('No AI vendor is set up yet.');
      return;
    }

    setIsSubmitting(true);

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
      },
    } satisfies AITranslationsPickerModalResult);
  };

  const handleSubmit = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    handleStart();
  };

  // When nothing can start, the way out is a Close; otherwise it cancels
  // the translation before it starts.
  const dismissLabel = canTranslate ? 'Cancel' : 'Close';
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

  const fieldPickers = (
    <>
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
          pluginSettingsPath={pluginSettingsPath}
          validationMessage={
            needsFieldError(model.value) ? PICK_FIELD_ERROR : undefined
          }
        />
      ))}
    </>
  );

  return (
    <form onSubmit={handleSubmit} onKeyDown={keepEnterInSelects} noValidate>
      {/* When nothing can start, the problem and Close are the whole
          dialog: the selection and its skipped records don't matter. */}
      {!canTranslate && (
        <NotTranslatableCallout
          ctx={ctx}
          providerConfigured={providerConfigured}
          isSingleLocale={isSingleLocale}
          models={models}
        />
      )}
      {canTranslate && (
        <>
          <SelectionIntro
            records={itemIds.length}
            models={parameters.models}
            excluded={excludedModels}
            locale={locale}
          />
          <FieldWrapper label="Translate from" hint={sourceSelect.hint}>
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
            label="Translate into"
            hint={targetSelect.hint}
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
          {models.length >= MANY_MODELS ? (
            <ManyModelsDisclosure
              needsUser={models.some(
                (model) =>
                  fieldsByModel[model.value]?.length === 0 ||
                  failedFieldModels.has(model.value) ||
                  needsFieldError(model.value),
              )}
              allFieldsPicked={models.every((model) => {
                const picked = new Set(selectedFieldsByModel[model.value]);
                return (fieldsByModel[model.value] ?? []).every((field) =>
                  picked.has(field.apiKey),
                );
              })}
            >
              {fieldPickers}
            </ManyModelsDisclosure>
          ) : (
            fieldPickers
          )}
          {isLargeRun(recordsToTranslate, targetLocales.length) && (
            <Callout tone="warning" title={LARGE_RUN_TITLE}>
              {largeRunWarning(
                pluginParams.vendor
                  ? vendorName(pluginParams.vendor)
                  : undefined,
              )}
            </Callout>
          )}
          {/* What the run does, said before the button that starts it. */}
          {!nothingToTranslate && (
            <p className={s.consequence}>{BULK_RUN_CONSEQUENCE}</p>
          )}
        </>
      )}
      {/* Cancel at the left, the main action at the right. When nothing can
          start, Close alone is the way out. */}
      <div className={s.actions}>
        <Button
          tone="ghost"
          label={dismissLabel}
          className={s.cancel}
          onClick={dismiss}
        />
        {canTranslate && (
          <Button
            submit
            tone="primary"
            label={translateRecordsLabel(recordsToTranslate, locale)}
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
