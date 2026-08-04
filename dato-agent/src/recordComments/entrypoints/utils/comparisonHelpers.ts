import type { CommentSegment, Mention } from '@ctypes/mentions';

export function areMentionsEqual(a: Mention, b: Mention): boolean {
  if (a.type !== b.type) return false;

  return JSON.stringify(a) === JSON.stringify(b);
}

export function areSegmentsEqual(
  a: readonly CommentSegment[],
  b: readonly CommentSegment[],
): boolean {
  if (a === b) return true;
  if (a.length !== b.length) return false;

  return a.every((segment, index) => {
    const other = b[index];
    if (!other || segment.type !== other.type) return false;
    if (segment.type === 'text' && other.type === 'text') {
      return segment.content === other.content;
    }
    return (
      segment.type === 'mention' &&
      other.type === 'mention' &&
      areMentionsEqual(segment.mention, other.mention)
    );
  });
}
