import { LucideProvider } from 'lucide-react';
import type React from 'react';
import { StrictMode } from 'react';
import { createRoot, type Root } from 'react-dom/client';

let root: Root | undefined;

// Lucide draws its icons at 24px; the kit's icons are 1em, the size of the
// text around them. The provider's type takes only a number, but the size goes
// straight to the width and height of the svg.
const ICON_SIZE = '1em' as unknown as number;

export function render(component: React.ReactNode): void {
  const container = document.getElementById('root');
  if (!container) {
    return;
  }
  root ??= createRoot(container);
  root.render(
    <StrictMode>
      <LucideProvider size={ICON_SIZE}>{component}</LucideProvider>
    </StrictMode>,
  );
}
