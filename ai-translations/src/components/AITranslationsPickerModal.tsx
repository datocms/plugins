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
 *   2. Clicks "Translate N records" → we open a native confirm.
 *   3. On confirm, the picker modal opens the existing translation progress
 *      modal as a nested call and awaits it.
 *   4. The picker modal resolves with `{ completed, canceled }` so the
 *      items-dropdown handler can surface a final notice.
 */
import type { RenderModalCtx } from 'datocms-plugin-sdk';
import { Button, Canvas, SelectField, Spinner } from 'datocms-react-ui';
import { useCallback, useEffect, useMemo, useState } from 'react';
import type { ctxParamsType } from '../entrypoints/Config/ConfigScreen';
import { formatLocaleLabel, formatLocaleWithCode } from '../utils/localeUtils';
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
  type ChipOption,
  renderChipOption,
} from './BulkTranslations/chipOption';
import { ModelFieldPicker } from './BulkTranslations/ModelFieldPicker';

type SingleValue<T> = T | null;
type MultiValue<T> = readonly T[];

type LocaleOption = ChipOption;

/**
 * Outcome the picker modal resolves with. Mirrors the shape produced by the
 * inner progress modal so callers can pattern-match on the same fields.
 */
export interface AITranslationsPickerModalResult {
  completed?: boolean;
  canceled?: boolean;
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
  const { itemIds, models, pluginParams, accessToken } = parameters;

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
  const [targetLocaleOptions, setTargetLocaleOptions] = useState<LocaleOption[]>(
    [],
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
  const [isBusy, setIsBusy] = useState(false);

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

  const toggleField = (modelId: string, fieldApiKey: string) => {
    setSelectedFieldsByModel((prev) => {
      const current = prev[modelId] ?? [];
      const isSelected = current.includes(fieldApiKey);
      const next = isSelected
        ? current.filter((k) => k !== fieldApiKey)
        : [...current, fieldApiKey];
      return { ...prev, [modelId]: next };
    });
  };

  const selectAllFields = (modelId: string) => {
    setSelectedFieldsByModel((prev) => ({
      ...prev,
      [modelId]: (fieldsByModel[modelId] ?? []).map((f) => f.apiKey),
    }));
  };

  const clearAllFields = (modelId: string) => {
    setSelectedFieldsByModel((prev) => ({ ...prev, [modelId]: [] }));
  };

  /**
   * Confirm, then open the progress modal nested inside this picker modal,
   * then resolve the picker modal with the outcome so the items-dropdown
   * caller can show a final notice.
   */
  const handleStart = async () => {
    if (!isReady || !sourceLocale) return;
    if (!isProviderConfigured(pluginParams)) {
      ctx.alert(
        'Please configure valid credentials for the selected AI vendor in the plugin settings',
      );
      return;
    }

    setIsBusy(true);
    try {
      const targetsSummary = targetLocales.map(formatLocaleWithCode).join(', ');
      const confirmResponse = await ctx.openConfirm({
        title: 'Start translation?',
        content: `This will translate ${itemIds.length} record(s) from ${formatLocaleWithCode(sourceLocale.value)} to ${targetLocales.length} locale(s): ${targetsSummary}.`,
        choices: [
          {
            label: `Translate ${itemIds.length} record(s)`,
            value: 'go',
            intent: 'positive',
          },
        ],
        cancel: { label: 'Cancel', value: 'cancel' },
      });

      if (confirmResponse !== 'go') {
        setIsBusy(false);
        return;
      }

      const progressResult = (await ctx.openModal({
        id: 'translationProgressModal',
        title: 'Translation Progress',
        width: 'l',
        parameters: {
          totalRecords: itemIds.length,
          fromLocale: sourceLocale.value,
          toLocales: targetLocales,
          accessToken,
          pluginParams,
          itemIds,
          selectedFieldsByModel,
        },
      })) as { completed?: boolean; canceled?: boolean } | undefined;

      ctx.resolve({
        completed: !!progressResult?.completed,
        canceled: !!progressResult?.canceled,
      } satisfies AITranslationsPickerModalResult);
    } catch (error) {
      console.error('Picker modal flow failed:', error);
      ctx.alert(
        `Bulk translation failed: ${
          error instanceof Error ? error.message : String(error)
        }`,
      );
      ctx.resolve({} satisfies AITranslationsPickerModalResult);
    }
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
              Defaults to every translatable field. Untick anything you want
              to leave alone.
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
                onToggle={(apiKey) => toggleField(model.value, apiKey)}
                onSelectAll={() => selectAllFields(model.value)}
                onClearAll={() => clearAllFields(model.value)}
                // Records-action dropdowns are registered per model in
                // DatoCMS, so the selection is always single-model in this
                // surface — drop the redundant model header.
                hideModelHeader={models.length === 1}
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
            disabled={isBusy}
          >
            Cancel
          </Button>
          <Button
            type="button"
            buttonType="primary"
            buttonSize="s"
            onClick={handleStart}
            disabled={!isReady || isBusy}
          >
            {isBusy ? (
              <>
                <Spinner size={14} /> Working…
              </>
            ) : (
              `Translate ${itemIds.length} record${itemIds.length === 1 ? '' : 's'}`
            )}
          </Button>
        </div>
      </div>
    </Canvas>
  );
}
