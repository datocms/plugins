/**
 * Triggers a client-side download of a text payload as a file. Pure browser DOM
 * glue (Blob + object URL + a transient anchor); no-ops when the document/URL
 * APIs are unavailable so it is safe to call in non-DOM environments.
 *
 * @param filename - Suggested download filename.
 * @param mimeType - MIME type for the Blob (e.g. `text/csv`).
 * @param content - The text content to download.
 */
export function downloadTextFile(
  filename: string,
  mimeType: string,
  content: string,
): void {
  if (
    typeof document === 'undefined' ||
    typeof URL === 'undefined' ||
    typeof URL.createObjectURL !== 'function'
  ) {
    return;
  }

  const blob = new Blob([content], { type: mimeType });
  const url = URL.createObjectURL(blob);
  const anchor = document.createElement('a');
  anchor.href = url;
  anchor.download = filename;
  document.body.appendChild(anchor);
  anchor.click();
  anchor.remove();
  URL.revokeObjectURL(url);
}
