export const GRAPH_NODE_THRESHOLD = 60;

// Why a diagram past the threshold shows a blank slate. The pane subtitle
// already counts the elements: the text gives no number.
const GRAPH_TOO_LARGE_REASON =
  'Drawing all its models, blocks and plugins can slow down your browser.';

/** The import: the overview holds the rest of the review */
export const GRAPH_TOO_LARGE_DESCRIPTION = `${GRAPH_TOO_LARGE_REASON} The overview lists every one.`;

/** The export: without boxes to click, the overview adds to the file */
export const EXPORT_GRAPH_TOO_LARGE_DESCRIPTION = `${GRAPH_TOO_LARGE_REASON} Open one in the overview to add it to the file.`;
