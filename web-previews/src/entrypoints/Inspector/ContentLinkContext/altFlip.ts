export type AltFlipEvent =
  | { type: 'keydown'; key: string; repeat: boolean }
  | { type: 'keyup'; key: string }
  | { type: 'blur' };

export type AltFlipStep = {
  /** Click-to-edit state before Alt was pressed; undefined when not held */
  flippedFrom: boolean | undefined;
  /** Click-to-edit state to send to the preview, when it must change */
  setClickToEditEnabled?: boolean;
};

/**
 * Alt flips click-to-edit away from its `current` state until release, then
 * restores exactly the pre-Alt state. Another key pressed meanwhile (Alt used
 * as a modifier) or a frame blur (focus moving into the preview) ends the hold.
 */
export function nextAltFlip(
  flippedFrom: boolean | undefined,
  event: AltFlipEvent,
  current: boolean,
): AltFlipStep {
  const isAltKeyDown = event.type === 'keydown' && event.key === 'Alt';
  const endsHold =
    (event.type === 'keydown' && event.key !== 'Alt') ||
    (event.type === 'keyup' && event.key === 'Alt') ||
    event.type === 'blur';

  if (flippedFrom === undefined) {
    return isAltKeyDown && !event.repeat
      ? { flippedFrom: current, setClickToEditEnabled: !current }
      : { flippedFrom };
  }

  return endsHold
    ? { flippedFrom: undefined, setClickToEditEnabled: flippedFrom }
    : { flippedFrom };
}
