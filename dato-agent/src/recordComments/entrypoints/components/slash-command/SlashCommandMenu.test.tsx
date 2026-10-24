import { SLASH_COMMANDS } from '@ctypes/slashCommands';
import { cleanup, fireEvent, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, describe, expect, it, onTestFinished, vi } from 'vitest';
import { renderInCanvas } from '../../../../test/canvas';
import { SlashCommandMenu } from './SlashCommandMenu';

afterEach(cleanup);

describe('SlashCommandMenu', () => {
  it('renders an accessible icon-backed menu for every reference type', () => {
    renderInCanvas(
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
    renderInCanvas(
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

  it('keeps the editor focus, follows the keyboard and closes on an outside click', () => {
    // jsdom has no layout: record the calls instead
    const scrollIntoView = vi.fn();
    const original = Element.prototype.scrollIntoView;
    Element.prototype.scrollIntoView = scrollIntoView;
    onTestFinished(() => {
      Element.prototype.scrollIntoView = original;
    });
    const onClose = vi.fn();
    const props = {
      commands: SLASH_COMMANDS,
      onClose,
      onSelect: vi.fn(),
    };
    const { rerender } = renderInCanvas(
      <SlashCommandMenu {...props} selectedIndex={0} />,
    );
    const items = screen.getAllByRole('menuitem');

    // A press on an option does not move the focus out of the editor
    expect(fireEvent.mouseDown(items[1])).toBe(false);
    // The options are not tab stops: the editor owns the keyboard
    expect(within(items[1]).getByRole('button')).toHaveAttribute(
      'tabindex',
      '-1',
    );

    scrollIntoView.mockClear();
    rerender(<SlashCommandMenu {...props} selectedIndex={3} />);
    expect(scrollIntoView).toHaveBeenCalledOnce();
    expect(scrollIntoView.mock.contexts[0]).toBe(
      screen.getAllByRole('menuitem')[3],
    );

    fireEvent.mouseDown(items[0]);
    expect(onClose).not.toHaveBeenCalled();
    fireEvent.mouseDown(document.body);
    expect(onClose).toHaveBeenCalledOnce();
  });

  it('says when no reference matches', () => {
    renderInCanvas(
      <SlashCommandMenu
        commands={[]}
        onClose={vi.fn()}
        onSelect={vi.fn()}
        selectedIndex={0}
      />,
    );

    expect(screen.queryByRole('menu')).not.toBeInTheDocument();
    expect(screen.getByRole('status')).toHaveTextContent(
      'No matching references',
    );
  });
});
