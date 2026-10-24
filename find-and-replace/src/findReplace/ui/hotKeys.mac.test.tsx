import {
  act,
  cleanup,
  fireEvent,
  screen,
  waitFor,
} from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { renderState } from './testing/renderPage';

// A Mac, before the kit and its actions read the platform: "mod" is then
// Cmd, not Ctrl.
vi.hoisted(() => {
  Object.defineProperty(window.navigator, 'platform', {
    configurable: true,
    value: 'MacIntel',
  });
});

afterEach(() => {
  cleanup();
  localStorage.clear();
});

function pressEnterWith(
  target: Element,
  modifier: 'metaKey' | 'ctrlKey' | 'altKey',
) {
  fireEvent.keyDown(target, {
    key: 'Enter',
    code: 'Enter',
    keyCode: 13,
    which: 13,
    [modifier]: true,
  });
}

describe('the replace keys on a Mac', () => {
  it('Cmd + Enter on the page and Ctrl + Enter in a field both open the replace confirm, once each', async () => {
    const { mock } = renderState('S11');
    mock.openConfirm.mockResolvedValue(false);

    pressEnterWith(document.body, 'metaKey');
    await waitFor(() => expect(mock.openConfirm).toHaveBeenCalledTimes(1));

    // The fields take Ctrl + Enter too, as Cmd + Enter.
    pressEnterWith(
      screen.getByRole('textbox', { name: 'Replace with' }),
      'ctrlKey',
    );
    await waitFor(() => expect(mock.openConfirm).toHaveBeenCalledTimes(2));

    // Other modified Enters are not the shortcut.
    pressEnterWith(document.body, 'altKey');
    await act(async () => {});
    expect(mock.openConfirm).toHaveBeenCalledTimes(2);
  });

  it('the primary shows the Cmd keys', async () => {
    const user = userEvent.setup();
    renderState('S11');
    await user.hover(screen.getByRole('button', { name: 'Replace 8 matches' }));
    expect(await screen.findByText('Replace the matches')).toBeInTheDocument();
    expect(screen.getByText('⌘')).toBeInTheDocument();
  });
});
