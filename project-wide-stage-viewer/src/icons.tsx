import {
  faArrowsRotate,
  faCircleExclamation,
  faListCheck,
  type IconDefinition,
} from '@fortawesome/free-solid-svg-icons';
import type { JSX, SVGProps } from 'react';
import { iconByName } from './lib/icons';
import { DEFAULT_ICON } from './lib/parameters';

// Font Awesome glyphs, 1em like the kit's own icons (a button does not size
// its icon; a blank slate does), painted with the color of the text.

export type SvgIcon = (props: SVGProps<SVGSVGElement>) => JSX.Element;

/** A component that draws a Font Awesome glyph as an `svg` */
export function faIcon(definition: IconDefinition): SvgIcon {
  const [width, height, , , pathData] = definition.icon;
  const paths = Array.isArray(pathData) ? pathData : [pathData];

  function FaIcon(props: SVGProps<SVGSVGElement>) {
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

  return FaIcon;
}

// One component for each glyph, so that its identity stays the same between
// renders
const COMPONENTS = new Map<IconDefinition, SvgIcon>();

/** The component of a glyph, made once */
export function iconComponent(definition: IconDefinition): SvgIcon {
  const cached = COMPONENTS.get(definition);
  if (cached) {
    return cached;
  }
  const component = faIcon(definition);
  COMPONENTS.set(definition, component);
  return component;
}

/** Do again: load the records or the workflows again */
export const RefreshIcon = iconComponent(faArrowsRotate);

/** The status of an error */
export const CircleExclamationIcon = iconComponent(faCircleExclamation);

/** The stages of a workflow: the default icon of a stage page */
export const ListCheckIcon = iconComponent(faListCheck);

/**
 * The icon of a stage page: the one of its item in the content sidebar. A name
 * that the plugin does not offer shows the default icon.
 */
export function EntryIcon({
  name,
  ...props
}: { name?: string } & SVGProps<SVGSVGElement>) {
  const Icon = iconComponent(iconByName(name ?? DEFAULT_ICON) ?? faListCheck);
  return <Icon {...props} />;
}
