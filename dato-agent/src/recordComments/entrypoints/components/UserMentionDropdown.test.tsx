import { cleanup, render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, describe, expect, it, vi } from 'vitest';
import UserMentionDropdown from './UserMentionDropdown';

afterEach(cleanup);

describe('UserMentionDropdown', () => {
  it('keeps cached people usable and exposes Retry when a refresh fails', async () => {
    const user = userEvent.setup();
    const onRetry = vi.fn();
    render(
      <UserMentionDropdown
        errorMessage="People could not be refreshed."
        onClose={vi.fn()}
        onRetry={onRetry}
        onSelect={vi.fn()}
        query=""
        selectedIndex={0}
        users={[
          {
            avatarUrl: null,
            email: 'ada@example.com',
            id: 'ada',
            name: 'Ada Lovelace',
          },
        ]}
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
});
