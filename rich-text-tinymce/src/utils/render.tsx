import type React from 'react';
import { StrictMode } from 'react';
import { createRoot, type Root } from 'react-dom/client';

let root: Root | undefined;

export function render(component: React.ReactNode): void {
  const container = document.getElementById('root');
  if (!container) {
    return;
  }
  root ??= createRoot(container);
  root.render(<StrictMode>{component}</StrictMode>);
}
