import type { Site } from 'datocms-plugin-sdk';
import { useCallback, useState } from 'react';

// Every marketplace plugin shares the origin of the plugins CDN, so the key
// starts with the name of the plugin. Older versions wrote the key without
// it: it is still read, until the next change writes the new one.
function keyForSidebarVisualEditing(site: Site) {
  return `web-previews.site.${site.id}.sidebarVisualEditing`;
}

function legacyKeyForSidebarVisualEditing(site: Site) {
  return `site.${site.id}.sidebarVisualEditing`;
}

export function readSidebarVisualEditing(site: Site): boolean {
  // Per-user preference, disabled by default (opt-in).
  try {
    const value =
      localStorage.getItem(keyForSidebarVisualEditing(site)) ??
      localStorage.getItem(legacyKeyForSidebarVisualEditing(site));

    return value === 'true';
  } catch {
    return false;
  }
}

function saveSidebarVisualEditing(site: Site, enabled: boolean) {
  try {
    localStorage.setItem(keyForSidebarVisualEditing(site), String(enabled));
  } catch {
    // Storage is unavailable (blocked or full): the choice lasts this session
  }
}

/**
 * Per-user toggle for enabling visual-editing navigation inside the sidebar
 * preview. Persisted in localStorage (keyed by site), mirroring the sidebar
 * width preference.
 */
export function usePersistedSidebarVisualEditing(site: Site) {
  const [enabled, setEnabled] = useState(() => readSidebarVisualEditing(site));

  const setPersisted = useCallback(
    (value: boolean) => {
      setEnabled(value);
      saveSidebarVisualEditing(site, value);
    },
    [site],
  );

  return [enabled, setPersisted] as const;
}
