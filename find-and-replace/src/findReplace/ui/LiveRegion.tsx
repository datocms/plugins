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
 * search settled, a pass ended), never progress. A pattern that turns invalid
 * isn't announced here: its danger callout is an alert, which a screen reader
 * reads as it appears, and it mounts again for each invalid pattern (see
 * FormLines), so the same problem twice is read twice.
 */
export function LiveRegion({
  announcement,
}: {
  announcement: Announcement | null;
}) {
  return (
    <div className="visually-hidden" aria-live="polite">
      {announcement && <span key={announcement.id}>{announcement.text}</span>}
    </div>
  );
}
