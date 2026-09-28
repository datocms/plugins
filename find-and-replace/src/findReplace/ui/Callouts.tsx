import { Button } from '../../ui/Button';
import type { CalloutView } from '../contract';
import { type CalloutAction, type Copy, STRINGS } from './copy';

type CalloutsProps = {
  callouts: ReadonlyArray<CalloutView>;
  copy: Copy;
  /** False while a run is going: the actions wait for it to end. */
  actionsEnabled: boolean;
  onAction: (action: CalloutAction) => void;
};

/**
 * At most one callout per kind, above the card, in the snapshot's order. Not
 * live regions: the page announces only settled states, from one region.
 */
export function Callouts({
  callouts,
  copy,
  actionsEnabled,
  onAction,
}: CalloutsProps) {
  return (
    <>
      {callouts.map((callout) => {
        const { tone, text, action } = copy.callout(callout);
        const classes = [
          'dl-callout',
          `dl-callout--${tone}`,
          'fr-callout--compact',
          action ? 'dl-callout--with-action' : null,
        ]
          .filter(Boolean)
          .join(' ');

        return (
          <div key={callout.kind} className={classes}>
            <div>{text}</div>
            {action && (
              <Button
                buttonSize="xs"
                disabled={!actionsEnabled}
                onClick={() => onAction(action)}
              >
                {STRINGS.tryAgain}
              </Button>
            )}
          </div>
        );
      })}
    </>
  );
}
