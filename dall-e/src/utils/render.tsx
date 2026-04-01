import type React from 'react';
import { StrictMode } from 'react';
import type {
  RenderAssetSourceCtx,
  RenderConfigScreenCtx,
} from 'datocms-plugin-sdk';
import { Canvas } from 'datocms-react-ui';
import { createRoot } from 'react-dom/client';

const container = document.getElementById('root');

if (!container) {
  throw new Error('Unable to find the root container for the plugin UI.');
}

const root = createRoot(container);

type CanvasCtx = RenderAssetSourceCtx | RenderConfigScreenCtx;

function render(component: React.ReactNode): void {
  root.render(<StrictMode>{component}</StrictMode>);
}

export function renderWithCanvas(
  component: React.ReactNode,
  ctx: CanvasCtx,
): void {
  render(<Canvas ctx={ctx}>{component}</Canvas>);
}
