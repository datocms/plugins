import type { RenderPageCtx } from 'datocms-plugin-sdk';
import { Canvas, useMediaQuery } from 'datocms-react-ui';
import { type ReactNode, useMemo, useRef, useState } from 'react';
import { SCOPE_MODAL_ID } from '../constants';
import { createSchemaLoader } from '../data/schema';
import {
  FirstRunSlate,
  NoAccessState,
  NoModelsState,
} from '../project/PageStates';
import { PageToolbar } from '../project/PageToolbar';
import { ReportLayout } from '../project/ReportLayout';
import { createProjectProducer } from '../project/scanProject';
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
import { useWidth } from '../ui/useWidth';
import { contextKey } from '../utils/contextKey';
import { downloadReport } from '../utils/csv';
import type { ScopeModalParams } from './ScopeModal';

type PageProps = { ctx: RenderPageCtx };

/** A positioned box the panes and the split can fill. */
function PageFrame({ ctx, children }: PageProps & { children: ReactNode }) {
  return (
    <Canvas ctx={ctx} noAutoResizer>
      <div className="dl-frame blc-page dl-kit-form-parity">{children}</div>
    </Canvas>
  );
}

/** One pane with a title-only toolbar: permissions hide the scan controls. */
function StatePane({ children }: { children: ReactNode }) {
  return (
    <div className="dl-pane dl-pane--last blc-main-pane">
      <PageToolbar mode="none" />
      <div className="dl-pane__body">{children}</div>
    </div>
  );
}

type FirstRunPaneProps = {
  onScan: () => void;
  onChooseScope: () => void;
};

/** The blank slate holds the pane's one primary "Scan links"; the toolbar offers the scope. */
function FirstRunPane({ onScan, onChooseScope }: FirstRunPaneProps) {
  const paneRef = useRef<HTMLDivElement>(null);
  const paneWidth = useWidth(paneRef);
  return (
    <div ref={paneRef} className="dl-pane dl-pane--last blc-main-pane">
      <PageToolbar
        mode="firstRun"
        paneWidth={paneWidth}
        onChooseScope={onChooseScope}
      />
      <div className="dl-pane__body">
        <div className="dl-page dl-page--wide">
          <FirstRunSlate onScan={onScan} />
        </div>
      </div>
    </div>
  );
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
  // Read once: below 1800px the sidebar starts as a rail and opens on selection.
  const wide = useMediaQuery('(min-width: 1800px)').matches;
  const [collapsed, setCollapsed] = useState(!wide);
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
    scanRun.current += 1;
    const run = scanRun.current;
    void scan.start(
      scopeLabel(next, loader.models, siteLocales, uiLocale),
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
        // The intro, the switches (the locale one on multi-locale sites) and the button
        initialHeight: siteLocales.length > 1 ? 328 : 242,
        parameters,
      });
    } catch (error) {
      console.error(error);
      void ctx.alert("Couldn't open the scan dialog!");
      return;
    }
    // ✕ and Esc resolve undefined: nothing to start.
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
      void ctx.alert("Couldn't open the record!");
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
      void ctx.alert("Couldn't export the report!");
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
    const openSchema = async () => {
      try {
        await ctx.navigateTo(`${envPrefix}/schema`);
      } catch (error) {
        console.error(error);
        void ctx.alert("Couldn't open Schema!");
      }
    };
    return (
      <StatePane>
        <div className="dl-page">
          <NoModelsState
            hasModels={hasModels}
            onOpenSchema={
              currentRole.meta.final_permissions.can_edit_schema
                ? () => void openSchema()
                : undefined
            }
          />
        </div>
      </StatePane>
    );
  }

  if (!scan.report)
    return (
      <FirstRunPane
        onScan={() => startScan(scope)}
        onChooseScope={() => void chooseScope()}
      />
    );

  return (
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
      collapsed={collapsed}
      onCollapsedChange={setCollapsed}
      onScan={() => startScan(scope)}
      onChooseScope={() => void chooseScope()}
      onCancel={scan.cancel}
      exporting={exporting}
      onExport={() => void exportCsv()}
      onRecheck={(group) => void recheck(group)}
      onOpenRecord={(recordId) => void openRecord(recordId)}
    />
  );
}

/** The Link checker page. Scanning saved records needs the current user's API token. */
export default function ProjectPage({ ctx }: PageProps) {
  return (
    <PageFrame ctx={ctx}>
      {ctx.currentUserAccessToken ? (
        <ProjectScanner ctx={ctx} />
      ) : (
        <StatePane>
          <NoAccessState />
        </StatePane>
      )}
    </PageFrame>
  );
}
