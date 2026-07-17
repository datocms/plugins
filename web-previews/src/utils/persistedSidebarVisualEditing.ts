import type { Site } from 'datocms-plugin-sdk';
import { useCallback, useState } from 'react';

function keyForSidebarVisualEditing(site: Site) {
  return `site.${site.id}.sidebarVisualEditing`;
}

export function readSidebarVisualEditing(site: Site): boolean {
  // Per-user preference, disabled by default (opt-in).
  return localStorage.getItem(keyForSidebarVisualEditing(site)) === 'true';
}

function saveSidebarVisualEditing(site: Site, enabled: boolean) {
  localStorage.setItem(keyForSidebarVisualEditing(site), String(enabled));
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
