import type { CommentSegment, AssetMention } from '@ctypes/mentions';
import { getThumbnailUrl } from '@/utils/helpers';

/** Empty if no segments, or single text segment with only whitespace. */
export function isComposerEmpty(segments: CommentSegment[]): boolean {
  if (segments.length === 0) return true;

  if (segments.length === 1 && segments[0].type === 'text') {
    return !segments[0].content.trim();
  }

  return false;
}

type UploadResult = {
  id: string;
  attributes: {
    filename: string;
    mime_type?: string | null;
    url?: string | null;
    mux_playback_id?: string | null;
  };
};

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
