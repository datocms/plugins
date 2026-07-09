/**
 * TranslateSidebar.tsx
 * --------------------
 * Sidebar panel for translating the fields of *the record currently open in
 * the form*. The compact configuration UI lets editors pick a source locale
 * and one or more target locales. The actual translation runs in form context
 * (via `translateRecordFields`, which writes through
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
import { formatLocaleLabel } from '../../utils/localeUtils';
import { translateRecordFields } from '../../utils/translateRecordFields';
import type { QcFlag } from '../../utils/translation/qc/types';
import { handleUIError } from '../../utils/translation/ProviderErrors';
import { isProviderConfigured } from '../../utils/translation/ProviderFactory';
import type { ctxParamsType } from '../Config/ConfigScreen';
import { ChatBubble } from './Components/ChatbubbleTranslate';
import s from './TranslateSidebar.module.css';

type SingleValue<T> = T | null;
type MultiValue<T> = readonly T[];

type LocaleOption = ChipOption;

type PropTypes = {
  ctx: RenderItemFormSidebarPanelCtx;
};

function getEnvironmentPrefix(ctx: RenderItemFormSidebarPanelCtx): string {
  return ctx.isEnvironmentPrimary ? '' : `/environments/${ctx.environment}`;
}

function normalizeLocaleSelection(
  value: SingleValue<LocaleOption> | MultiValue<LocaleOption>,
): LocaleOption[] {
  if (Array.isArray(value)) return [...value];
  return value ? [value as LocaleOption] : [];
}

/** Auto-dismiss timer for the success banner, in milliseconds. */
const SUCCESS_TIMER_DURATION_MS = 7500;

export default function TranslateSidebar({ ctx }: PropTypes) {
  const pluginParams = ctx.plugin.attributes.parameters as ctxParamsType;
  const internalLocales = ctx.formValues.internalLocales as Array<string>;

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
  const [targetLocaleOptions, setTargetLocaleOptions] = useState<LocaleOption[]>(
    () => locales.slice(1),
  );

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
  // Mirror of `isCancelling` for reads inside the running translation loop. The
  // state drives the button label (render); the ref is what the loop's
  // `checkCancellation` callback and the post-await branch read, since a state
  // value would be captured stale in the in-flight async closure.
  const isCancellingRef = useRef(false);

  const handleTargetLocalesChange = (
    newValue: SingleValue<LocaleOption> | MultiValue<LocaleOption>,
  ) => {
    setTargetLocaleOptions(normalizeLocaleSelection(newValue));
  };

  const handleSourceLocaleChange = (
    newValue: SingleValue<LocaleOption> | MultiValue<LocaleOption>,
  ) => {
    const [next] = normalizeLocaleSelection(newValue);
    if (next) {
      setSourceLocale(next);
      // Reset the targets only when the source actually CHANGED (the old set
      // may contain the new source). Re-picking the same source must not wipe
      // a target selection the user has deliberately narrowed.
      if (next.value !== sourceLocale?.value) {
        setTargetLocaleOptions(locales.filter((o) => o.value !== next.value));
      }
    }
  };

  const sourceLocaleValue = sourceLocale?.value ?? null;
  const concreteTargetLocales = useMemo(
    () =>
      sourceLocaleValue
        ? targetLocaleOptions
            .map((o) => o.value)
            .filter((locale) => locale !== sourceLocaleValue)
        : [],
    [sourceLocaleValue, targetLocaleOptions],
  );

  const isReady = !!sourceLocaleValue && concreteTargetLocales.length > 0;

  const targetOptions = useMemo<LocaleOption[]>(
    () => locales.filter((l) => l.value !== sourceLocaleValue),
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

    setIsLoading(true);
    setTranslationBubbles([]);
    setIsCancelling(false);
    isCancellingRef.current = false;
    successShownRef.current = false;

    const controller = new AbortController();
    abortControllerRef.current = controller;
    const qcFlags: QcFlag[] = [];

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
          onQcFlag: (flag) => {
            qcFlags.push(flag);
          },
          checkCancellation: () => isCancellingRef.current,
          abortSignal: controller.signal,
        },
      );

      if (isCancellingRef.current) {
        ctx.notice('Translation cancelled');
        setIsCancelling(false);
        setIsLoading(false);
      } else if (qcFlags.length > 0) {
        const errorCount = qcFlags.filter(
          (flag) => flag.severity === 'error',
        ).length;
        const summary = qcFlags
          .slice(0, 8)
          .map((flag) => `• ${flag.message}`)
          .join('\n');
        if (errorCount > 0) {
          ctx.alert(
            `Translation finished, but ${errorCount} field(s) may be incomplete — please review before saving:\n${summary}`,
          );
        } else {
          ctx.notice(
            `Translation finished with ${qcFlags.length} note(s) worth reviewing.`,
          );
        }
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
    isCancellingRef.current = true;
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
              <div className={s.localeRow}>
                <div className={s.localeCue}>From</div>
                <div className={s.localeSelect}>
                  <SelectField
                    name="sourceLocale"
                    id="sourceLocale"
                    label=""
                    value={sourceLocale}
                    selectInputProps={{
                      options: locales,
                      formatOptionLabel: renderChipOption,
                      classNamePrefix: CHIP_SELECT_CLASS_PREFIX,
                    }}
                    onChange={handleSourceLocaleChange}
                  />
                </div>
                <div className={s.localeCue}>To</div>
              </div>
            </div>

            <div className={s.section}>
              <SelectField
                name="targetLocaleOptions"
                id="targetLocaleOptions"
                label=""
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

            <Button fullWidth disabled={!isReady} onClick={handleTranslateAllFields}>
              Translate all fields
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
