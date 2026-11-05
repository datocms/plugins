import {
  findIconDefinition,
  type IconName,
  library,
} from '@fortawesome/fontawesome-svg-core';
import {
  faArrowsRotate,
  faArrowUpRightFromSquare,
  faCircleExclamation,
  faDisplay,
  faEllipsisVertical,
  faExpand,
  faEye,
  faGlobe,
  faRuler,
  fas,
  faTableColumns,
  faTriangleExclamation,
} from '@fortawesome/free-solid-svg-icons';
import snakeCase from 'lodash-es/snakeCase';
import type { JSX, SVGProps } from 'react';

// The viewport presets store the name of a Font Awesome solid icon (aliases
// such as 'mobile-alt' included), so the whole solid set is looked up by name
library.add(fas);

type IconComponent = (props: SVGProps<SVGSVGElement>) => JSX.Element;

type IconSource = {
  iconName: string;
  icon: [number, number, unknown, unknown, string | string[]];
};

/**
 * Turns a Font Awesome icon into a plain SVG component that the components
 * of datocms-react-ui accept as an `icon`. The icon is 1em, in the color of
 * the text: the place sizes it.
 */
function svgIcon(definition: IconSource): IconComponent {
  const [width, height, , , pathData] = definition.icon;
  const paths = Array.isArray(pathData) ? pathData : [pathData];

  function Icon(props: SVGProps<SVGSVGElement>) {
    return (
      <svg
        viewBox={`0 0 ${width} ${height}`}
        width="1em"
        height="1em"
        fill="currentColor"
        aria-hidden="true"
        focusable="false"
        {...props}
      >
        {paths.map((d) => (
          <path key={d} d={d} />
        ))}
      </svg>
    );
  }

  Icon.displayName = `Icon(${definition.iconName})`;

  return Icon;
}

export const ReloadIcon = svgIcon(faArrowsRotate);
export const EyeIcon = svgIcon(faEye);
export const OpenInNewTabIcon = svgIcon(faArrowUpRightFromSquare);
/** The "⋮" of a menu of actions */
export const ActionToggleIcon = svgIcon(faEllipsisVertical);
export const FitIcon = svgIcon(faExpand);
export const CustomSizeIcon = svgIcon(faRuler);
/** The icon of a viewport preset whose icon name is unknown */
export const DisplayIcon = svgIcon(faDisplay);
export const GlobeIcon = svgIcon(faGlobe);
/** The sidebar of the record form */
export const WarningIcon = svgIcon(faTriangleExclamation);
export const ErrorIcon = svgIcon(faCircleExclamation);

function lookUpIcon(name: string) {
  // The library is typed for its own icon names: an unknown name finds nothing
  return (
    findIconDefinition({ prefix: 'fas', iconName: name as IconName }) ??
    undefined
  );
}

const componentsByIconName = new Map<string, IconComponent>();
const componentsByName = new Map<string, IconComponent | undefined>();

/**
 * The component of the Font Awesome solid icon with this name (or alias), or
 * undefined when there is none. The same name always gives the same
 * component, so it can be rendered on every render.
 */
export function iconByName(name: string): IconComponent | undefined {
  if (componentsByName.has(name)) {
    return componentsByName.get(name);
  }

  const definition = name ? lookUpIcon(name) : undefined;
  let component: IconComponent | undefined;

  if (definition) {
    component = componentsByIconName.get(definition.iconName);
    if (!component) {
      component = svgIcon(definition);
      componentsByIconName.set(definition.iconName, component);
    }
  }

  componentsByName.set(name, component);

  return component;
}

/** Whether a Font Awesome solid icon has this name (or alias) */
export function isValidIconName(name: string): name is IconName {
  return Boolean(name && lookUpIcon(name));
}

/**
 * The icon select shows only the first matches of a search: the query
 * narrows the list
 */
export const ICON_RESULTS_LIMIT = 36;

let iconNames: string[] | undefined;

/**
 * The names that a viewport stores: the keys of the solid set in kebab case
 * (aliases included), without the few that the library can't find, sorted
 */
export function allIconNames(): string[] {
  if (!iconNames) {
    iconNames = Object.keys(fas)
      .map((key) => snakeCase(key.replace(/^fa/, '')).replace(/_/g, '-'))
      .filter((name) => isValidIconName(name))
      .sort();
  }

  return iconNames;
}

/** The icons of devices, which the icon select lists before a search */
const DEVICE_ICON_NAMES = [
  'mobile-screen-button',
  'mobile',
  'tablet-screen-button',
  'tablet',
  'laptop',
  'desktop',
  'display',
  'tv',
];

/**
 * The icons that the select lists before a search: the current one (an
 * alias stays as it is), then the devices that don't have the same glyph
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
export const SidebarIcon = svgIcon(faTableColumns);
