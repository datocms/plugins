import { useCallback, useState } from 'react';

export type Announcement = { id: number; text: string };

/** Announcements for the polite live region; the same text twice is read twice. */
export function useAnnouncer(): [Announcement | null, (text: string) => void] {
  const [announcement, setAnnouncement] = useState<Announcement | null>(null);
  const announce = useCallback((text: string) => {
    setAnnouncement((previous) => ({ id: (previous?.id ?? 0) + 1, text }));
  }, []);
  return [announcement, announce];
}

/**
 * One visually hidden polite region. It announces settled states only (a
 * search settled, the pattern turned invalid, a pass ended), never progress.
 */
export function LiveRegion({
  announcement,
}: {
  announcement: Announcement | null;
}) {
  return (
    <div className="fr-sr-only" aria-live="polite">
      {announcement && <span key={announcement.id}>{announcement.text}</span>}
    </div>
  );
}
