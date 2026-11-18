import { LucideProvider } from 'lucide-react';
import type { ReactNode } from 'react';
import { createRoot, type Root } from 'react-dom/client';

// Lucide draws its icons at 24px; the kit's icons are 1em, the size of the
// text around them. The provider's type takes only a number, but the size goes
// straight to the width and height of the svg.
const ICON_SIZE = '1em' as unknown as number;

let root: Root | undefined;

export function render(node: ReactNode): void {
  const container = document.getElementById('root');

  if (!container) {
    throw new Error('Missing #root element');
  }

  root ??= createRoot(container);
  root.render(<LucideProvider size={ICON_SIZE}>{node}</LucideProvider>);
}
