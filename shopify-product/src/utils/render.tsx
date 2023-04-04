import React, { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';

export function render(component: React.ReactNode): void {
  const element = document.getElementById('root');
  const root = element && createRoot(element);

  root?.render(<StrictMode>{component}</StrictMode>);
}
