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
  try {
    // Default options
    const fileName = options.fileName || 'data.json';
    const prettify = options.prettify ?? true;

    // Convert data to JSON string
    const jsonString = prettify
      ? JSON.stringify(data, null, 2) // Pretty print with 2 spaces
      : JSON.stringify(data);

    // Create blob with JSON data
    const blob = new Blob([jsonString], { type: 'application/json' });

    // Create URL for the blob
    const url = URL.createObjectURL(blob);

    // Create temporary link element
    const link = document.createElement('a');
    link.href = url;
    link.download = fileName;

    // Append link to document, click it, and remove it
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);

    // Clean up by revoking the URL
    URL.revokeObjectURL(url);
  } catch (error) {
    console.error('Error downloading JSON:', error);
    throw error;
  }
};
