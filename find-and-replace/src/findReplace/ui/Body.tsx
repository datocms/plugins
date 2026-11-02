import Callout from 'datocms-react-ui/Callout';
import ListArea from 'datocms-react-ui/ListArea';
import type { FindReplaceSnapshot } from '../contract';
import styles from './Body.module.css';
import { Callouts, NoteCallout } from './Callouts';
import { type Copy, STRINGS } from './copy';
import type { FieldProblemIds } from './FindBar';
import { FormLines } from './FormLines';
import { IdleState } from './IdleState';
import { NoResults } from './NoResults';
import { PageState } from './PaneState';
import { ResultsTable } from './ResultsTable';

export type BodyProps = {
  snapshot: FindReplaceSnapshot;
  copy: Copy;
  /**
   * A frame under 600px wide: the meta line shows above the results, not in
   * the title bar, and so does "Keep this page open" while a pass runs.
   */
  narrow: boolean;
  /** Counts the invalid patterns: a new value remounts the pattern's alert, which is then read again. */
  patternAlertKey?: number;
  /** The ids of the problem texts of the find form, which its inputs point to. */
  problemIds?: FieldProblemIds;
  /** "Try again" after a failed search. */
  onRetrySearch: () => void;
  /** "Select all" in the header of the results. */
  onSelectAll: (included: boolean) => void;
  /** "Show all models" when the model filter hides every match. */
  onShowAllModels: () => void;
};

/**
 * The problems of the find form that the body shows: the pattern problem
 * stands in for the results, the replacement problem tops them. The field of
 * each one takes it as its description while it shows.
 */
export function shownFieldProblems(snapshot: FindReplaceSnapshot): {
  pattern: boolean;
  replacement: boolean;
} {
  return {
    pattern:
      snapshot.body === 'invalid' && snapshot.search.patternProblem !== null,
    replacement:
      snapshot.body === 'results' && snapshot.replacementCheck.problem !== null,
  };
}

/** A replace or publish pass runs (running or stopping): same-tab links would leave it. */
function isPassActive(snapshot: FindReplaceSnapshot): boolean {
  const { run, publish } = snapshot;
  return (
    run.phase === 'running' ||
    run.phase === 'stopping' ||
    publish.phase === 'running' ||
    publish.phase === 'stopping'
  );
}

/**
 * The meta after the title (above the results on a narrow frame). While a
 * replacement runs, the progress row says what is done. While Find holds
 * settings not searched yet, the count shown is the earlier search's: the
 * meta asks for Enter instead.
 */
export function metaLine(
  snapshot: FindReplaceSnapshot,
  copy: Copy,
): string | null {
  const { run } = snapshot;
  if (run.phase === 'running' || run.phase === 'stopping') {
    return null;
  }
  if (snapshot.findRow.awaitingEnter && snapshot.meta.kind !== 'none') {
    return STRINGS.awaitingEnter;
  }
  // No list shows: the title of the blank slate says it on its own.
  if (snapshot.body === 'noResults') {
    return null;
  }
  return copy.meta(snapshot.meta);
}

/** The notices that the body shows above the results: the failed models and the note. */
function hasNotices(snapshot: FindReplaceSnapshot): boolean {
  return (
    snapshot.note !== null ||
    snapshot.callouts.some((callout) => callout.kind === 'modelsFailed')
  );
}

/** The results, and what to know about them above the table. */
function Results({
  snapshot,
  copy,
  narrow,
  problemIds,
  onSelectAll,
}: Pick<
  BodyProps,
  'snapshot' | 'copy' | 'narrow' | 'problemIds' | 'onSelectAll'
>) {
  const meta = narrow ? metaLine(snapshot, copy) : null;
  const runActive = isPassActive(snapshot);

  return (
    <>
      {meta && <p className={styles.meta}>{meta}</p>}
      {/* The progress row of a narrow frame has no room for it. */}
      {narrow && runActive && <Callout>{STRINGS.keepOpenNotice}</Callout>}
      <FormLines
        copy={copy}
        replacementCheck={snapshot.replacementCheck}
        problemIds={problemIds}
      />
      <Callouts callouts={snapshot.callouts} copy={copy} />
      <NoteCallout note={snapshot.note} copy={copy} />
      <ResultsTable
        key={snapshot.search.resultsId}
        records={snapshot.records}
        selection={snapshot.selection}
        runActive={runActive}
        onSelectAll={onSelectAll}
      />
    </>
  );
}

function BodyContent({
  snapshot,
  copy,
  narrow,
  patternAlertKey = 0,
  problemIds,
  onRetrySearch,
  onSelectAll,
  onShowAllModels,
}: BodyProps) {
  switch (snapshot.body) {
    case 'idle':
      return <IdleState enterToSearch={snapshot.findRow.enterToSearch} />;
    // The progress row under the find form shows the search: one indicator.
    case 'blank':
    case 'spinner':
      return null;
    case 'searchFailed':
      return (
        <PageState
          state={{
            kind: 'searchFailed',
            cause: snapshot.search.failure?.cause ?? 'unknown',
          }}
          copy={copy}
          onRetry={onRetrySearch}
        />
      );
    case 'invalid':
      return (
        <FormLines
          copy={copy}
          patternProblem={snapshot.search.patternProblem}
          patternAlertKey={patternAlertKey}
          problemIds={problemIds}
        />
      );
    case 'noResults':
      return (
        <>
          <Callouts callouts={snapshot.callouts} copy={copy} />
          <NoteCallout note={snapshot.note} copy={copy} />
          {snapshot.noResults && (
            <NoResults
              view={snapshot.noResults}
              pattern={snapshot.find.pattern}
              pending={snapshot.search.phase === 'pending'}
              belowNotices={hasNotices(snapshot)}
              copy={copy}
              onShowAllModels={onShowAllModels}
            />
          )}
        </>
      );
    case 'results':
      return (
        <Results
          snapshot={snapshot}
          copy={copy}
          narrow={narrow}
          problemIds={problemIds}
          onSelectAll={onSelectAll}
        />
      );
  }
}

/**
 * The content of the page's Pane for `snapshot.body`: the list area with the
 * results and the notices above them, or the state that stands in for them.
 * The results table reads its controller and copy from `ResultsEnv`.
 */
export function Body(props: BodyProps) {
  return (
    <ListArea>
      <BodyContent {...props} />
    </ListArea>
  );
}
