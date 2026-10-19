import { describe, expect, it } from 'vitest';
import { type AltFlipEvent, nextAltFlip } from './altFlip';

const altDown: AltFlipEvent = { type: 'keydown', key: 'Alt', repeat: false };
const altRepeat: AltFlipEvent = { type: 'keydown', key: 'Alt', repeat: true };
const altUp: AltFlipEvent = { type: 'keyup', key: 'Alt' };
const blur: AltFlipEvent = { type: 'blur' };

/** Runs events through the reducer, tracking what the preview would show. */
function run(initial: boolean, events: AltFlipEvent[]) {
  let flippedFrom: boolean | undefined;
  let current = initial;
  for (const event of events) {
    const step = nextAltFlip(flippedFrom, event, current);
    flippedFrom = step.flippedFrom;
    if (step.setClickToEditEnabled !== undefined) {
      current = step.setClickToEditEnabled;
    }
  }
  return { flippedFrom, current };
}

describe('nextAltFlip', () => {
  it('flips away from the current state on Alt press', () => {
    expect(nextAltFlip(undefined, altDown, true)).toEqual({
      flippedFrom: true,
      setClickToEditEnabled: false,
    });
    expect(nextAltFlip(undefined, altDown, false)).toEqual({
      flippedFrom: false,
      setClickToEditEnabled: true,
    });
  });

  it('restores the exact pre-Alt state, whatever the preview reports meanwhile', () => {
    // The preview reports `true` mid-hold (e.g. its own toggle): still restore `false`
    expect(nextAltFlip(false, altUp, true)).toEqual({
      flippedFrom: undefined,
      setClickToEditEnabled: false,
    });
  });

  it('ignores key repeat and a second press while held', () => {
    expect(nextAltFlip(true, altRepeat, false)).toEqual({ flippedFrom: true });
    expect(nextAltFlip(true, altDown, false)).toEqual({ flippedFrom: true });
    expect(nextAltFlip(undefined, altRepeat, true)).toEqual({
      flippedFrom: undefined,
    });
  });

  it('ends the hold when Alt acts as a modifier', () => {
    expect(
      nextAltFlip(false, { type: 'keydown', key: 'e', repeat: false }, true),
    ).toEqual({ flippedFrom: undefined, setClickToEditEnabled: false });
  });

  it('ignores other keys released while held', () => {
    expect(nextAltFlip(true, { type: 'keyup', key: 'e' }, false)).toEqual({
      flippedFrom: true,
    });
  });

  it('does nothing on release or blur when not held', () => {
    expect(nextAltFlip(undefined, altUp, true)).toEqual({
      flippedFrom: undefined,
    });
    expect(nextAltFlip(undefined, blur, true)).toEqual({
      flippedFrom: undefined,
    });
  });

  it.each([
    true,
    false,
  ])('returns to %s after press, pointer into the preview (blur), release elsewhere', (initial) => {
    // The release lands in the preview frame, so this frame never sees it
    expect(run(initial, [altDown, blur])).toEqual({
      flippedFrom: undefined,
      current: initial,
    });
  });

  it.each([
    true,
    false,
  ])('returns to %s after press, repeats, release', (initial) => {
    expect(run(initial, [altDown, altRepeat, altRepeat, altUp])).toEqual({
      flippedFrom: undefined,
      current: initial,
    });
  });
});
