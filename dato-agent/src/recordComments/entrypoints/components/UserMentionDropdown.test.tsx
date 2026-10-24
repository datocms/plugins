import { cleanup, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { renderInCanvas } from '../../../test/canvas';
import UserMentionDropdown from './UserMentionDropdown';

const ada = {
  avatarUrl: null,
  email: 'ada@example.com',
  id: 'ada',
  name: 'Ada Lovelace',
};

afterEach(cleanup);

describe('UserMentionDropdown', () => {
  it('lists people with their email and picks the clicked one', async () => {
    const user = userEvent.setup();
    const onSelect = vi.fn();
    renderInCanvas(
      <UserMentionDropdown
        onClose={vi.fn()}
        onSelect={onSelect}
        query=""
        selectedIndex={0}
        users={[ada]}
      />,
    );

    const option = screen.getByRole('menuitem', { name: /Ada Lovelace/ });
    expect(option).toHaveTextContent('ada@example.com');
    // Each person has an avatar; the glyph of people is on the group title
    expect(screen.getByText('People').querySelector('svg')).toBeInTheDocument();
    expect(screen.queryByRole('status')).not.toBeInTheDocument();

    await user.click(option);
    expect(onSelect).toHaveBeenCalledWith(ada);
  });

  it('keeps cached people usable and exposes Retry when a refresh fails', async () => {
    const user = userEvent.setup();
    const onRetry = vi.fn();
    renderInCanvas(
      <UserMentionDropdown
        errorMessage="People could not be refreshed."
        onClose={vi.fn()}
        onRetry={onRetry}
        onSelect={vi.fn()}
        query=""
        selectedIndex={0}
        users={[ada]}
      />,
    );

    expect(screen.getByRole('menu', { name: 'People' })).toBeVisible();
    expect(
      screen.getByRole('menuitem', { name: /Ada Lovelace/ }),
    ).toBeVisible();
    expect(screen.getByRole('status')).toHaveTextContent(
      'Couldn’t refresh people.',
    );

    const retry = screen.getByRole('button', { name: 'Retry' });
    expect(retry).toBeVisible();
    await user.click(retry);
    expect(onRetry).toHaveBeenCalledOnce();
  });

  it('tells when people load, fail or match nothing', () => {
    const props = {
      onClose: vi.fn(),
      onSelect: vi.fn(),
      selectedIndex: 0,
      users: [],
    };
    const { rerender } = renderInCanvas(
      <UserMentionDropdown {...props} isLoading query="" />,
    );

    expect(screen.queryByRole('menu')).not.toBeInTheDocument();
    expect(screen.getByRole('status')).toHaveTextContent('Loading people…');

    rerender(
      <UserMentionDropdown
        {...props}
        errorMessage="People could not be loaded."
        onRetry={vi.fn()}
        query=""
      />,
    );
    expect(screen.getByRole('status')).toHaveTextContent(
      'People could not be loaded.',
    );
    expect(screen.getByRole('button', { name: 'Retry' })).toBeVisible();

    rerender(<UserMentionDropdown {...props} query="zed" />);
    expect(screen.getByRole('status')).toHaveTextContent(
      'No users match “zed”',
    );
    expect(
      screen.queryByRole('button', { name: 'Retry' }),
    ).not.toBeInTheDocument();

    rerender(<UserMentionDropdown {...props} query="" />);
    expect(screen.getByRole('status')).toHaveTextContent('No users available');
  });
});
