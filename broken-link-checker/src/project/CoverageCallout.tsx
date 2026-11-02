import Button from 'datocms-react-ui/Button';
import Callout from 'datocms-react-ui/Callout';
import Toolbar from 'datocms-react-ui/Toolbar';
import {
  type Dispatch,
  type ReactNode,
  type SetStateAction,
  useMemo,
  useState,
} from 'react';
import {
  countLabel,
  formatWarning,
  groupWarnings,
  preciseWarnings,
} from '../report/format';
import { pageSlice } from '../report/view';
import type { ScanReport } from '../types';
import styles from './Notices.module.css';

const WARNINGS_PER_PAGE = 50;
const PAGINATE_WARNINGS_ABOVE = 100;

/** A scan that ended, however it ended. */
export type SettledPhase = Exclude<ScanReport['state'], 'running'>;

const UNREAD_INTRO =
  "Some content couldn't be read, so its links aren't in this report.";
/** The facts under it count the links that show as “Not checked”. */
const CANCELLED_LEAD =
  'This report covers only what was checked before you stopped the scan.';

/**
 * What a settled report leaves out: `lead` is the text before the list,
 * `listIntro` introduces the list of content issues (no list without it). A
 * canceled scan says what it covers, then that some content couldn't be
 * read, if so. An incomplete scan says that some content couldn't be read,
 * or else how many links weren't checked. A complete scan leaves nothing
 * out.
 */
export function coverageText(
  phase: SettledPhase,
  warnings: readonly string[],
  notCheckedCount: number,
  uiLocale: string,
): { lead?: string; listIntro?: string } {
  const listIntro = warnings.length > 0 ? UNREAD_INTRO : undefined;
  if (phase === 'cancelled') return { lead: CANCELLED_LEAD, listIntro };
  if (phase === 'complete') return {};
  if (listIntro) return { listIntro };
  if (notCheckedCount === 0) return {};
  return {
    lead: countLabel(
      notCheckedCount,
      "1 link wasn't checked. Recheck it, or scan again.",
      "{n} links weren't checked. Recheck them one by one, or scan again.",
      uiLocale,
    ),
  };
}

/** The list holds what couldn't be read, not the links that need attention. */
function toggleLabel(expanded: boolean) {
  return expanded ? "Hide what couldn't be read" : "Show what couldn't be read";
}

/** How a list of content issues shows: in full or not, and its page (from 0). */
export type IssueListState = {
  expanded: boolean;
  setExpanded: Dispatch<SetStateAction<boolean>>;
  page: number;
  setPage: (page: number) => void;
};

/**
 * The state of a list of content issues. The report holds it, so the list
 * keeps how it shows when the running scan's callout gives way to the settled
 * summary, and when the split moves the list to a box of another kind.
 */
export function useIssueList(): IssueListState {
  const [expanded, setExpanded] = useState(false);
  const [page, setPage] = useState(0);
  return { expanded, setExpanded, page, setPage };
}

type CoverageCalloutProps = {
  tone: 'neutral' | 'warning';
  /** The state or the problem, in a few words: "Scan incomplete". None for a complete scan. */
  title?: string;
  /** The text before the list, when there is one. */
  lead?: string;
  /** Introduces the list of content issues; without it there is no list. */
  listIntro?: string;
  warnings: readonly string[];
  /** The last lines of the callout, after the list: the facts of a settled scan. */
  children?: ReactNode;
  /** The list pane is narrow: the pages of the list show fewer numbers. */
  compactPagination?: boolean;
  /** How the list shows, when a parent keeps it; otherwise the callout keeps its own. */
  issueList?: IssueListState;
  uiLocale: string;
};

/**
 * A callout about what the report covers. The content that couldn't be read
 * is a list that shows on demand, so the callout stays short: then all of
 * it, or pages of 50 above 100. Each reason shows once, after the places
 * that give it. A callout holds no buttons, so the list's
 * controls sit right after it. The wrapper keeps them close to it, and it
 * stays the same while the list grows, so the callout never mounts again (a
 * warning callout is an alert, read when it appears).
 */
export function CoverageCallout({
  tone,
  title,
  lead,
  listIntro,
  warnings: allWarnings,
  children,
  compactPagination = false,
  issueList,
  uiLocale,
}: CoverageCalloutProps) {
  const warnings = useMemo(
    () =>
      groupWarnings(
        preciseWarnings(allWarnings).map((warning) =>
          formatWarning(warning, uiLocale),
        ),
      ),
    [allWarnings, uiLocale],
  );
  const ownList = useIssueList();
  const { expanded, setExpanded, page, setPage } = issueList ?? ownList;
  const listed = listIntro !== undefined && warnings.length > 0;
  const paginated = warnings.length > PAGINATE_WARNINGS_ABOVE;
  // The list keeps growing while a scan runs: the page stays where it was.
  const lastPage = Math.max(
    0,
    Math.ceil(warnings.length / WARNINGS_PER_PAGE) - 1,
  );
  const current = Math.min(page, lastPage);
  const shown = paginated
    ? pageSlice(warnings, current + 1, WARNINGS_PER_PAGE)
    : warnings;

  return (
    <div className={styles.notice}>
      <Callout tone={tone} title={title} className={styles.callout}>
        {lead && <p>{lead}</p>}
        {listed && <p>{listIntro}</p>}
        {listed && expanded && (
          <ul>
            {shown.map((warning) => (
              <li key={warning}>{warning}</li>
            ))}
          </ul>
        )}
        {children}
      </Callout>
      {listed && (
        <div className={styles.controls}>
          <Button
            tone="ghost"
            label={toggleLabel(expanded)}
            onClick={() => setExpanded((value) => !value)}
          />
          {expanded && paginated && (
            <Toolbar className={styles.pages}>
              <Toolbar.Pagination
                ariaLabel="Content issues"
                compact={compactPagination}
                currentPage={current}
                perPage={WARNINGS_PER_PAGE}
                totalEntries={warnings.length}
                onChange={setPage}
              />
            </Toolbar>
          )}
        </div>
      )}
    </div>
  );
}

/**
 * While a scan runs: the content read so far that couldn't be read, whose
 * links won't be in the report. Nothing while all of it could be read.
 */
export function RunningCoverageCallout({
  warnings,
  compactPagination,
  issueList,
  uiLocale,
}: {
  warnings: readonly string[];
  /** The list pane is narrow: the pages of the list show fewer numbers. */
  compactPagination?: boolean;
  /** How the list shows, kept by the report into the settled summary. */
  issueList?: IssueListState;
  uiLocale: string;
}) {
  if (warnings.length === 0) return null;
  return (
    <CoverageCallout
      tone="warning"
      title="Some content couldn't be read"
      listIntro="Its links aren't in this report."
      warnings={warnings}
      compactPagination={compactPagination}
      issueList={issueList}
      uiLocale={uiLocale}
    />
  );
}
