import type { Site } from 'datocms-plugin-sdk';
import { useEffect } from 'react';
import { useWindowSize } from 'usehooks-ts';

function keyForSidebarWidth(site: Site) {
  return `site.${site.id}.sidebarWidth`;
}

function saveSidebarWidth(site: Site, width: number) {
  localStorage.setItem(keyForSidebarWidth(site), width.toString());
}

export function readSidebarWidth(site: Site) {
  const value = localStorage.getItem(keyForSidebarWidth(site));

  return value ? Number.parseInt(value) : undefined;
}

export function usePersistedSidebarWidth(site: Site) {
  const { width } = useWindowSize();

  // biome-ignore lint/correctness/useExhaustiveDependencies: intentional
  useEffect(() => {
    saveSidebarWidth(site, width);
  }, [site.id, width]);
}
