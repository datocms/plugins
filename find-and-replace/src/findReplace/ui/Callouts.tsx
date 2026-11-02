import Callout from 'datocms-react-ui/Callout';
import type { CalloutView, NoteView } from '../contract';
import type { Copy } from './copy';

type CalloutsProps = {
  callouts: ReadonlyArray<CalloutView>;
  copy: Copy;
};

/**
 * The models that couldn't be searched: a fact about the current results.
 * The callout holds only its text: the button that searches them again is
 * in the title bar. Failed and skipped records have no callout: the meta
 * counts them, each row says why, and the toast reported the run.
 */
export function Callouts({ callouts, copy }: CalloutsProps) {
  return (
    <>
      {callouts.map((callout) => {
        if (callout.kind !== 'modelsFailed') {
          return null;
        }
        const { title, text } = copy.modelsFailed(callout);
        return (
          <Callout key={callout.kind} tone="warning" title={title ?? undefined}>
            {text}
          </Callout>
        );
      })}
    </>
  );
}

/** Why the results may be incomplete: the search was capped or stopped. */
export function NoteCallout({
  note,
  copy,
}: {
  note: NoteView | null;
  copy: Copy;
}) {
  return note ? (
    <Callout title={copy.noteTitle(note)}>{copy.note(note)}</Callout>
  ) : null;
}
