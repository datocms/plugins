// @vitest-environment jsdom

import { useAfterPointerRelease } from '@hooks/useAfterPointerRelease';
import { describe, expect, it, vi } from 'vitest';
import { renderHook } from '../testUtils/react';

function press(type: 'pointerdown' | 'pointerup') {
  document.body.dispatchEvent(new Event(type, { bubbles: true }));
}

describe('useAfterPointerRelease', () => {
  it('runs at once when no press is in progress', () => {
    const { result, unmount } = renderHook(() => useAfterPointerRelease());
    const callback = vi.fn();
    result.current?.(callback);
    expect(callback).toHaveBeenCalledTimes(1);
    unmount();
  });

  it('waits until the press ends, and runs after its click', () => {
    vi.useFakeTimers();
    try {
      const { result, unmount } = renderHook(() => useAfterPointerRelease());
      const callback = vi.fn();

      // The press on a button blurs the editor
      press('pointerdown');
      result.current?.(callback);
      expect(callback).not.toHaveBeenCalled();

      press('pointerup');
      expect(callback).not.toHaveBeenCalled();
      vi.runAllTimers();
      expect(callback).toHaveBeenCalledTimes(1);
      unmount();
    } finally {
      vi.useRealTimers();
    }
  });

  it('drops a waiting callback on unmount', () => {
    const { result, unmount } = renderHook(() => useAfterPointerRelease());
    const callback = vi.fn();
    press('pointerdown');
    result.current?.(callback);
    unmount();
    press('pointerup');
    expect(callback).not.toHaveBeenCalled();
  });
});
