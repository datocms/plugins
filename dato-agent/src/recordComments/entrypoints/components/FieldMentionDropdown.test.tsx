import type { FieldInfo } from '@hooks/useMentions';
import { cleanup, fireEvent, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { renderInCanvas } from '../../../test/canvas';
import FieldMentionDropdown from './FieldMentionDropdown';

const titleField: FieldInfo = {
  apiKey: 'title',
  availableLocales: ['en', 'it'],
  depth: 0,
  displayLabel: 'Title',
  fieldPath: 'title',
  label: 'Title',
  localized: true,
};

const summaryField: FieldInfo = {
  apiKey: 'summary',
  depth: 0,
  displayLabel: 'Summary',
  fieldPath: 'summary',
  label: 'Summary',
  localized: false,
};

afterEach(cleanup);

describe('FieldMentionDropdown', () => {
  it('renders native field rows and synchronizes the keyboard index on hover', () => {
    const onSelectedIndexChange = vi.fn();
    renderInCanvas(
      <FieldMentionDropdown
        fields={[titleField, summaryField]}
        onClose={vi.fn()}
        onSelect={vi.fn()}
        onSelectedIndexChange={onSelectedIndexChange}
        query=""
        selectedIndex={0}
      />,
    );

    const menu = screen.getByRole('menu', { name: 'Fields' });
    const items = within(menu).getAllByRole('menuitem');
    // The label alone names a field: no API key
    expect(items.map((item) => item.textContent)).toEqual(['Title', 'Summary']);
    // Every option is a field: the glyph of the kind is on the group title
    const title = screen.getByText('Fields');
    expect(title).toBeVisible();
    expect(title.querySelector('svg')).toBeInTheDocument();
    expect(items.some((item) => item.querySelector('svg'))).toBe(false);

    fireEvent.mouseEnter(items[1]);
    expect(onSelectedIndexChange).toHaveBeenCalledWith(1);
  });

  it('asks for the locale of a localized field and picks the only locale of the others', async () => {
    const user = userEvent.setup();
    const onSelect = vi.fn();
    renderInCanvas(
      <FieldMentionDropdown
        fields={[titleField, summaryField]}
        onClose={vi.fn()}
        onSelect={onSelect}
        query=""
        selectedIndex={0}
      />,
    );

    await user.click(screen.getByRole('menuitem', { name: /^Title/ }));
    expect(onSelect).toHaveBeenLastCalledWith(titleField);

    await user.click(screen.getByRole('menuitem', { name: /^Summary/ }));
    expect(onSelect).toHaveBeenLastCalledWith(summaryField, undefined);
  });

  it('keeps locale selection compact and supports both back and click actions', async () => {
    const user = userEvent.setup();
    const onClearPendingField = vi.fn();
    const onSelect = vi.fn();
    renderInCanvas(
      <FieldMentionDropdown
        fields={[titleField]}
        onClearPendingField={onClearPendingField}
        onClose={vi.fn()}
        onSelect={onSelect}
        pendingFieldForLocale={titleField}
        query=""
        selectedIndex={0}
      />,
    );

    const menu = screen.getByRole('menu', { name: 'Language · Title' });
    const locales = within(menu).getAllByRole('menuitem');
    expect(locales.map((item) => item.textContent)).toEqual([
      'English (en)',
      'Italian (it)',
    ]);

    await user.click(locales[1]);
    expect(onSelect).toHaveBeenCalledWith(titleField, 'it');

    const back = screen.getByRole('button', { name: 'Back to fields' });
    // The editor keeps the focus when the pointer presses the button
    expect(fireEvent.mouseDown(back)).toBe(false);
    await user.click(back);
    expect(onClearPendingField).toHaveBeenCalledOnce();
  });

  it('moves, picks and leaves the locale step with the keys of the editor', () => {
    let handleKey: ((key: string) => boolean) | undefined;
    const onClearPendingField = vi.fn();
    const onSelect = vi.fn();
    const onSelectedIndexChange = vi.fn();
    renderInCanvas(
      <FieldMentionDropdown
        fields={[titleField]}
        onClearPendingField={onClearPendingField}
        onClose={vi.fn()}
        onSelect={onSelect}
        onSelectedIndexChange={onSelectedIndexChange}
        pendingFieldForLocale={titleField}
        query=""
        registerKeyHandler={(handler) => {
          handleKey = handler;
        }}
        selectedIndex={1}
      />,
    );

    expect(handleKey?.('ArrowDown')).toBe(true);
    expect(onSelectedIndexChange).toHaveBeenLastCalledWith(0);
    expect(handleKey?.('ArrowUp')).toBe(true);
    expect(onSelectedIndexChange).toHaveBeenLastCalledWith(0);

    expect(handleKey?.('Tab')).toBe(true);
    expect(onSelect).toHaveBeenLastCalledWith(titleField, 'it');

    expect(handleKey?.('Backspace')).toBe(true);
    expect(handleKey?.('Escape')).toBe(true);
    expect(onClearPendingField).toHaveBeenCalledTimes(2);

    expect(handleKey?.('a')).toBe(false);
  });

  it('closes on Escape while it lists the fields', () => {
    let handleKey: ((key: string) => boolean) | undefined;
    const onClose = vi.fn();
    renderInCanvas(
      <FieldMentionDropdown
        fields={[titleField]}
        onClose={onClose}
        onSelect={vi.fn()}
        query=""
        registerKeyHandler={(handler) => {
          handleKey = handler;
        }}
        selectedIndex={0}
      />,
    );

    expect(handleKey?.('ArrowDown')).toBe(false);
    expect(handleKey?.('Escape')).toBe(true);
    expect(onClose).toHaveBeenCalledOnce();
  });

  it('tells why no field shows and offers Retry after a failed load', async () => {
    const user = userEvent.setup();
    const onRetry = vi.fn();
    const props = {
      fields: [],
      onClose: vi.fn(),
      onSelect: vi.fn(),
      selectedIndex: 0,
    };
    const { rerender } = renderInCanvas(
      <FieldMentionDropdown {...props} query="hero" />,
    );

    expect(screen.queryByRole('menu')).not.toBeInTheDocument();
    expect(screen.getByRole('status')).toHaveTextContent(
      'No fields match “hero”',
    );

    rerender(<FieldMentionDropdown {...props} isLoading query="" />);
    expect(screen.getByRole('status')).toHaveTextContent('Loading fields…');

    rerender(
      <FieldMentionDropdown
        {...props}
        errorMessage="The fields could not be loaded."
        onRetry={onRetry}
        query=""
      />,
    );
    expect(screen.getByRole('status')).toHaveTextContent(
      'The fields could not be loaded.',
    );
    await user.click(screen.getByRole('button', { name: 'Retry' }));
    expect(onRetry).toHaveBeenCalledOnce();
  });
});
