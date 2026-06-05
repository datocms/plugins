/**
 * TranslateSidebar.tsx
 * --------------------
 * Sidebar panel for translating the fields of *the record currently open in
 * the form*. The configuration UI mirrors the bulk page and the records-
 * action picker modal: same chip-style locale selects, same per-model field
 * picker, same "All other locales" option. The actual translation runs in
 * form context (via `translateRecordFields`, which writes through
 * `ctx.setFieldValue`) so changes show up in the form immediately and the
 * user can review them before saving.
 *
 * In-progress feedback stays as inline chat bubbles instead of the bulk
 * progress modal because single-record translation streams per field and
 * the user benefits from the granular, click-to-scroll-to-field UX.
 */
import type { RenderItemFormSidebarPanelCtx } from 'datocms-plugin-sdk';
import { Button, Canvas, SelectField } from 'datocms-react-ui';
import { AnimatePresence, motion } from 'framer-motion';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { MdCelebration } from 'react-icons/md';
import {
  CHIP_SELECT_CLASS_PREFIX,
  type ChipOption,
  renderChipOption,
} from '../../components/BulkTranslations/chipOption';
import { ModelFieldPicker } from '../../components/BulkTranslations/ModelFieldPicker';
import { formatLocaleLabel } from '../../utils/localeUtils';
import { translateRecordFields } from '../../utils/translateRecordFields';
import {
  ALL_LOCALES_VALUE,
  defaultFieldSelection,
  filterTranslatableFields,
  resolveTargetLocales,
  type SdkField,
  sortFieldsByLayoutOrder,
  type TranslatableField,
} from '../../utils/translation/BulkTranslationHelpers';
import { handleUIError } from '../../utils/translation/ProviderErrors';
import { isProviderConfigured } from '../../utils/translation/ProviderFactory';
import type { ctxParamsType } from '../Config/ConfigScreen';
import { ChatBubble } from './Components/ChatbubbleTranslate';
import s from './TranslateSidebar.module.css';

type SingleValue<T> = T | null;
type MultiValue<T> = readonly T[];

type LocaleOption = ChipOption;
type ModelOption = ChipOption & { code: string };

type PropTypes = {
  ctx: RenderItemFormSidebarPanelCtx;
};

const ALL_LOCALES_OPTION: LocaleOption = {
  label: 'All other locales',
  value: ALL_LOCALES_VALUE,
};

function getEnvironmentPrefix(ctx: RenderItemFormSidebarPanelCtx): string {
  return ctx.isEnvironmentPrimary ? '' : `/environments/${ctx.environment}`;
}

/** Auto-dismiss timer for the success banner, in milliseconds. */
const SUCCESS_TIMER_DURATION_MS = 7500;

export default function TranslateSidebar({ ctx }: PropTypes) {
  const pluginParams = ctx.plugin.attributes.parameters as ctxParamsType;
  const internalLocales = ctx.formValues.internalLocales as Array<string>;

  // Build the model option for this record's item type so `ModelFieldPicker`
  // gets the same `{ label, code }` shape it renders on the bulk page.
  const model: ModelOption = useMemo(() => {
    const itemType = ctx.itemType;
    return {
      label: itemType.attributes.name ?? 'Record',
      value: itemType.id,
      code: itemType.attributes.api_key ?? itemType.id,
    };
  }, [ctx.itemType]);

  const locales = useMemo<LocaleOption[]>(
    () =>
      internalLocales.map((locale) => ({
        label: formatLocaleLabel(locale),
        value: locale,
        code: locale,
      })),
    [internalLocales],
  );

  const [sourceLocale, setSourceLocale] = useState<LocaleOption | null>(
    locales[0] ?? null,
  );
  // Default to "All other locales" so the common case takes zero clicks.
  const [targetLocaleOptions, setTargetLocaleOptions] = useState<LocaleOption[]>(
    [ALL_LOCALES_OPTION],
  );
  const [translatableFields, setTranslatableFields] = useState<
    TranslatableField[]
  >([]);
  const [selectedFieldApiKeys, setSelectedFieldApiKeys] = useState<string[]>(
    [],
  );
  const [isLoadingFields, setIsLoadingFields] = useState(true);

  const [isLoading, setIsLoading] = useState<boolean>(false);
  const [isCancelling, setIsCancelling] = useState<boolean>(false);
  const [translationBubbles, setTranslationBubbles] = useState<
    {
      id: string;
      fieldLabel: string;
      locale: string;
      status: 'pending' | 'done' | 'error';
      fieldPath: string;
      baseFieldPath: string;
      streamingContent?: string;
      startedAt?: number;
      errorMessage?: string;
    }[]
  >([]);
  const [showTimer, setShowTimer] = useState<boolean>(false);
  const [progress, setProgress] = useState<number>(100);

  const abortControllerRef = useRef<AbortController | null>(null);
  const successShownRef = useRef(false);

  // Load and filter the translatable fields for this record's model so the
  // user can opt fields in or out before kicking off the translation.
  useEffect(() => {
    let cancelled = false;
    async function loadFields() {
      try {
        const raw = (await ctx.loadItemTypeFields(model.value)) as SdkField[];
        if (cancelled) return;
        const ordered = sortFieldsByLayoutOrder(raw);
        const translatable = filterTranslatableFields(ordered, {
          translationFields: pluginParams.translationFields ?? [],
          apiKeysToBeExcludedFromThisPlugin:
            pluginParams.apiKeysToBeExcludedFromThisPlugin ?? [],
        });
        setTranslatableFields(translatable);
        setSelectedFieldApiKeys(defaultFieldSelection(translatable));
      } catch (error) {
        if (cancelled) return;
        console.error('Error loading fields for sidebar:', error);
        ctx.alert(
          `Error loading fields: ${
            error instanceof Error ? error.message : String(error)
          }`,
        );
      } finally {
        if (!cancelled) setIsLoadingFields(false);
      }
    }
    void loadFields();
    return () => {
      cancelled = true;
    };
  }, [
    ctx,
    model.value,
    pluginParams.translationFields,
    pluginParams.apiKeysToBeExcludedFromThisPlugin,
  ]);

  // Mirrors the bulk page's mutex: picking "All" replaces specific picks and
  // vice versa, so the chips stay clean.
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
      const next = newValue as LocaleOption;
      setSourceLocale(next);
      // Drop the new source from the target picker if it was selected.
      setTargetLocaleOptions((prev) =>
        prev.filter((o) => o.value !== next.value),
      );
    }
  };

  const sourceLocaleValue = sourceLocale?.value ?? null;
  const allLocaleValues = useMemo(
    () => locales.map((l) => l.value),
    [locales],
  );
  const concreteTargetLocales = useMemo(
    () =>
      sourceLocaleValue
        ? resolveTargetLocales(
            targetLocaleOptions.map((o) => o.value),
            allLocaleValues,
            sourceLocaleValue,
          )
        : [],
    [sourceLocaleValue, targetLocaleOptions, allLocaleValues],
  );

  const isReady =
    !!sourceLocaleValue &&
    concreteTargetLocales.length > 0 &&
    selectedFieldApiKeys.length > 0;

  const targetOptions = useMemo<LocaleOption[]>(
    () => [
      ALL_LOCALES_OPTION,
      ...locales.filter((l) => l.value !== sourceLocaleValue),
    ],
    [locales, sourceLocaleValue],
  );

  /** Auto-dismiss banner driver. */
  const showSuccessNoticeOnce = useCallback(() => {
    if (successShownRef.current) return;
    successShownRef.current = true;
    ctx.notice(
      'Translations were applied to the form. Review them and click Save to persist the changes.',
    );
    setShowTimer(true);
    setProgress(100);
  }, [ctx]);

  useEffect(() => {
    let timer: ReturnType<typeof setTimeout> | undefined;
    if (showTimer) {
      const startTime = Date.now();
      const tick = () => {
        const elapsed = Date.now() - startTime;
        const remaining = Math.max(0, SUCCESS_TIMER_DURATION_MS - elapsed);
        const newProgress = (remaining / SUCCESS_TIMER_DURATION_MS) * 100;
        if (newProgress > 0) {
          setProgress(newProgress);
          timer = setTimeout(tick, 16);
        } else {
          setShowTimer(false);
          setIsLoading(false);
        }
      };
      timer = setTimeout(tick, 16);
    }
    return () => {
      if (timer) clearTimeout(timer);
    };
  }, [showTimer]);

  useEffect(() => {
    if (!isLoading || isCancelling || showTimer) return;
    if (translationBubbles.length === 0) return;
    const allFinished = translationBubbles.every(
      (b) => b.status === 'done' || b.status === 'error',
    );
    const hasErrors = translationBubbles.some((b) => b.status === 'error');
    if (allFinished) {
      const t = setTimeout(() => {
        if (hasErrors) {
          setIsLoading(false);
        } else {
          showSuccessNoticeOnce();
        }
      }, 100);
      return () => clearTimeout(t);
    }
  }, [
    translationBubbles,
    isLoading,
    isCancelling,
    showTimer,
    showSuccessNoticeOnce,
  ]);

  if (!isProviderConfigured(pluginParams)) {
    return (
      <Canvas ctx={ctx}>
        <div className={s.configurePrompt}>
          <Button
            buttonType="muted"
            onClick={() =>
              ctx.navigateTo(
                `${getEnvironmentPrefix(ctx)}/configuration/plugins/${ctx.plugin.id}/edit`,
              )
            }
          >
            Configure credentials for your selected AI vendor in settings
          </Button>
        </div>
      </Canvas>
    );
  }

  async function handleTranslateAllFields() {
    if (!sourceLocaleValue) return;
    if (concreteTargetLocales.length === 0) return;
    if (selectedFieldApiKeys.length === 0) return;

    setIsLoading(true);
    setTranslationBubbles([]);
    setIsCancelling(false);
    successShownRef.current = false;

    const controller = new AbortController();
    abortControllerRef.current = controller;

    try {
      await translateRecordFields(
        ctx,
        pluginParams,
        concreteTargetLocales,
        sourceLocaleValue,
        {
          onStart: (fieldLabel, locale, fieldPath, baseFieldPath) => {
            setTranslationBubbles((prev) => {
              if (prev.some((b) => b.id === fieldPath)) return prev;
              return [
                ...prev,
                {
                  id: fieldPath,
                  fieldLabel,
                  locale,
                  status: 'pending',
                  fieldPath,
                  baseFieldPath,
                  startedAt: Date.now(),
                },
              ];
            });
          },
          onStream: (_fl, _loc, fieldPath, _bfp, content) => {
            setTranslationBubbles((prev) =>
              prev.map((bubble) =>
                bubble.id === fieldPath
                  ? { ...bubble, streamingContent: content }
                  : bubble,
              ),
            );
          },
          onComplete: (_fl, _loc, fieldPath) => {
            setTranslationBubbles((prev) =>
              prev.map((bubble) =>
                bubble.id === fieldPath
                  ? { ...bubble, status: 'done', streamingContent: undefined }
                  : bubble,
              ),
            );
          },
          onError: (fieldLabel, locale, fieldPath, _bfp, errorMessage) => {
            setTranslationBubbles((prev) =>
              prev.map((bubble) =>
                bubble.id === fieldPath
                  ? {
                      ...bubble,
                      status: 'error',
                      streamingContent: undefined,
                      errorMessage,
                    }
                  : bubble,
              ),
            );
            ctx.alert(
              `Failed to translate "${fieldLabel}" to ${locale}: ${errorMessage}`,
            );
          },
          checkCancellation: () => isCancelling,
          abortSignal: controller.signal,
          allowedFieldApiKeys: new Set(selectedFieldApiKeys),
        },
      );

      if (isCancelling) {
        ctx.notice('Translation cancelled');
        setIsCancelling(false);
        setIsLoading(false);
      }
    } catch (error) {
      handleUIError(error, pluginParams.vendor, ctx);
      setIsLoading(false);
      setIsCancelling(false);
    } finally {
      abortControllerRef.current = null;
    }
  }

  function handleCancelTranslation() {
    setIsCancelling(true);
    ctx.notice('Translation cancellation requested. Please wait...');
    abortControllerRef.current?.abort();
  }

  return (
    <Canvas ctx={ctx}>
      <AnimatePresence mode="wait">
        {!isLoading ? (
          <motion.div
            key="form"
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            transition={{ duration: 0.3 }}
            className={s.form}
          >
            <div className={s.section}>
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

            <div className={s.section}>
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

            <div className={s.section}>
              <div className={s.subsectionHeader}>
                <div className={s.subsectionLabel}>Fields to translate</div>
                <div className={s.subsectionHint}>
                  Defaults to every translatable field on this record. Remove
                  any you want to leave alone.
                </div>
              </div>
              <ModelFieldPicker
                model={model}
                fields={isLoadingFields ? undefined : translatableFields}
                isLoading={isLoadingFields}
                selectedApiKeys={selectedFieldApiKeys}
                onChange={setSelectedFieldApiKeys}
              />
            </div>

            <Button fullWidth disabled={!isReady} onClick={handleTranslateAllFields}>
              {selectedFieldApiKeys.length === translatableFields.length
                ? `Translate all fields to ${concreteTargetLocales.length} locale${concreteTargetLocales.length === 1 ? '' : 's'}`
                : `Translate ${selectedFieldApiKeys.length} field${selectedFieldApiKeys.length === 1 ? '' : 's'} to ${concreteTargetLocales.length} locale${concreteTargetLocales.length === 1 ? '' : 's'}`}
            </Button>
          </motion.div>
        ) : (
          <motion.div
            key="loading"
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            transition={{ duration: 0.3 }}
            className={s.progress}
          >
            <div className={s.bubbleList}>
              {translationBubbles.map((bubble, index) => (
                <button
                  key={bubble.id}
                  onClick={() => {
                    ctx.scrollToField(bubble.baseFieldPath, bubble.locale);
                  }}
                  aria-label={`Go to field: ${bubble.fieldLabel} (${bubble.locale}) - ${bubble.status === 'done' ? 'completed' : 'in progress'}`}
                  className={s.bubbleButton}
                  type="button"
                >
                  <ChatBubble index={index} bubble={bubble}/>
                </button>
              ))}
              {showTimer && (
                <div>
                  <motion.div
                    initial={{ opacity: 0, y: 20 }}
                    animate={{ opacity: 1, y: 0 }}
                    className={s.successBanner}
                    style={{
                      backgroundColor: 'var(--color--primary-soft--surface)',
                      color: 'var(--color--primary-soft--ink)',
                      border: '1px solid var(--color--primary-soft--surface)',
                    }}
                  >
                    <motion.div
                      initial={{ scale: 0 }}
                      animate={{ scale: 1 }}
                      transition={{ delay: 0.2 }}
                      style={{ color: 'var(--color--primary-soft--ink)' }}
                    >
                      <MdCelebration size={20} />
                    </motion.div>
                    Translations were applied to the form. Review them and
                    click Save.
                    <motion.div
                      initial={{ scale: 0 }}
                      animate={{ scale: 1 }}
                      transition={{ delay: 0.2 }}
                      style={{ color: 'var(--color--primary-soft--ink)' }}
                    >
                      <MdCelebration size={20} />
                    </motion.div>
                  </motion.div>
                  <div className={s.timerTrack}>
                    <motion.div
                      className={s.timerFill}
                      style={{ backgroundColor: 'var(--color--primary--surface)' }}
                      initial={{ scaleX: 1 }}
                      animate={{ scaleX: progress / 100 }}
                      transition={{ duration: 0.1 }}
                    />
                  </div>
                  <div className={s.timerActions}>
                    <Button
                      buttonSize="xs"
                      fullWidth
                      buttonType="primary"
                      onClick={() => {
                        setShowTimer(false);
                        setIsLoading(false);
                      }}
                    >
                      Done
                    </Button>
                  </div>
                </div>
              )}
              {isLoading && !showTimer && (
                <Button
                  buttonSize="xs"
                  fullWidth
                  buttonType="muted"
                  onClick={handleCancelTranslation}
                  disabled={isCancelling}
                  className={s.cancelButton}
                >
                  {isCancelling ? 'Cancelling...' : 'Cancel'}
                </Button>
              )}
            </div>
          </motion.div>
        )}
      </AnimatePresence>
    </Canvas>
  );
}
