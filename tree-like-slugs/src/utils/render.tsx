import React, { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';

/** Cached React 18 root instance for the plugin container */
const container = document.getElementById('root');
const root = createRoot(container!);

/** Renders a React component into the plugin's root container */
export function render(component: React.ReactNode): void {
  root.render(<StrictMode>{component}</StrictMode>);
}
