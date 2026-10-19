import { describe, expect, it } from 'vitest';
import { type AltFlipEvent, nextAltFlip } from './altFlip';

const altDown: AltFlipEvent = { type: 'keydown', key: 'Alt', repeat: false };
const altRepeat: AltFlipEvent = { type: 'keydown', key: 'Alt', repeat: true };
const altUp: AltFlipEvent = { type: 'keyup', key: 'Alt' };

describe('nextAltFlip', () => {
  it('flips away from the preferred state on Alt press', () => {
    expect(nextAltFlip(false, altDown, true)).toEqual({
      isFlipped: true,
      setClickToEditEnabled: false,
    });
    expect(nextAltFlip(false, altDown, false)).toEqual({
      isFlipped: true,
      setClickToEditEnabled: true,
    });
  });

  it('ignores key repeat while held', () => {
    expect(nextAltFlip(true, altRepeat, true)).toEqual({ isFlipped: true });
  });

  it('reverts on Alt release', () => {
    expect(nextAltFlip(true, altUp, true)).toEqual({
      isFlipped: false,
      setClickToEditEnabled: true,
    });
  });

  it('reverts when Alt acts as a modifier', () => {
    expect(
      nextAltFlip(true, { type: 'keydown', key: 'e', repeat: false }, false),
    ).toEqual({ isFlipped: false, setClickToEditEnabled: false });
  });

  it('reverts on blur', () => {
    expect(nextAltFlip(true, { type: 'blur' }, true)).toEqual({
      isFlipped: false,
      setClickToEditEnabled: true,
    });
  });

  it('does nothing when not flipped', () => {
    expect(nextAltFlip(false, altUp, true)).toEqual({ isFlipped: false });
    expect(nextAltFlip(false, { type: 'blur' }, true)).toEqual({
      isFlipped: false,
    });
  });
});
