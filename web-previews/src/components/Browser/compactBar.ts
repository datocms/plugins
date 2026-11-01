import { useMediaQuery } from 'datocms-react-ui/hooks/useMediaQuery';

// The bars of the previews give room to the page in a narrow frame. The
// queries read the width of the frame (the Visual tab), not the width of the
// window of DatoCMS.

/**
 * In the Visual tab, the trigger of the viewport shows only its icon under
 * 800px (a common width once the inspector panel is open), so the path of the
 * page keeps a usable width. Its icon is the icon of the current choice. The
 * trigger of the frontend has no icon: it shows its name at every width.
 */
const COMPACT_VISUAL_TAB_BAR = '(max-width: 799.98px)';

/**
 * In a very narrow Visual tab, edit mode shows only its switch, without its
 * label and the hint of the Alt key, so the path of the page keeps a width
 * that shows a path. The label and the hint keep the width of their longest
 * text, so the limit includes the 26px that this adds.
 */
const NARROW_VISUAL_TAB_BAR = '(max-width: 585.98px)';

export function useCompactVisualTabBar(): boolean {
  return useMediaQuery(COMPACT_VISUAL_TAB_BAR).matches;
}

export function useNarrowVisualTabBar(): boolean {
  return useMediaQuery(NARROW_VISUAL_TAB_BAR).matches;
}
