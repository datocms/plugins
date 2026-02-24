import { type ReactNode, StrictMode } from 'react';
import { createRoot } from 'react-dom/client';

const container = document.getElementById('root');
if (!container) {
  throw new Error('Root container element "#root" was not found');
}

const root = createRoot(container);

export function render(component: ReactNode): void {
  root.render(<StrictMode>{component}</StrictMode>);
}
