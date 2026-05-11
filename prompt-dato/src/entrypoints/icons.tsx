import type { ReactNode } from 'react';

export type IconKey =
  | 'edit'
  | 'title'
  | 'bullets'
  | 'check'
  | 'slug'
  | 'search'
  | 'calendar'
  | 'sparkle'
  | 'tag'
  | 'image';

export const ICON_KEYS: readonly IconKey[] = [
  'edit',
  'title',
  'bullets',
  'check',
  'slug',
  'search',
  'calendar',
  'sparkle',
  'tag',
  'image',
];

export const iconPaths: Record<IconKey, ReactNode> = {
  edit: (
    <>
      <path d="M12 20h9" />
      <path d="M16.5 3.5a2.12 2.12 0 013 3L7 19l-4 1 1-4z" />
    </>
  ),
  title: (
    <>
      <path d="M4 7V4h16v3" />
      <path d="M9 20h6" />
      <path d="M12 4v16" />
    </>
  ),
  bullets: (
    <>
      <path d="M4 6h16" />
      <path d="M4 12h16" />
      <path d="M4 18h10" />
    </>
  ),
  check: <path d="M20 6L9 17l-5-5" />,
  slug: (
    <>
      <path d="M10 13a5 5 0 007 0l4-4a5 5 0 00-7-7l-1 1" />
      <path d="M14 11a5 5 0 00-7 0l-4 4a5 5 0 007 7l1-1" />
    </>
  ),
  search: (
    <>
      <circle cx="11" cy="11" r="7" />
      <path d="M21 21l-4.3-4.3" />
    </>
  ),
  calendar: (
    <>
      <rect x="3" y="4" width="18" height="18" rx="2" />
      <path d="M16 2v4" />
      <path d="M8 2v4" />
      <path d="M3 10h18" />
    </>
  ),
  sparkle: (
    <>
      <path d="M12 3l1.6 4.2L18 9l-4.4 1.8L12 15l-1.6-4.2L6 9l4.4-1.8z" />
      <path d="M19 15l.6 1.6L21 17l-1.4.4L19 19l-.6-1.6L17 17l1.4-.4z" />
    </>
  ),
  tag: (
    <>
      <path d="M20.59 13.41L13.41 20.59a2 2 0 01-2.82 0L2 12V2h10l8.59 8.59a2 2 0 010 2.82z" />
      <line x1="7" y1="7" x2="7.01" y2="7" />
    </>
  ),
  image: (
    <>
      <rect x="3" y="3" width="18" height="18" rx="2" />
      <circle cx="8.5" cy="8.5" r="1.5" />
      <path d="M21 15l-5-5L5 21" />
    </>
  ),
};

export function isIconKey(value: unknown): value is IconKey {
  return typeof value === 'string' && (ICON_KEYS as readonly string[]).includes(value);
}
