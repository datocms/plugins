import { type ComponentType, StrictMode } from 'react';
import { createRoot, type Root } from 'react-dom/client';

let root: Root | null = null;

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
      <Component ctx={ctx} />
    </StrictMode>,
  );
}
