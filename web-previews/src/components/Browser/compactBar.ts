import { useMediaQuery } from 'datocms-react-ui/hooks/useMediaQuery';

// The bars of the previews give room to the page in a narrow frame. The
// queries read the width of the frame (the sidebar, the Visual tab), not the
// width of the window of DatoCMS.

/**
 * The sidebar is 300px wide at least (the host's minimum). Under 560px the
 * menu of the links gets a bar of its own, with all its width, and the
 * controls go in a second bar, where the viewport trigger shows only its
 * icon. From 560px one bar holds everything, and the link still has about
 * 190px.
 */
const COMPACT_SIDEBAR_BAR = '(max-width: 559.98px)';

/**
 * In the Visual tab, the trigger of the viewport shows only its icon under
 * 800px (a common width once the inspector panel is open), so the path of the
 * page keeps a usable width. Its icon is the icon of the current choice. The
 * trigger of the frontend keeps its name there: its icon is the same for
 * every frontend, so only the name shows the current one.
 */
const COMPACT_VISUAL_TAB_BAR = '(max-width: 799.98px)';

/**
 * In a very narrow Visual tab, the trigger of the frontend and edit mode show
 * only their icon too, so the path of the page keeps a width that shows a
 * path: with the name of the frontend, the address would have less than
 * 80px at 500px. The same width as in the sidebar, where edit mode also
 * shows only its icon under 560px.
 */
const NARROW_VISUAL_TAB_BAR = '(max-width: 559.98px)';

export function useCompactSidebarBar(): boolean {
  return useMediaQuery(COMPACT_SIDEBAR_BAR).matches;
}

export function useCompactVisualTabBar(): boolean {
  return useMediaQuery(COMPACT_VISUAL_TAB_BAR).matches;
}

export function useNarrowVisualTabBar(): boolean {
  return useMediaQuery(NARROW_VISUAL_TAB_BAR).matches;
}
