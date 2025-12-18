import md5 from 'md5';

/**
 * Generates a Gravatar URL for a given email address.
 * @param email - The user's email address
 * @param size - The desired size in pixels (default: 64)
 * @returns The Gravatar URL
 */
export function getGravatarUrl(email: string, size = 64): string {
  return `https://www.gravatar.com/avatar/${md5(email)}?d=mp&s=${size}`;
}

/**
 * Generates a thumbnail URL for an image or video asset.
 * - For images: Uses imgix parameters for resizing
 * - For videos: Uses Mux thumbnail API
 * @param mimeType - The MIME type of the asset
 * @param url - The asset URL (for images)
 * @param muxPlaybackId - The Mux playback ID (for videos)
 * @param width - Thumbnail width (default: 100)
 * @param height - Thumbnail height (default: 100)
 * @returns The thumbnail URL, or null if not applicable
 */
export function getThumbnailUrl(
  mimeType: string,
  url: string | null,
  muxPlaybackId?: string | null,
  width = 100,
  height = 100
): string | null {
  const isImage = mimeType.startsWith('image/');
  const isVideo = mimeType.startsWith('video/');

  if (isImage && url) {
    return `${url}?w=${width}&h=${height}&fit=crop`;
  }
  
  if (isVideo && muxPlaybackId) {
    return `https://image.mux.com/${muxPlaybackId}/thumbnail.jpg?width=${width}&height=${height}&fit_mode=crop`;
  }
  
  return null;
}

