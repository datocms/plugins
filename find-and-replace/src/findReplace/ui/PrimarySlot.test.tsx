import { act, cleanup, screen, waitFor, within } from '@testing-library/react';
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

/** The title bar: the toolbar of the page's title. */
function titleBar(): HTMLElement {
  const bar = screen.getByRole('heading', { level: 1 }).parentElement
    ?.parentElement;
  if (!bar) {
    throw new Error('no title bar');
  }
  return bar;
}

/** The names of the slot's buttons, in order (the title's "?" left out). */
function slotLabels(): string[] {
  return within(titleBar())
    .getAllByRole('button')
    .map((button) => button.textContent ?? '')
    .filter((label) => label !== '');
}

describe('PrimarySlot', () => {
  it('enabled: the primary with the count', () => {
    renderPrimary({
      kind: 'replace',
      verb: 'replace',
      count: 118,
      enabled: true,
    });
    const primary = screen.getByRole('button', { name: 'Replace 118 matches' });
    expect(primary).toBeEnabled();
    expect(primary).not.toHaveAttribute('aria-disabled');
    expect(slotLabels()).toEqual(['Replace 118 matches']);
  });

  it('enabled remove, one match', () => {
    renderPrimary({ kind: 'replace', verb: 'remove', count: 1, enabled: true });
    expect(
      screen.getByRole('button', { name: 'Remove 1 match' }),
    ).toBeEnabled();
  });

  const reasons: Array<[DisabledReason, string]> = [
    ['no_matches', 'Find some matches to replace first.'],
    ['search_running', 'Wait for the search to finish.'],
    ['press_enter', 'Search first.'],
    ['invalid_pattern', 'Fix the text in Find first.'],
    [
      'no_replacement',
      'Type a replacement first, or pick Replace with nothing in Options.',
    ],
    ['invalid_replacement', 'Fix the replacement first.'],
    ['nothing_selected', 'Select at least one match first.'],
    [
      'nothing_changes',
      'Type a different replacement, as this one changes nothing.',
    ],
    ['replacing', 'Wait for the replacement to finish.'],
  ];

  for (const [reason, text] of reasons) {
    it(`disabled (${reason}): no count, the reason reachable by keyboard`, async () => {
      const user = userEvent.setup();
      const { mock } = renderPrimary(disabledPrimary(reason, { count: 12 }));
      const primary = screen.getByRole('button', { name: 'Replace' });
      // Disabled with a reason: it keeps its place in the tab order.
      expect(primary).toHaveAttribute('aria-disabled', 'true');
      expect(primary).not.toHaveAttribute('disabled');

      // The slot follows the title's "?".
      act(() =>
        screen.getByRole('button', { name: 'About this page' }).focus(),
      );
      await user.tab();
      expect(primary).toHaveFocus();
      // The reason opens on focus and describes the button.
      await waitFor(() => expect(primary).toHaveAccessibleDescription(text));

      await user.click(primary);
      expect(mock.openConfirm).not.toHaveBeenCalled();
    });
  }

  it('disabled: the reason opens on hover too', async () => {
    const user = userEvent.setup();
    renderPrimary(disabledPrimary('nothing_selected', { verb: 'remove' }));
    await user.hover(screen.getByRole('button', { name: 'Remove' }));
    expect(
      await screen.findByText('Select at least one match first.'),
    ).toBeInTheDocument();
  });

  it('busy: keeps its label and says it is busy', () => {
    renderPrimary(
      disabledPrimary('replacing', { verb: 'remove', count: 6, busy: true }),
    );
    const primary = screen.getByRole('button', { name: 'Remove 6 matches' });
    expect(primary).toHaveAttribute('aria-busy', 'true');
    expect(primary).toBeDisabled();
  });

  it('"Search again" replaces the primary, then focuses Find', async () => {
    const user = userEvent.setup();
    const { controller } = renderPrimary({
      kind: 'searchAgain',
      publish: null,
    });
    expect(slotLabels()).toEqual(['Search again']);
    await user.click(screen.getByRole('button', { name: 'Search again' }));
    expect(controller.callsTo('searchAgain')).toHaveLength(1);
    expect(screen.getByRole('textbox', { name: 'Find' })).toHaveFocus();
  });

  it('a publish offer follows "Search again"; while publishing it is the only button', () => {
    const { controller } = renderPrimary({
      kind: 'searchAgain',
      publish: { token: 'publish-token', recordCount: 1, heldCount: 0 },
    });
    expect(slotLabels()).toEqual(['Search again', 'Publish 1 record']);

    act(() =>
      controller.setSnapshot((current) => ({
        ...current,
        primary: { kind: 'publishing', count: 1 },
      })),
    );
    expect(slotLabels()).toEqual(['Publish 1 record']);
    const publishing = screen.getByRole('button', { name: 'Publish 1 record' });
    expect(publishing).toHaveAttribute('aria-busy', 'true');
    expect(publishing).toBeDisabled();
  });
});
