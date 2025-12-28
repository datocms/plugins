import { UI } from '@/constants';

// Re-export from centralized emoji utilities
export { extractLeadingEmoji } from './emojiUtils';
export type { LeadingEmojiResult } from './emojiUtils';

/**
 * Truncates a filename for display, keeping first N chars + extension.
 * Preserves the file extension while truncating the base name.
 *
 * @param filename - The filename to potentially truncate
 * @returns The truncated filename with ellipsis if needed
 *
 * @example
 * getTruncatedFilename("my-long-filename.pdf") // "my-long-….pdf"
 * getTruncatedFilename("short.pdf") // "short.pdf"
 * getTruncatedFilename("no-extension") // "no-exten…" (if too long)
 */
export function getTruncatedFilename(filename: string): string {
  const maxLength = UI.MENTION_CHIP_MAX_NAME_LENGTH;
  const lastDotIndex = filename.lastIndexOf('.');
  const hasExtension = lastDotIndex !== -1;

  if (!hasExtension) {
    return filename.length > maxLength
      ? `${filename.slice(0, maxLength)}…`
      : filename;
  }

  const nameWithoutExtension = filename.slice(0, lastDotIndex);
  const extension = filename.slice(lastDotIndex);

  if (nameWithoutExtension.length <= maxLength) {
    return filename;
  }

  return `${nameWithoutExtension.slice(0, maxLength)}…${extension}`;
}

/**
 * Formats a field type for display in tooltips.
 * Converts snake_case to sentence case (first letter capitalized).
 *
 * @param fieldType - The field type string (e.g., "single_line", "structured_text")
 * @returns Formatted string (e.g., "Single line") or null if no fieldType provided
 *
 * @example
 * formatFieldType("single_line") // "Single line"
 * formatFieldType("structured_text") // "Structured text"
 * formatFieldType(undefined) // null
 */
export function formatFieldType(fieldType: string | undefined): string | null {
  if (!fieldType) return null;
  const formatted = fieldType.replace(/_/g, ' ');
  return formatted.charAt(0).toUpperCase() + formatted.slice(1);
}
