import { cleanup, render } from '@testing-library/react';
import type { RenderModalCtx } from 'datocms-plugin-sdk';
import Canvas from 'datocms-react-ui/Canvas';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { makeCtx } from '../test/renderWithCanvas';
import { useFrameHeight } from './useFrameHeight';

function Probe({ ctx }: { ctx: RenderModalCtx }) {
  const ref = useFrameHeight(ctx);
  return <div ref={ref}>Content</div>;
}

describe('useFrameHeight', () => {
  afterEach(() => {
    cleanup();
    vi.unstubAllGlobals();
  });

  it('reports the Canvas height, and hands the sizing back on unmount', () => {
    let onResize: (() => void) | undefined;
    const observe = vi.fn();
    const disconnect = vi.fn();
    vi.stubGlobal(
      'ResizeObserver',
      class {
        constructor(callback: () => void) {
          onResize = callback;
        }
        observe = observe;
        unobserve() {}
        disconnect = disconnect;
      },
    );
    const ctx = makeCtx<RenderModalCtx>();

    const { unmount } = render(
      <Canvas ctx={ctx} noAutoResizer>
        <Probe ctx={ctx} />
      </Canvas>,
    );

    expect(ctx.stopAutoResizer).toHaveBeenCalledTimes(1);
    expect(observe).toHaveBeenCalledTimes(1);
    expect(observe.mock.calls[0][0]).toHaveAttribute('data-color-scheme');
    onResize?.();
    expect(ctx.updateHeight).toHaveBeenCalledWith(0);
    expect(ctx.startAutoResizer).not.toHaveBeenCalled();

    unmount();

    expect(disconnect).toHaveBeenCalledTimes(1);
    expect(ctx.startAutoResizer).toHaveBeenCalledTimes(1);
  });
});
