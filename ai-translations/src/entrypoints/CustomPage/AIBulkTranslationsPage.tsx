/**
 * AIBulkTranslationsPage.tsx
 * Custom settings page that lets admins run bulk translations across models.
 *
 * The page composes four pure helpers from `BulkTranslationHelpers`:
 *   - `filterTranslatableFields` — narrows a model's fields to those the
 *     plugin can translate, given the user's allowed editor types and
 *     api_key exclusions in plugin settings.
 *   - `resolveTargetLocales` — expands the "All locales" sentinel into a
 *     concrete deduplicated list, dropping the source locale.
 *   - `isReadyToTranslate` — single boolean for whether the Start button
 *     should enable.
 *   - `defaultFieldSelection` / `pruneFieldSelection` — manage the per-model
 *     field selection map as the user adds and removes models.
 *
 * After Start, the page opens the existing TranslationProgressModal once
 * per target locale, sequentially. Each modal receives the per-model field
 * allowlist and the cmaBaseUrl so the translation flow only touches the
 * fields the user explicitly opted into.
 */
import type { RenderPageCtx } from 'datocms-plugin-sdk';
import { Button, Canvas, SelectField, Spinner } from 'datocms-react-ui';
import { useCallback, useEffect, useMemo, useState } from 'react';
import {
  type ChipOption,
  renderChipOption,
} from '../../components/BulkTranslations/chipOption';
import { ModelFieldPicker } from '../../components/BulkTranslations/ModelFieldPicker';
import type { ctxParamsType } from '../../entrypoints/Config/ConfigScreen';
import { buildDatoCMSClient } from '../../utils/clients';
import { formatLocaleLabel, formatLocaleWithCode } from '../../utils/localeUtils';
import {
  ALL_LOCALES_VALUE,
  defaultFieldSelection,
  filterTranslatableFields,
  isReadyToTranslate,
  pruneFieldSelection,
  resolveTargetLocales,
  type SdkField,
  sortFieldsByLayoutOrder,
  type TranslatableField,
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

/**
 * The "All locales" entry that prefixes the target-locale multi-select. We
 * keep it as a regular option so the chip rendering, keyboard navigation,
 * and screen-reader behavior all match the rest of the locale chips. No
 * `code` because there's no machine code to show for "all".
 */
const ALL_LOCALES_OPTION: LocaleOption = {
  label: 'All other locales',
  value: ALL_LOCALES_VALUE,
};

export default function AIBulkTranslationsPage({ ctx }: PropTypes) {
  const [models, setModels] = useState<ModelOption[]>([]);
  const [selectedModels, setSelectedModels] = useState<ModelOption[]>([]);
  const [locales, setLocales] = useState<LocaleOption[]>([]);
  const [sourceLocale, setSourceLocale] = useState<LocaleOption | null>(null);
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
  const [isLoading, setIsLoading] = useState(true);
  const [isStartingTranslation, setIsStartingTranslation] = useState(false);

  // Initial load: models + locales
  useEffect(() => {
    async function loadData() {
      if (!ctx.currentUserAccessToken) {
        ctx.alert('No access token found');
        setIsLoading(false);
        return;
      }

      try {
        const client = buildDatoCMSClient(
          ctx.currentUserAccessToken,
          ctx.environment,
          ctx.cmaBaseUrl,
        );

        const itemTypes = await client.itemTypes.list();
        const nonBlockModels = itemTypes.filter((m) => !m.modular_block);
        setModels(
          nonBlockModels.map((m) => ({
            label: m.name,
            value: m.id,
            code: m.api_key,
          })),
        );

        const site = await client.site.find();
        const localeOptions: LocaleOption[] = site.locales.map(
          (locale: string) => ({
            label: formatLocaleLabel(locale),
            value: locale,
            code: locale,
          }),
        );
        setLocales(localeOptions);
        if (localeOptions.length > 0) {
          setSourceLocale(localeOptions[0]);
        }

        setIsLoading(false);
      } catch (error) {
        console.error('Error loading data:', error);
        ctx.alert(
          `Error loading data: ${error instanceof Error ? error.message : String(error)}`,
        );
        setIsLoading(false);
      }
    }

    loadData();
  }, [ctx]);

  const pluginParams = ctx.plugin.attributes.parameters as ctxParamsType;

  /**
   * Loads, filters, and stores the translatable fields for a newly added
   * model, defaulting the selection to "everything translatable selected".
   * Reuses an in-flight loading marker to avoid duplicate fetches on quick
   * model toggles.
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
        // `loadItemTypeFields` does not guarantee schema-layout order in the
        // returned array, so we sort by `position` ourselves before filtering.
        const fields = (await ctx.loadItemTypeFields(modelId)) as SdkField[];
        const ordered = sortFieldsByLayoutOrder(fields);
        const translatable = filterTranslatableFields(ordered, {
          translationFields: pluginParams.translationFields ?? [],
          apiKeysToBeExcludedFromThisPlugin:
            pluginParams.apiKeysToBeExcludedFromThisPlugin ?? [],
        });

        setFieldsByModel((prev) => ({ ...prev, [modelId]: translatable }));
        setSelectedFieldsByModel((prev) =>
          // Don't overwrite an existing selection if the user already toggled
          // some fields before the fetch resolved.
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

  // Fetch fields for any newly selected model, in parallel.
  useEffect(() => {
    for (const m of selectedModels) {
      void ensureFieldsLoaded(m.value);
    }
  }, [selectedModels, ensureFieldsLoaded]);

  // Prune cached field metadata + user selections for models that were
  // deselected. Keeping stale entries would slowly leak memory across the
  // session and could confuse the helpers.
  useEffect(() => {
    const keptIds = selectedModels.map((m) => m.value);
    setFieldsByModel((prev) => pruneFieldSelection(prev, keptIds));
    setSelectedFieldsByModel((prev) => pruneFieldSelection(prev, keptIds));
  }, [selectedModels]);

  // Derive concrete target locales from the user's multi-select state.
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

  const selectedModelIds = useMemo(
    () => selectedModels.map((m) => m.value),
    [selectedModels],
  );

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

  /**
   * Multi-select onChange for the target locales. Enforces a soft mutex:
   * picking "All other locales" clears any specific picks, and picking a
   * specific locale clears the "All" sentinel. Resolving this here keeps
   * the chip set clean instead of relying on de-duplication after the fact.
   */
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
      // User added a specific locale while "All" was selected → drop "All".
      setTargetLocaleOptions(
        next.filter((o) => o.value !== ALL_LOCALES_VALUE),
      );
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

  const handleModelChange = (
    newValue: SingleValue<ModelOption> | MultiValue<ModelOption>,
  ) => {
    if (Array.isArray(newValue)) {
      setSelectedModels([...newValue]);
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

  const startTranslation = async () => {
    if (!isReady) return;
    if (!ctx.currentUserAccessToken) {
      ctx.alert('No access token found');
      return;
    }
    if (!sourceLocale) return;
    if (!isProviderConfigured(pluginParams)) {
      ctx.alert(
        'Please configure valid credentials for the selected AI vendor in the plugin settings',
      );
      return;
    }

    setIsStartingTranslation(true);

    try {
      const client = buildDatoCMSClient(
        ctx.currentUserAccessToken,
        ctx.environment,
        ctx.cmaBaseUrl,
      );
      const allRecordIds: string[] = [];

      // Drain every selected model's record list in parallel.
      await Promise.all(
        selectedModelIds.map(async (modelId) => {
          const iterator = client.items.listPagedIterator({
            filter: { type: modelId },
            version: 'current',
          });
          for await (const record of iterator) {
            allRecordIds.push(record.id);
          }
        }),
      );

      if (allRecordIds.length === 0) {
        ctx.alert('No records found in the selected models');
        return;
      }

      // Confirm before the destructive operation. Same wording shape used
      // by the record-action dropdown so the surfaces stay consistent.
      const targetsSummary = targetLocales.map(formatLocaleWithCode).join(', ');
      const confirmResponse = await ctx.openConfirm({
        title: 'Start bulk translation?',
        content: `This will translate ${allRecordIds.length} record(s) from ${formatLocaleWithCode(sourceLocale.value)} to ${targetLocales.length} locale(s): ${targetsSummary}.`,
        choices: [
          {
            label: `Translate ${allRecordIds.length} record(s)`,
            value: 'go',
            intent: 'positive',
          },
        ],
        cancel: { label: 'Cancel', value: 'cancel' },
      });

      if (confirmResponse !== 'go') return;

      // Single modal handles the whole job: each record is translated into
      // every target locale and saved in one CMA write per record.
      const modalPromise = ctx.openModal({
        id: 'translationProgressModal',
        title: 'Translation Progress',
        width: 'l',
        parameters: {
          totalRecords: allRecordIds.length,
          fromLocale: sourceLocale.value,
          toLocales: targetLocales,
          accessToken: ctx.currentUserAccessToken,
          pluginParams,
          itemIds: allRecordIds,
          selectedFieldsByModel,
        },
      });

      const result = (await modalPromise) as
        | TranslationModalResult
        | undefined;

      const localeCount = targetLocales.length;
      if (result?.canceled) {
        await ctx.notice('Bulk translation was canceled');
      } else if (result?.completed) {
        await ctx.notice(
          `Successfully translated ${allRecordIds.length} record(s) to ${localeCount} locale(s)`,
        );
      } else {
        await ctx.alert(
          'Bulk translation finished with errors; review the modal output above.',
        );
      }
    } catch (error) {
      handleUIError(error, pluginParams.vendor, ctx);
    } finally {
      setIsStartingTranslation(false);
    }
  };

  // SelectField needs its `options` shaped as { label, value } and accepts
  // the same { label, value } shape for `value`. We build them here so the
  // render block stays declarative.
  const targetOptions = useMemo<LocaleOption[]>(
    () => [
      ALL_LOCALES_OPTION,
      ...locales.filter((l) => l.value !== sourceLocale?.value),
    ],
    [locales, sourceLocale],
  );

  return (
    <Canvas ctx={ctx}>
      <div className={s.page}>
        <div className={s.container}>
          <div className={s.card}>
            <div className={s.cardHeader}>
              <h1 className={s.cardTitle}>AI Bulk Translations</h1>
              <p className={s.cardCaption}>
                Pick the source and target languages, the models, and the
                fields you want translated.
              </p>
            </div>

            {isLoading && (
              <div className={s.loadingOverlay}>
                <Spinner size={40} />
                <div className={s.loadingText}>
                  Loading languages and models...
                </div>
              </div>
            )}

            {/* Language selectors row */}
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

            {/* Models selector */}
            <div className={s.section}>
              <SelectField
                name="selectedModels"
                id="selectedModels"
                label="Models"
                hint="Records of these models will be translated"
                value={selectedModels}
                selectInputProps={{
                  isMulti: true,
                  options: models,
                  formatOptionLabel: renderChipOption,
                }}
                onChange={handleModelChange}
              />
            </div>

            {/* Per-model field selection */}
            {selectedModels.length > 0 && (
              <div className={s.section}>
                <div className={s.subsectionHeader}>
                  <div className={s.subsectionLabel}>Fields to translate</div>
                  <div className={s.subsectionHint}>
                    Defaults to every translatable field. Untick anything you
                    want to leave alone.
                  </div>
                </div>
                <div className={s.modelFieldList}>
                  {selectedModels.map((model) => (
                    <ModelFieldPicker
                      key={model.value}
                      model={model}
                      fields={fieldsByModel[model.value]}
                      isLoading={loadingFieldsForModel.has(model.value)}
                      selectedApiKeys={selectedFieldsByModel[model.value] ?? []}
                      onToggle={(apiKey) => toggleField(model.value, apiKey)}
                      onSelectAll={() => selectAllFields(model.value)}
                      onClearAll={() => clearAllFields(model.value)}
                    />
                  ))}
                </div>
              </div>
            )}

            {/* Actions */}
            <div className={s.actions}>
              <Button
                buttonType="primary"
                onClick={startTranslation}
                disabled={!isReady || isStartingTranslation}
                fullWidth
              >
                {isStartingTranslation
                  ? 'Collecting records…'
                  : 'Start bulk translation'}
              </Button>
              {isReady && !isStartingTranslation && (
                <div className={`${s.helperText} ${s.statusReady}`}>
                  Ready to translate to {targetLocales.length} locale
                  {targetLocales.length === 1 ? '' : 's'}
                </div>
              )}
            </div>
          </div>
        </div>

        <div className={s.footerNote}>
          Translations are performed using AI. Review content after translation.
        </div>
      </div>
    </Canvas>
  );
}

