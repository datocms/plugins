import {
  type AbstractElement,
  type IconDefinition,
  icon as renderIcon,
} from '@fortawesome/fontawesome-svg-core';
import { createElement, type ReactElement } from 'react';

type Props = {
  icon: IconDefinition;
};

// Maps an SVG attribute to its React prop name (`class` -> `className`,
// `stroke-width` -> `strokeWidth`), as @fortawesome/react-fontawesome does.
function toPropName(attribute: string): string {
  if (attribute === 'class') {
    return 'className';
  }

  if (attribute.startsWith('aria-') || attribute.startsWith('data-')) {
    return attribute.toLowerCase();
  }

  const camelized = attribute.replace(/[-_\s]+(.)?/g, (_match, chr?: string) =>
    chr ? chr.toUpperCase() : '',
  );

  return camelized.charAt(0).toLowerCase() + camelized.slice(1);
}

function toReactElement(element: AbstractElement): ReactElement {
  const props: Record<string, unknown> = {};

  for (const [attribute, value] of Object.entries(element.attributes ?? {})) {
    props[toPropName(attribute)] = value;
  }

  return createElement(
    element.tag,
    props,
    ...(element.children ?? []).map(toReactElement),
  );
}

// Renders a Font Awesome icon as the same inline SVG that
// @fortawesome/react-fontawesome 0.1 produced. Every supported release of that
// package requires React 18, so the plugin renders the icon itself through
// fontawesome-svg-core, which also injects the Font Awesome CSS as before.
export function FontAwesomeIcon({ icon }: Props): ReactElement | null {
  const rendered = renderIcon(icon);

  if (!rendered) {
    return null;
  }

  return toReactElement(rendered.abstract[0]);
}
