import type {
  RenderAssetSourceCtx,
  RenderConfigScreenCtx,
} from 'datocms-plugin-sdk';
import Canvas from 'datocms-react-ui/Canvas';
import { LucideProvider } from 'lucide-react';
import type React from 'react';
import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { TEXTS } from '../texts';

const container = document.getElementById('root');

if (!container) {
  throw new Error('Unable to find the root container for the plugin UI.');
}

const root = createRoot(container);

// Lucide draws its icons at 24px; the kit's icons are 1em, the size of the
// text around them. The provider's type takes only a number, but the size goes
// straight to the width and height of the svg.
const ICON_SIZE = '1em' as unknown as number;

type CanvasCtx = RenderAssetSourceCtx | RenderConfigScreenCtx;

function render(component: React.ReactNode): void {
  root.render(<StrictMode>{component}</StrictMode>);
}

export function renderWithCanvas(
  component: React.ReactNode,
  ctx: CanvasCtx,
): void {
  render(
    <Canvas ctx={ctx} texts={TEXTS}>
      <LucideProvider size={ICON_SIZE}>{component}</LucideProvider>
    </Canvas>,
  );
}
