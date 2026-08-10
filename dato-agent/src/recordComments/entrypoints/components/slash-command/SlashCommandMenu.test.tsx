import { SLASH_COMMANDS } from '@ctypes/slashCommands';
import {
  cleanup,
  fireEvent,
  render,
  screen,
  within,
} from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { SlashCommandMenu } from './SlashCommandMenu';

afterEach(cleanup);

describe('SlashCommandMenu', () => {
  it('renders an accessible icon-backed menu for every reference type', () => {
    render(
      <SlashCommandMenu
        commands={SLASH_COMMANDS}
        onClose={vi.fn()}
        onSelect={vi.fn()}
        selectedIndex={0}
      />,
    );

    const menu = screen.getByRole('menu', { name: 'References' });
    const items = within(menu).getAllByRole('menuitem');

    expect(items).toHaveLength(5);
    expect(items.map((item) => item.textContent)).toEqual([
      'UserMention a team member',
      'FieldReference a field',
      'RecordLink to a record',
      'AssetLink to an asset',
      'ModelReference a model',
    ]);
    for (const item of items) {
      expect(item.querySelector('svg')).toBeInTheDocument();
    }
    expect(menu).not.toHaveTextContent(/[👤📄📎📦]/u);
  });

  it('selects clicked commands and synchronizes the keyboard index on hover', async () => {
    const user = userEvent.setup();
    const onSelect = vi.fn();
    const onSelectedIndexChange = vi.fn();
    render(
      <SlashCommandMenu
        commands={SLASH_COMMANDS}
        onClose={vi.fn()}
        onSelect={onSelect}
        onSelectedIndexChange={onSelectedIndexChange}
        selectedIndex={0}
      />,
    );

    const model = screen.getByRole('menuitem', { name: /Model/ });
    fireEvent.mouseEnter(model);
    expect(onSelectedIndexChange).toHaveBeenLastCalledWith(4);

    await user.click(
      screen.getByRole('menuitem', { name: /RecordLink to a record/ }),
    );
    expect(onSelect).toHaveBeenCalledOnce();
    expect(onSelect).toHaveBeenCalledWith(SLASH_COMMANDS[2]);
  });
});
