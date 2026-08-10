import type { FieldInfo } from '@hooks/useMentions';
import {
  cleanup,
  fireEvent,
  render,
  screen,
  within,
} from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, describe, expect, it, vi } from 'vitest';
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
    render(
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
    expect(items.map((item) => item.textContent)).toEqual([
      'Title#title',
      'Summary#summary',
    ]);
    expect(items.every((item) => item.querySelector('svg'))).toBe(true);

    fireEvent.mouseEnter(items[1]);
    expect(onSelectedIndexChange).toHaveBeenCalledWith(1);
  });

  it('keeps locale selection compact and supports both back and click actions', async () => {
    const user = userEvent.setup();
    const onClearPendingField = vi.fn();
    const onSelect = vi.fn();
    render(
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

    const menu = screen.getByRole('menu', { name: 'Locale · Title' });
    await user.click(within(menu).getAllByRole('menuitem')[1]);
    expect(onSelect).toHaveBeenCalledWith(titleField, 'it');

    await user.click(screen.getByRole('button', { name: 'Back to fields' }));
    expect(onClearPendingField).toHaveBeenCalledOnce();
  });
});
