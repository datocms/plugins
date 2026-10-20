const FALLBACK_BROWSER_WIDTH = 1440;
const MINIMUM_PANE_WIDTH = 560;
const RECORD_PANE_SHARE = 0.45;

export function inspectorRecordPaneWidth(
  browserOuterWidth: number | undefined,
): number {
  const browserWidth =
    typeof browserOuterWidth === 'number' &&
    Number.isFinite(browserOuterWidth) &&
    browserOuterWidth > 0
      ? browserOuterWidth
      : FALLBACK_BROWSER_WIDTH;

  // A window too small for two usable panes is split evenly. Otherwise the
  // record pane starts at about 45% and neither pane drops below the floor.
  if (browserWidth < MINIMUM_PANE_WIDTH * 2) {
    return Math.round(browserWidth / 2);
  }

  return Math.min(
    Math.max(Math.round(browserWidth * RECORD_PANE_SHARE), MINIMUM_PANE_WIDTH),
    browserWidth - MINIMUM_PANE_WIDTH,
  );
}
