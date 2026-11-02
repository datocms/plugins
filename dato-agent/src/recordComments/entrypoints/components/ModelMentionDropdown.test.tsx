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
  it('lists models and blocks by name and picks the clicked one', async () => {
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
    // The name alone names a model: no API key, and the pill of a block
    expect(items.map((item) => item.textContent)).toEqual([
      'Page',
      'HeroBlock',
    ]);
    // Every option is a model: the glyph of the kind is on the group title
    expect(screen.getByText('Models').querySelector('svg')).toBeInTheDocument();
    expect(items.some((item) => item.querySelector('svg'))).toBe(false);

    await user.click(items[1]);
    expect(onSelect).toHaveBeenCalledWith(hero);
  });

  it('tells two models with the same name apart by their API keys', () => {
    const landingPage = { ...page, id: 'landing', apiKey: 'landing_page' };
    renderInCanvas(
      <ModelMentionDropdown
        models={[page, landingPage, hero]}
        onClose={vi.fn()}
        onSelect={vi.fn()}
        query=""
        selectedIndex={0}
      />,
    );

    const menu = screen.getByRole('menu', { name: 'Models' });
    expect(
      within(menu)
        .getAllByRole('menuitem')
        .map((item) => item.textContent),
    ).toEqual(['Pagepage', 'Pagelanding_page', 'HeroBlock']);
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
