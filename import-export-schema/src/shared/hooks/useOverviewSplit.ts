import { useDidUpdateEffect } from 'datocms-react-ui/hooks/useDidUpdateEffect';
import { useIsSmallViewport } from 'datocms-react-ui/hooks/useMediaQuery';
import type { SplitPaneSize } from 'datocms-react-ui/SplitPane';
import { useState } from 'react';

type Options = {
  /**
   * On a small viewport, the overview starts open over the graph: it holds
   * the work of the screen (the conflicts of an import). Otherwise it starts
   * closed there, and its rail opens it.
   */
  openWhenSmall: boolean;
};

/**
 * The props of the SplitPane of a graph screen: the graph at the left, the
 * overview at the right, side by side, or over the graph on a small
 * viewport (the breakpoint of the components, useIsSmallViewport).
 */
export function useOverviewSplit({ openWhenSmall }: Options) {
  const isSmallViewport = useIsSmallViewport();
  const [size, setSize] = useState<SplitPaneSize>('33%');
  const [open, setOpen] = useState(openWhenSmall || !isSmallViewport);

  // Open again when the frame gets wide enough for the two panes, and back
  // to the first state when it gets small
  useDidUpdateEffect(() => {
    setOpen(openWhenSmall || !isSmallViewport);
  }, [isSmallViewport]);

  return {
    mode: isSmallViewport ? ('overlay' as const) : ('split' as const),
    size,
    minSize: 340,
    maxSize: '60%' as const,
    onDragFinished: setSize,
    collapse: { open, onToggle: setOpen },
  };
}
