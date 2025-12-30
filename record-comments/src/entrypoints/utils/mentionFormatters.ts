import { UI } from '@/constants';

export { extractLeadingEmoji } from './emojiUtils';
export type { LeadingEmojiResult } from './emojiUtils';

/** Truncates filename keeping first N chars + extension. */
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

/** Converts snake_case field type to sentence case for display. */
export function formatFieldType(fieldType: string | undefined): string | null {
  if (!fieldType) return null;
  const formatted = fieldType.replace(/_/g, ' ');
  return formatted.charAt(0).toUpperCase() + formatted.slice(1);
}
