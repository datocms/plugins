import type { ComponentType } from 'react';

type Entrypoint<Ctx> = { default: ComponentType<{ ctx: Ctx }> };

export const LOAD_ERROR_MESSAGE =
  "Couldn't load the Shopify plugin. Reload the page to try again.";

let latestCall = 0;
let rendered = false;

/**
 * Plain DOM, because the failure may be React or the UI kit itself. The SDK
 * sets `color-scheme` on <html>, so the system colors follow dark mode.
 */
function showLoadError(): void {
  const container = document.getElementById('root');
  if (!container) return;
  const message = document.createElement('p');
  message.setAttribute('role', 'alert');
  message.textContent = LOAD_ERROR_MESSAGE;
  message.style.cssText =
    'margin: 0; font-family: system-ui, sans-serif; font-size: 14px; line-height: 1.4; color: CanvasText;';
  container.replaceChildren(message);
}

/**
 * Renders an entrypoint once its chunk and the React DOM chunk have loaded.
 * Each DatoCMS iframe runs a single hook, so loading screens on demand keeps
 * the UI out of the hidden hooks iframe and the other screens out of each
 * one. The SDK calls a render hook again on every ctx change and the chunks
 * can settle out of order, so only the latest call renders. If a chunk fails
 * to load (a network blip, or a stale deploy), the frame says so instead of
 * staying blank.
 */
export function mount<Ctx>(
  entrypoint: Promise<Entrypoint<Ctx>>,
  ctx: Ctx,
): void {
  latestCall += 1;
  const call = latestCall;
  Promise.all([import('./render'), entrypoint])
    .then(([{ renderEntrypoint }, { default: Component }]) => {
      if (call !== latestCall) return;
      renderEntrypoint(Component, ctx);
      rendered = true;
    })
    .catch((error: unknown) => {
      if (call !== latestCall) return;
      console.error('Shopify plugin: a screen failed to load.', error);
      // Once React owns the root, keep the last good screen on display.
      if (!rendered) showLoadError();
    });
}
