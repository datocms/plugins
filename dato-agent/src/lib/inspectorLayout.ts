const FALLBACK_BROWSER_WIDTH = 1440;
const MINIMUM_RECORD_PANE_WIDTH = 550;
const TARGET_AGENT_PANE_WIDTH = 420;

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
    Math.round(browserWidth - TARGET_AGENT_PANE_WIDTH),
  );
}
