/**
 * Render utility for mounting React components in the DatoCMS plugin environment.
 * Uses React 18's createRoot API with StrictMode for better development experience.
 */
import { LucideProvider } from 'lucide-react';
import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';

// Create root once to avoid multiple root instances
const container = document.getElementById('root');
if (!container) {
  throw new Error('Root element not found');
}
const root = createRoot(container);

// Lucide draws its icons at 24px; the kit's icons are 1em, the size of the
// text around them. The provider's type takes only a number, but the size goes
// straight to the width and height of the svg.
const ICON_SIZE = '1em' as unknown as number;

/**
 * Renders a React component into the plugin's root container.
 * Note: Error boundaries should be added at the component level to have access to ctx
 *
 * @param component - The React component to render
 */
export function render(component: React.ReactNode): void {
  root.render(
    <StrictMode>
      <LucideProvider size={ICON_SIZE}>{component}</LucideProvider>
    </StrictMode>,
  );
}
