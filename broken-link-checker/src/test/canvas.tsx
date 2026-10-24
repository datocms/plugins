import { type RenderOptions, render } from '@testing-library/react';
import Canvas, { type BaseCtx } from 'datocms-react-ui/Canvas';
import type { ReactElement, ReactNode } from 'react';
import { pageContext } from './fixtures';

type CanvasRenderOptions<Ctx extends BaseCtx> = Omit<
  RenderOptions,
  'wrapper'
> & {
  /** The hook's ctx; a page ctx from the fixtures by default. */
  ctx?: Ctx;
};

/**
 * Renders a component inside the real kit `Canvas`, as each entrypoint does
 * for its hook. `rerender` keeps the Canvas around the new content. The
 * auto-resizer stays off: jsdom has no layout to measure.
 */
export function renderInCanvas<Ctx extends BaseCtx = BaseCtx>(
  ui: ReactElement,
  { ctx, ...options }: CanvasRenderOptions<Ctx> = {},
) {
  const canvasCtx: BaseCtx = ctx ?? pageContext();
  function Wrapper({ children }: { children: ReactNode }) {
    return (
      <Canvas ctx={canvasCtx} noAutoResizer>
        {children}
      </Canvas>
    );
  }
  return { ...render(ui, { ...options, wrapper: Wrapper }), ctx: canvasCtx };
}
