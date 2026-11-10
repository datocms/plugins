import { useMemo, useState, useSyncExternalStore } from 'react';

/** The kit's split: the panel's width before the user resizes it. */
const DEFAULT_DETAIL_WIDTH = 500;
/** The kit's split: the least width the list and the panel each keep. */
const MIN_SIDE_WIDTH = 360;

/** The value of the page's ListDetailWidthsProvider. */
export type SplitWidths = {
  listWidth: number | undefined;
  onListWidthChange: (width: number) => void;
  detailWidth: number | undefined;
  onDetailWidthChange: (width: number) => void;
};

/**
 * The list takes all the width the panel leaves, so the list and the open
 * panel fill the frame together: the kit's split caps the list at 1100px and
 * would leave the rest of a wide frame empty, right of the panel. With no
 * open row the list keeps the same width, so it doesn't move when a row
 * opens. Before the frame is measured, the kit's own widths apply.
 */
export function fillingWidths(
  frameWidth: number,
  detailWidth = DEFAULT_DETAIL_WIDTH,
): Pick<SplitWidths, 'listWidth' | 'detailWidth'> {
  if (frameWidth < 2 * MIN_SIDE_WIDTH)
    return { listWidth: undefined, detailWidth: undefined };
  const detail = Math.min(
    Math.max(detailWidth, MIN_SIDE_WIDTH),
    frameWidth - MIN_SIDE_WIDTH,
  );
  return { listWidth: frameWidth - detail, detailWidth: detail };
}

function subscribe(onChange: () => void) {
  window.addEventListener('resize', onChange);
  return () => window.removeEventListener('resize', onChange);
}

/** The page fills the frame, so the split is as wide as the frame. */
function frameWidth() {
  return document.documentElement.clientWidth;
}

/**
 * The widths of the list and the panel, for the page's
 * ListDetailWidthsProvider. Only the panel's width is kept: a resize of the
 * list gives the panel the rest of the frame, and a resize of the panel gives
 * the list the rest.
 */
export function useFillingWidths(): SplitWidths {
  const frame = useSyncExternalStore(subscribe, frameWidth, () => 0);
  const [detailWidth, setDetailWidth] = useState<number>();
  return useMemo(
    () => ({
      ...fillingWidths(frame, detailWidth),
      onListWidthChange: (width: number) => setDetailWidth(frame - width),
      onDetailWidthChange: setDetailWidth,
    }),
    [frame, detailWidth],
  );
}
