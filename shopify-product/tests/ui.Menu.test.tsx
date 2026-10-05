import { act, cleanup, render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import {
  Canvas,
  DropdownGroup,
  DropdownOption,
  DropdownSeparator,
} from 'datocms-react-ui';
import { type ReactNode, useState } from 'react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { Menu, MenuAction, type MenuSelection } from '../src/ui/Menu';

// datocms-react-ui measures with these (some at import time); jsdom has neither.
vi.hoisted(() => {
  class ObserverStub {
    observe() {}
    unobserve() {}
    disconnect() {}
    takeRecords() {
      return [];
    }
  }
  Object.assign(globalThis, {
    IntersectionObserver: ObserverStub,
    ResizeObserver: ObserverStub,
  });
});

afterEach(cleanup);

const ctx = {
  theme: {},
  cssDesignTokens: {},
  bodyPadding: [0, 0, 0, 0],
} as unknown as Parameters<typeof Canvas>[0]['ctx'];

function TestMenu({
  label = 'Actions',
  selection,
  children,
}: {
  label?: string;
  selection?: MenuSelection;
  children: ReactNode;
}) {
  return (
    <Canvas ctx={ctx}>
      <Menu
        selection={selection}
        renderTrigger={({ triggerProps }) => (
          <button {...triggerProps} type="button">
            {label}
          </button>
        )}
      >
        {children}
      </Menu>
      <button type="button">After</button>
    </Canvas>
  );
}

/** The kit portals the menu in an effect; the hook decorates it next. */
async function settle() {
  await act(async () => {
    await new Promise((resolve) => window.setTimeout(resolve, 10));
  });
}

async function openWithKeyboard(name = 'Actions') {
  const user = userEvent.setup();
  screen.getByRole('button', { name }).focus();
  await user.keyboard('{Enter}');
  await settle();
  return user;
}

describe('Menu: semantics', () => {
  it('exposes a menu labelled by its trigger', async () => {
    const onEdit = vi.fn();
    render(
      <TestMenu>
        <DropdownOption onClick={onEdit}>Edit</DropdownOption>
        <DropdownSeparator />
        <DropdownOption red onClick={() => {}}>
          Remove
        </DropdownOption>
      </TestMenu>,
    );
    const trigger = screen.getByRole('button', { name: 'Actions' });
    expect(trigger).toHaveAttribute('aria-haspopup', 'menu');
    expect(trigger).toHaveAttribute('aria-expanded', 'false');

    await openWithKeyboard();

    const menu = screen.getByRole('menu', { name: 'Actions' });
    expect(trigger).toHaveAttribute('aria-expanded', 'true');
    expect(trigger).toHaveAttribute('aria-controls', menu.id);
    expect(
      screen.getAllByRole('menuitem').map((item) => item.textContent),
    ).toEqual(['Edit', 'Remove']);
    expect(screen.getByRole('separator')).toBeInTheDocument();
    for (const item of screen.getAllByRole('menuitem')) {
      expect(item).toHaveAttribute('tabindex', '-1');
    }
  });

  it('reads one current value as checked radios, keeping actions plain', async () => {
    render(
      <TestMenu selection="single">
        <DropdownOption active onClick={() => {}}>
          Newest
        </DropdownOption>
        <DropdownOption onClick={() => {}}>Title A–Z</DropdownOption>
        <DropdownOption closeMenuOnClick={false} onClick={() => {}}>
          <MenuAction />
          Load more
        </DropdownOption>
      </TestMenu>,
    );
    await openWithKeyboard();

    expect(
      screen.getByRole('menuitemradio', { name: 'Newest' }),
    ).toHaveAttribute('aria-checked', 'true');
    expect(
      screen.getByRole('menuitemradio', { name: 'Title A–Z' }),
    ).toHaveAttribute('aria-checked', 'false');
    const action = screen.getByRole('menuitem', { name: 'Load more' });
    expect(action).not.toHaveAttribute('aria-checked');
  });

  it('reads toggles as checkboxes and follows their state', async () => {
    function Tags() {
      const [tags, setTags] = useState<string[]>(['Sport']);
      const toggle = (tag: string) =>
        setTags((current) =>
          current.includes(tag)
            ? current.filter((value) => value !== tag)
            : [...current, tag],
        );
      return (
        <TestMenu label="Tags" selection="multiple">
          {['Premium', 'Sport'].map((tag) => (
            <DropdownOption
              key={tag}
              active={tags.includes(tag)}
              closeMenuOnClick={false}
              onClick={() => toggle(tag)}
            >
              {tag}
            </DropdownOption>
          ))}
        </TestMenu>
      );
    }
    render(<Tags />);
    const user = await openWithKeyboard('Tags');

    const premium = screen.getByRole('menuitemcheckbox', { name: 'Premium' });
    expect(premium).toHaveAttribute('aria-checked', 'false');
    expect(
      screen.getByRole('menuitemcheckbox', { name: 'Sport' }),
    ).toHaveAttribute('aria-checked', 'true');

    expect(premium).toHaveFocus();
    await user.keyboard('{Enter}');
    await waitFor(() =>
      expect(premium).toHaveAttribute('aria-checked', 'true'),
    );
    expect(premium).toHaveFocus();
  });

  it('names option groups', async () => {
    render(
      <TestMenu selection="single">
        <DropdownGroup name="Country">
          <DropdownOption active onClick={() => {}}>
            Italy (EUR)
          </DropdownOption>
        </DropdownGroup>
        <DropdownGroup name="Language">
          <DropdownOption active onClick={() => {}}>
            English
          </DropdownOption>
        </DropdownGroup>
      </TestMenu>,
    );
    await openWithKeyboard();
    expect(screen.getByRole('group', { name: 'Country' })).toContainElement(
      screen.getByRole('menuitemradio', { name: 'Italy (EUR)' }),
    );
    expect(screen.getByRole('group', { name: 'Language' })).toBeInTheDocument();
  });
});

describe('Menu: keyboard', () => {
  it('skips disabled options, which the kit leaves focusable', async () => {
    const onReplace = vi.fn();
    render(
      <TestMenu>
        <DropdownOption onClick={() => {}}>
          Open in Shopify admin
        </DropdownOption>
        <DropdownOption disabled onClick={onReplace}>
          Replace…
        </DropdownOption>
        <DropdownOption disabled onClick={() => {}}>
          Remove
        </DropdownOption>
        <DropdownOption onClick={() => {}}>View on store</DropdownOption>
      </TestMenu>,
    );
    const user = await openWithKeyboard();
    const first = screen.getByRole('menuitem', {
      name: 'Open in Shopify admin',
    });
    expect(first).toHaveFocus();
    expect(screen.getByRole('menuitem', { name: 'Replace…' })).toHaveAttribute(
      'aria-disabled',
      'true',
    );

    await user.keyboard('{ArrowDown}');
    expect(
      screen.getByRole('menuitem', { name: 'View on store' }),
    ).toHaveFocus();
    await user.keyboard('{ArrowDown}');
    expect(first).toHaveFocus();
    await user.keyboard('{End}');
    expect(
      screen.getByRole('menuitem', { name: 'View on store' }),
    ).toHaveFocus();
    expect(onReplace).not.toHaveBeenCalled();
  });

  it('starts in the search field of a long menu and moves between it and the options', async () => {
    const names = ['Alpha', 'Bravo', 'Charlie', 'Delta', 'Echo', 'Foxtrot'];
    render(
      <TestMenu selection="single">
        {names.map((name) => (
          <DropdownOption key={name} onClick={() => {}}>
            {name}
          </DropdownOption>
        ))}
      </TestMenu>,
    );
    const user = await openWithKeyboard();
    const search = screen.getByPlaceholderText('Search...');
    expect(search).toHaveFocus();

    await user.keyboard('{ArrowDown}');
    expect(screen.getByRole('menuitemradio', { name: 'Alpha' })).toHaveFocus();
    await user.keyboard('{ArrowUp}');
    expect(search).toHaveFocus();
    await user.keyboard('{ArrowUp}');
    expect(
      screen.getByRole('menuitemradio', { name: 'Foxtrot' }),
    ).toHaveFocus();

    // Typing on an option continues in the search field.
    await user.keyboard('e');
    expect(search).toHaveFocus();
    expect(search).toHaveValue('e');
  });

  it('closes on Esc and on Tab, back on the trigger', async () => {
    render(
      <TestMenu>
        <DropdownOption onClick={() => {}}>Edit</DropdownOption>
        <DropdownOption onClick={() => {}}>Remove</DropdownOption>
      </TestMenu>,
    );
    const trigger = screen.getByRole('button', { name: 'Actions' });
    const user = await openWithKeyboard();
    expect(screen.getByRole('menuitem', { name: 'Edit' })).toHaveFocus();
    await user.keyboard('{Escape}');
    expect(screen.queryByRole('menu')).toBeNull();
    expect(trigger).toHaveFocus();
    expect(trigger).toHaveAttribute('aria-expanded', 'false');

    await user.keyboard('{Enter}');
    await settle();
    expect(screen.getByRole('menuitem', { name: 'Edit' })).toHaveFocus();
    await user.tab();
    expect(screen.queryByRole('menu')).toBeNull();
    expect(screen.getByRole('button', { name: 'After' })).toHaveFocus();
  });

  it('leaves focus on the trigger after a mouse opening, then Down enters', async () => {
    render(
      <TestMenu>
        <DropdownOption onClick={() => {}}>Edit</DropdownOption>
        <DropdownOption onClick={() => {}}>Remove</DropdownOption>
      </TestMenu>,
    );
    const user = userEvent.setup();
    const trigger = screen.getByRole('button', { name: 'Actions' });
    await user.click(trigger);
    await settle();
    expect(trigger).toHaveFocus();

    await user.keyboard('{ArrowUp}');
    expect(screen.getByRole('menuitem', { name: 'Remove' })).toHaveFocus();
  });

  it('runs the focused option and returns focus to the trigger', async () => {
    const onEdit = vi.fn();
    render(
      <TestMenu>
        <DropdownOption onClick={onEdit}>Edit</DropdownOption>
      </TestMenu>,
    );
    const trigger = screen.getByRole('button', { name: 'Actions' });
    const user = await openWithKeyboard();
    await user.keyboard('{Enter}');
    expect(onEdit).toHaveBeenCalledTimes(1);
    await settle();
    expect(screen.queryByRole('menu')).toBeNull();
    expect(trigger).toHaveFocus();
  });
});
