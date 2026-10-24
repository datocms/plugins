/**
 * dropFocus.ts
 * ------------
 * What a browser does when the focused button turns disabled (a busy kit
 * Button is disabled): it drops the focus to the body. jsdom keeps the focus
 * on a disabled button, and its `blur()` does nothing there, so a test
 * drops the focus itself: a stand-in takes it and leaves the document.
 */
import { act } from '@testing-library/react';

export function dropFocus(): void {
  act(() => {
    const standIn = document.createElement('input');
    document.body.append(standIn);
    standIn.focus();
    standIn.remove();
  });
}
