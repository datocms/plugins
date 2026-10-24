import Button from 'datocms-react-ui/Button';
import Callout from 'datocms-react-ui/Callout';
import Toolbar from 'datocms-react-ui/Toolbar';
import {
  type Dispatch,
  type ReactNode,
  type SetStateAction,
  useState,
} from 'react';
import { countLabel, formatWarning } from '../report/format';
import { pageSlice } from '../report/view';
import type { ScanReport } from '../types';
import styles from './Notices.module.css';

const COLLAPSED_WARNINGS = 5;
const WARNINGS_PER_PAGE = 50;
const PAGINATE_WARNINGS_ABOVE = 100;

/** A scan that ended, however it ended. */
export type SettledPhase = Exclude<ScanReport['state'], 'running'>;

const UNREAD_INTRO =
  "Some content couldn't be read, so the links in it aren't in this report:";
const CANCELLED_LEAD =
  "It covers only the records read and the URLs processed until then. URLs that weren't checked show as “Not checked”.";
/** The same, in one sentence, when the list intro is the second one. */
const CANCELLED_SHORT_LEAD =
  "It covers only the records read until then, and URLs that weren't checked show as “Not checked”.";

/**
 * What a settled report leaves out: `lead` is the text before the list,
 * `listIntro` introduces the list of content issues (no list without it). A
 * canceled scan says what it covers and how its unchecked URLs read, then
 * lists the content it couldn't read, if any, in one sentence less, so the
 * callout keeps two sentences. An incomplete scan lists the unread content,
 * or else says how many URLs weren't checked. A complete scan leaves nothing
 * out.
 */
export function coverageText(
  phase: SettledPhase,
  warnings: readonly string[],
  notCheckedCount: number,
  uiLocale: string,
): { lead?: string; listIntro?: string } {
  const unread = warnings.length > 0;
  if (phase === 'cancelled')
    return unread
      ? { lead: CANCELLED_SHORT_LEAD, listIntro: UNREAD_INTRO }
      : { lead: CANCELLED_LEAD };
  if (phase === 'complete') return {};
  if (unread) return { listIntro: UNREAD_INTRO };
  if (notCheckedCount === 0) return {};
  return {
    lead: countLabel(
      notCheckedCount,
      "1 URL wasn't checked. Recheck it, or scan again.",
      "{n} URLs weren't checked. Recheck them one by one, or scan again.",
      uiLocale,
    ),
  };
}

function toggleLabel(
  count: number,
  expanded: boolean,
  paginated: boolean,
  uiLocale: string,
) {
  if (expanded) return 'Show fewer issues';
  return countLabel(
    count,
    'Show 1 issue',
    paginated ? 'Show {n} issues' : 'Show all {n} issues',
    uiLocale,
  );
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
  /** The state or the problem, in a few words: "Scan incomplete". */
  title: string;
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
 * A callout about what the report covers, with the content that couldn't be
 * read as a list: 5 at first, then all of them, or pages of 50 above 100. A
 * callout holds no buttons, so the list's controls sit right after it. The
 * wrapper keeps them close to it, and it stays the same while the list grows,
 * so the callout never mounts again (a warning callout is an alert, read when
 * it appears).
 */
export function CoverageCallout({
  tone,
  title,
  lead,
  listIntro,
  warnings,
  children,
  compactPagination = false,
  issueList,
  uiLocale,
}: CoverageCalloutProps) {
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
  const shown = !expanded
    ? warnings.slice(0, COLLAPSED_WARNINGS)
    : paginated
      ? pageSlice(warnings, current + 1, WARNINGS_PER_PAGE)
      : warnings;

  return (
    <div className={styles.notice}>
      <Callout tone={tone} title={title} className={styles.callout}>
        {lead && <p>{lead}</p>}
        {listed && (
          <>
            <p>{listIntro}</p>
            <ul>
              {shown.map((warning) => (
                <li key={warning}>{formatWarning(warning, uiLocale)}</li>
              ))}
            </ul>
          </>
        )}
        {children}
      </Callout>
      {listed && warnings.length > COLLAPSED_WARNINGS && (
        <div className={styles.controls}>
          <Button
            tone="ghost"
            label={toggleLabel(warnings.length, expanded, paginated, uiLocale)}
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
      listIntro="The links in it aren't in this report:"
      warnings={warnings}
      compactPagination={compactPagination}
      issueList={issueList}
      uiLocale={uiLocale}
    />
  );
}
