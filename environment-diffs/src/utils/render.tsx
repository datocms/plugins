import type { ReactNode } from 'react';
import { createRoot, type Root } from 'react-dom/client';

let root: Root | null = null;

export function render(node: ReactNode) {
  const element = document.getElementById('root');

  if (!element) {
    throw new Error('Root element not found');
  }

  if (!root) {
    root = createRoot(element);
  }

  root.render(node);
}
