import type { RenderItemFormSidebarPanelCtx } from 'datocms-plugin-sdk';
import { Canvas } from 'datocms-react-ui';
import { useEffect, useMemo, useRef } from 'react';
import { readFormRecord } from '../data/formRecord';
import { createSchemaLoader } from '../data/schema';
import { extractLinks } from '../extraction/extract';
import { PanelControls, PanelProgress } from '../panel/PanelControls';
import { PanelNotes } from '../panel/PanelNotes';
import {
  PanelResults,
  PanelSummary,
  panelSummaryText,
} from '../panel/PanelResults';
import { formatWarning, hasWarningRewrite } from '../report/format';
import type { ScanSession } from '../state/session';
import { useScan } from '../state/useScan';
import type { LinkOccurrence, ScanReport } from '../types';
import { contextKey } from '../utils/contextKey';

const FIELDS_FAILED =
  "The record's fields couldn't be loaded. Check again to retry.";
const READ_FAILED = "The record couldn't be read. Check again to retry.";

/**
 * Reads the form and feeds its links to the session. A host or SDK failure is
 * logged and reported in plain words, since its own message ("Failed to
 * fetch", "Cannot serialize block") says nothing useful here.
 */
async function checkForm(
  ctx: RenderItemFormSidebarPanelCtx,
  loader: ReturnType<typeof createSchemaLoader>,
  locales: string[],
  session: ScanSession,
  signal: AbortSignal,
) {
  let failure = FIELDS_FAILED;
  try {
    const schema = await loader.load(ctx.itemType.id);
    if (signal.aborted) return;
    failure = READ_FAILED;
    const { record, warnings } = await readFormRecord(
      ctx,
      schema,
      locales,
      signal,
    );
    if (signal.aborted) return;
    for (const warning of warnings) session.warn(warning);
    session.addRecord(extractLinks(record, schema, locales));
  } catch (error) {
    if (signal.aborted) return;
    console.error(error);
    // The reader's own "still loading" message already says what to do.
    if (error instanceof Error && hasWarningRewrite(error.message))
      session.warn(error.message);
    else session.warn(failure);
  }
}

/**
 * Every locale of the record: the site's locales the form has enabled. A form
 * can still hold values for a locale the record no longer has; those aren't
 * the record's links.
 */
function recordLocales(ctx: RenderItemFormSidebarPanelCtx): string[] {
  const siteLocales = ctx.site.attributes.locales;
  const enabled = ctx.formValues.internalLocales;
  if (!Array.isArray(enabled)) return siteLocales;
  const locales = siteLocales.filter((locale) => enabled.includes(locale));
  return locales.length > 0 ? locales : siteLocales;
}

/** What the live region says once a check settles: the notes' gist, then the summary. */
function announcement(
  report: ScanReport | undefined,
  running: boolean,
  uiLocale: string,
): string {
  if (!report || running) return '';
  // Nothing could be read: the reason is the whole story.
  if (report.recordsScanned === 0 && report.warnings.length > 0)
    return formatWarning(report.warnings[0], uiLocale);
  return [
    report.state === 'cancelled' && 'Check canceled',
    report.warnings.length > 0 && "Some content couldn't be read",
    panelSummaryText({ report, uiLocale }),
  ]
    .filter(Boolean)
    .join('. ');
}

export default function RecordPanel({
  ctx,
}: {
  ctx: RenderItemFormSidebarPanelCtx;
}) {
  const { itemTypes, loadItemTypeFields, currentRole, environment } = ctx;
  const loader = useMemo(
    () =>
      createSchemaLoader({
        itemTypes,
        loadItemTypeFields,
        currentRole,
        environment,
      }),
    [itemTypes, loadItemTypeFields, currentRole, environment],
  );
  const scan = useScan(
    `${contextKey(ctx)}:${ctx.item?.id ?? 'new'}:${ctx.itemType.id}`,
  );
  // Every locale is checked, so only content changes make results stale.
  const source = JSON.stringify(ctx.formValues);
  const scannedSource = useRef<string | undefined>(undefined);
  const uiLocale = ctx.ui.locale;
  const multiLocale = ctx.site.attributes.locales.length > 1;

  useEffect(() => {
    if (scannedSource.current !== undefined && scannedSource.current !== source)
      scan.markStale();
  }, [source, scan.markStale]);

  const start = () => {
    scannedSource.current = source;
    const locales = recordLocales(ctx);
    void scan.start('Current form', (session, signal) =>
      checkForm(ctx, loader, locales, session, signal),
    );
  };

  const goToField = async (occurrence: LinkOccurrence) => {
    try {
      // The host adds absent locales when navigating, so only switch to enabled ones.
      const present =
        occurrence.locale &&
        Array.isArray(ctx.formValues.internalLocales) &&
        ctx.formValues.internalLocales.includes(occurrence.locale);
      await ctx.scrollToField(
        occurrence.fieldPath,
        present ? occurrence.locale : undefined,
      );
    } catch (error) {
      console.error(error);
      void ctx.alert("Couldn't open the field!");
    }
  };

  const report = scan.report;
  return (
    <Canvas ctx={ctx}>
      <div className="dl-kit-form-parity blc-panel">
        <PanelControls
          running={scan.running}
          submitting={ctx.isSubmitting}
          hasReport={report !== undefined}
          onCheck={start}
          onCancel={scan.cancel}
        />
        {report && scan.running && (
          <PanelProgress report={report} uiLocale={uiLocale} />
        )}
        <PanelNotes
          report={report}
          running={scan.running}
          uiLocale={uiLocale}
        />
        {report && !scan.running && (
          <PanelSummary report={report} uiLocale={uiLocale} />
        )}
        <PanelResults
          key={report?.startedAt}
          report={report}
          showLocale={multiLocale}
          uiLocale={uiLocale}
          onGoToField={(occurrence) => void goToField(occurrence)}
        />
        {/* Mounted from the start, so screen readers announce the result when a check settles */}
        <div role="status" className="blc-visually-hidden">
          {announcement(report, scan.running, uiLocale)}
        </div>
      </div>
    </Canvas>
  );
}
