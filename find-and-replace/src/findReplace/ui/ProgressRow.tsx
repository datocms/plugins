import ProgressBar from 'datocms-react-ui/ProgressBar';
import Spinner from 'datocms-react-ui/Spinner';
import Toolbar from 'datocms-react-ui/Toolbar';
import type { Ref } from 'react';
import type { PublishState, RunState, SearchState } from '../contract';
import { type Copy, STRINGS } from './copy';
import styles from './ProgressRow.module.css';

type ProgressRowProps = {
  search: SearchState;
  run: RunState;
  publish: PublishState;
  copy: Copy;
  onStopSearch: () => void;
  onStopReplace: () => void;
  onStopPublish: () => void;
  /** The Stop button, for moving the focus to it when a pass starts. */
  stopRef?: Ref<HTMLElement>;
  /**
   * A frame under 600px wide: the row keeps the bar, the label and Stop, and
   * has no room for the note. During a pass, "Keep this page open"
   * then shows as a callout above the results (see Body).
   */
  narrow?: boolean;
};

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

type ProgressView = {
  /** The share done (0–1), or null while the total isn't known (a spinner). */
  value: number | null;
  /** What is done ("12 of 40 records processed"): the label next to the bar, and its name. */
  text: string;
  /** "Keep this page open until it finishes" during a pass, or the time a search still needs. */
  note: string | null;
  stopping: boolean;
  onStop: () => void;
};

const fraction = (done: number, total: number) =>
  total > 0 ? done / total : 0;

/** The pass the row shows: publishing, else the replacement, else the search. */
function progressView(props: ProgressRowProps): ProgressView {
  const { search, run, publish, copy } = props;
  if (isPassActive(publish.phase)) {
    const { done, total } = publish.progress;
    return {
      value: fraction(done, total),
      text: copy.publishProgress(done, total),
      note: STRINGS.keepOpen,
      stopping: publish.phase === 'stopping',
      onStop: props.onStopPublish,
    };
  }
  if (isPassActive(run.phase)) {
    const { done, total } = run.progress;
    return {
      value: fraction(done, total),
      text: copy.replaceProgress(done, total),
      note: STRINGS.keepOpen,
      stopping: run.phase === 'stopping',
      onStop: props.onStopReplace,
    };
  }
  const { searched, total } = search.progress;
  return {
    value: total === null ? null : fraction(searched, total),
    text: copy.searchProgress(searched, total),
    note:
      search.secondsLeft === null ? null : copy.timeLeft(search.secondsLeft),
    stopping: false,
    onStop: props.onStopSearch,
  };
}

/**
 * The short row under the find form while the search reads the records,
 * and while records are written or published: a bar (or a spinner while the
 * total isn't known) and what is done, then at the right end a quiet note
 * and Stop. The bar takes the text next to it as its name. On a frame under
 * 600px wide the note has no room: the search's time left drops, and the
 * "Keep this page open" of a pass moves above the results. "Stopping…" keeps
 * the focus and says why it waits.
 */
export function ProgressRow(props: ProgressRowProps) {
  const view = progressView(props);

  return (
    <Toolbar style="short">
      {view.value === null ? (
        <Spinner inline label={false} />
      ) : (
        <ProgressBar
          className={styles.bar}
          value={view.value}
          ariaLabel={view.text}
        />
      )}
      <span className={styles.label}>{view.text}</span>
      <Toolbar.Space />
      {/* Why Stop is there, right before it: the pass needs the page open,
          or the search needs this much longer. */}
      {view.note && !props.narrow && <Toolbar.Note>{view.note}</Toolbar.Note>}
      <Toolbar.Button
        ref={props.stopRef}
        tone="soft"
        label={view.stopping ? STRINGS.stopping : STRINGS.stop}
        disabled={
          view.stopping ? { reason: STRINGS.stoppingReason } : undefined
        }
        onClick={view.onStop}
      />
    </Toolbar>
  );
}
