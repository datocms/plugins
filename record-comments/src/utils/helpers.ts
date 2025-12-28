import md5 from 'md5';

// ============================================================================
// IMAGE URL SECURITY DOCUMENTATION
// ============================================================================
//
// WHY IMAGE URL VALIDATION IS NOT IMPLEMENTED:
// -------------------------------------------
// All image URLs used in this plugin come from trusted, controlled sources:
//
// 1. GRAVATAR URLs (getGravatarUrl):
//    - Generated programmatically: https://www.gravatar.com/avatar/{hash}
//    - We construct the URL, always pointing to gravatar.com
//    - No user input can modify the domain
//
// 2. DATOCMS ASSET URLs (getThumbnailUrl for images):
//    - Base URL comes from DatoCMS API response (upload.attributes.url)
//    - We append imgix query parameters to existing DatoCMS CDN URLs
//    - These are trusted backend responses, not user input
//
// 3. MUX VIDEO THUMBNAILS (getThumbnailUrl for videos):
//    - Generated programmatically: https://image.mux.com/{playbackId}/...
//    - PlaybackId comes from DatoCMS API response
//    - We construct the URL, always pointing to mux.com
//
// THEORETICAL ATTACK VECTOR (and why it's not a concern):
// -------------------------------------------------------
// An attacker with direct DatoCMS API/UI access could theoretically edit
// the comment record's JSON to inject malicious URLs into mention data.
// However:
//
// 1. This requires write access to the project_comment model, meaning the
//    attacker already has significant CMS privileges
// 2. The impact is limited: <img> tags can only display images, they cannot
//    execute JavaScript and browsers sandbox cross-origin requests
// 3. At worst, an attacker could display arbitrary images or tracking pixels
// 4. Anyone with this level of access can cause more damage directly
//
// RISKS OF ADDING URL VALIDATION:
// -------------------------------
// 1. DatoCMS CDN domains may change, breaking legitimate asset URLs
// 2. Added complexity with no meaningful security benefit
// 3. False positives could break normal plugin functionality
//
// CONCLUSION: URL validation is intentionally not implemented.
// DO NOT add URL validation without reconsidering the above points.
// ============================================================================

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
 * @param width - Thumbnail width (default: 300 for good quality previews)
 * @returns The thumbnail URL, or null if not applicable
 */
export function getThumbnailUrl(
  mimeType: string,
  url: string | null,
  muxPlaybackId?: string | null,
  width = 300
): string | null {
  const isImage = mimeType.startsWith('image/');
  const isVideo = mimeType.startsWith('video/');

  if (isImage && url) {
    // Use fit=max to preserve aspect ratio and show full image
    return `${url}?w=${width}&fit=max&auto=format`;
  }
  
  if (isVideo && muxPlaybackId) {
    // Use fit_mode=preserve for videos to maintain aspect ratio
    return `https://image.mux.com/${muxPlaybackId}/thumbnail.jpg?width=${width}&fit_mode=preserve`;
  }
  
  return null;
}




