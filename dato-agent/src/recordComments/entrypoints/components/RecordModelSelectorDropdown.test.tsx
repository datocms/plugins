import { cleanup, fireEvent, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { EditorToolbar } from 'datocms-react-ui/EditorToolbar';
import { afterEach, beforeAll, describe, expect, it, vi } from 'vitest';
import { renderInCanvas } from '../../../test/canvas';
import {
  RecordMentionDropdown,
  RecordModelPanel,
} from './RecordModelSelectorDropdown';

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

const heroBlock = {
  id: 'hero',
  apiKey: 'hero_block',
  name: 'Hero',
  isBlockModel: true,
};

beforeAll(() => {
  // The menus scroll the highlighted option into view; jsdom has no layout
  Object.defineProperty(HTMLElement.prototype, 'scrollIntoView', {
    configurable: true,
    value: vi.fn(),
  });
});

afterEach(cleanup);

describe('RecordModelPanel', () => {
  function renderPanel(
    props: Partial<Parameters<typeof RecordModelPanel>[0]> = {},
  ) {
    const onSelect = vi.fn();
    const onClose = vi.fn();
    const onLeave = vi.fn();
    renderInCanvas(
      <div>
        <RecordModelPanel
          models={models}
          onClose={onClose}
          onLeave={onLeave}
          onSelect={onSelect}
          {...props}
        />
        <button type="button">Next control</button>
      </div>,
    );
    return { onClose, onLeave, onSelect };
  }

  function panelSearch() {
    return screen.getByRole('textbox', { name: 'Search record models' });
  }

  /** The model that Enter picks: the search names it to screen readers */
  function highlightedName() {
    const optionId = panelSearch().getAttribute('aria-activedescendant');
    const option = optionId ? document.getElementById(optionId) : null;
    expect(option).toHaveAttribute('role', 'menuitem');
    expect(panelSearch()).toHaveAttribute(
      'aria-controls',
      screen.getByRole('menu', { name: 'Records' }).id,
    );
    return option?.textContent;
  }

  it('lists the readable models with the search focused and the first one highlighted', () => {
    renderPanel({ models: [...models, heroBlock] });

    expect(panelSearch()).toHaveFocus();
    expect(panelSearch()).toHaveAttribute('placeholder', 'Blog post');
    expect(panelSearch()).toHaveAttribute('autocomplete', 'off');
    expect(panelSearch()).toHaveAttribute('spellcheck', 'false');
    // Every option is a model of records: the glyph is on the group title
    expect(
      screen.getByText('Records').querySelector('svg'),
    ).toBeInTheDocument();
    expect(
      within(screen.getByRole('menu', { name: 'Records' }))
        .getAllByRole('menuitem')
        .map((item) => item.textContent),
    ).toEqual(['Article', 'Page', 'Product']);
    expect(highlightedName()).toBe('Article');
  });

  it('filters by name or API key', async () => {
    const user = userEvent.setup();
    renderPanel({
      models: [
        ...models,
        {
          id: 'release',
          apiKey: 'news_item',
          name: 'Press release',
          isBlockModel: false,
        },
      ],
    });

    await user.type(panelSearch(), 'NEWS_');
    expect(
      within(screen.getByRole('menu', { name: 'Records' }))
        .getAllByRole('menuitem')
        .map((item) => item.textContent),
    ).toEqual(['Press release']);
  });

  it('picks the first match with Enter after a search', async () => {
    const user = userEvent.setup();
    const { onSelect } = renderPanel();

    await user.type(panelSearch(), 'PROD');
    expect(highlightedName()).toBe('Product');
    await user.keyboard('{Enter}');

    expect(onSelect).toHaveBeenCalledWith(models[2]);
  });

  it('highlights the first match again when the search narrows the list', async () => {
    const user = userEvent.setup();
    const { onSelect } = renderPanel();

    await user.keyboard('{ArrowDown}{ArrowDown}');
    expect(highlightedName()).toBe('Product');

    // "a" keeps Article and Page: the highlight goes back to the first one
    await user.type(panelSearch(), 'a');
    expect(highlightedName()).toBe('Article');
    await user.keyboard('{Enter}');

    expect(onSelect).toHaveBeenCalledWith(models[0]);
  });

  it('moves with the arrows, follows the pointer, and picks with Tab', async () => {
    const user = userEvent.setup();
    const { onSelect } = renderPanel();

    await user.keyboard('{ArrowDown}{ArrowDown}{ArrowDown}{ArrowUp}');
    expect(highlightedName()).toBe('Page');

    fireEvent.mouseEnter(screen.getByRole('menuitem', { name: /^Product/ }));
    expect(highlightedName()).toBe('Product');

    await user.keyboard('{Tab}');
    expect(onSelect).toHaveBeenCalledWith(models[2]);
    expect(panelSearch()).toHaveFocus();
  });

  it('picks the clicked model and keeps the focus in its search', async () => {
    const user = userEvent.setup();
    const { onSelect } = renderPanel();

    await user.click(screen.getByRole('menuitem', { name: /^Page/ }));

    expect(onSelect).toHaveBeenCalledWith(models[1]);
    expect(panelSearch()).toHaveFocus();
  });

  it('keeps the focus in its search when its title, a text or its padding is pressed', async () => {
    const user = userEvent.setup();
    const { onClose, onLeave } = renderPanel();

    await user.click(screen.getByText('Records'));
    expect(panelSearch()).toHaveFocus();

    await user.type(panelSearch(), 'missing');
    await user.click(screen.getByRole('status'));

    expect(panelSearch()).toHaveFocus();
    expect(onLeave).not.toHaveBeenCalled();
    expect(onClose).not.toHaveBeenCalled();
  });

  it('lets Tab leave when nothing matches, and closes as the focus leaves', async () => {
    const user = userEvent.setup();
    const { onLeave, onSelect } = renderPanel();

    await user.type(panelSearch(), 'missing');
    expect(screen.getByRole('status')).toHaveTextContent(
      'No models match “missing”',
    );
    expect(panelSearch()).not.toHaveAttribute('aria-activedescendant');
    await user.keyboard('{Tab}');

    expect(onSelect).not.toHaveBeenCalled();
    expect(screen.getByRole('button', { name: 'Next control' })).toHaveFocus();
    expect(onLeave).toHaveBeenCalledOnce();
  });

  it('closes with Escape', async () => {
    const user = userEvent.setup();
    const { onClose, onSelect } = renderPanel();

    await user.keyboard('{Escape}');

    expect(onClose).toHaveBeenCalledOnce();
    expect(onSelect).not.toHaveBeenCalled();
  });

  it('ignores Enter while an IME composition is active', () => {
    const { onSelect } = renderPanel();

    fireEvent.keyDown(panelSearch(), {
      key: 'Enter',
      keyCode: 229,
      isComposing: true,
    });

    expect(onSelect).not.toHaveBeenCalled();
  });

  it('says when no model can be read', () => {
    renderPanel({ models: [heroBlock] });

    expect(screen.getByRole('status')).toHaveTextContent(
      'No models you can read',
    );
  });

  it('names its search with a field of its own, in the body of the panel', () => {
    renderPanel();

    // The label of the field names the search, hidden from the eye
    expect(panelSearch()).toHaveAttribute('aria-labelledby');
    expect(panelSearch()).not.toHaveAttribute('aria-label');
    expect(panelSearch().closest('.Dropdown__menu__body')).not.toBeNull();
  });
});

describe('RecordMentionDropdown', () => {
  function renderDropdown(
    props: Partial<Parameters<typeof RecordMentionDropdown>[0]> = {},
  ) {
    const onSelect = vi.fn();
    const onToggle = vi.fn();
    renderInCanvas(
      <EditorToolbar ariaLabel="Insert">
        <EditorToolbar.Group>
          <RecordMentionDropdown
            models={[...models, heroBlock]}
            onSelect={onSelect}
            onToggle={onToggle}
            {...props}
          />
        </EditorToolbar.Group>
      </EditorToolbar>,
    );
    return { onSelect, onToggle };
  }

  it('opens a menu of the readable models, tells it, and picks one', async () => {
    const user = userEvent.setup();
    const { onSelect, onToggle } = renderDropdown();
    expect(onToggle).toHaveBeenLastCalledWith(false);

    await user.click(screen.getByRole('button', { name: 'Record' }));

    expect(onToggle).toHaveBeenLastCalledWith(true);
    const menu = screen.getByRole('menu', { name: 'Record' });
    expect(within(menu).getByText('Records').querySelector('svg')).not.toBe(
      null,
    );
    expect(
      within(menu)
        .getAllByRole('menuitem')
        .map((item) => item.textContent),
    ).toEqual(['Article', 'Page', 'Product']);

    await user.click(within(menu).getByRole('menuitem', { name: /^Page/ }));

    expect(onSelect).toHaveBeenCalledWith(models[1]);
    expect(onToggle).toHaveBeenLastCalledWith(false);
  });

  it('does not open while the composer is off', async () => {
    const user = userEvent.setup();
    const { onToggle } = renderDropdown({ disabled: true });

    const trigger = screen.getByRole('button', { name: 'Record' });
    expect(trigger).toHaveAttribute('aria-disabled', 'true');
    await user.click(trigger);

    expect(screen.queryByRole('menu', { name: 'Record' })).toBeNull();
    expect(onToggle).not.toHaveBeenCalledWith(true);
  });
});
