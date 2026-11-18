import {
  CircleAlert,
  ExternalLink,
  Eye,
  Globe,
  icons,
  type LucideIcon,
  Maximize,
  Monitor,
  PanelRight,
  RefreshCw,
  Ruler,
  TriangleAlert,
} from 'lucide-react';

// The plugin's icons, from Lucide. They are drawn at 1em, the size of the
// text around them (see the LucideProvider in utils/render.tsx).
export const ErrorIcon = CircleAlert;
export const OpenInNewTabIcon = ExternalLink;
export const EyeIcon = Eye;
export const GlobeIcon = Globe;
export const FitIcon = Maximize;
/** The icon of a viewport preset whose icon name is unknown */
export const DisplayIcon = Monitor;
/** The sidebar of the record form */
export const SidebarIcon = PanelRight;
export const ReloadIcon = RefreshCw;
export const CustomSizeIcon = Ruler;
export const WarningIcon = TriangleAlert;

type IconComponent = LucideIcon;

const iconsByPascalName: Record<string, IconComponent> = icons;

/** 'tablet-smartphone' → 'TabletSmartphone', the key of the icon in Lucide */
function toPascalName(name: string) {
  return name
    .split('-')
    .map((part) => part.charAt(0).toUpperCase() + part.slice(1))
    .join('');
}

/** 'TabletSmartphone' → 'tablet-smartphone', the name that a viewport stores */
function toKebabName(pascalName: string) {
  return pascalName
    .replace(/([a-z0-9])([A-Z])/g, '$1-$2')
    .replace(/([A-Z])([A-Z])/g, '$1-$2')
    .replace(/([a-zA-Z])(\d)/g, '$1-$2')
    .toLowerCase();
}

/**
 * The viewports saved before the icons came from Lucide store the name of a
 * Font Awesome solid icon. The device icons (and their aliases), the ones
 * the select suggested and the defaults, keep showing the same device. A
 * Font Awesome name that Lucide has too (laptop, tablet, tv) needs no entry.
 */
const LEGACY_ICON_NAMES = new Map<string, string>(
  Object.entries({
    mobile: 'smartphone',
    'mobile-alt': 'smartphone',
    'mobile-android': 'smartphone',
    'mobile-android-alt': 'smartphone',
    'mobile-button': 'smartphone',
    'mobile-phone': 'smartphone',
    'mobile-retro': 'smartphone',
    'mobile-screen': 'smartphone',
    'mobile-screen-button': 'smartphone',
    'tablet-alt': 'tablet',
    'tablet-android': 'tablet',
    'tablet-button': 'tablet',
    'tablet-screen': 'tablet',
    'tablet-screen-button': 'tablet',
    'laptop-code': 'laptop',
    desktop: 'monitor',
    'desktop-alt': 'monitor',
    display: 'monitor',
    'tv-alt': 'tv',
  }),
);

/**
 * The Lucide icon with this name, or with the Lucide name of a legacy Font
 * Awesome device name, or undefined when there is none. The same name
 * always gives the same component, so it can be rendered on every render.
 */
export function iconByName(name: string): IconComponent | undefined {
  if (!name) {
    return undefined;
  }

  const legacyName = LEGACY_ICON_NAMES.get(name);

  return (
    iconsByPascalName[toPascalName(name)] ??
    (legacyName ? iconsByPascalName[toPascalName(legacyName)] : undefined)
  );
}

/** Whether an icon has this name (a legacy Font Awesome device name too) */
export function isValidIconName(name: string): boolean {
  return Boolean(iconByName(name));
}

/**
 * The icon select shows only the first matches of a search: the query
 * narrows the list
 */
export const ICON_RESULTS_LIMIT = 36;

let iconNames: string[] | undefined;

/** The names that a viewport stores: the Lucide icons in kebab case, sorted */
export function allIconNames(): string[] {
  if (!iconNames) {
    iconNames = Object.keys(iconsByPascalName).map(toKebabName).sort();
  }

  return iconNames;
}

/** The icons of devices, which the icon select lists before a search */
const DEVICE_ICON_NAMES = [
  'smartphone',
  'tablet',
  'tablet-smartphone',
  'laptop',
  'monitor',
  'monitor-smartphone',
  'computer',
  'tv',
];

/**
 * The icons that the select lists before a search: the current one (a
 * legacy name stays as it is), then the devices that don't have the same
 * glyph
 */
export function suggestedIconNames(current: string): string[] {
  const currentIcon = iconByName(current);

  return [
    ...(currentIcon ? [current] : []),
    ...DEVICE_ICON_NAMES.filter((name) => iconByName(name) !== currentIcon),
  ];
}

/**
 * The icon names that contain the query, in lower case: first the names
 * that start with it, then the names with a word that starts with it, then
 * the others, each group in alphabetical order
 */
export function searchIconNames(query: string): string[] {
  if (!query.trim()) {
    return allIconNames();
  }

  const lowerCaseQuery = query.toLowerCase();
  const rank = (name: string) => {
    if (name.startsWith(lowerCaseQuery)) {
      return 0;
    }

    return name.includes(`-${lowerCaseQuery}`) ? 1 : 2;
  };

  // The sort is stable: each group keeps the alphabetical order
  return allIconNames()
    .filter((name) => name.includes(lowerCaseQuery))
    .sort((a, b) => rank(a) - rank(b));
}
