import { LEGACY_LOCAL_STORAGE_KEY } from '../constants';

/**
 * Deletes the 1.x cache, which was shared by every project and store. Kept
 * apart from the Shopify client so the hooks iframe, which runs this on boot,
 * never loads the client.
 */
export function removeLegacyCache(): void {
  try {
    localStorage.removeItem(LEGACY_LOCAL_STORAGE_KEY);
  } catch {
    // Storage can be unavailable in sandboxed iframes.
  }
}
