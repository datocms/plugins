import type { RenderItemFormSidebarPanelCtx } from 'datocms-plugin-sdk';
import { Button, Canvas, SelectField } from 'datocms-react-ui';
import { AnimatePresence, motion } from 'framer-motion';
import { useCallback, useEffect, useRef, useState } from 'react';
import { MdCelebration } from 'react-icons/md';
import { localeSelect } from '../../utils/localeUtils';
import { translateRecordFields } from '../../utils/translateRecordFields';
import { handleUIError } from '../../utils/translation/ProviderErrors';
import { isProviderConfigured } from '../../utils/translation/ProviderFactory';
import type { ctxParamsType } from '../Config/ConfigScreen';
import { ChatBubble } from './Components/ChatbubbleTranslate';

/**
 * DatoGPTTranslateSidebar.tsx
 *
 * This file renders a sidebar panel in the DatoCMS UI that allows users to translate
 * all fields of a record from a source locale into one or more target locales.
 *
 * Features:
 * - Lets the user pick a "From" locale (source) and multiple "To" locales (targets).
 * - On clicking "Translate all fields", all translatable fields in the record are translated.
 * - Displays a loading spinner while the translation is in progress.
 *   Each bubble represents a field-locale translation. When translation starts for a field-locale,
 *   a bubble appears. When that translation completes, the bubble updates to a completed state.
 *
 * State variables:
 * - selectedLocale: The source locale for translation (default: the first locale in internalLocales).
 * - selectedLocales: The target locales to translate into (all locales except the source by default).
 * - isLoading: Boolean indicating if the translation is currently in progress.
 * - isCancelling: Boolean indicating if the user has requested to cancel the translation.
 * - translationBubbles: An array of objects representing the translation bubbles on the UI.
 *   Each bubble has { fieldLabel: string, locale: string, status: 'pending'|'done' }.
 *
 * Steps:
 * 1. User picks locales.
 * 2. Click "Translate all fields".
 * 3. The translateRecordFields utility function translates each field-locale pair and
 *    calls our onStart and onComplete callbacks for each translation.
 * 4. onStart callback adds a bubble with status 'pending', onComplete updates it to 'done'.
 * 5. Once all translations finish, isLoading is set to false and user gets a success message.
 */

type PropTypes = {
  ctx: RenderItemFormSidebarPanelCtx;
};

export default function DatoGPTTranslateSidebar({ ctx }: PropTypes) {
  // Retrieve plugin parameters, expecting API keys and model details
  const pluginParams = ctx.plugin.attributes.parameters as ctxParamsType;

  // The first locale in internalLocales is considered the source/base locale
  const [selectedLocale, setSelectedLocale] = useState<string>(
    (ctx.formValues.internalLocales as Array<string>)[0],
  );

  // By default, all other locales are target locales
  const [selectedLocales, setSelectedLocales] = useState<Array<string>>(
    (ctx.formValues.internalLocales as Array<string>).filter(
      (locale) => locale !== selectedLocale,
    ),
  );

  // isLoading tracks if translation is in progress
  const [isLoading, setIsLoading] = useState<boolean>(false);

  // Tracks if user has requested to cancel the translation
  const [isCancelling, setIsCancelling] = useState<boolean>(false);

  // translationBubbles stores the chat-like bubble info.
  // Each bubble: { fieldLabel: string, locale: string, status: 'pending'|'done'|'error' }
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

  // New state variables for timer functionality
  const [showTimer, setShowTimer] = useState<boolean>(false);
  const [progress, setProgress] = useState<number>(100);
  const TIMER_DURATION = 7500; // 7.5 seconds in milliseconds

  // Reference to the AbortController for cancelling API requests (using ref to avoid state updates on unmount)
  const abortControllerRef = useRef<AbortController | null>(null);

  // Prevent duplicate success notices across effect and completion handler
  const successShownRef = useRef(false);

  // Stable callback — wrapped in useCallback so it can be safely listed as a
  // useEffect dependency without triggering infinite re-renders.
  const showSuccessNoticeOnce = useCallback(() => {
    if (successShownRef.current) return;
    successShownRef.current = true;
    ctx.notice(
      'Translations were applied to the form. Review them and click Save to persist the changes.',
    );
    setShowTimer(true);
    setProgress(100);
  }, [ctx]);

  // Timer effect
  useEffect(() => {
    let timer: ReturnType<typeof setTimeout> | undefined;
    if (showTimer) {
      const startTime = Date.now();
      const updateProgress = () => {
        const elapsed = Date.now() - startTime;
        const remaining = Math.max(0, TIMER_DURATION - elapsed);
        const newProgress = (remaining / TIMER_DURATION) * 100;

        if (newProgress > 0) {
          setProgress(newProgress);
          timer = setTimeout(updateProgress, 16); // ~60fps
        } else {
          setShowTimer(false);
          setIsLoading(false);
        }
      };
      timer = setTimeout(updateProgress, 16);
    }
    return () => {
      if (timer) clearTimeout(timer);
    };
  }, [showTimer]);

  // Removed global long-running banner; rely on per-bubble hint instead

  // Show success as soon as all bubbles report done (no errors), without waiting for the worker to settle
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
          // Don't show success if there were errors - just end loading state
          setIsLoading(false);
        } else {
          showSuccessNoticeOnce();
        }
      }, 100); // allow final bubble animation to commit
      return () => clearTimeout(t);
    }
  }, [
    translationBubbles,
    isLoading,
    isCancelling,
    showTimer,
    showSuccessNoticeOnce,
  ]);

  // If not configured, prompt user to fix configuration
  if (!isProviderConfigured(pluginParams)) {
    return (
      <Canvas ctx={ctx}>
        <div
          style={{
            display: 'flex',
            flexDirection: 'column',
            gap: '1rem',
            justifyContent: 'center',
            alignItems: 'center',
          }}
        >
          <Button
            buttonType="muted"
            onClick={() =>
              ctx.navigateTo(`/configuration/plugins/${ctx.plugin.id}/edit`)
            }
          >
            Configure credentials for your selected AI vendor in settings
          </Button>
        </div>
      </Canvas>
    );
  }

  /**
   * handleTranslateAllFields
   *
   * Called when "Translate all fields" is clicked.
   * Sets the loading state and calls translateRecordFields with callbacks.
   */
  async function handleTranslateAllFields() {
    setIsLoading(true);
    setTranslationBubbles([]);
    setIsCancelling(false);
    successShownRef.current = false;

    // Create a new AbortController for this translation session
    const controller = new AbortController();
    abortControllerRef.current = controller;

    try {
      await translateRecordFields(
        ctx,
        pluginParams,
        selectedLocales,
        selectedLocale,
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
          onStream: (
            _fieldLabel,
            _locale,
            fieldPath,
            _baseFieldPath,
            content,
          ) => {
            setTranslationBubbles((prev) =>
              prev.map((bubble) =>
                bubble.id === fieldPath
                  ? { ...bubble, streamingContent: content }
                  : bubble,
              ),
            );
          },
          onComplete: (_fieldLabel, _locale, fieldPath) => {
            setTranslationBubbles((prev) =>
              prev.map((bubble) =>
                bubble.id === fieldPath
                  ? { ...bubble, status: 'done', streamingContent: undefined }
                  : bubble,
              ),
            );
          },
          onError: (
            fieldLabel,
            locale,
            fieldPath,
            _baseFieldPath,
            errorMessage,
          ) => {
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
        },
      );

      if (isCancelling) {
        ctx.notice('Translation cancelled');
        setIsCancelling(false);
        setIsLoading(false);
      }
      // Success/error handling is done via useEffect when all bubbles are finished
    } catch (error) {
      handleUIError(error, pluginParams.vendor, ctx);
      setIsLoading(false);
      setIsCancelling(false);
    } finally {
      abortControllerRef.current = null;
    }
  }

  /**
   * handleCancelTranslation
   *
   * Called when "Cancel" is clicked during translation.
   * Sets the cancellation flag and shows a notification.
   * Aborts the current API request if one is in progress.
   */
  function handleCancelTranslation() {
    setIsCancelling(true);
    ctx.notice('Translation cancellation requested. Please wait...');

    // Abort the API request
    if (abortControllerRef.current) {
      abortControllerRef.current.abort();
    }
  }

  return (
    <Canvas ctx={ctx}>
      <AnimatePresence mode="wait">
        {!isLoading ? (
          // When not loading, show the configuration form
          <motion.div
            key="form"
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            transition={{ duration: 0.3 }}
            style={{
              marginBottom: '1rem',
              display: 'flex',
              flexDirection: 'column',
            }}
          >
            <div
              style={{
                display: 'flex',
                gap: '1rem',
                alignItems: 'center',
                justifyContent: 'center',
              }}
            >
              <h3 style={{ marginRight: '-12px' }}>From</h3>
              <SelectField
                name="fromLocale"
                id="fromLocale"
                label=""
                value={[
                  {
                    label: `${
                      localeSelect(selectedLocale)?.name
                    } [${selectedLocale}]`,
                    value: selectedLocale,
                  },
                ]}
                selectInputProps={{
                  isMulti: false,
                  options: (
                    ctx.formValues.internalLocales as Array<string>
                  ).map((locale) => ({
                    label: `${localeSelect(locale)?.name} [${locale}]`,
                    value: locale,
                  })),
                }}
                onChange={(newValue) => {
                  const newSourceLocale = newValue?.value || selectedLocale;
                  setSelectedLocale(newSourceLocale);
                  setSelectedLocales(
                    (ctx.formValues.internalLocales as Array<string>).filter(
                      (locale) => locale !== newSourceLocale,
                    ),
                  );
                }}
              />
              <h3>To</h3>
            </div>
            <div style={{ marginBottom: '1rem' }}>
              <SelectField
                name="toLocales"
                id="toLocales"
                label=""
                value={selectedLocales.map((locale) => ({
                  label: `${localeSelect(locale)?.name} [${locale}]`,
                  value: locale,
                }))}
                selectInputProps={{
                  isMulti: true,
                  options: (ctx.formValues.internalLocales as Array<string>)
                    .filter((locale) => locale !== selectedLocale)
                    .map((locale) => ({
                      label: `${localeSelect(locale)?.name} [${locale}]`,
                      value: locale,
                    })),
                }}
                onChange={(newValue) => {
                  setSelectedLocales(
                    newValue?.map((locale) => locale.value) || [],
                  );
                }}
              />
            </div>

            <Button fullWidth onClick={handleTranslateAllFields}>
              Translate all fields
            </Button>
          </motion.div>
        ) : (
          // When loading, show spinner and translation bubbles
          <motion.div
            key="loading"
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            transition={{ duration: 0.3 }}
            style={{
              display: 'flex',
              flexDirection: 'column',
              width: '100%',
              padding: '0 16px',
              boxSizing: 'border-box',
            }}
          >
            {/* Global banner removed per request; per-bubble hint handles feedback */}
            <div
              style={{
                width: '100%',
                display: 'flex',
                flexDirection: 'column',
              }}
            >
              {translationBubbles.map((bubble, index) => (
                <button
                  key={bubble.id}
                  onClick={() => {
                    ctx.scrollToField(bubble.baseFieldPath, bubble.locale);
                  }}
                  aria-label={`Go to field: ${bubble.fieldLabel} (${bubble.locale}) - ${bubble.status === 'done' ? 'completed' : 'in progress'}`}
                  style={{
                    background: 'none',
                    border: 'none',
                    padding: 0,
                    width: '100%',
                    cursor: 'pointer',
                    textAlign: 'left',
                  }}
                  type="button"
                >
                  <ChatBubble index={index} bubble={bubble} theme={ctx.theme} />
                </button>
              ))}
              {showTimer && (
                <div>
                  <motion.div
                    initial={{ opacity: 0, y: 20 }}
                    animate={{ opacity: 1, y: 0 }}
                    style={{
                      display: 'flex',
                      alignItems: 'center',
                      justifyContent: 'center',
                      gap: '12px',
                      backgroundColor: ctx.theme.semiTransparentAccentColor,
                      color: ctx.theme.accentColor,
                      padding: '16px 24px',
                      borderRadius: '12px',
                      marginBottom: '8px',
                      fontFamily:
                        '-apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, Helvetica, Arial, sans-serif',
                      fontSize: '16px',
                      lineHeight: '1.4',
                      letterSpacing: '0.01em',
                      boxShadow: '0 2px 4px rgba(0, 0, 0, 0.1)',
                      fontWeight: 600,
                      border: `1px solid ${ctx.theme.semiTransparentAccentColor}`,
                      textAlign: 'center',
                    }}
                  >
                    <motion.div
                      initial={{ scale: 0 }}
                      animate={{ scale: 1 }}
                      transition={{ delay: 0.2 }}
                      style={{
                        display: 'flex',
                        alignItems: 'center',
                        textAlign: 'center',
                        color: ctx.theme.accentColor,
                      }}
                    >
                      <MdCelebration size={20} />
                    </motion.div>
                    Translations were applied to the form. Review them and click
                    Save.
                    <motion.div
                      initial={{ scale: 0 }}
                      animate={{ scale: 1 }}
                      transition={{ delay: 0.2 }}
                      style={{
                        display: 'flex',
                        alignItems: 'center',
                        color: ctx.theme.accentColor,
                      }}
                    >
                      <MdCelebration size={20} />
                    </motion.div>
                  </motion.div>
                  <div
                    style={{
                      width: '100%',
                      height: '6px',
                      backgroundColor: '#e6e6e6',
                      borderRadius: '8px',
                      overflow: 'hidden',
                    }}
                  >
                    <motion.div
                      style={{
                        width: '100%',
                        height: '100%',
                        backgroundColor: ctx.theme.accentColor,
                        transformOrigin: 'left',
                      }}
                      initial={{ scaleX: 1 }}
                      animate={{ scaleX: progress / 100 }}
                      transition={{ duration: 0.1 }}
                    />
                  </div>
                  <div
                    style={{
                      display: 'flex',
                      justifyContent: 'center',
                      marginTop: '8px',
                    }}
                  >
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
                  style={{ marginTop: '16px' }}
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
