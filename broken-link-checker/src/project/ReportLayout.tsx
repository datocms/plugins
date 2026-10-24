import { useElementLayout } from 'datocms-react-ui/hooks/useElementLayout';
import ListArea from 'datocms-react-ui/ListArea';
import { ListDetail, useOpenRowRoute } from 'datocms-react-ui/ListDetail';
import Main from 'datocms-react-ui/Main';
import Pane from 'datocms-react-ui/Pane';
import type { SidebarPanelCollapse } from 'datocms-react-ui/SidebarPanel';
import type { TableLayout } from 'datocms-react-ui/Table';
import Toolbar, { useFilterToolbar } from 'datocms-react-ui/Toolbar';
import {
  useCallback,
  useDeferredValue,
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
  pageCount,
  pageSlice,
  proxyRefused,
  reportDimensions,
  type Sort,
  type StatusView,
  scanFraction,
  scanProgress,
  sortGroups,
} from '../report/view';
import { updateGroup } from '../state/group';
import type { CheckResult, LinkGroup, ScanReport } from '../types';
import { ProxyRefusedCallout } from '../ui/ProxyRefusedCallout';
import {
  type IssueListState,
  RunningCoverageCallout,
  useIssueList,
} from './CoverageCallout';
import { FilterToolbar } from './FilterToolbar';
import { LinkDetail } from './InfoSidebar';
import {
  type ExportState,
  PageToolbar,
  type PageToolbarMode,
} from './PageToolbar';
import styles from './Report.module.css';
import { ReportTable } from './ReportTable';
import { ResultsEmpty, type ResultsEmptyKind } from './ResultsEmpty';
import { ScanProgressBlock, ScanProgressSlate } from './ScanProgressBlock';
import { ScanAnnouncement, ScanSummary } from './ScanSummary';
import type { SettledScan } from './useSettledScan';

/** The in-memory route of the open row: "/links/<encoded URL key>". */
export const ROW_BASE_URL = '/links';

const PER_PAGE_OPTIONS = [25, 50, 100, 200];
const DEFAULT_PER_PAGE = 50;
/** A list pane narrower than this shows fewer page numbers, and the list's pages no "Show" select. */
const COMPACT_PAGINATION_BELOW = 600;

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
  /** The page keeps the columns, so they outlive a new scan. */
  tableLayout: TableLayout;
  onTableLayoutChange: (layout: TableLayout) => void;
  /** The open state of the detail's sections, kept across rows and scans. */
  linkPanel: SidebarPanelCollapse;
  recordsPanel: SidebarPanelCollapse;
  onScan: () => void;
  onChooseScope: () => void;
  onCancel: () => void;
  exporting?: boolean;
  onExport: () => void;
  onRecheck: (group: LinkGroup) => void;
  onOpenRecord: (recordId: string) => void;
};

/** Filters, sort and pagination; a new scan remounts the layout, which resets them. */
function useReportView(groups: readonly LinkGroup[]) {
  const [filters, setFilters] = useState<Filters>(DEFAULT_FILTERS);
  const [sort, setSort] = useState<Sort>(null);
  const [page, setPage] = useState(1);
  const [perPage, setPerPage] = useState(DEFAULT_PER_PAGE);
  const query = useDeferredValue(filters.query);
  const { status, modelId, locale } = filters;
  const applied = useMemo<Filters>(
    () => ({ status, modelId, locale, query }),
    [status, modelId, locale, query],
  );
  const counts = useMemo(() => countStatuses(groups), [groups]);
  const dimensions = useMemo(() => reportDimensions(groups), [groups]);
  const filtered = useMemo(() => {
    const matches = filterGroups(groups, applied);
    return sort ? sortGroups(matches, sort) : matches;
  }, [groups, applied, sort]);
  const pages = pageCount(filtered.length, perPage);
  // The filtered list shrinks and grows during a scan: keep the page it fell back to.
  if (page > pages) setPage(pages);
  const current = Math.min(page, pages);
  const changeSort = useCallback((next: Sort) => {
    setSort(next);
    setPage(1);
  }, []);

  return {
    filters,
    applied,
    sort,
    perPage,
    counts,
    dimensions,
    filtered,
    page: current,
    slice: pageSlice(filtered, current, perPage),
    changeFilters(next: Filters) {
      setFilters(next);
      setPage(1);
    },
    changeSort,
    changePage: setPage,
    changePerPage(next: number) {
      if (!PER_PAGE_OPTIONS.includes(next)) return;
      setPerPage(next);
      setPage(1);
    },
  };
}

type ReportView = ReturnType<typeof useReportView>;

function exportStateFor(
  hasGroups: boolean,
  scanning: boolean,
  exporting: boolean,
): ExportState {
  // A running scan can still find URLs; a settled one without any has nothing to export.
  if (!hasGroups) return scanning ? 'waiting' : 'none';
  return exporting ? 'preparing' : 'ready';
}

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
              ? updateGroup(group, { result: recheckResult })
              : group,
          ),
    [groups, recheckKey, recheckResult],
  );
}

/**
 * A running scan's progress is all the list area shows until the view has a
 * row (by default, a URL that needs attention; a scan that ends first shows
 * its summary instead). Once the progress moves above the results it stays
 * there, so the page never jumps back.
 */
function useCenteredProgress(scanning: boolean, rows: number): boolean {
  const moved = useRef(false);
  if (rows > 0) moved.current = true;
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
  // Reading the last counted record is not completion: extraction, late
  // records and the queue can still add work before the final report arrives.
  highest.current = Math.min(0.99, Math.max(highest.current, fraction));
  return highest.current;
}

/** The URL key of the open row, from its route segment. */
function decodeRowId(id: string | undefined): string | undefined {
  if (id === undefined) return undefined;
  try {
    return decodeURIComponent(id);
  } catch {
    return undefined;
  }
}

/**
 * A new page starts at the top of the list. The Pane's content is the box
 * that scrolls; it isn't a part the plugin can reach, so every box between
 * the top of the list area and the list side scrolls back (a box that doesn't
 * scroll ignores it).
 */
function scrollListToTop(top: HTMLElement | null, list: HTMLElement | null) {
  for (
    let box = top?.parentElement ?? null;
    box && box !== list;
    box = box.parentElement
  )
    box.scrollTop = 0;
}

/** What takes the place of the table when the view has no row, or null for nothing. */
function emptyKind(
  view: ReportView,
  report: ScanReport,
  state: ScanReport['state'],
  scanning: boolean,
): ResultsEmptyKind | null {
  const total = report.groups.length;
  // Nothing found yet: the progress already says the scan is running.
  if (total === 0 && scanning) return null;
  // A canceled or failed scan without URLs: its summary explains it.
  if (total === 0) return state === 'complete' ? 'noLinks' : null;
  if (!isDefaultFilters(view.applied)) return 'noMatch';
  return scanning ? 'cleanSoFar' : 'clean';
}

type ScanProgressProps = Parameters<typeof ScanProgressBlock>[0];

type ReportResultsProps = {
  view: ReportView;
  report: ScanReport;
  /** The report as the view reads it (a rechecked URL keeps its previous result). */
  viewReport: ScanReport;
  settled?: SettledScan;
  scanning: boolean;
  /** The running scan's progress is all the list area shows. */
  centered: boolean;
  /** A notice sits above the results. */
  noticeAbove: boolean;
  progress: ScanProgressProps;
  /** The live groups, so a rechecked row reads "Checking". */
  groupsByKey: ReadonlyMap<string, LinkGroup>;
  tableLayout: TableLayout;
  onTableLayoutChange: (layout: TableLayout) => void;
  openKey?: string;
  onOpen: (group: LinkGroup) => void;
  /** The list pane is narrow: every pagination in it shows fewer numbers. */
  compactPagination: boolean;
  /** How the content issues show, from the running scan into its summary. */
  issueList: IssueListState;
  uiLocale: string;
};

/** The progress or the summary, then the table or what takes its place. */
function ReportResults({
  view,
  report,
  viewReport,
  settled,
  scanning,
  centered,
  noticeAbove,
  progress,
  groupsByKey,
  tableLayout,
  onTableLayoutChange,
  openKey,
  onOpen,
  compactPagination,
  issueList,
  uiLocale,
}: ReportResultsProps) {
  if (centered)
    return (
      <ScanProgressSlate
        placement={noticeAbove ? 'section' : 'area'}
        {...progress}
      />
    );
  const showTable = view.filtered.length > 0;
  const kind = showTable
    ? null
    : emptyKind(view, report, settled?.state ?? report.state, scanning);
  return (
    <>
      {scanning ? (
        <ScanProgressBlock {...progress} />
      ) : (
        <ScanSummary
          report={viewReport}
          settled={settled}
          notCheckedCount={view.counts.cancelled}
          compactPagination={compactPagination}
          issueList={issueList}
          uiLocale={uiLocale}
        />
      )}
      {showTable && (
        <ReportTable
          groups={view.slice.map(
            (group) => groupsByKey.get(group.key) ?? group,
          )}
          layout={tableLayout}
          onLayoutChange={onTableLayoutChange}
          sort={view.sort}
          onSortChange={view.changeSort}
          openKey={openKey}
          onOpen={onOpen}
          uiLocale={uiLocale}
        />
      )}
      {kind !== null && (
        <ResultsEmpty
          kind={kind}
          total={report.groups.length}
          partial={report.warnings.length > 0}
          onShowAll={() =>
            view.changeFilters({ ...view.filters, status: 'all' })
          }
          uiLocale={uiLocale}
        />
      )}
    </>
  );
}

type ReportFooterProps = {
  view: ReportView;
  /** The list pane is narrow: fewer page numbers and no "Show" select. */
  compact: boolean;
  /** Gets the new page, from 0. */
  onChange: (page: number) => void;
};

/** The pages of the list, only when there is more than one. */
function ReportFooter({ view, compact, onChange }: ReportFooterProps) {
  if (view.filtered.length <= view.perPage) return null;
  return (
    <Toolbar>
      <Toolbar.Pagination
        currentPage={view.page - 1}
        perPage={view.perPage}
        totalEntries={view.filtered.length}
        onChange={onChange}
        perPageSelect={{
          onChange: view.changePerPage,
          options: PER_PAGE_OPTIONS,
        }}
        compact={compact}
      />
    </Toolbar>
  );
}

/** The text, model and locale filters, behind the title bar's toggle; closing it clears them. */
function useReportFilter(view: ReportView) {
  const { filters, changeFilters } = view;
  return useFilterToolbar({
    isFiltering:
      filters.query !== '' || filters.modelId !== '' || filters.locale !== '',
    onClear: () =>
      changeFilters({ ...DEFAULT_FILTERS, status: filters.status }),
  });
}

/**
 * The open row, from the in-memory route; the detail shows it even when the
 * view filters it out. `]` closes it and opens the last one again.
 */
function useOpenGroup(groups: readonly LinkGroup[]) {
  const route = useOpenRowRoute(ROW_BASE_URL);
  const groupsByKey = useMemo(() => {
    const index = new Map<string, LinkGroup>();
    for (const group of groups) index.set(group.key, group);
    return index;
  }, [groups]);
  const openKey = decodeRowId(route.id);
  return {
    groupsByKey,
    openGroup: openKey === undefined ? undefined : groupsByKey.get(openKey),
    open: (group: LinkGroup) => route.open(encodeURIComponent(group.key)),
    close: route.close,
    reopen: route.reopen,
  };
}

/**
 * The width of a box that can be replaced. The split mounts the list again,
 * in a box of another kind, when the frame crosses the width at which the
 * detail goes over the list; the kit's hook measures the element its ref
 * holds when it mounts, so the ref changes with the box.
 */
function useBoxWidth(box: HTMLElement | null): number {
  const ref = useMemo(() => ({ current: box }), [box]);
  return useElementLayout(ref).width;
}

function toolbarMode(scanning: boolean, rechecking: boolean): PageToolbarMode {
  if (scanning) return 'scanning';
  return rechecking ? 'rechecking' : 'idle';
}

/** The report once a scan exists: the title bar, the notices and the table, with the open URL's detail beside them. */
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
  tableLayout,
  onTableLayoutChange,
  linkPanel,
  recordsPanel,
  onScan,
  onChooseScope,
  onCancel,
  exporting = false,
  onExport,
  onRecheck,
  onOpenRecord,
}: ReportLayoutProps) {
  const viewGroups = useViewGroups(report.groups, recheckKey, recheckResult);
  const viewReport = useMemo(
    () =>
      viewGroups === report.groups ? report : { ...report, groups: viewGroups },
    [report, viewGroups],
  );
  const view = useReportView(viewGroups);
  const fraction = useScanFraction(report, scanning, recordTotal);
  const centered = useCenteredProgress(
    scanning,
    view.counts.attention + view.filtered.length,
  );
  const { groupsByKey, openGroup, open, close, reopen } = useOpenGroup(
    report.groups,
  );
  const filter = useReportFilter(view);
  const issueList = useIssueList();
  const [listBox, setListBox] = useState<HTMLDivElement | null>(null);
  const topRef = useRef<HTMLDivElement>(null);
  const listWidth = useBoxWidth(listBox);
  // Before measuring, the width is 0: the full pages until then.
  const compactPagination =
    listWidth > 0 && listWidth < COMPACT_PAGINATION_BELOW;
  const hasGroups = report.groups.length > 0;
  const showFilter = hasGroups && !centered;
  const refused = proxyRefused(report.groups);
  const runningWarnings = scanning && report.warnings.length > 0;

  const changeStatus = (status: StatusView) =>
    view.changeFilters({ ...view.filters, status });

  const changePage = (page: number) => {
    view.changePage(page + 1);
    scrollListToTop(topRef.current, listBox);
  };

  return (
    <Main className={styles.screen}>
      <ListDetail.Split
        detail={{
          panel: openGroup && (
            <LinkDetail
              key={openGroup.key}
              group={openGroup}
              scanning={scanning}
              rechecking={rechecking}
              rechecked={recheckKey === openGroup.key}
              changedRecordIds={changedRecordIds}
              showLocale={multiLocale}
              uiLocale={uiLocale}
              linkPanel={linkPanel}
              recordsPanel={recordsPanel}
              onRecheck={onRecheck}
              onOpenRecord={onOpenRecord}
            />
          ),
          onClose: close,
          onReopen: reopen,
        }}
      >
        <div ref={setListBox} className={styles.list}>
          <Pane
            ariaLabel="URLs"
            header={
              <>
                <PageToolbar
                  mode={toolbarMode(scanning, rechecking)}
                  status={view.filters.status}
                  counts={view.counts}
                  onStatusChange={changeStatus}
                  countLabel={urlCountLabel(view, uiLocale)}
                  exportState={exportStateFor(hasGroups, scanning, exporting)}
                  onExport={onExport}
                  filter={showFilter ? filter : undefined}
                  onScan={onScan}
                  onChooseScope={onChooseScope}
                  onCancel={onCancel}
                />
                {showFilter && filter.open && (
                  <FilterToolbar
                    filters={view.filters}
                    onChange={view.changeFilters}
                    dimensions={view.dimensions}
                    autoFocus={filter.autoFocus}
                    onClose={filter.onClose}
                    uiLocale={uiLocale}
                  />
                )}
              </>
            }
            footer={
              !centered && (
                <ReportFooter
                  view={view}
                  compact={compactPagination}
                  onChange={changePage}
                />
              )
            }
          >
            <ListArea>
              <ScanAnnouncement
                ref={topRef}
                report={viewReport}
                settled={settled}
                scanning={scanning}
              />
              {refused && <ProxyRefusedCallout className={styles.callout} />}
              {scanning && (
                <RunningCoverageCallout
                  warnings={report.warnings}
                  compactPagination={compactPagination}
                  issueList={issueList}
                  uiLocale={uiLocale}
                />
              )}
              <ReportResults
                view={view}
                report={report}
                viewReport={viewReport}
                settled={settled}
                scanning={scanning}
                centered={centered}
                noticeAbove={refused || runningWarnings}
                progress={{
                  scope: viewReport.scope,
                  progress: scanProgress(viewReport),
                  fraction,
                  discovering: viewReport.discovering,
                  recordTotal,
                  uiLocale,
                }}
                groupsByKey={groupsByKey}
                tableLayout={tableLayout}
                onTableLayoutChange={onTableLayoutChange}
                openKey={openGroup?.key}
                onOpen={open}
                compactPagination={compactPagination}
                issueList={issueList}
                uiLocale={uiLocale}
              />
            </ListArea>
          </Pane>
        </div>
      </ListDetail.Split>
    </Main>
  );
}
