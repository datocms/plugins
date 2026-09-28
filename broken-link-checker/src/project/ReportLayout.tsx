import { useMediaQuery, VerticalSplit } from 'datocms-react-ui';
import {
  type RefObject,
  useCallback,
  useDeferredValue,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
} from 'react';
import { countLabel } from '../report/format';
import {
  countStatuses,
  DEFAULT_FILTERS,
  type Filters,
  filterGroups,
  isDefaultFilters,
  nextSort,
  pageCount,
  pageSlice,
  proxyRefused,
  reportDimensions,
  type Sort,
  type SortKey,
  scanFraction,
  scanProgress,
  sortGroups,
} from '../report/view';
import type { CheckResult, LinkGroup, ScanReport } from '../types';
import { ProxyRefusedCallout } from '../ui/ProxyRefusedCallout';
import { useWidth } from '../ui/useWidth';
import { CoverageCallout, hasCoverageCallout } from './CoverageCallout';
import { FilterToolbar } from './FilterToolbar';
import { InfoOverlay } from './InfoOverlay';
import { InfoSidebar } from './InfoSidebar';
import { PageToolbar } from './PageToolbar';
import { PaginationBar, type PerPage, pageWindowFor } from './PaginationBar';
import { ReportTable } from './ReportTable';
import { ResultsEmpty } from './ResultsEmpty';
import { ScanProgressBlock } from './ScanProgressBlock';
import { type ScanAgain, ScanSummary } from './ScanSummary';
import type { SettledScan } from './useSettledScan';

export type ReportLayoutProps = {
  report: ScanReport;
  scanning: boolean;
  rechecking: boolean;
  recheckKey?: string;
  /** The rechecked group's result from before the recheck. */
  recheckResult?: CheckResult;
  settled?: SettledScan;
  /** Records the scan will read, once counted; the progress bar needs it while records are read. */
  recordTotal?: number;
  changedRecordIds: ReadonlySet<string>;
  /** The site has more than one locale, so each place names its own. */
  multiLocale: boolean;
  uiLocale: string;
  collapsed: boolean;
  /** Receives the next collapsed value. */
  onCollapsedChange: (collapsed: boolean) => void;
  onScan: () => void;
  onChooseScope: () => void;
  onCancel: () => void;
  onExport: () => void;
  onRecheck: (group: LinkGroup) => void;
  onOpenRecord: (recordId: string) => void;
};

/** Filters, sort and pagination; a new scan remounts the layout, which resets them. */
function useReportView(groups: readonly LinkGroup[]) {
  const [filters, setFilters] = useState<Filters>(DEFAULT_FILTERS);
  const [sort, setSort] = useState<Sort>(null);
  const [page, setPage] = useState(1);
  const [perPage, setPerPage] = useState<PerPage>(50);
  const query = useDeferredValue(filters.query);
  const { status, modelId, locale } = filters;
  const applied = useMemo<Filters>(
    () => ({ status, modelId, locale, query }),
    [status, modelId, locale, query],
  );
  const counts = useMemo(() => countStatuses(groups), [groups]);
  const dimensions = useMemo(() => reportDimensions(groups), [groups]);
  const filtered = useMemo(
    () => sortGroups(filterGroups(groups, applied), sort),
    [groups, applied, sort],
  );
  const pages = pageCount(filtered.length, perPage);
  // The filtered list shrinks and grows during a scan: keep the page it fell back to.
  if (page > pages) setPage(pages);
  const current = Math.min(page, pages);

  return {
    filters,
    applied,
    sort,
    perPage,
    counts,
    dimensions,
    filtered,
    page: current,
    pages,
    slice: pageSlice(filtered, current, perPage),
    changeFilters(next: Filters) {
      setFilters(next);
      setPage(1);
    },
    changeSort(key: SortKey) {
      setSort((previous) => nextSort(previous, key));
      setPage(1);
    },
    changePage: setPage,
    changePerPage(next: PerPage) {
      setPerPage(next);
      setPage(1);
    },
  };
}

type ReportView = ReturnType<typeof useReportView>;

/** The rows in the current view: "248 URLs". */
function urlCountLabel(view: ReportView, uiLocale: string) {
  const shown = view.filtered.length;
  return shown === 0
    ? undefined
    : countLabel(shown, '1 URL', '{n} URLs', uiLocale);
}

/**
 * While a URL is rechecked its live result reads "Checking". Filters, counts and
 * the summary keep its previous result, so its row stays where it was.
 */
function useViewGroups(
  groups: LinkGroup[],
  recheckKey?: string,
  recheckResult?: CheckResult,
): LinkGroup[] {
  return useMemo(
    () =>
      recheckKey === undefined || recheckResult === undefined
        ? groups
        : groups.map((group) =>
            group.key === recheckKey
              ? { ...group, result: recheckResult }
              : group,
          ),
    [groups, recheckKey, recheckResult],
  );
}

function rowOf(body: HTMLElement | null, key: string) {
  if (!body) return undefined;
  return Array.from(
    body.querySelectorAll<HTMLTableRowElement>('tr[data-key]'),
  ).find((row) => row.dataset.key === key);
}

type ReportResultsProps = {
  view: ReportView;
  report: ScanReport;
  /** The live groups, so a rechecked row reads "Checking". */
  groupsByKey: ReadonlyMap<string, LinkGroup>;
  /** The settled state: a recheck publishes the report as running. */
  state: ScanReport['state'];
  scanning: boolean;
  selectedKey: string | null;
  onSelect: (key: string, open: boolean) => void;
  onClearSelection: () => void;
  uiLocale: string;
};

function emptyKind(view: ReportView, total: number, scanning: boolean) {
  if (total === 0) return 'noLinks';
  if (!isDefaultFilters(view.applied)) return 'noMatch';
  return scanning ? 'cleanSoFar' : 'clean';
}

function ReportResults({
  view,
  report,
  groupsByKey,
  state,
  scanning,
  selectedKey,
  onSelect,
  onClearSelection,
  uiLocale,
}: ReportResultsProps) {
  const total = report.groups.length;
  // Nothing found yet: the summary's spinner already says the scan is running.
  if (total === 0 && scanning) return null;
  // A canceled or failed scan without URLs: the coverage callout explains it.
  if (total === 0 && state !== 'complete') return null;
  if (view.filtered.length === 0)
    return (
      <ResultsEmpty
        kind={emptyKind(view, total, scanning)}
        total={total}
        partial={report.warnings.length > 0}
        onShowAll={() => view.changeFilters({ ...view.filters, status: 'all' })}
        uiLocale={uiLocale}
      />
    );
  return (
    <ReportTable
      groups={view.slice.map((group) => groupsByKey.get(group.key) ?? group)}
      sort={view.sort}
      onSort={view.changeSort}
      selectedKey={selectedKey}
      onSelect={onSelect}
      onClearSelection={onClearSelection}
      uiLocale={uiLocale}
    />
  );
}

type ReportBodyProps = ReportResultsProps & {
  bodyRef: RefObject<HTMLDivElement | null>;
  /** The report as the view reads it, for the summary. */
  viewReport: ScanReport;
  settled?: SettledScan;
  recordTotal?: number;
  /** The running scan's progress, never moving backwards; null while unknown. */
  fraction: number | null;
  /** A running scan with nothing to show yet: its progress sits in the middle of the pane. */
  centered: boolean;
  scanAgain: ScanAgain;
};

/** Until a URL needs attention, a running scan's progress is all there is to show: centered in the pane. */
function ScanStartBody({
  bodyRef,
  viewReport,
  recordTotal,
  fraction,
  scanAgain,
  report,
  state,
  view,
  uiLocale,
}: ReportBodyProps) {
  return (
    <div className="dl-pane__body" ref={bodyRef}>
      <div className="blc-scan-start">
        <div className="blc-scan-start__column">
          <ScanProgressBlock
            centered
            scope={viewReport.scope}
            progress={scanProgress(viewReport)}
            fraction={fraction}
            discovering={viewReport.discovering}
            recordTotal={recordTotal}
            uiLocale={uiLocale}
          />
          <CoverageCallout
            state={state}
            scanning
            warnings={report.warnings}
            notCheckedCount={view.counts.cancelled}
            uiLocale={uiLocale}
            scanAgain={scanAgain}
          />
        </div>
      </div>
    </div>
  );
}

function ReportBody(props: ReportBodyProps) {
  const { bodyRef, viewReport, settled, recordTotal, fraction, scanAgain } =
    props;
  const { report, state, scanning, view, uiLocale } = props;
  const hasGroups = report.groups.length > 0;
  if (props.centered) return <ScanStartBody {...props} />;
  const coverage = {
    state,
    scanning,
    warnings: report.warnings,
    notCheckedCount: view.counts.cancelled,
    uiLocale,
  };
  return (
    <div className="dl-pane__body" ref={bodyRef}>
      <div className="dl-page dl-page--wide blc-report">
        <div className="dl-page__content blc-stack">
          {scanning ? (
            <ScanProgressBlock
              centered={false}
              scope={viewReport.scope}
              progress={scanProgress(viewReport)}
              fraction={fraction}
              discovering={viewReport.discovering}
              recordTotal={recordTotal}
              uiLocale={uiLocale}
            />
          ) : (
            <ScanSummary
              report={viewReport}
              settled={settled}
              uiLocale={uiLocale}
              scanAgain={hasCoverageCallout(coverage) ? undefined : scanAgain}
            />
          )}
          {proxyRefused(report.groups) && <ProxyRefusedCallout />}
          <CoverageCallout {...coverage} scanAgain={scanAgain} />
          <ReportResults {...props} />
          <p className="blc-footnote">
            Results are kept only while this page is open.
            {hasGroups && ' Use "Export CSV" to keep a copy.'}
          </p>
        </div>
      </div>
    </div>
  );
}

/**
 * A running scan stays centered until a URL needs attention (a scan that ends
 * first shows its summary instead). Once the progress moves above the results
 * it stays there, so the page never jumps back.
 */
function useCenteredProgress(scanning: boolean, attention: number): boolean {
  const moved = useRef(false);
  if (attention > 0) moved.current = true;
  return scanning && !moved.current;
}

/** A running scan's progress for the bar: URLs found while reading can lower it, but the bar never moves back. */
function useScanFraction(
  report: ScanReport,
  scanning: boolean,
  recordTotal?: number,
): number | null {
  const highest = useRef(0);
  if (!scanning) return null;
  const fraction = scanFraction(
    scanProgress(report),
    report.discovering,
    recordTotal,
  );
  if (fraction === null) return null;
  highest.current = Math.max(highest.current, fraction);
  return highest.current;
}

/** The report once a scan exists: toolbars, summary and table, with the Info sidebar beside them. */
export function ReportLayout({
  report,
  scanning,
  rechecking,
  recheckKey,
  recheckResult,
  settled,
  recordTotal,
  changedRecordIds,
  multiLocale,
  uiLocale,
  collapsed,
  onCollapsedChange,
  onScan,
  onChooseScope,
  onCancel,
  onExport,
  onRecheck,
  onOpenRecord,
}: ReportLayoutProps) {
  const isNarrow = useMediaQuery('(max-width: 999px)').matches;
  const narrowFrame = useMediaQuery('(max-width: 639px)').matches;
  const iconOnlyExport = useMediaQuery('(max-width: 479px)').matches;
  const viewGroups = useViewGroups(report.groups, recheckKey, recheckResult);
  const viewReport = useMemo(
    () =>
      viewGroups === report.groups ? report : { ...report, groups: viewGroups },
    [report, viewGroups],
  );
  const view = useReportView(viewGroups);
  const fraction = useScanFraction(report, scanning, recordTotal);
  const centered = useCenteredProgress(scanning, view.counts.attention);
  const [selectedKey, setSelectedKey] = useState<string | null>(null);
  const bodyRef = useRef<HTMLDivElement>(null);
  const paneRef = useRef<HTMLDivElement>(null);
  const paneWidth = useWidth(paneRef);
  const groupsByKey = useMemo(
    () => new Map(report.groups.map((group) => [group.key, group])),
    [report.groups],
  );
  // Filters never hide the selection: the sidebar keeps showing it.
  const selectedGroup =
    selectedKey === null ? undefined : groupsByKey.get(selectedKey);
  const hasGroups = report.groups.length > 0;
  // Only a row or the rail opens the overlay: a frame that narrows, or a scan
  // that starts in one, leaves it closed and doesn't move focus.
  const [overlayRequested, setOverlayRequested] = useState(false);
  const [narrowSeen, setNarrowSeen] = useState(isNarrow);
  if (narrowSeen !== isNarrow) {
    setNarrowSeen(isNarrow);
    setOverlayRequested(false);
  }
  const overlayOpen = isNarrow && overlayRequested;
  const closeOverlay = useCallback(() => {
    setOverlayRequested(false);
    onCollapsedChange(true);
  }, [onCollapsedChange]);
  const scanAgain: ScanAgain = {
    disabledReason: rechecking
      ? 'You cannot start a scan while a URL is being rechecked'
      : null,
    onClick: onScan,
  };

  // Focus left with the overlay: give it back to the selected row.
  const overlayWasOpen = useRef(overlayOpen);
  useLayoutEffect(() => {
    const closed = overlayWasOpen.current && !overlayOpen;
    overlayWasOpen.current = overlayOpen;
    if (!closed || selectedKey === null) return;
    if (document.activeElement !== document.body) return;
    rowOf(bodyRef.current, selectedKey)?.focus({ preventScroll: true });
  }, [overlayOpen, selectedKey]);

  const select = (key: string, open: boolean) => {
    setSelectedKey(key);
    if (!open) return;
    onCollapsedChange(false);
    if (isNarrow) setOverlayRequested(true);
  };

  /** The kit's rail and sash toggle; in a narrow frame the rail opens the overlay. */
  const toggleSidebar = (nextCollapsed: boolean) => {
    onCollapsedChange(nextCollapsed);
    if (isNarrow) setOverlayRequested(!nextCollapsed);
  };

  const changePage = (next: number) => {
    view.changePage(next);
    if (bodyRef.current) bodyRef.current.scrollTop = 0;
  };

  const sidebar = (isOverlay: boolean) => (
    <InfoSidebar
      group={selectedGroup}
      scanning={scanning}
      rechecking={rechecking}
      rechecked={recheckKey !== undefined && recheckKey === selectedGroup?.key}
      changedRecordIds={changedRecordIds}
      showLocale={multiLocale}
      uiLocale={uiLocale}
      isOverlay={isOverlay}
      onRecheck={onRecheck}
      onOpenRecord={onOpenRecord}
    />
  );

  return (
    <>
      {/* Always split: in a narrow frame the sidebar stays a rail and opens as InfoOverlay. */}
      <VerticalSplit
        primaryPane="left"
        size={350}
        minSize={300}
        maxSize="60%"
        mode="split"
        isSecondaryCollapsed={isNarrow || collapsed}
        onSecondaryToggle={toggleSidebar}
      >
        {/* Under the overlay the report takes no focus and stays out of the accessibility tree. */}
        <div
          ref={paneRef}
          className="dl-pane blc-main-pane"
          inert={overlayOpen || undefined}
        >
          <PageToolbar
            mode={scanning ? 'scanning' : rechecking ? 'rechecking' : 'idle'}
            countLabel={urlCountLabel(view, uiLocale)}
            paneWidth={paneWidth}
            exportState={hasGroups ? 'enabled' : 'disabled'}
            iconOnlyExport={iconOnlyExport}
            onScan={onScan}
            onChooseScope={onChooseScope}
            onCancel={onCancel}
            onExport={onExport}
          />
          {hasGroups && !centered && (
            <FilterToolbar
              filters={view.filters}
              onChange={view.changeFilters}
              counts={view.counts}
              dimensions={view.dimensions}
              uiLocale={uiLocale}
            />
          )}
          <ReportBody
            bodyRef={bodyRef}
            viewReport={viewReport}
            settled={settled}
            recordTotal={recordTotal}
            fraction={fraction}
            centered={centered}
            scanAgain={scanAgain}
            view={view}
            report={report}
            groupsByKey={groupsByKey}
            state={settled?.state ?? report.state}
            scanning={scanning}
            selectedKey={selectedKey}
            onSelect={select}
            onClearSelection={() => setSelectedKey(null)}
            uiLocale={uiLocale}
          />
          {view.filtered.length > view.perPage && (
            <PaginationBar
              page={view.page}
              pageCount={view.pages}
              perPage={view.perPage}
              pageWindow={pageWindowFor(paneWidth, narrowFrame)}
              onPage={changePage}
              onPerPage={view.changePerPage}
            />
          )}
        </div>
        {sidebar(false)}
      </VerticalSplit>
      {overlayOpen && (
        <InfoOverlay onClose={closeOverlay}>{sidebar(true)}</InfoOverlay>
      )}
    </>
  );
}
