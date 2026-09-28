import { Spinner, Toolbar, ToolbarStack } from 'datocms-react-ui';
import { type RefObject, useLayoutEffect } from 'react';
import { Button } from '../../ui/Button';
import type { PublishState, RunState, SearchState } from '../contract';
import { type Copy, STRINGS } from './copy';

type ProgressRowProps = {
  search: SearchState;
  run: RunState;
  publish: PublishState;
  copy: Copy;
  onStopSearch: () => void;
  onStopReplace: () => void;
  onStopPublish: () => void;
  /** `.fr-progress`, for moving the focus to "Stop". */
  containerRef: RefObject<HTMLDivElement | null>;
};

type BarProps = { label: string; done: number; total: number };

function ProgressBar({ label, done, total }: BarProps) {
  const percent = total > 0 ? Math.min(100, (done / total) * 100) : 0;
  return (
    <div
      className="dl-progress"
      role="progressbar"
      aria-label={label}
      aria-valuemin={0}
      aria-valuemax={total}
      aria-valuenow={done}
    >
      <div className="dl-progress__bar" style={{ width: `${percent}%` }} />
    </div>
  );
}

const isPassActive = (phase: string) =>
  phase === 'running' || phase === 'stopping';

/** Mount only while `search.showProgress`, or while a replace or publish pass is running or stopping. */
export function isProgressVisible(
  search: SearchState,
  run: RunState,
  publish: PublishState,
): boolean {
  return (
    isPassActive(run.phase) ||
    isPassActive(publish.phase) ||
    search.showProgress
  );
}

type PassView = {
  label: string;
  done: number;
  total: number;
  text: string;
  stopping: boolean;
  onStop: () => void;
};

/** The replace or publish pass the row shows, if one runs. */
function activePass(props: ProgressRowProps): PassView | null {
  const { run, publish, copy } = props;
  if (isPassActive(publish.phase)) {
    return {
      label: STRINGS.publishProgress,
      done: publish.progress.done,
      total: publish.progress.total,
      text: copy.publishProgress(publish.progress.done, publish.progress.total),
      stopping: publish.phase === 'stopping',
      onStop: props.onStopPublish,
    };
  }
  if (isPassActive(run.phase)) {
    return {
      label: STRINGS.replaceProgress,
      done: run.progress.done,
      total: run.progress.total,
      text: copy.replaceProgress(run.progress.done, run.progress.total),
      stopping: run.phase === 'stopping',
      onStop: props.onStopReplace,
    };
  }
  return null;
}

/**
 * One 40px row for the search, the write and publishing: bar (or a 20px
 * spinner while the total is unknown), label, hint while writing, and a
 * compact Stop.
 */
export function ProgressRow(props: ProgressRowProps) {
  const { search, copy, onStopSearch, containerRef } = props;
  const pass = activePass(props);
  const writing = pass !== null;
  const stopping = pass?.stopping ?? false;
  const { searched, total } = search.progress;

  // "Stopping…" keeps the focus it got from Space/Enter: a disabled button would drop it to
  // <body> until the pass ends. So it's aria-disabled (the kit Button takes no aria props) and
  // its click does nothing.
  useLayoutEffect(() => {
    const stop = containerRef.current?.querySelector('button');
    if (stopping) {
      stop?.setAttribute('aria-disabled', 'true');
    } else {
      stop?.removeAttribute('aria-disabled');
    }
  }, [stopping, containerRef]);

  return (
    <Toolbar className="fr-toolbar fr-toolbar--progress">
      <ToolbarStack
        stackSize="s"
        style={{ gap: 'var(--spacing-m)', minWidth: 0 }}
      >
        <div className="fr-progress" ref={containerRef}>
          {pass && (
            <ProgressBar
              label={pass.label}
              done={pass.done}
              total={pass.total}
            />
          )}
          {!writing && total !== null && (
            <ProgressBar
              label={STRINGS.searchProgress}
              done={searched}
              total={total}
            />
          )}
          {!writing && total === null && (
            <div
              className="fr-progress__spinner"
              role="progressbar"
              aria-label={STRINGS.searchProgress}
            >
              <Spinner size={20} placement="centered" />
            </div>
          )}
          <span className="fr-progress__label">
            {pass ? pass.text : copy.searchProgress(searched, total)}
          </span>
          {writing && (
            <span className="fr-progress__hint">{STRINGS.keepOpen}</span>
          )}
          {!writing && search.secondsLeft !== null && (
            <span className="fr-progress__hint">
              {copy.timeLeft(search.secondsLeft)}
            </span>
          )}
          <div className="dl-toolbar__space" />
          <Button
            buttonSize="xxs"
            className="fr-progress__stop"
            onClick={() => {
              if (stopping) {
                return;
              }
              if (pass) {
                pass.onStop();
              } else {
                onStopSearch();
              }
            }}
          >
            {stopping ? STRINGS.stopping : STRINGS.stop}
          </Button>
        </div>
      </ToolbarStack>
    </Toolbar>
  );
}
