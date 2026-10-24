import {
  faArrowsRotate,
  faCalendar,
  faChevronLeft,
  faChevronRight,
  faCircleExclamation,
  faCube,
  faEye,
  faEyeSlash,
  type IconDefinition,
} from '@fortawesome/free-solid-svg-icons';
import type { SVGProps } from 'react';

type IconComponent = (props: SVGProps<SVGSVGElement>) => React.JSX.Element;

/**
 * Turns a Font Awesome icon into a plain SVG component that the components
 * of datocms-react-ui accept as an `icon`. The icon is 1em, in the color of
 * the text: the place sizes it.
 */
function svgIcon(definition: IconDefinition): IconComponent {
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

export const ChevronLeftIcon = svgIcon(faChevronLeft);
export const ChevronRightIcon = svgIcon(faChevronRight);
export const EyeIcon = svgIcon(faEye);
export const EyeSlashIcon = svgIcon(faEyeSlash);
export const CalendarIcon = svgIcon(faCalendar);
export const ModelIcon = svgIcon(faCube);
export const CircleExclamationIcon = svgIcon(faCircleExclamation);
export const RefreshIcon = svgIcon(faArrowsRotate);
