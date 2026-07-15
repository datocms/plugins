/**
 * TranslateSidebar.tsx
 * --------------------
 * Sidebar panel for translating the fields of *the record currently open in
 * the form*. The compact configuration UI lets editors pick a source locale
 * and one or more target locales.
 *
 * Since v4 (spec §2/§2.3) the run goes through the ONE unified engine: the form
 * state is normalized to the engine's simple record shape
 * (`ctx.formValuesToItem` → `itemToSimpleShape`), translated by
 * `translateRecordUnits` under the shared adaptive scheduler/pacer, and the
 * resulting payload is staged into the OPEN form by the form sink
 * (`writeToForm` via `ctx.setFieldValue`). The user reviews the staged values
 * and clicks Save; there is no CMA write here, so locale-sync is bypassed
 * (§2.3-7). Progress is a single status line, not per-field chat bubbles
 * (§2.3-5 — the streaming UX is dead; Phase 4 adds the report modal).
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
import {
  type PauseController,
  createPauseController,
} from '../../components/BulkTranslations/pauseController';
import {
  RUN_CANCELLED,
  type RecordUnitsResult,
  type TranslateRecordUnitsOptions,
  translateRecordUnits,
} from '../../engine';
import {
  type JsonApiItem,
  itemToSimpleShape,
  payloadToFormWrites,
} from '../../engine/formAdapter';
import { assertNoBareBlockIds } from '../../engine/formAdapter';
import { writeToForm } from '../../engine/formSink';
import { buildDatoCMSClient } from '../../utils/clients';
import { formatLocaleLabel } from '../../utils/localeUtils';
import { createSchemaRepository } from '../../utils/schemaRepository';
import type { DatoCMSRecordFromAPI } from '../../utils/translation/ItemsDropdownUtils';
import { buildFieldTypeDictionaryWithRepo } from '../../utils/translation/ItemsDropdownUtils';
import { handleUIError } from '../../utils/translation/ProviderErrors';
import {
  getProvider,
  isProviderConfigured,
} from '../../utils/translation/ProviderFactory';
import type { ctxParamsType } from '../Config/ConfigScreen';
import s from './TranslateSidebar.module.css';

/**
 * Top-level DatoCMS field types whose value carries blocks. `assertNoBareBlockIds`
 * needs this set to distinguish a bare block id (the §2.1 zero-field-block
 * hazard) from a scalar string that merely looks like one.
 */
const BLOCK_BEARING_FIELD_TYPES = new Set([
  'single_block',
  'rich_text',
  'structured_text',
]);

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

/**
 * The settled outcome of a run, decoupled from the React state plumbing so the
 * decision (status line + which notice/alert to raise) stays a pure function of
 * the engine result. `clean` earns the success banner; `notes` is a soft heads
 * up; `failures` blocks the banner and demands review before Save.
 */
type RunSummary =
  | { kind: 'clean'; statusLine: string }
  | { kind: 'notes'; statusLine: string; notice: string }
  | { kind: 'failures'; statusLine: string; alert: string };

/** Derives the {@link RunSummary} from an engine result (§2.3-5 status line). */
function summarizeRunOutcome(
  result: RecordUnitsResult,
  localeCount: number,
): RunSummary {
  const errorCount = result.qcFlags.filter(
    (flag) => flag.severity === 'error',
  ).length;

  if (result.failedFields.length > 0 || errorCount > 0) {
    const lines = [
      ...result.failedFields.map((f) => `• ${f.field}: ${f.error.message}`),
      ...result.qcFlags.slice(0, 8).map((flag) => `• ${flag.message}`),
    ].slice(0, 8);
    return {
      kind: 'failures',
      statusLine: 'Completed with warnings — see report',
      alert: `Translation finished, but ${result.failedFields.length + errorCount} field(s) may be incomplete — please review before saving:\n${lines.join('\n')}`,
    };
  }

  if (result.qcFlags.length > 0) {
    return {
      kind: 'notes',
      statusLine: 'Completed with warnings — see report',
      notice: `Translation finished with ${result.qcFlags.length} note(s) worth reviewing.`,
    };
  }

  const distinctFields = new Set(result.translatedFields).size;
  return {
    kind: 'clean',
    statusLine: `Translated 1 record (${distinctFields} field${distinctFields === 1 ? '' : 's'} × ${localeCount} locale${localeCount === 1 ? '' : 's'})`,
  };
}

/** Result of {@link stageTranslationsToForm}: blocked (blocks still loading) or done. */
type StageOutcome =
  | { kind: 'blocked' }
  | {
      kind: 'done';
      result: RecordUnitsResult;
      sinkResult: Awaited<ReturnType<typeof writeToForm>>;
    };

/**
 * The whole record run, front to back: normalize the open form to the engine's
 * record shape, translate every target locale through the unified engine, and
 * stage the payload into the form (§2/§2.3). Kept module-level and free of React
 * state so the run reads as one linear pipeline; the caller owns the UI state.
 *
 * Returns `blocked` when the form's nested blocks are still loading
 * (`formValuesToItem` → undefined). Throws `RUN_CANCELLED` on cancel and
 * normalized provider errors on failure, both handled by the caller.
 */
async function stageTranslationsToForm(args: {
  ctx: RenderItemFormSidebarPanelCtx;
  pluginParams: ctxParamsType;
  fromLocale: string;
  targetLocales: string[];
  blockBearingFieldApiKeys: Set<string>;
  options: TranslateRecordUnitsOptions;
  isCancelled: () => boolean;
}): Promise<StageOutcome> {
  const {
    ctx,
    pluginParams,
    fromLocale,
    targetLocales,
    blockBearingFieldApiKeys,
    options,
    isCancelled,
  } = args;

  // Form state → JSON:API item. Returns undefined while nested blocks are still
  // loading; block rather than translate a partial record.
  const item = (await ctx.formValuesToItem(ctx.formValues, false)) as
    | JsonApiItem
    | undefined;
  if (!item) return { kind: 'blocked' };

  // §2.1 guard: a zero-field block model serialises to a bare id that
  // `itemToFormValues` cannot round-trip. Fail loudly, naming the path.
  assertNoBareBlockIds(item, blockBearingFieldApiKeys);

  const { itemTypeId, fields } = itemToSimpleShape(item);
  // The engine speaks `DatoCMSRecordFromAPI` (fields at top level + id +
  // item_type). `id` is only used in error logging; the open record may be
  // unsaved, so fall back to a placeholder.
  const unit: DatoCMSRecordFromAPI = {
    ...fields,
    id: ctx.item?.id ?? 'current-record',
    item_type: { id: itemTypeId },
  };

  const accessToken = ctx.currentUserAccessToken as string;
  const client = buildDatoCMSClient(accessToken, ctx.environment, ctx.cmaBaseUrl);
  const schemaRepository = createSchemaRepository(client);
  const fieldDictionary = await buildFieldTypeDictionaryWithRepo(
    schemaRepository,
    ctx.itemType.id,
  );

  const result = await translateRecordUnits(unit, targetLocales, {
    provider: getProvider(pluginParams),
    pluginParams,
    fieldDictionary,
    fromLocale,
    accessToken,
    environment: ctx.environment,
    cmaBaseUrl: ctx.cmaBaseUrl,
    schemaRepository,
    options,
  });

  // Stage the translated payload into the open form. writtenLocales gates the
  // writes to only the locales this run actually produced (§2.1).
  const writes = payloadToFormWrites(result.payload, result.writtenLocales);
  const sinkResult = await writeToForm({ writes, ctx, isCancelled });

  return { kind: 'done', result, sinkResult };
}

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
  // The single status line that replaces the per-field chat bubbles (§2.3-5).
  // Empty while idle; "Translating…" during the run; a summary/warning/failure
  // line once the run settles.
  const [statusLine, setStatusLine] = useState<string>('');
  const [showTimer, setShowTimer] = useState<boolean>(false);
  const [progress, setProgress] = useState<number>(100);

  const abortControllerRef = useRef<AbortController | null>(null);
  // The run's pause machine — the engine's between-unit `gate` and its
  // `onSystemic` handler share this one instance (§2.3-1). Cancelling the run
  // cancels it so a paused/awaiting locale unwinds via RUN_CANCELLED.
  const pauseControllerRef = useRef<PauseController | null>(null);
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

  /**
   * The api_keys of the record's top-level block-bearing fields, for
   * `assertNoBareBlockIds`. Restricted to the current item type so a block
   * sub-field sharing an api_key with an unrelated top-level scalar can't widen
   * the set.
   */
  const blockBearingFieldApiKeys = useMemo<Set<string>>(() => {
    const keys = new Set<string>();
    for (const field of Object.values(ctx.fields)) {
      if (!field?.attributes) continue;
      if (field.relationships?.item_type?.data?.id !== ctx.itemType.id) continue;
      if (BLOCK_BEARING_FIELD_TYPES.has(field.attributes.field_type)) {
        keys.add(field.attributes.api_key);
      }
    }
    return keys;
  }, [ctx.fields, ctx.itemType.id]);

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

  /** Resets to the idle-but-cancelled state and notices the user. */
  const finishCancelled = () => {
    setStatusLine('');
    ctx.notice('Translation cancelled');
    setIsCancelling(false);
    setIsLoading(false);
  };

  /** Applies the settled run's status line + QC notice/alert to the UI. */
  const reportSettledRun = (
    outcome: Extract<StageOutcome, { kind: 'done' }>,
  ) => {
    if (outcome.sinkResult.verifiedMissing.length > 0) {
      ctx.alert(
        `Some fields did not stage into the form and may need a re-run: ${outcome.sinkResult.verifiedMissing.join(', ')}`,
      );
    }
    const summary = summarizeRunOutcome(
      outcome.result,
      concreteTargetLocales.length,
    );
    setStatusLine(summary.statusLine);
    if (summary.kind === 'failures') {
      ctx.alert(summary.alert);
      setIsLoading(false);
      return;
    }
    if (summary.kind === 'notes') ctx.notice(summary.notice);
    showSuccessNoticeOnce();
  };

  async function handleTranslateAllFields() {
    if (!sourceLocaleValue) return;
    if (concreteTargetLocales.length === 0) return;

    setIsLoading(true);
    setIsCancelling(false);
    isCancellingRef.current = false;
    successShownRef.current = false;
    // A plain running state: the engine reports per-field outcomes only at
    // completion (no streaming — §2.3-5), so there is no live n/m to show.
    setStatusLine('Translating…');

    const controller = new AbortController();
    abortControllerRef.current = controller;

    // One pause machine per run: the engine's `gate` (between-unit cancel) and
    // `onSystemic` (rate-limit/auth/quota/network pause + auto-retry) both read
    // from it, so pausing and cancelling share one source of truth (§2.3-1).
    // The sidebar has no pause UI yet (Phase 4), so status transitions are
    // ignored here — the machine's default auto-retry-then-pause still runs.
    const pauseController = createPauseController({ onStatus: () => {} });
    pauseControllerRef.current = pauseController;

    const options: TranslateRecordUnitsOptions = {
      gate: pauseController.gate,
      onSystemic: pauseController.handleSystemic,
      abortSignal: controller.signal,
      // §2.3-7: no CMA write here, so never run the locale-sync fallback — it
      // would stage fallback nulls/originals into the live form.
      applyLocaleSync: false,
    };

    try {
      const outcome = await stageTranslationsToForm({
        ctx,
        pluginParams,
        fromLocale: sourceLocaleValue,
        targetLocales: concreteTargetLocales,
        blockBearingFieldApiKeys,
        options,
        isCancelled: () => isCancellingRef.current,
      });

      if (outcome.kind === 'blocked') {
        ctx.alert(
          'The record is still loading its nested blocks. Please try again in a moment.',
        );
        setIsLoading(false);
        return;
      }
      if (isCancellingRef.current) return finishCancelled();
      reportSettledRun(outcome);
    } catch (error) {
      if (error === RUN_CANCELLED) return finishCancelled();
      setStatusLine('Failed — see report');
      handleUIError(error, pluginParams.vendor, ctx);
      setIsLoading(false);
      setIsCancelling(false);
    } finally {
      abortControllerRef.current = null;
      pauseControllerRef.current = null;
    }
  }

  function handleCancelTranslation() {
    setIsCancelling(true);
    isCancellingRef.current = true;
    ctx.notice('Translation cancellation requested. Please wait...');
    // Cancel the pause machine (unwinds a paused/awaiting locale via
    // RUN_CANCELLED) and abort in-flight provider calls.
    pauseControllerRef.current?.cancel();
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
              <div className={s.statusLine} role="status" aria-live="polite">
                {statusLine}
              </div>
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
