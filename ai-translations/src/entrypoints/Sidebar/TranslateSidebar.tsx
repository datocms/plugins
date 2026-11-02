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
 * While it runs, one row per field shows its state in all the target
 * locales, and a click on a row scrolls the form to that field (in the
 * first locale that failed, when one did). Single-record translation reports
 * field by field, so it stays in the panel instead of the bulk progress
 * modal.
 *
 * Each phase swaps the panel's button, so the focus moves with the phase:
 * to Cancel while it runs, to Done once it ends, and back to "Translate all
 * fields" with the form. A run with failures keeps its rows too, and one
 * alert at its end says which fields failed, in which locales, and why.
 */
import type { RenderItemFormSidebarPanelCtx } from 'datocms-plugin-sdk';
import BlankSlate from 'datocms-react-ui/BlankSlate';
import Button from 'datocms-react-ui/Button';
import FieldWrapper from 'datocms-react-ui/FieldWrapper';
import RowList from 'datocms-react-ui/RowList';
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
import { buildPluginSettingsPath } from '../../utils/dashboardPaths';
import { formatList, formatLocaleWithCode } from '../../utils/localeUtils';
import { translateRecordFields } from '../../utils/translateRecordFields';
import { handleUIError } from '../../utils/translation/ProviderErrors';
import { isProviderConfigured } from '../../utils/translation/ProviderFactory';
import type { ctxParamsType } from '../Config/ConfigScreen';
import {
  type FieldRowState,
  fieldRows,
  localeToOpen,
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
 * translated, `done` keeps the rows with "Done" once the run ended (with or
 * without failures).
 */
type Phase = 'form' | 'running' | 'done';

/**
 * How long a run without failures stays before the panel goes back to the
 * form. A run with failures stays until Done, so its failed rows stay in view.
 */
const SUCCESS_TIMER_DURATION_MS = 7500;

const SUCCESS_NOTICE =
  'The translations are in the form. Review them, then save the record.';

const NOT_READY_REASON = 'Pick at least one locale to translate into.';

/** A field that couldn't be translated into a locale, and why. */
type Failure = { fieldLabel: string; locale: string; message: string };

/** What the end-of-run alert needs to know about the run. */
type RunTally = {
  /** The number of fields that the run started. */
  fields: number;
  /** The target locales of the run, in order. */
  locales: string[];
  /** Some field was translated into some locale. */
  someTranslated: boolean;
};

/**
 * The one alert at the end of a run with failures. When every field failed
 * in the same locales, it names the locales only ("Couldn't translate into
 * German [de]."); otherwise the fields and their locales ("Couldn't
 * translate “Excerpt” into Italian [it] and German [de]."). Then the causes
 * and, when something was translated, what to do next.
 */
function failureAlert(failures: Failure[], run: RunTally): string {
  // Each field that failed, with its failed locales in the order of the run
  const failedLocales = new Map<string, string[]>();
  for (const { fieldLabel } of failures) {
    failedLocales.set(
      fieldLabel,
      run.locales.filter((locale) =>
        failures.some(
          (failure) =>
            failure.fieldLabel === fieldLabel && failure.locale === locale,
        ),
      ),
    );
  }
  // The fields that failed in the same locales go together
  const fieldsByLocales = new Map<string, string[]>();
  for (const [fieldLabel, locales] of failedLocales) {
    const key = formatList(locales.map(formatLocaleWithCode));
    fieldsByLocales.set(key, [
      ...(fieldsByLocales.get(key) ?? []),
      `“${fieldLabel}”`,
    ]);
  }
  const groups = [...fieldsByLocales];
  const lead =
    groups.length === 1 && failedLocales.size >= run.fields
      ? `Couldn't translate into ${groups[0][0]}.`
      : `Couldn't translate ${formatList(
          groups.map(
            ([locales, fields]) => `${formatList(fields)} into ${locales}`,
          ),
        )}.`;
  const causes = [...new Set(failures.map((failure) => failure.message))];
  // The failed fields failed in every locale: the other fields are whole
  const wholeFieldsFailed = [...failedLocales.values()].every(
    (locales) => locales.length === run.locales.length,
  );
  const next = run.someTranslated
    ? `The other ${wholeFieldsFailed ? 'fields' : 'translations'} are in the form. Review them, then save the record.`
    : '';
  return [lead, ...causes, next].filter(Boolean).join(' ');
}

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
  // The vendor is a setting that these roles never see: only who to ask.
  if (!ctx.currentRole.meta.final_permissions.can_edit_schema) {
    return (
      <SidebarPanel.Blank message="Translation isn't set up yet. Ask an admin to set it up." />
    );
  }

  return (
    <>
      <SidebarPanel.Blank message="No AI vendor is set up yet." />
      <SidebarPanel.Action
        label="Open plugin settings"
        onClick={() => {
          void ctx.navigateTo(buildPluginSettingsPath(ctx));
        }}
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
  // The last run ended with failures: its rows stay until Done.
  const [hasFailures, setHasFailures] = useState(false);
  const [rows, setRows] = useState<TranslationRowState[]>([]);
  // The target locales of the run that the rows show.
  const [runLocales, setRunLocales] = useState<string[]>([]);
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

  // A run without failures goes back to the form on its own after a while.
  useEffect(() => {
    if (phase !== 'done' || hasFailures) return;
    const timer = setTimeout(() => setPhase('form'), SUCCESS_TIMER_DURATION_MS);
    return () => clearTimeout(timer);
  }, [phase, hasFailures]);

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
        : phase === 'done'
          ? doneRef.current
          : document.getElementById(translateId);
    target?.focus({ preventScroll: true });
  }, [phase, translateId]);

  const openRow = useCallback(
    (field: FieldRowState) => {
      void ctx.scrollToField(field.baseFieldPath, localeToOpen(field));
    },
    [ctx],
  );

  /** A new source translates into every other locale of the record. */
  function handleSourceLocaleChange(next: string | null) {
    if (!next) return;
    setSourceLocale(next);
    setTargetLocales(internalLocales.filter((locale) => locale !== next));
  }

  /**
   * What the panel shows once a run settles: the form after a cancel or a
   * run with nothing to translate; the rows with Done after a run, kept
   * until Done when some field failed or stopped (with one alert for the
   * failures).
   */
  function endRun(
    source: string,
    tally: {
      started: number;
      completed: number;
      fields: number;
      locales: string[];
      failures: Failure[];
    },
  ) {
    const { started, completed, fields, locales, failures } = tally;
    if (isCancellingRef.current) {
      ctx.notice(
        completed > 0
          ? 'Translation cancelled. Review the translated fields, then save the record.'
          : 'Translation cancelled.',
      );
      setIsCancelling(false);
      setPhase('form');
    } else if (started === 0) {
      ctx.notice(
        `No translatable field has content in ${formatLocaleWithCode(source)}.`,
      );
      setPhase('form');
    } else if (failures.length > 0 || completed < started) {
      // The rows stay, with the failed ones marked. A field that stopped
      // without a result isn't a success either: its row stops loading.
      setRows((prev) =>
        prev.map((row) =>
          row.status === 'pending' ? { ...row, status: 'error' } : row,
        ),
      );
      if (failures.length > 0) {
        ctx.alert(
          failureAlert(failures, {
            fields,
            locales,
            someTranslated: completed > 0,
          }),
        );
      }
      setHasFailures(true);
      setPhase('done');
    } else {
      ctx.notice(SUCCESS_NOTICE);
      setPhase('done');
    }
  }

  async function handleTranslateAllFields() {
    if (!sourceLocale || concreteTargetLocales.length === 0) return;

    setPhase('running');
    setRows([]);
    setRunLocales(concreteTargetLocales);
    setHasFailures(false);
    setIsCancelling(false);
    isCancellingRef.current = false;

    const controller = new AbortController();
    abortControllerRef.current = controller;
    // The run's own tally, read once it settles: the rows in state would be
    // a render behind.
    const startedFieldPaths = new Set<string>();
    const startedFields = new Set<string>();
    const completedFieldPaths = new Set<string>();
    const failures: Failure[] = [];

    try {
      await translateRecordFields(
        ctx,
        pluginParams,
        concreteTargetLocales,
        sourceLocale,
        {
          onStart: (fieldLabel, locale, fieldPath, baseFieldPath) => {
            startedFieldPaths.add(fieldPath);
            startedFields.add(fieldLabel);
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
          // The row shows the failure; the alert at the end says why.
          onError: (fieldLabel, locale, fieldPath, _base, errorMessage) => {
            failures.push({ fieldLabel, locale, message: errorMessage });
            setRows((prev) => withRowStatus(prev, fieldPath, 'error'));
          },
          checkCancellation: () => isCancellingRef.current,
          abortSignal: controller.signal,
        },
      );

      endRun(sourceLocale, {
        started: startedFieldPaths.size,
        completed: completedFieldPaths.size,
        fields: startedFields.size,
        locales: concreteTargetLocales,
        failures,
      });
    } catch (error) {
      handleUIError(error, pluginParams.vendor, ctx);
      setIsCancelling(false);
      setPhase('form');
    } finally {
      abortControllerRef.current = null;
    }
  }

  // The busy Cancel shows that the run is stopping.
  function handleCancelTranslation() {
    setIsCancelling(true);
    isCancellingRef.current = true;
    abortControllerRef.current?.abort();
  }

  if (phase === 'form') {
    return (
      <>
        <FieldWrapper label="Translate from">
          <SelectInput
            name="sourceLocale"
            value={sourceLocale}
            onChange={handleSourceLocaleChange}
            options={localeOptions}
            clearable={false}
          />
        </FieldWrapper>
        <FieldWrapper
          label="Translate into"
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
        // The panel has its inset: compact rows keep their text on its edge,
        // in line with the fields and buttons of the panel.
        <RowList density="compact">
          {fieldRows(rows, runLocales, phase === 'done').map((field) => (
            <TranslationRow
              key={field.baseFieldPath}
              field={field}
              onOpen={openRow}
            />
          ))}
        </RowList>
      )}
      <div className={s.actions}>
        {phase === 'done' ? (
          <Button
            key="done"
            ref={doneRef}
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
