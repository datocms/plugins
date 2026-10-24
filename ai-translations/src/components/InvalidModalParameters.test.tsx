import { fireEvent, screen } from '@testing-library/react';
import type { RenderModalCtx } from 'datocms-plugin-sdk';
import { describe, expect, it, vi } from 'vitest';
import { makeCtx, renderWithCanvas } from '../test/renderWithCanvas';
import InvalidModalParameters from './InvalidModalParameters';

function renderSlate() {
  const onClose = vi.fn();
  renderWithCanvas(
    <InvalidModalParameters onClose={onClose} />,
    makeCtx<RenderModalCtx>(),
  );
  return onClose;
}

describe('InvalidModalParameters', () => {
  it('closes the dialog with its Close button', () => {
    const onClose = renderSlate();

    expect(screen.getByText("Couldn't open this window")).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'Close' }));

    expect(onClose).toHaveBeenCalledTimes(1);
  });

  it('closes the dialog on Escape, as the host draws no cross', () => {
    const onClose = renderSlate();

    fireEvent.keyDown(document.body, { key: 'Escape', code: 'Escape' });

    expect(onClose).toHaveBeenCalledTimes(1);
  });
});
