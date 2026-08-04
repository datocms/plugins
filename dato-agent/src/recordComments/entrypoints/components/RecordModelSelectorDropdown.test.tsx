import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, describe, expect, it, vi } from 'vitest';
import RecordModelSelectorDropdown from './RecordModelSelectorDropdown';

const models = [
  {
    id: 'article',
    apiKey: 'article',
    name: 'Article',
    isBlockModel: false,
  },
  {
    id: 'page',
    apiKey: 'page',
    name: 'Page',
    isBlockModel: false,
  },
  {
    id: 'product',
    apiKey: 'product',
    name: 'Product',
    isBlockModel: false,
  },
];

afterEach(cleanup);

describe('RecordModelSelectorDropdown', () => {
  it('resets keyboard selection when a query narrows the results', async () => {
    const user = userEvent.setup();
    const onSelect = vi.fn();
    render(
      <RecordModelSelectorDropdown
        models={models}
        onClose={vi.fn()}
        onSelect={onSelect}
      />,
    );
    const search = screen.getByRole('textbox', {
      name: 'Search record models',
    });

    await user.keyboard('{ArrowDown}{ArrowDown}');
    await user.type(search, 'art');
    await user.keyboard('{Enter}');

    expect(onSelect).toHaveBeenCalledWith(models[0]);
  });

  it('does not trap Tab when filtering has no results', async () => {
    const user = userEvent.setup();
    const onSelect = vi.fn();
    render(
      <RecordModelSelectorDropdown
        models={models}
        onClose={vi.fn()}
        onSelect={onSelect}
      />,
    );
    const search = screen.getByRole('textbox', {
      name: 'Search record models',
    });

    await user.type(search, 'missing');
    expect(fireEvent.keyDown(search, { key: 'Tab' })).toBe(true);
    expect(onSelect).not.toHaveBeenCalled();
  });

  it('ignores selection keys during IME composition', () => {
    const onSelect = vi.fn();
    render(
      <RecordModelSelectorDropdown
        models={models}
        onClose={vi.fn()}
        onSelect={onSelect}
      />,
    );
    const search = screen.getByRole('textbox', {
      name: 'Search record models',
    });

    fireEvent.keyDown(search, { key: 'Enter', isComposing: true });
    expect(onSelect).not.toHaveBeenCalled();
  });
});
