import { Spinner } from 'datocms-react-ui';
import type { FindReplaceSnapshot } from '../contract';
import { Callouts } from './Callouts';
import { type CalloutAction, type Copy, STRINGS } from './copy';
import { FormLines } from './FormLines';
import { IdleState } from './IdleState';
import { NoResults } from './NoResults';
import { PaneState } from './PaneState';
import { ResultsList } from './ResultsList';
import { TriCheckbox } from './TriCheckbox';

/** The 80px spinner, centered in the pane body (booting, and searching before the first match). */
export function BodySpinner({ label }: { label?: string }) {
  return (
    <>
      <Spinner size={80} placement="centered" />
      {label && (
        <span className="fr-sr-only" role="status">
          {label}
        </span>
      )}
    </>
  );
}

type BodyProps = {
  snapshot: FindReplaceSnapshot;
  copy: Copy;
  onRetrySearch: () => void;
  onCalloutAction: (action: CalloutAction) => void;
  onSelectAll: (included: boolean) => void;
};

/** Everything above the card and the card itself (body kind `results`). */
function Results({
  snapshot,
  copy,
  onCalloutAction,
  onSelectAll,
}: Omit<BodyProps, 'onRetrySearch'>) {
  const { selection, run, publish } = snapshot;
  const selecting = selection.ui !== 'hidden';
  // A replace or publish pass: same-tab links would leave it.
  const runActive =
    run.phase === 'running' ||
    run.phase === 'stopping' ||
    publish.phase === 'running' ||
    publish.phase === 'stopping';
  const summary = copy.meta(snapshot.meta);

  return (
    <>
      {summary && <p className="fr-summary">{summary}</p>}
      <FormLines copy={copy} replacementCheck={snapshot.replacementCheck} />
      <Callouts
        callouts={snapshot.callouts}
        copy={copy}
        actionsEnabled={snapshot.findRow.enabled}
        onAction={onCalloutAction}
      />
      {snapshot.note && <p className="fr-note">{copy.note(snapshot.note)}</p>}
      {selecting && (
        <label className="fr-results__head">
          <TriCheckbox
            state={selection.all}
            disabled={selection.ui === 'disabled'}
            onChange={onSelectAll}
          />
          {STRINGS.selectAll}
        </label>
      )}
      <ResultsList
        key={snapshot.search.resultsId}
        records={snapshot.records}
        selecting={selecting}
        selectionDisabled={selection.ui === 'disabled'}
        runActive={runActive}
      />
    </>
  );
}

/** What the pane body shows for `snapshot.body` (one of). */
export function Body({
  snapshot,
  copy,
  onRetrySearch,
  onCalloutAction,
  onSelectAll,
}: BodyProps) {
  switch (snapshot.body) {
    case 'idle':
      return <IdleState />;
    case 'blank':
      return null;
    case 'spinner':
      return <BodySpinner />;
    case 'searchFailed':
      return (
        <PaneState
          pane={{
            kind: 'searchFailed',
            cause: snapshot.search.failure?.cause ?? 'unknown',
          }}
          copy={copy}
          onRetry={onRetrySearch}
        />
      );
    case 'invalid':
      return (
        <div className="dl-page dl-page--large">
          <FormLines
            copy={copy}
            patternProblem={snapshot.search.patternProblem}
          />
        </div>
      );
    case 'noResults':
      return (
        <div className="dl-page dl-page--large fr-page--fill">
          <Callouts
            callouts={snapshot.callouts}
            copy={copy}
            actionsEnabled={snapshot.findRow.enabled}
            onAction={onCalloutAction}
          />
          {snapshot.note && (
            <p className="fr-note">{copy.note(snapshot.note)}</p>
          )}
          {snapshot.noResults && (
            <NoResults
              view={snapshot.noResults}
              pattern={snapshot.find.pattern}
              pending={snapshot.search.phase === 'pending'}
              copy={copy}
            />
          )}
        </div>
      );
    case 'results':
      return (
        <div className="dl-page dl-page--large">
          <Results
            snapshot={snapshot}
            copy={copy}
            onCalloutAction={onCalloutAction}
            onSelectAll={onSelectAll}
          />
        </div>
      );
  }
}
