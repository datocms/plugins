import type { JSX, ReactNode, SVGProps } from 'react';

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
  return (
    typeof value === 'string' &&
    (ICON_KEYS as readonly string[]).includes(value)
  );
}

export type IconProps = SVGProps<SVGSVGElement>;
export type IconComponent = (props: IconProps) => JSX.Element;

// The frame of every icon: a 24-unit stroke drawing in the current color.
// The icon is 1em, like the icons of the kit, so the place around it sizes
// it. The kit fills every svg (`svg { fill: … }` in styles.css, and
// `fill: currentColor` in some components), which beats the fill attribute:
// the inline style keeps these stroke drawings unfilled.
function Icon({
  children,
  style,
  ...props
}: IconProps & { children: ReactNode }): JSX.Element {
  return (
    <svg
      viewBox="0 0 24 24"
      width="1em"
      height="1em"
      fill="none"
      stroke="currentColor"
      strokeWidth={2}
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
      {...props}
      style={{ fill: 'none', ...style }}
    >
      {children}
    </svg>
  );
}

// The add and close icons are bold
export function AddIcon(props: IconProps): JSX.Element {
  return (
    <Icon strokeWidth={2.5} {...props}>
      <path d="M12 5v14" />
      <path d="M5 12h14" />
    </Icon>
  );
}

export function CloseIcon(props: IconProps): JSX.Element {
  return (
    <Icon strokeWidth={2.5} {...props}>
      <path d="M6 6l12 12" />
      <path d="M18 6L6 18" />
    </Icon>
  );
}

export function ChatIcon(props: IconProps): JSX.Element {
  return (
    <Icon {...props}>
      <path d="M21 15a2 2 0 01-2 2H7l-4 4V5a2 2 0 012-2h14a2 2 0 012 2z" />
    </Icon>
  );
}

export function SendIcon(props: IconProps): JSX.Element {
  return (
    <Icon {...props}>
      <path d="M5 12h14" />
      <path d="M13 6l6 6-6 6" />
    </Icon>
  );
}

export function AtIcon(props: IconProps): JSX.Element {
  return (
    <Icon {...props}>
      <circle cx="12" cy="12" r="4" />
      <path d="M16 8v5a3 3 0 006 0v-1a10 10 0 10-3.92 7.94" />
    </Icon>
  );
}

export function BoltIcon(props: IconProps): JSX.Element {
  return (
    <Icon {...props}>
      <path d="M13 2L4 14h6l-1 8 10-12h-7l1-8z" />
    </Icon>
  );
}

export function SettingsIcon(props: IconProps): JSX.Element {
  return (
    <Icon {...props}>
      <circle cx="12" cy="12" r="3" />
      <path d="M19.4 15a1.65 1.65 0 00.33 1.82l.06.06a2 2 0 01-2.83 2.83l-.06-.06a1.65 1.65 0 00-1.82-.33 1.65 1.65 0 00-1 1.51V21a2 2 0 01-4 0v-.09A1.65 1.65 0 009 19.4a1.65 1.65 0 00-1.82.33l-.06.06a2 2 0 01-2.83-2.83l.06-.06a1.65 1.65 0 00.33-1.82 1.65 1.65 0 00-1.51-1H3a2 2 0 010-4h.09A1.65 1.65 0 004.6 9a1.65 1.65 0 00-.33-1.82l-.06-.06a2 2 0 012.83-2.83l.06.06a1.65 1.65 0 001.82.33H9a1.65 1.65 0 001-1.51V3a2 2 0 014 0v.09a1.65 1.65 0 001 1.51 1.65 1.65 0 001.82-.33l.06-.06a2 2 0 012.83 2.83l-.06.06a1.65 1.65 0 00-.33 1.82V9a1.65 1.65 0 001.51 1H21a2 2 0 010 4h-.09a1.65 1.65 0 00-1.51 1z" />
    </Icon>
  );
}

export function RecordIcon(props: IconProps): JSX.Element {
  return (
    <Icon {...props}>
      <path d="M14 2H6a2 2 0 00-2 2v16a2 2 0 002 2h12a2 2 0 002-2V8z" />
      <path d="M14 2v6h6" />
    </Icon>
  );
}

// An icon component for each key of iconPaths: the icons of the starters
function pathIcon(key: IconKey): IconComponent {
  function PathIcon(props: IconProps): JSX.Element {
    return <Icon {...props}>{iconPaths[key]}</Icon>;
  }
  return PathIcon;
}

export const STARTER_ICONS: Record<IconKey, IconComponent> = {
  edit: pathIcon('edit'),
  title: pathIcon('title'),
  bullets: pathIcon('bullets'),
  check: pathIcon('check'),
  slug: pathIcon('slug'),
  search: pathIcon('search'),
  calendar: pathIcon('calendar'),
  sparkle: pathIcon('sparkle'),
  tag: pathIcon('tag'),
  image: pathIcon('image'),
};
