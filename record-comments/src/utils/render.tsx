import { LucideProvider } from 'lucide-react';
import { StrictMode } from 'react';
import { createRoot, type Root } from 'react-dom/client';

// Lucide draws its icons at 24px; the kit's icons are 1em, the size of the
// text around them. The provider's type takes only a number, but the size goes
// straight to the width and height of the svg.
const ICON_SIZE = '1em' as unknown as number;

let root: Root | null = null;
let rootContainer: HTMLElement | null = null;

function getRootContainer(): HTMLElement {
  const container = document.getElementById('root');
  if (!container) {
    throw new Error(
      'Unable to render plugin: root container "#root" was not found.',
    );
  }

  return container;
}

export function render(component: React.ReactNode): void {
  const container = getRootContainer();

  if (!root || rootContainer !== container) {
    root = createRoot(container);
    rootContainer = container;
  }

  root.render(
    <StrictMode>
      <LucideProvider size={ICON_SIZE}>{component}</LucideProvider>
    </StrictMode>,
  );
}
