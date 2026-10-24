/**
 * render.tsx
 * ----------
 * Mounts the content of a frame hook in the plugin's root element: in
 * StrictMode, inside the kit's Canvas (the root every frame needs) and the
 * plugin's ErrorBoundary, which is inside the Canvas so its fallback can use
 * the kit.
 */
import Canvas, { type BaseCtx } from 'datocms-react-ui/Canvas';
import { type ReactNode, StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import ErrorBoundary from '../components/ErrorBoundary';
import { PLUGIN_TEXTS } from './texts';

const container = document.getElementById('root');
if (!container) {
  throw new Error('Root element not found');
}
const root = createRoot(container);

export type RenderFrameOptions = {
  /** The frame sets its height itself (a full-height page). */
  noAutoResizer?: boolean;
  /**
   * The frame is a full-height page (renderPage): the error fallback is then
   * the whole page, in its own `Main`.
   */
  page?: boolean;
  /** The CMS path of the plugin settings, linked from the error fallback. */
  settingsPath?: string;
  /**
   * Closes a dialog with the value that a dismissal means to its caller: the
   * error fallback shows a "Close" button that calls it.
   */
  onClose?: () => void;
};

/**
 * Renders the content of a frame hook inside a Canvas with the hook's ctx.
 *
 * @param ctx - The ctx the hook received.
 * @param content - What the frame shows.
 * @param options - Canvas and error fallback options.
 */
export function renderFrame(
  ctx: BaseCtx,
  content: ReactNode,
  {
    noAutoResizer = false,
    page = false,
    settingsPath,
    onClose,
  }: RenderFrameOptions = {},
): void {
  root.render(
    <StrictMode>
      <Canvas ctx={ctx} noAutoResizer={noAutoResizer} texts={PLUGIN_TEXTS}>
        <ErrorBoundary
          page={page}
          settingsPath={settingsPath}
          onClose={onClose}
        >
          {content}
        </ErrorBoundary>
      </Canvas>
    </StrictMode>,
  );
}
