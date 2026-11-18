import { LucideProvider } from 'lucide-react';
import { type ComponentType, StrictMode } from 'react';
import { createRoot, type Root } from 'react-dom/client';

let root: Root | null = null;

// Lucide draws its icons at 24px; the kit's icons are 1em, the size of the
// text around them. The provider's type takes only a number, but the size goes
// straight to the width and height of the svg.
const ICON_SIZE = '1em' as unknown as number;

function getRoot(): Root {
  if (!root) {
    const container = document.getElementById('root');
    if (!container) {
      throw new Error('Root element not found');
    }
    root = createRoot(container);
  }
  return root;
}

export function renderEntrypoint<Ctx>(
  Component: ComponentType<{ ctx: Ctx }>,
  ctx: Ctx,
): void {
  getRoot().render(
    <StrictMode>
      <LucideProvider size={ICON_SIZE}>
        <Component ctx={ctx} />
      </LucideProvider>
    </StrictMode>,
  );
}
