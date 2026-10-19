export type AltFlipEvent =
  | { type: 'keydown'; key: string; repeat: boolean }
  | { type: 'keyup'; key: string }
  | { type: 'blur' };

export type AltFlipStep = {
  isFlipped: boolean;
  /** Click-to-edit state to send to the preview, when it must change */
  setClickToEditEnabled?: boolean;
};

/**
 * Alt flips click-to-edit away from `preferred` until release. Another key
 * pressed meanwhile (Alt used as a modifier) or a frame blur cancels the flip.
 */
export function nextAltFlip(
  isFlipped: boolean,
  event: AltFlipEvent,
  preferred: boolean,
): AltFlipStep {
  const isAltPress =
    event.type === 'keydown' && event.key === 'Alt' && !event.repeat;
  const isAltRepeat =
    event.type === 'keydown' && event.key === 'Alt' && event.repeat;
  const isKeyUpOfOtherKey = event.type === 'keyup' && event.key !== 'Alt';

  if (isAltPress && !isFlipped) {
    return { isFlipped: true, setClickToEditEnabled: !preferred };
  }

  if (!isFlipped || isAltPress || isAltRepeat || isKeyUpOfOtherKey) {
    return { isFlipped };
  }

  return { isFlipped: false, setClickToEditEnabled: preferred };
}
