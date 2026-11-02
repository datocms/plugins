import { act, fireEvent, render, screen } from '@testing-library/react';
import type { RenderModalCtx, RenderPageCtx } from 'datocms-plugin-sdk';
import Canvas from 'datocms-react-ui/Canvas';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { makeCtx, renderWithCanvas } from '../test/renderWithCanvas';
import ErrorBoundary from './ErrorBoundary';

let shouldThrow = true;

function Flaky() {
  if (shouldThrow) {
    throw new Error('Boom: the frame failed');
  }
  return <p>Rendered content</p>;
}

describe('ErrorBoundary', () => {
  afterEach(() => {
    shouldThrow = true;
    vi.restoreAllMocks();
  });

  it('shows the error with a way to try again', () => {
    vi.spyOn(console, 'error').mockImplementation(() => {});

    renderWithCanvas(
      <ErrorBoundary>
        <Flaky />
      </ErrorBoundary>,
    );

    expect(screen.getByText('Something went wrong')).toBeInTheDocument();
    expect(screen.getByText('Boom: the frame failed')).toBeInTheDocument();
    expect(
      screen.queryByRole('link', { name: 'Open plugin settings' }),
    ).not.toBeInTheDocument();

    shouldThrow = false;
    fireEvent.click(screen.getByRole('button', { name: 'Try again' }));

    expect(screen.getByText('Rendered content')).toBeInTheDocument();
  });

  it('sizes a frame that had no auto-resizer, and closes its dialog', () => {
    vi.spyOn(console, 'error').mockImplementation(() => {});
    const ctx = makeCtx<RenderModalCtx>();
    const onClose = vi.fn();

    // The progress modal frame: the component that sized it threw in its
    // first render, so only the fallback can start the auto-resizer.
    render(
      <Canvas ctx={ctx} noAutoResizer>
        <ErrorBoundary onClose={onClose}>
          <Flaky />
        </ErrorBoundary>
      </Canvas>,
    );

    expect(ctx.startAutoResizer).toHaveBeenCalled();

    fireEvent.click(screen.getByRole('button', { name: 'Close' }));

    expect(onClose).toHaveBeenCalledTimes(1);
  });

  it('closes its dialog on Escape, as the content that failed did', () => {
    vi.spyOn(console, 'error').mockImplementation(() => {});
    const onClose = vi.fn();

    renderWithCanvas(
      <ErrorBoundary onClose={onClose}>
        <Flaky />
      </ErrorBoundary>,
      makeCtx<RenderModalCtx>(),
    );

    fireEvent.keyDown(document.body, { key: 'Escape', code: 'Escape' });

    expect(onClose).toHaveBeenCalledTimes(1);
  });

  it('is the whole page, in its own main, for a full-height page', () => {
    vi.spyOn(console, 'error').mockImplementation(() => {});

    renderWithCanvas(
      <ErrorBoundary page>
        <Flaky />
      </ErrorBoundary>,
      makeCtx<RenderPageCtx>(),
    );

    // The page's own Main was in the component that failed: the fallback
    // brings the landmark, and its title is the page's title.
    const main = screen.getByRole('main');
    expect(main).toContainElement(
      screen.getByRole('heading', { level: 1, name: 'Something went wrong' }),
    );
    expect(main.querySelector('.blank-slate--area')).not.toBeNull();

    shouldThrow = false;
    fireEvent.click(screen.getByRole('button', { name: 'Try again' }));

    expect(screen.getByText('Rendered content')).toBeInTheDocument();
    expect(screen.queryByRole('main')).toBeNull();
  });

  it('is an inline blank slate with no landmark out of a page', () => {
    vi.spyOn(console, 'error').mockImplementation(() => {});

    renderWithCanvas(
      <ErrorBoundary>
        <Flaky />
      </ErrorBoundary>,
    );

    expect(screen.queryByRole('main')).toBeNull();
    expect(screen.queryByRole('heading')).toBeNull();
    expect(screen.getByText('Something went wrong')).toBeInTheDocument();
  });

  it('keeps the focus on "Try again" when the frame fails again', () => {
    vi.spyOn(console, 'error').mockImplementation(() => {});

    renderWithCanvas(
      <ErrorBoundary>
        <Flaky />
      </ErrorBoundary>,
    );

    const first = screen.getByRole('button', { name: 'Try again' });
    act(() => first.focus());
    fireEvent.click(first);

    // React mounts a new fallback: its "Try again" takes the focus.
    const second = screen.getByRole('button', { name: 'Try again' });
    expect(second).not.toBe(first);
    expect(document.activeElement).toBe(second);
  });

  it('leaves the focus where it is when a later error shows the fallback', () => {
    vi.spyOn(console, 'error').mockImplementation(() => {});
    shouldThrow = false;

    const { rerender } = renderWithCanvas(
      <ErrorBoundary>
        <Flaky />
      </ErrorBoundary>,
    );

    shouldThrow = true;
    rerender(
      <ErrorBoundary>
        <Flaky />
      </ErrorBoundary>,
    );

    expect(screen.getByText('Something went wrong')).toBeInTheDocument();
    expect(document.activeElement).toBe(document.body);
  });

  it('shows no Close button out of a dialog', () => {
    vi.spyOn(console, 'error').mockImplementation(() => {});

    renderWithCanvas(
      <ErrorBoundary>
        <Flaky />
      </ErrorBoundary>,
    );

    expect(screen.queryByRole('button', { name: 'Close' })).toBeNull();
  });
});
