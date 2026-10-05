import { useCallback, useState } from 'react';
import { PICKER_VIEW_STORAGE_KEY } from '../../constants';

export type PickerView = 'grid' | 'list';

function readView(): PickerView {
  try {
    return window.localStorage.getItem(PICKER_VIEW_STORAGE_KEY) === 'list'
      ? 'list'
      : 'grid';
  } catch {
    return 'grid';
  }
}

function writeView(view: PickerView): void {
  try {
    window.localStorage.setItem(PICKER_VIEW_STORAGE_KEY, view);
  } catch {
    // Storage can be unavailable in sandboxed iframes; the choice just isn't remembered.
  }
}

/** Grid or list, remembered per user (per browser) when storage is available. */
export function usePickerView(): [PickerView, (view: PickerView) => void] {
  const [view, setView] = useState<PickerView>(readView);
  const change = useCallback((next: PickerView) => {
    setView(next);
    writeView(next);
  }, []);
  return [view, change];
}
