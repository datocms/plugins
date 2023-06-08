import { Site } from 'datocms-plugin-sdk';
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

  return value ? parseInt(value) : undefined;
}

export function usePersistedSidebarWidth(site: Site) {
  const { width } = useWindowSize();

  useEffect(() => {
    saveSidebarWidth(site, width);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [site.id, width]);
}
