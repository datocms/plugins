import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';

const container = document.getElementById('root');
const root = createRoot(container!);

/** Render the plugin entry component with React strict mode enabled. */
export function render(component: React.ReactNode): void {
  root.render(<StrictMode>{component}</StrictMode>);
}
