import { useEffect } from 'react';

export const DEFAULT_SIDEBAR_WIDTH = 360;

function key(siteId: string): string {
  return `dato-agent:sidebar-width:${siteId}`;
}

export function readSidebarWidth(siteId: string): number | undefined {
  try {
    const parsed = Number.parseInt(localStorage.getItem(key(siteId)) ?? '', 10);
    return Number.isFinite(parsed) && parsed >= 300 ? parsed : undefined;
  } catch {
    return undefined;
  }
}

export function usePersistedSidebarWidth(siteId: string): void {
  useEffect(() => {
    const persist = () => {
      if (window.innerWidth >= 300) {
        try {
          localStorage.setItem(
            key(siteId),
            String(Math.round(window.innerWidth)),
          );
        } catch {
          // Resizing remains available when iframe storage is blocked.
        }
      }
    };

    persist();
    window.addEventListener('resize', persist);
    return () => window.removeEventListener('resize', persist);
  }, [siteId]);
}
