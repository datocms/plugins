import Callout from 'datocms-react-ui/Callout';
import type { CalloutView, NoteView } from '../contract';
import type { Copy } from './copy';

type CalloutsProps = {
  callouts: ReadonlyArray<CalloutView>;
  copy: Copy;
};

/**
 * What the last search or run left to know, one callout per kind, in the
 * snapshot's order. They hold only their text: the retries they call for are
 * options of the title bar's ⋮, and the toasts carry them too.
 */
export function Callouts({ callouts, copy }: CalloutsProps) {
  return (
    <>
      {callouts.map((callout) => {
        const { tone, title, text } = copy.callout(callout);
        return (
          <Callout key={callout.kind} tone={tone} title={title ?? undefined}>
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
    <Callout title={copy.noteTitle(note) ?? undefined}>
      {copy.note(note)}
    </Callout>
  ) : null;
}
