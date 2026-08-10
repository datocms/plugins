import {
  cleanup,
  fireEvent,
  render,
  screen,
  within,
} from '@testing-library/react';
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
  it('renders a native, accessible record-model menu with searchable rows', () => {
    render(
      <RecordModelSelectorDropdown
        models={models}
        onClose={vi.fn()}
        onSelect={vi.fn()}
      />,
    );

    const menu = screen.getByRole('menu', { name: 'Records' });
    const items = within(menu).getAllByRole('menuitem');
    const search = screen.getByRole('textbox', {
      name: 'Search record models',
    });

    expect(items).toHaveLength(3);
    expect(items.map((item) => item.textContent)).toEqual([
      'Article$article',
      'Page$page',
      'Product$product',
    ]);
    expect(items.every((item) => item.querySelector('svg'))).toBe(true);
    expect(search).toHaveAttribute('autocomplete', 'off');
    expect(search).toHaveAttribute('spellcheck', 'false');
  });

  it('uses the hovered row for keyboard selection', async () => {
    const user = userEvent.setup();
    const onSelect = vi.fn();
    render(
      <RecordModelSelectorDropdown
        models={models}
        onClose={vi.fn()}
        onSelect={onSelect}
      />,
    );

    fireEvent.mouseEnter(screen.getByRole('menuitem', { name: 'Page$page' }));
    await user.keyboard('{Enter}');

    expect(onSelect).toHaveBeenCalledWith(models[1]);
  });

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
