import type { ReactNode } from 'react';
import { createRoot, type Root } from 'react-dom/client';

let root: Root | undefined;

export function render(node: ReactNode): void {
  const container = document.getElementById('root');

  if (!container) {
    throw new Error('Missing #root element');
  }

  root ??= createRoot(container);
  root.render(node);
}
