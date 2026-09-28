import {
  act,
  cleanup,
  fireEvent,
  screen,
  waitFor,
} from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, describe, expect, it } from 'vitest';
import type { DisabledReason, PrimaryView } from '../contract';
import { disabledPrimary, idleSnapshot } from './testing/fixtures';
import { renderSnapshot } from './testing/renderPage';

afterEach(() => {
  cleanup();
});

function renderPrimary(primary: PrimaryView) {
  return renderSnapshot({ ...idleSnapshot(), primary });
}

function primaryButton(): HTMLElement | null {
  return document.querySelector('.dl-kit-button--primary');
}

describe('PrimarySlot', () => {
  it('enabled: the solid primary with the count', () => {
    renderPrimary({
      kind: 'replace',
      verb: 'replace',
      count: 118,
      enabled: true,
    });
    expect(primaryButton()).toHaveTextContent('Replace 118 matches');
    expect(primaryButton()).toBeEnabled();
    expect(document.querySelector('.dl-tooltip-anchor')).toBeNull();
  });

  it('enabled remove, one match', () => {
    renderPrimary({ kind: 'replace', verb: 'remove', count: 1, enabled: true });
    expect(primaryButton()).toHaveTextContent('Remove 1 match');
  });

  const reasons: Array<[DisabledReason, string]> = [
    [
      'no_matches',
      'You cannot replace anything until the search finds matches',
    ],
    [
      'search_running',
      'You cannot replace right now as the search is still running',
    ],
    ['press_enter', 'You cannot replace until you press Enter to search'],
    ['invalid_pattern', 'You cannot replace as the pattern is not valid'],
    [
      'no_replacement',
      'You cannot replace until you type a replacement or turn on Replace with nothing',
    ],
    [
      'invalid_replacement',
      'You cannot replace until the replacement is fixed',
    ],
    ['nothing_selected', 'You cannot replace as no matches are selected'],
    ['nothing_changes', 'You cannot replace as nothing would change'],
    [
      'replacing',
      'You cannot replace right now as a replacement is in progress',
    ],
  ];

  for (const [reason, text] of reasons) {
    it(`disabled (${reason}): no count, the reason reachable by keyboard`, async () => {
      const user = userEvent.setup();
      renderPrimary(disabledPrimary(reason, { count: 12 }));
      expect(primaryButton()).toBeDisabled();
      expect(primaryButton()).toHaveTextContent(/^Replace$/);

      const anchor = document.querySelector('.dl-tooltip-anchor');
      expect(anchor).toHaveAttribute('tabindex', '0');
      // Tab from the page start: the slot comes first.
      if (document.activeElement instanceof HTMLElement) {
        document.activeElement.blur();
      }
      await user.tab();
      expect(anchor).toHaveFocus();
      const describedBy = anchor?.getAttribute('aria-describedby') ?? '';
      const description = describedBy
        .split(' ')
        .map((id) => document.getElementById(id)?.textContent)
        .filter(Boolean);
      expect(description).toContain(text);
      // The tooltip opens on focus too.
      expect(await screen.findAllByText(text)).toHaveLength(2);
    });
  }

  it('opens the reason when the pointer moves over it, not when it appears under a still pointer', async () => {
    const text = 'You cannot replace anything until the search finds matches';
    renderPrimary(disabledPrimary('no_matches'));
    const anchor = document.querySelector('.dl-tooltip-anchor');
    if (!(anchor instanceof HTMLElement)) {
      throw new Error('no anchor');
    }
    // What Chrome sends an element that mounts under the pointer ("Search again" was just
    // clicked there): boundary events, no movement.
    fireEvent.pointerOver(anchor, { pointerType: 'mouse' });
    fireEvent.pointerEnter(anchor, { pointerType: 'mouse' });
    fireEvent.mouseOver(anchor);
    fireEvent.mouseEnter(anchor);
    await act(async () => {
      await new Promise((resolve) => setTimeout(resolve, 20));
    });
    expect(screen.getAllByText(text)).toHaveLength(1); // the hidden description only
    fireEvent.pointerMove(anchor, { pointerType: 'mouse' });
    expect(await screen.findAllByText(text)).toHaveLength(2);
    fireEvent.pointerLeave(anchor, { pointerType: 'mouse' });
    await waitFor(() => expect(screen.getAllByText(text)).toHaveLength(1));
  });

  it('busy: keeps its label, adds a spinner and ", in progress"', () => {
    renderPrimary(
      disabledPrimary('replacing', { verb: 'remove', count: 6, busy: true }),
    );
    expect(primaryButton()).toHaveTextContent('Remove 6 matches, in progress');
    expect(primaryButton()?.querySelector('.fr-button-spinner')).not.toBeNull();
    expect(primaryButton()).toBeDisabled();
  });

  it('"Search again" is a soft button that replaces the primary', async () => {
    const user = userEvent.setup();
    const { controller } = renderPrimary({
      kind: 'searchAgain',
      publish: null,
    });
    expect(primaryButton()).toBeNull();
    const button = screen.getByRole('button', { name: 'Search again' });
    expect(button).toHaveClass('dl-kit-button--muted');
    await user.click(button);
    expect(controller.callsTo('searchAgain')).toHaveLength(1);
    expect(screen.getByRole('textbox', { name: 'Find' })).toHaveFocus();
  });
});
