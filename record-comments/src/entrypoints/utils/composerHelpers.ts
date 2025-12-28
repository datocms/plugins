import type { CommentSegment, AssetMention } from '@ctypes/mentions';
import { getThumbnailUrl } from '@/utils/helpers';

/**
 * Checks if a comment composer is empty (no meaningful content).
 *
 * A composer is considered empty if:
 * - It has no segments at all
 * - It has a single text segment with only whitespace
 *
 * This utility is used in multiple places:
 * - CommentsBar.tsx: To disable send button when composer is empty
 * - GlobalCommentsChannel.tsx: Same purpose for dashboard composer
 * - Comment.tsx: To determine if a reply/edit should be deleted on blur
 *
 * @param segments - The segments from the composer
 * @returns true if the composer has no meaningful content
 */
export function isComposerEmpty(segments: CommentSegment[]): boolean {
  if (segments.length === 0) return true;

  if (segments.length === 1 && segments[0].type === 'text') {
    return !segments[0].content.trim();
  }

  return false;
}

/**
 * Upload type from DatoCMS selectUpload result.
 * This is a minimal type covering the fields we need.
 */
type UploadResult = {
  id: string;
  attributes: {
    filename: string;
    mime_type?: string | null;
    url?: string | null;
    mux_playback_id?: string | null;
  };
};

/**
 * Creates an AssetMention from a DatoCMS upload result.
 *
 * This utility is used in multiple places:
 * - CommentsBar.tsx: When user selects an asset via ^ trigger or toolbar
 * - GlobalCommentsChannel.tsx: Same purpose for dashboard composer
 *
 * @param upload - The upload result from ctx.selectUpload()
 * @returns An AssetMention ready to be inserted into the composer
 */
export function createAssetMention(upload: UploadResult): AssetMention {
  const mimeType = upload.attributes.mime_type ?? 'application/octet-stream';
  const url = upload.attributes.url ?? '';
  const thumbnailUrl = getThumbnailUrl(mimeType, url, upload.attributes.mux_playback_id);

  return {
    type: 'asset',
    id: upload.id,
    filename: upload.attributes.filename,
    url,
    thumbnailUrl,
    mimeType,
  };
}
