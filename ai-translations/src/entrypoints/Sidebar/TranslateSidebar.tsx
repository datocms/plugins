/**
 * TranslateSidebar.tsx
 * --------------------
 * The "AI Translations" panel of the record sidebar (the host draws the panel
 * and its title). Editors pick a source locale and one or more target
 * locales, then translate every translatable field of the record that is
 * open in the form. The translation runs in form context (via
 * `translateRecordFields`, which writes through `ctx.setFieldValue`), so the
 * changes show in the form at once and the user reviews them before saving.
 *
 * While it runs, one row per field and locale shows its state, and a click on
 * a row scrolls the form to that field. Single-record translation reports
 * field by field, so it stays in the panel instead of the bulk progress
 * modal.
 *
 * Each phase swaps the panel's button, so the focus moves with the phase:
 * to Cancel while it runs, to Done after a success, and back to "Translate
 * all fields" with the form.
 */
import type { RenderItemFormSidebarPanelCtx } from 'datocms-plugin-sdk';
import BlankSlate from 'datocms-react-ui/BlankSlate';
import Button from 'datocms-react-ui/Button';
import FieldWrapper from 'datocms-react-ui/FieldWrapper';
import SelectInput from 'datocms-react-ui/SelectInput';
import SidebarPanel from 'datocms-react-ui/SidebarPanel';
import {
  useCallback,
  useEffect,
  useId,
  useMemo,
  useRef,
  useState,
} from 'react';
import { PICK_LOCALE_ERROR } from '../../components/BulkTranslations/bulkCopy';
import { InsetRowList } from '../../components/InsetRowList';
import { buildPluginSettingsPath } from '../../utils/dashboardPaths';
import { formatLocaleWithCode } from '../../utils/localeUtils';
import { translateRecordFields } from '../../utils/translateRecordFields';
import { handleUIError } from '../../utils/translation/ProviderErrors';
import { isProviderConfigured } from '../../utils/translation/ProviderFactory';
import type { ctxParamsType } from '../Config/ConfigScreen';
import {
  TranslationRow,
  type TranslationRowState,
  type TranslationRowStatus,
} from './Components/TranslationRow';
import s from './TranslateSidebar.module.css';

type PropTypes = {
  ctx: RenderItemFormSidebarPanelCtx;
};

/**
 * `form` picks the locales, `running` shows the rows while the fields are
 * translated, `success` keeps the rows with "Done" after a run without
 * errors.
 */
type Phase = 'form' | 'running' | 'success';

/** How long the success state stays before the panel goes back to the form. */
const SUCCESS_TIMER_DURATION_MS = 7500;

const SUCCESS_NOTICE =
  'Translations were applied to the form. Review them and click Save to persist the changes.';

const NOT_READY_REASON = 'Pick a source locale and at least one target locale.';

/**
 * Whether the frame has the focus but no element holds it: the focused
 * button went away with the old phase, and the focus fell to the body. When
 * the focus is elsewhere (another control of the panel, or the record's form
 * out of the frame), a phase change, such as the automatic return to the
 * form, leaves it there.
 */
function focusFellToBody(): boolean {
  const active = document.activeElement;
  return document.hasFocus() && (active === null || active === document.body);
}

/** The locales of the record, or none when the form doesn't give a list. */
function recordLocales(ctx: RenderItemFormSidebarPanelCtx): string[] {
  const { internalLocales } = ctx.formValues;
  return Array.isArray(internalLocales) ? (internalLocales as string[]) : [];
}

/**
 * The panel of a project whose vendor has no credentials yet. Only the roles
 * that can edit the schema can open the plugin settings, so the others are
 * told to ask an admin.
 */
function VendorNotSetUp({ ctx }: PropTypes) {
  if (!ctx.currentRole.meta.final_permissions.can_edit_schema) {
    return (
      <SidebarPanel.Blank message="No AI vendor is set up yet. Ask an admin to set one up." />
    );
  }

  return (
    <>
      <SidebarPanel.Blank message="No AI vendor is set up yet." />
      <Button
        expand
        label="Open plugin settings"
        to={buildPluginSettingsPath(ctx)}
      />
    </>
  );
}

/**
 * The panel of a record with nothing to translate into, and of a project
 * whose vendor isn't set up yet; otherwise the translator.
 */
export default function TranslateSidebar({ ctx }: PropTypes) {
  const pluginParams = ctx.plugin.attributes.parameters as ctxParamsType;
  const internalLocales = recordLocales(ctx);

  if (!isProviderConfigured(pluginParams)) {
    return <VendorNotSetUp ctx={ctx} />;
  }

  if (internalLocales.length < 2) {
    return (
      <SidebarPanel.Blank message="This record has only one locale, so there's nothing to translate it into." />
    );
  }

  return (
    <RecordTranslator
      ctx={ctx}
      pluginParams={pluginParams}
      internalLocales={internalLocales}
    />
  );
}

type RecordTranslatorProps = PropTypes & {
  pluginParams: ctxParamsType;
  internalLocales: string[];
};

/** Sets the status of one row, by the field path of its locale. */
function withRowStatus(
  rows: TranslationRowState[],
  fieldPath: string,
  status: TranslationRowStatus,
): TranslationRowState[] {
  return rows.map((row) => (row.id === fieldPath ? { ...row, status } : row));
}

function RecordTranslator({
  ctx,
  pluginParams,
  internalLocales,
}: RecordTranslatorProps) {
  const localeOptions = useMemo(
    () =>
      internalLocales.map((locale) => ({
        value: locale,
        label: formatLocaleWithCode(locale),
      })),
    [internalLocales],
  );

  const [sourceLocale, setSourceLocale] = useState<string | null>(
    internalLocales[0] ?? null,
  );
  const [targetLocales, setTargetLocales] = useState<string[]>(() =>
    internalLocales.slice(1),
  );
  const [phase, setPhase] = useState<Phase>('form');
  const [rows, setRows] = useState<TranslationRowState[]>([]);
  // Drives the busy Cancel button only. The running loop reads the ref: a
  // state value would be captured stale in its in-flight async closure.
  const [isCancelling, setIsCancelling] = useState(false);
  const isCancellingRef = useRef(false);
  const abortControllerRef = useRef<AbortController | null>(null);
  // The buttons that take the focus when the phase changes. "Translate all
  // fields" is found by its id, not a ref: while it is disabled with a
  // reason, the kit's tooltip clones it and reads `element.ref`, which React
  // 19 warns about.
  const translateId = useId();
  const cancelRef = useRef<HTMLElement>(null);
  const doneRef = useRef<HTMLElement>(null);
  const focusedPhaseRef = useRef<Phase>(phase);

  const concreteTargetLocales = useMemo(
    () =>
      sourceLocale
        ? targetLocales.filter((locale) => locale !== sourceLocale)
        : [],
    [sourceLocale, targetLocales],
  );
  const isReady = !!sourceLocale && concreteTargetLocales.length > 0;

  const targetOptions = useMemo(
    () => localeOptions.filter((option) => option.value !== sourceLocale),
    [localeOptions, sourceLocale],
  );

  // The success state goes back to the form on its own after a while.
  useEffect(() => {
    if (phase !== 'success') return;
    const timer = setTimeout(() => setPhase('form'), SUCCESS_TIMER_DURATION_MS);
    return () => clearTimeout(timer);
  }, [phase]);

  // The focused button goes away with its phase (Translate when the run
  // starts, Cancel when it ends, Done when the form comes back): give the
  // focus to the button of the new phase, so a keyboard or screen reader
  // user keeps their place.
  useEffect(() => {
    if (focusedPhaseRef.current === phase) return;
    focusedPhaseRef.current = phase;
    if (!focusFellToBody()) return;
    const target =
      phase === 'running'
        ? cancelRef.current
        : phase === 'success'
          ? doneRef.current
          : document.getElementById(translateId);
    target?.focus({ preventScroll: true });
  }, [phase, translateId]);

  const openRow = useCallback(
    (row: TranslationRowState) => {
      void ctx.scrollToField(row.baseFieldPath, row.locale);
    },
    [ctx],
  );

  /** A new source translates into every other locale of the record. */
  function handleSourceLocaleChange(next: string | null) {
    if (!next) return;
    setSourceLocale(next);
    setTargetLocales(internalLocales.filter((locale) => locale !== next));
  }

  async function handleTranslateAllFields() {
    if (!sourceLocale || concreteTargetLocales.length === 0) return;

    setPhase('running');
    setRows([]);
    setIsCancelling(false);
    isCancellingRef.current = false;

    const controller = new AbortController();
    abortControllerRef.current = controller;
    // The run's own tally, read once it settles: the rows in state would be
    // a render behind.
    const startedFieldPaths = new Set<string>();
    const completedFieldPaths = new Set<string>();
    let failedCount = 0;

    try {
      await translateRecordFields(
        ctx,
        pluginParams,
        concreteTargetLocales,
        sourceLocale,
        {
          onStart: (fieldLabel, locale, fieldPath, baseFieldPath) => {
            startedFieldPaths.add(fieldPath);
            setRows((prev) => {
              if (prev.some((row) => row.id === fieldPath)) return prev;
              return [
                ...prev,
                {
                  id: fieldPath,
                  fieldLabel,
                  locale,
                  baseFieldPath,
                  status: 'pending',
                },
              ];
            });
          },
          onComplete: (_fieldLabel, _locale, fieldPath) => {
            completedFieldPaths.add(fieldPath);
            setRows((prev) => withRowStatus(prev, fieldPath, 'done'));
          },
          onError: (fieldLabel, locale, fieldPath, _base, errorMessage) => {
            failedCount += 1;
            setRows((prev) => withRowStatus(prev, fieldPath, 'error'));
            ctx.alert(
              `Failed to translate "${fieldLabel}" to ${locale}: ${errorMessage}`,
            );
          },
          checkCancellation: () => isCancellingRef.current,
          abortSignal: controller.signal,
        },
      );

      if (isCancellingRef.current) {
        ctx.notice('Translation cancelled');
        setIsCancelling(false);
        setPhase('form');
      } else if (startedFieldPaths.size === 0) {
        ctx.notice(
          `No translatable field has content in ${formatLocaleWithCode(sourceLocale)}.`,
        );
        setPhase('form');
      } else if (
        failedCount > 0 ||
        completedFieldPaths.size < startedFieldPaths.size
      ) {
        // Each failure was alerted: the form is back for another try. A
        // field that stopped without a result isn't a success either.
        setPhase('form');
      } else {
        ctx.notice(SUCCESS_NOTICE);
        setPhase('success');
      }
    } catch (error) {
      handleUIError(error, pluginParams.vendor, ctx);
      setIsCancelling(false);
      setPhase('form');
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

  if (phase === 'form') {
    return (
      <>
        <FieldWrapper label="From">
          <SelectInput
            name="sourceLocale"
            value={sourceLocale}
            onChange={handleSourceLocaleChange}
            options={localeOptions}
            clearable={false}
          />
        </FieldWrapper>
        <FieldWrapper
          label="To"
          error={
            concreteTargetLocales.length === 0 ? PICK_LOCALE_ERROR : undefined
          }
        >
          <SelectInput
            multiple
            name="targetLocales"
            value={targetLocales}
            onChange={(next) => setTargetLocales(next ?? [])}
            options={targetOptions}
            placeholder="Pick locales"
          />
        </FieldWrapper>
        <Button
          id={translateId}
          expand
          label="Translate all fields"
          disabled={isReady ? undefined : { reason: NOT_READY_REASON }}
          onClick={() => {
            void handleTranslateAllFields();
          }}
        />
      </>
    );
  }

  return (
    <>
      {rows.length === 0 ? (
        <BlankSlate
          placement="section"
          small
          loading
          title="Preparing the fields"
        />
      ) : (
        // The rows go out into the panel padding, so their text lines up
        // with the fields and buttons of the panel.
        <InsetRowList bodyPadding={ctx.bodyPadding}>
          {rows.map((row) => (
            <TranslationRow
              key={row.id}
              row={row}
              vendor={pluginParams.vendor}
              onOpen={openRow}
            />
          ))}
        </InsetRowList>
      )}
      <div className={s.actions}>
        {phase === 'success' ? (
          <Button
            key="done"
            ref={doneRef}
            tone="primary"
            expand
            label="Done"
            onClick={() => setPhase('form')}
          />
        ) : (
          <Button
            key="cancel"
            ref={cancelRef}
            tone="ghost"
            expand
            label="Cancel"
            busy={isCancelling}
            onClick={handleCancelTranslation}
          />
        )}
      </div>
    </>
  );
}
