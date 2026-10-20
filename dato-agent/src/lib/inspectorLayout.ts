const FALLBACK_BROWSER_WIDTH = 1440;
// The CMS does not render the record pane narrower than this.
const MINIMUM_RECORD_PANE_WIDTH = 550;
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

  // The record pane takes about 45%, which leaves the chat at least 55%.
  // On narrow windows the CMS minimum wins and the chat gets the remainder.
  return Math.max(
    Math.round(browserWidth * RECORD_PANE_SHARE),
    MINIMUM_RECORD_PANE_WIDTH,
  );
}
