/**
 * AITranslationsPickerModal.tsx
 * -----------------------------
 * Modal that lets the user configure a bulk translation for *a specific set
 * of pre-selected records* — opened from the records-action dropdown ("AI
 * Translations…"). The UI mirrors the standalone bulk-translations page,
 * minus the model multi-select (models are derived from the selected
 * records). Reuses the same chip-option renderer, per-model field picker,
 * and progress modal.
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
import { Button, Canvas, SelectField } from 'datocms-react-ui';
import { useCallback, useEffect, useMemo, useState } from 'react';
import type { ctxParamsType } from '../entrypoints/Config/ConfigScreen';
import { formatLocaleLabel } from '../utils/localeUtils';
import {
  ALL_LOCALES_VALUE,
  defaultFieldSelection,
  filterTranslatableFields,
  isReadyToTranslate,
  resolveTargetLocales,
  type SdkField,
  sortFieldsByLayoutOrder,
  type TranslatableField,
} from '../utils/translation/BulkTranslationHelpers';
import { isProviderConfigured } from '../utils/translation/ProviderFactory';
import s from './AITranslationsPickerModal.module.css';
import {
  CHIP_SELECT_CLASS_PREFIX,
  type ChipOption,
  renderChipOption,
} from './BulkTranslations/chipOption';
import { ModelFieldPicker } from './BulkTranslations/ModelFieldPicker';
import type { ConfirmModelSummary } from './TranslationConfirmModal';

type SingleValue<T> = T | null;
type MultiValue<T> = readonly T[];

type LocaleOption = ChipOption;

/**
 * Outcome the picker modal resolves with. Mirrors the shape produced by the
 * inner progress modal so callers can pattern-match on the same fields.
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
  /** True when the user dismissed the picker before starting anything. */
  dismissedBeforeStart?: boolean;
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

const ALL_LOCALES_OPTION: LocaleOption = {
  label: 'All other locales',
  value: ALL_LOCALES_VALUE,
};

export default function AITranslationsPickerModal({ ctx, parameters }: Props) {
  const { itemIds, models, pluginParams } = parameters;

  const locales = useMemo<LocaleOption[]>(
    () =>
      ctx.site.attributes.locales.map((locale: string) => ({
        label: formatLocaleLabel(locale),
        value: locale,
        code: locale,
      })),
    [ctx.site.attributes.locales],
  );

  const [sourceLocale, setSourceLocale] = useState<LocaleOption | null>(
    locales[0] ?? null,
  );
  // Default to "All other locales" so the common case takes zero clicks.
  const [targetLocaleOptions, setTargetLocaleOptions] = useState<LocaleOption[]>(
    [ALL_LOCALES_OPTION],
  );
  const [fieldsByModel, setFieldsByModel] = useState<
    Record<string, TranslatableField[]>
  >({});
  const [selectedFieldsByModel, setSelectedFieldsByModel] = useState<
    Record<string, string[]>
  >({});
  const [loadingFieldsForModel, setLoadingFieldsForModel] = useState<
    Set<string>
  >(new Set());

  /**
   * Fetches and stores the translatable fields for one model, defaulting
   * the selection to "everything selected". Re-uses the page's pattern of
   * an in-flight marker so quick toggles don't race.
   */
  const ensureFieldsLoaded = useCallback(
    async (modelId: string) => {
      if (fieldsByModel[modelId] || loadingFieldsForModel.has(modelId)) return;

      setLoadingFieldsForModel((prev) => {
        const next = new Set(prev);
        next.add(modelId);
        return next;
      });

      try {
        const fields = (await ctx.loadItemTypeFields(modelId)) as SdkField[];
        const ordered = sortFieldsByLayoutOrder(fields);
        const translatable = filterTranslatableFields(ordered, {
          translationFields: pluginParams.translationFields ?? [],
          apiKeysToBeExcludedFromThisPlugin:
            pluginParams.apiKeysToBeExcludedFromThisPlugin ?? [],
        });

        setFieldsByModel((prev) => ({ ...prev, [modelId]: translatable }));
        setSelectedFieldsByModel((prev) =>
          prev[modelId]
            ? prev
            : { ...prev, [modelId]: defaultFieldSelection(translatable) },
        );
      } catch (error) {
        console.error(`Error loading fields for model ${modelId}:`, error);
        ctx.alert(
          `Error loading fields: ${
            error instanceof Error ? error.message : String(error)
          }`,
        );
      } finally {
        setLoadingFieldsForModel((prev) => {
          const next = new Set(prev);
          next.delete(modelId);
          return next;
        });
      }
    },
    [
      ctx,
      fieldsByModel,
      loadingFieldsForModel,
      pluginParams.apiKeysToBeExcludedFromThisPlugin,
      pluginParams.translationFields,
    ],
  );

  // Load fields for every model represented in the selection on mount.
  useEffect(() => {
    for (const m of models) {
      void ensureFieldsLoaded(m.value);
    }
  }, [models, ensureFieldsLoaded]);

  const allLocaleValues = useMemo(
    () => locales.map((l) => l.value),
    [locales],
  );
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

  const selectedModelIds = useMemo(() => models.map((m) => m.value), [models]);

  const isReady = useMemo(
    () =>
      isReadyToTranslate({
        sourceLocale: sourceLocale?.value ?? null,
        targetLocales,
        selectedModelIds,
        selectedFieldsByModel,
      }),
    [sourceLocale, targetLocales, selectedModelIds, selectedFieldsByModel],
  );

  const targetOptions = useMemo<LocaleOption[]>(
    () => [
      ALL_LOCALES_OPTION,
      ...locales.filter((l) => l.value !== sourceLocale?.value),
    ],
    [locales, sourceLocale],
  );

  const handleTargetLocalesChange = (
    newValue: SingleValue<LocaleOption> | MultiValue<LocaleOption>,
  ) => {
    const next: LocaleOption[] = Array.isArray(newValue)
      ? [...newValue]
      : newValue
        ? [newValue]
        : [];
    const hadAll = targetLocaleOptions.some(
      (o) => o.value === ALL_LOCALES_VALUE,
    );
    const hasAll = next.some((o) => o.value === ALL_LOCALES_VALUE);

    if (!hadAll && hasAll) {
      setTargetLocaleOptions([ALL_LOCALES_OPTION]);
      return;
    }
    if (hadAll && hasAll && next.length > 1) {
      setTargetLocaleOptions(next.filter((o) => o.value !== ALL_LOCALES_VALUE));
      return;
    }
    setTargetLocaleOptions(next);
  };

  const handleSourceLocaleChange = (
    newValue: SingleValue<LocaleOption> | MultiValue<LocaleOption>,
  ) => {
    if (newValue && !Array.isArray(newValue)) {
      setSourceLocale(newValue as LocaleOption);
    }
  };

  const setModelFields = (modelId: string, apiKeys: string[]) => {
    setSelectedFieldsByModel((prev) => ({ ...prev, [modelId]: apiKeys }));
  };

  /**
   * Resolve the picker with the chosen config and close. The confirm +
   * progress modal run in the items-dropdown handler's (non-modal) context;
   * see {@link AITranslationsPickerModalResult} for why they can't run here.
   */
  const handleStart = () => {
    if (!isReady || !sourceLocale) return;
    if (!isProviderConfigured(pluginParams)) {
      ctx.alert(
        'Please configure valid credentials for the selected AI vendor in the plugin settings',
      );
      return;
    }

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
        selectedFieldsByModel,
        models: modelSummaries,
      },
    } satisfies AITranslationsPickerModalResult);
  };

  const handleCancel = () => {
    ctx.resolve({
      dismissedBeforeStart: true,
    } satisfies AITranslationsPickerModalResult);
  };

  return (
    <Canvas ctx={ctx}>
      <div className={s.modal}>
        <p className={s.intro}>
          Translating <strong>{itemIds.length}</strong> selected record
          {itemIds.length === 1 ? '' : 's'} across{' '}
          <strong>{models.length}</strong> model
          {models.length === 1 ? '' : 's'}.
        </p>

        {/* Source + target row */}
        <div className={s.section}>
          <div className={s.localeRow}>
            <div>
              <SelectField
                name="sourceLocale"
                id="sourceLocale"
                label="Source language"
                hint="Translate from"
                value={sourceLocale}
                selectInputProps={{
                  options: locales,
                  formatOptionLabel: renderChipOption,
                  classNamePrefix: CHIP_SELECT_CLASS_PREFIX,
                }}
                onChange={handleSourceLocaleChange}
              />
            </div>
            <div className={s.localeArrow} aria-hidden>
              →
            </div>
            <div>
              <SelectField
                name="targetLocales"
                id="targetLocales"
                label="Target languages"
                hint="Pick one or more, or “All other locales”"
                value={targetLocaleOptions}
                selectInputProps={{
                  isMulti: true,
                  options: targetOptions,
                  formatOptionLabel: renderChipOption,
                  classNamePrefix: CHIP_SELECT_CLASS_PREFIX,
                }}
                onChange={handleTargetLocalesChange}
              />
            </div>
          </div>
        </div>

        {/* Per-model field selection */}
        <div className={s.section}>
          <div className={s.subsectionHeader}>
            <div className={s.subsectionLabel}>Fields to translate</div>
            <div className={s.subsectionHint}>
              Defaults to every translatable field. Remove any you want to
              leave alone, per model.
            </div>
          </div>
          <div className={s.modelFieldList}>
            {models.map((model) => (
              <ModelFieldPicker
                key={model.value}
                model={model}
                fields={fieldsByModel[model.value]}
                isLoading={loadingFieldsForModel.has(model.value)}
                selectedApiKeys={selectedFieldsByModel[model.value] ?? []}
                onChange={(apiKeys) => setModelFields(model.value, apiKeys)}
              />
            ))}
          </div>
        </div>

        <div className={s.footer}>
          <Button
            type="button"
            buttonType="muted"
            buttonSize="s"
            onClick={handleCancel}
          >
            Cancel
          </Button>
          <Button
            type="button"
            buttonType="primary"
            buttonSize="s"
            onClick={handleStart}
            disabled={!isReady}
          >
            {`Translate ${itemIds.length} record${itemIds.length === 1 ? '' : 's'}`}
          </Button>
        </div>
      </div>
    </Canvas>
  );
}
