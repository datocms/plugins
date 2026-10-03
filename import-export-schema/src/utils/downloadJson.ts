interface DownloadOptions {
  fileName?: string;
  prettify?: boolean;
}

/**
 * Downloads any JSON data as a file
 * @param data - Any valid JSON data (object, array, etc.)
 * @param options - Configuration options for the download
 */
export const downloadJSON = (
  data: unknown,
  options: DownloadOptions = {},
): void => {
  const jsonString =
    (options.prettify ?? true)
      ? JSON.stringify(data, null, 2)
      : JSON.stringify(data);
  downloadBlob(new Blob([jsonString], { type: 'application/json' }), options);
};

/** Download an already-built blob without serializing the whole schema again. */
export const downloadBlob = (
  blob: Blob,
  options: Pick<DownloadOptions, 'fileName'> = {},
): void => {
  const url = URL.createObjectURL(blob);
  const link = document.createElement('a');
  try {
    // Default options
    const fileName = options.fileName || 'data.json';
    link.href = url;
    link.download = fileName;

    // Append link to document, click it, and remove it
    document.body.appendChild(link);
    link.click();
    // Give the browser time to consume large blob downloads before revoking.
    setTimeout(() => URL.revokeObjectURL(url), 30000);
  } catch (error) {
    URL.revokeObjectURL(url);
    console.error('Error downloading JSON:', error);
    throw error;
  } finally {
    link.remove();
  }
};
