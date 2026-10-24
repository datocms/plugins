import type { Site } from 'datocms-plugin-sdk';
import { useEffect } from 'react';
import { useWindowSize } from 'usehooks-ts';

// Every marketplace plugin shares the origin of the plugins CDN, so the key
// starts with the name of the plugin. Older versions wrote the key without
// it: it is still read, until the next save writes the new one.
function keyForSidebarWidth(site: Site) {
  return `web-previews.site.${site.id}.sidebarWidth`;
}

function legacyKeyForSidebarWidth(site: Site) {
  return `site.${site.id}.sidebarWidth`;
}

function saveSidebarWidth(site: Site, width: number) {
  try {
    localStorage.setItem(keyForSidebarWidth(site), width.toString());
  } catch {
    // Storage is unavailable (blocked or full): the width is not remembered
  }
}

export function readSidebarWidth(site: Site): number | undefined {
  let value: string | null;

  try {
    value =
      localStorage.getItem(keyForSidebarWidth(site)) ??
      localStorage.getItem(legacyKeyForSidebarWidth(site));
  } catch {
    return undefined;
  }

  if (!value) {
    return undefined;
  }

  const width = Number.parseInt(value, 10);

  return Number.isNaN(width) ? undefined : width;
}

/** Remembers the width of the sidebar frame, on every resize */
export function usePersistedSidebarWidth(site: Site) {
  const { width } = useWindowSize();

  useEffect(() => {
    saveSidebarWidth(site, width);
  }, [width, site]);
}
