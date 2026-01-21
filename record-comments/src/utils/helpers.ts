import md5 from 'md5';

// Image URLs come from trusted sources (Gravatar, DatoCMS CDN, Mux) - no validation needed.
// URL validation would add complexity without security benefit and risk breaking CDN changes.

export function getGravatarUrl(email: string, size = 64): string {
  return `https://www.gravatar.com/avatar/${md5(email)}?d=mp&s=${size}`;
}

export function getThumbnailUrl(
  mimeType: string,
  url: string | null,
  muxPlaybackId?: string | null,
  width = 300
): string | null {
  const isImage = mimeType.startsWith('image/');
  const isVideo = mimeType.startsWith('video/');

  if (isImage && url) {
    // dpr=2 for retina, q=80 for smaller file size, auto=format for webp/avif
    return `${url}?w=${width}&fit=max&auto=format&dpr=2&q=80`;
  }

  if (isVideo && muxPlaybackId) {
    return `https://image.mux.com/${muxPlaybackId}/thumbnail.jpg?width=${width}&fit_mode=preserve`;
  }

  return null;
}

/** Normalizes a string for case-insensitive comparison by lowercasing and trimming. */
export function normalizeForComparison(value: string | undefined | null): string {
  return value?.toLowerCase().trim() ?? '';
}
