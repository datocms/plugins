import { StrictMode } from 'react';
import { createRoot, type Root } from 'react-dom/client';

let root: Root | null = null;
let rootContainer: HTMLElement | null = null;

function getRootContainer(): HTMLElement {
  const container = document.getElementById('root');
  if (!container) {
    throw new Error('Unable to render plugin: root container "#root" was not found.');
  }

  return container;
}

export function render(component: React.ReactNode): void {
  const container = getRootContainer();

  if (!root || rootContainer !== container) {
    root = createRoot(container);
    rootContainer = container;
  }

  root.render(<StrictMode>{component}</StrictMode>);
}
