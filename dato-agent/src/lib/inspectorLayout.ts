const FALLBACK_BROWSER_WIDTH = 1440;
const MINIMUM_RECORD_PANE_WIDTH = 550;
/**
 * The Agent tab's starting chat width, and the narrowest it stays usable: below
 * it, the tab covers the chat with a "too narrow" notice.
 */
export const AGENT_PANE_WIDTH = 300;

export function inspectorRecordPaneWidth(
  browserOuterWidth: number | undefined,
): number {
  const browserWidth =
    typeof browserOuterWidth === 'number' &&
    Number.isFinite(browserOuterWidth) &&
    browserOuterWidth > 0
      ? browserOuterWidth
      : FALLBACK_BROWSER_WIDTH;

  return Math.max(
    MINIMUM_RECORD_PANE_WIDTH,
    Math.round(browserWidth - AGENT_PANE_WIDTH),
  );
}
