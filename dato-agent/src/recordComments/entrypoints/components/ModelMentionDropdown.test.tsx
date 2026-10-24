import { cleanup, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { renderInCanvas } from '../../../test/canvas';
import ModelMentionDropdown from './ModelMentionDropdown';

const page = { id: 'page', apiKey: 'page', name: 'Page', isBlockModel: false };
const hero = {
  id: 'hero',
  apiKey: 'hero_block',
  name: 'Hero',
  isBlockModel: true,
};

afterEach(cleanup);

describe('ModelMentionDropdown', () => {
  it('lists models and blocks with their API keys and picks the clicked one', async () => {
    const user = userEvent.setup();
    const onSelect = vi.fn();
    renderInCanvas(
      <ModelMentionDropdown
        models={[page, hero]}
        onClose={vi.fn()}
        onSelect={onSelect}
        query=""
        selectedIndex={0}
      />,
    );

    const menu = screen.getByRole('menu', { name: 'Models' });
    const items = within(menu).getAllByRole('menuitem');
    // The API key is the key alone, next to the name
    expect(items.map((item) => item.textContent)).toEqual([
      'Pagepage',
      'Herohero_blockBlock',
    ]);
    expect(within(items[0]).getByText('page')).toBeVisible();
    expect(within(items[1]).getByText('hero_block')).toBeVisible();
    // Every option is a model: the glyph of the kind is on the group title
    expect(screen.getByText('Models').querySelector('svg')).toBeInTheDocument();
    expect(items.some((item) => item.querySelector('svg'))).toBe(false);

    await user.click(items[1]);
    expect(onSelect).toHaveBeenCalledWith(hero);
  });

  it('says when no model matches', () => {
    const props = { onClose: vi.fn(), onSelect: vi.fn(), selectedIndex: 0 };
    const { rerender } = renderInCanvas(
      <ModelMentionDropdown {...props} models={[]} query="blog" />,
    );

    expect(screen.getByRole('status')).toHaveTextContent(
      'No models match “blog”',
    );

    rerender(<ModelMentionDropdown {...props} models={[]} query="" />);
    expect(screen.getByRole('status')).toHaveTextContent('No models available');
  });
});
