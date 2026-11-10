import type { RenderPageCtx } from 'datocms-plugin-sdk';
import Canvas, { type NavigationAdapter } from 'datocms-react-ui/Canvas';
import { ListDetailWidthsProvider } from 'datocms-react-ui/ListDetail';
import { useInMemorySidebarPanelOpen } from 'datocms-react-ui/SidebarPanel';
import { useInMemoryTableLayout } from 'datocms-react-ui/Table';
import { useMemo, useRef, useState } from 'react';
import { SCOPE_MODAL_ID } from '../constants';
import { createSchemaLoader } from '../data/schema';
import {
  FirstRunOverview,
  NoAccessState,
  NoModelsState,
} from '../project/PageStates';
import { REPORT_TEXTS } from '../project/PageToolbar';
import { ReportLayout, ROW_BASE_URL } from '../project/ReportLayout';
import { DEFAULT_TABLE_LAYOUT } from '../project/ReportTable';
import { createProjectProducer } from '../project/scanProject';
import { useFillingWidths } from '../project/useFillingWidths';
import { useSettledScan } from '../project/useSettledScan';
import { localeName } from '../report/format';
import {
  ALL_SCOPE,
  isScope,
  resolveScope,
  type Scope,
  scopeLabel,
} from '../report/scope';
import { updateGroup } from '../state/group';
import { useScan } from '../state/useScan';
import type { CheckResult, LinkGroup } from '../types';
import { contextKey } from '../utils/contextKey';
import { downloadReport } from '../utils/csv';
import { type ScopeModalParams, scopeModalHeight } from './ScopeModal';

type PageProps = { ctx: RenderPageCtx };

type PageLocation = NonNullable<NavigationAdapter['location']>;

/** No row open: the list alone. The location lives only in memory. */
const BASE_LOCATION: PageLocation = {
  pathname: ROW_BASE_URL,
  search: '',
};

function locationOf(to: string): PageLocation {
  const [pathname, query] = to.split('?');
  return { pathname, search: query ? `?${query}` : '' };
}

/**
 * The open row lives in an in-memory route ("/links/<URL key>"), and the
 * widths of the list and of the detail in state, so a new scan keeps them.
 */
function usePageNavigation() {
  const [location, setLocation] = useState(BASE_LOCATION);
  const navigation = useMemo<NavigationAdapter>(
    () => ({ location, navigate: (to) => setLocation(locationOf(to)) }),
    [location],
  );
  const widths = useFillingWidths();
  return {
    navigation,
    widths,
    closeRow: () => setLocation(BASE_LOCATION),
  };
}

function ProjectScanner({ ctx }: PageProps) {
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
  const scan = useScan(contextKey(ctx));
  const settled = useSettledScan(scan.report);
  const [scope, setScope] = useState<Scope>(ALL_SCOPE);
  const [recheckKey, setRecheckKey] = useState<string>();
  const [recheckResult, setRecheckResult] = useState<CheckResult>();
  const [changedRecordIds, setChangedRecordIds] = useState<ReadonlySet<string>>(
    () => new Set(),
  );
  // The progress bar's record count, per scan: a late count from an earlier scan is ignored.
  const [recordTotal, setRecordTotal] = useState<number>();
  const scanRun = useRef(0);
  const exportRunning = useRef(false);
  const [exporting, setExporting] = useState(false);
  const { navigation, widths, closeRow } = usePageNavigation();
  // What the user arranged outlives a new scan, which remounts the report.
  const [tableLayout, setTableLayout] =
    useInMemoryTableLayout(DEFAULT_TABLE_LAYOUT);
  const [linkOpen, setLinkOpen] = useInMemorySidebarPanelOpen(true);
  const [recordsOpen, setRecordsOpen] = useInMemorySidebarPanelOpen(true);
  const siteLocales = ctx.site.attributes.locales;
  const uiLocale = ctx.ui.locale;
  const scanning = scan.running && recheckKey === undefined;
  const rechecking = scan.running && recheckKey !== undefined;

  const startScan = (next: Scope) => {
    const { models, locales } = resolveScope(next, loader.models, siteLocales);
    if (models.length === 0 || locales.length === 0) return;
    setScope(next);
    setChangedRecordIds(new Set());
    setRecordTotal(undefined);
    // A URL of the new report could have the open row's key.
    closeRow();
    scanRun.current += 1;
    const run = scanRun.current;
    // The facts name the scope only when the user narrowed it.
    const whole =
      models.length === loader.models.length &&
      locales.length === siteLocales.length;
    void scan.start(
      whole ? '' : scopeLabel(next, loader.models, siteLocales, uiLocale),
      createProjectProducer(ctx, loader, models, locales, (total) => {
        if (run === scanRun.current) setRecordTotal(total);
      }),
    );
  };

  const chooseScope = async () => {
    const parameters: ScopeModalParams = {
      environment: ctx.environment,
      models: loader.models.map(({ id, name }) => ({ id, name })),
      locales: siteLocales.map((code) => ({
        code,
        label: localeName(code, uiLocale),
      })),
      scope,
    };
    let result: unknown;
    try {
      result = await ctx.openModal({
        id: SCOPE_MODAL_ID,
        title: 'Choose what to scan',
        width: 's',
        initialHeight: scopeModalHeight(siteLocales.length > 1),
        // Its footer has a Cancel, so it has no cross.
        closeDisabled: true,
        parameters,
      });
    } catch (error) {
      console.error(error);
      void ctx.alert("Couldn't open the scan dialog.");
      return;
    }
    // Cancel and Escape resolve nothing: nothing to start.
    if (isScope(result)) startScan(result);
  };

  const recheck = async (group: LinkGroup) => {
    setRecheckKey(group.key);
    setRecheckResult(group.result);
    try {
      await scan.recheck(group);
    } finally {
      setRecheckKey(undefined);
      setRecheckResult(undefined);
    }
  };

  const openRecord = async (recordId: string) => {
    try {
      const saved = await ctx.editItem(recordId);
      if (!saved) return;
      scan.markStale(recordId);
      setChangedRecordIds((previous) => new Set(previous).add(recordId));
    } catch (error) {
      console.error(error);
      void ctx.alert("Couldn't open the record.");
    }
  };

  // Always the whole report, whatever the filters. During a recheck the export
  // matches the page: the settled state, and the rechecked URL's previous result.
  const exportCsv = async () => {
    const { report } = scan;
    if (!report || exportRunning.current) return;
    exportRunning.current = true;
    setExporting(true);
    try {
      await downloadReport(
        rechecking && settled
          ? {
              ...report,
              state: settled.state,
              groups: report.groups.map((group) =>
                group.key === recheckKey && recheckResult
                  ? updateGroup(group, { result: recheckResult })
                  : group,
              ),
            }
          : report,
      );
    } catch (error) {
      console.error(error);
      void ctx.alert("Couldn't export the report.");
    } finally {
      exportRunning.current = false;
      setExporting(false);
    }
  };

  if (loader.models.length === 0) {
    const hasModels = Object.values(itemTypes).some(
      (itemType) => itemType && !itemType.attributes.modular_block,
    );
    const envPrefix = ctx.isEnvironmentPrimary
      ? ''
      : `/environments/${ctx.environment}`;
    // The CMS router of a plain Canvas opens Schema.
    return (
      <Canvas ctx={ctx} noAutoResizer>
        <NoModelsState
          hasModels={hasModels}
          schemaPath={
            currentRole.meta.final_permissions.can_edit_schema
              ? `${envPrefix}/schema`
              : undefined
          }
        />
      </Canvas>
    );
  }

  return (
    <Canvas
      ctx={ctx}
      noAutoResizer
      navigation={navigation}
      texts={REPORT_TEXTS}
    >
      <ListDetailWidthsProvider value={widths}>
        {scan.report ? (
          <ReportLayout
            key={scan.report.startedAt}
            report={scan.report}
            scanning={scanning}
            rechecking={rechecking}
            recheckKey={recheckKey}
            recheckResult={recheckResult}
            settled={settled}
            recordTotal={recordTotal}
            changedRecordIds={changedRecordIds}
            multiLocale={siteLocales.length > 1}
            uiLocale={uiLocale}
            tableLayout={tableLayout}
            onTableLayoutChange={setTableLayout}
            linkPanel={{ open: linkOpen, onToggle: setLinkOpen }}
            recordsPanel={{ open: recordsOpen, onToggle: setRecordsOpen }}
            onScan={() => startScan(scope)}
            onChooseScope={() => void chooseScope()}
            onCancel={scan.cancel}
            exporting={exporting}
            onExport={() => void exportCsv()}
            onRecheck={(group) => void recheck(group)}
            onOpenRecord={(recordId) => void openRecord(recordId)}
          />
        ) : (
          <FirstRunOverview
            onScan={() => startScan(scope)}
            onChooseScope={() => void chooseScope()}
          />
        )}
      </ListDetailWidthsProvider>
    </Canvas>
  );
}

/** The Link checker page. Scanning saved records needs the current user's API token. */
export default function ProjectPage({ ctx }: PageProps) {
  if (!ctx.currentUserAccessToken)
    return (
      <Canvas ctx={ctx} noAutoResizer>
        <NoAccessState />
      </Canvas>
    );
  return <ProjectScanner ctx={ctx} />;
}
