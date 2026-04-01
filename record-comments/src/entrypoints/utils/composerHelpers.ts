import type { AssetMention } from '@ctypes/mentions';
import { getThumbnailUrl } from '@/utils/helpers';

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
  const thumbnailUrl = getThumbnailUrl(
    mimeType,
    url,
    upload.attributes.mux_playback_id,
  );

  return {
    type: 'asset',
    id: upload.id,
    filename: upload.attributes.filename,
    url,
    thumbnailUrl,
    mimeType,
  };
}
