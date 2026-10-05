/** Tiny DOM helpers for the host page (no React there, on purpose). */

type ElementProps = {
  className?: string;
  text?: string;
  attributes?: Record<string, string>;
  style?: Record<string, string>;
};

export function el<K extends keyof HTMLElementTagNameMap>(
  tag: K,
  props: ElementProps = {},
  children: Array<Node | string> = [],
): HTMLElementTagNameMap[K] {
  const node = document.createElement(tag);
  if (props.className) {
    node.className = props.className;
  }
  if (props.text !== undefined) {
    node.textContent = props.text;
  }
  for (const [name, value] of Object.entries(props.attributes ?? {})) {
    node.setAttribute(name, value);
  }
  for (const [name, value] of Object.entries(props.style ?? {})) {
    node.style.setProperty(name, value);
  }
  node.append(...children);
  return node;
}

export function button(
  text: string,
  onClick: () => void,
  className = 'hx-button',
): HTMLButtonElement {
  const node = el('button', {
    className,
    text,
    attributes: { type: 'button' },
  });
  node.addEventListener('click', onClick);
  return node;
}

/** JSON for the inspector; `undefined` and functions read as such. */
export function formatValue(value: unknown): string {
  if (value === undefined) {
    return 'undefined';
  }
  try {
    return JSON.stringify(value, null, 2) ?? String(value);
  } catch {
    return String(value);
  }
}
