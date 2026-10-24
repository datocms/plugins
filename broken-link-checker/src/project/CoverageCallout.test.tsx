import { fireEvent, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it } from 'vitest';
import { renderInCanvas } from '../test/canvas';
import {
  CoverageCallout,
  coverageText,
  RunningCoverageCallout,
} from './CoverageCallout';

const issues = (count: number) =>
  Array.from({ length: count }, (_, index) => `Issue ${index}`);

function show(count: number) {
  renderInCanvas(
    <CoverageCallout
      tone="warning"
      title="Scan incomplete"
      listIntro="Some content couldn't be read, so the links in it aren't in this report:"
      warnings={issues(count)}
      uiLocale="en"
    />,
  );
  return screen.getByRole('alert');
}

describe('CoverageCallout', () => {
  it('preserves the small issue list expansion, with its controls under the callout', async () => {
    const user = userEvent.setup();
    const callout = show(8);
    expect(within(callout).getAllByRole('listitem')).toHaveLength(5);
    const toggle = screen.getByRole('button', { name: 'Show all 8 issues' });
    // A callout holds no buttons.
    expect(callout).not.toContainElement(toggle);
    await user.click(toggle);
    expect(within(callout).getAllByRole('listitem')).toHaveLength(8);
    expect(screen.queryByRole('navigation')).not.toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: 'Show fewer issues' }));
    expect(within(callout).getAllByRole('listitem')).toHaveLength(5);
  });

  it('shows no controls for 5 issues or fewer', () => {
    const callout = show(5);
    expect(within(callout).getAllByRole('listitem')).toHaveLength(5);
    expect(screen.queryByRole('button')).not.toBeInTheDocument();
  });

  it('pages more than 100 issues, 50 at a time', async () => {
    const user = userEvent.setup();
    const callout = show(120);
    await user.click(screen.getByRole('button', { name: 'Show 120 issues' }));
    expect(within(callout).getAllByRole('listitem')).toHaveLength(50);
    const pages = screen.getByRole('navigation', {
      name: 'Content issues pagination',
    });
    expect(callout).not.toContainElement(pages);
    fireEvent.click(within(pages).getByRole('button', { name: 'Next page' }));
    expect(within(callout).getByText('Issue 50')).toBeInTheDocument();
    fireEvent.click(within(pages).getByRole('button', { name: 'Next page' }));
    expect(within(callout).getAllByRole('listitem')).toHaveLength(20);
    expect(within(callout).getByText('Issue 119')).toBeInTheDocument();
  });

  it('warns about unread content while a scan runs, and says nothing otherwise', () => {
    const { rerender } = renderInCanvas(
      <RunningCoverageCallout warnings={[]} uiLocale="en" />,
    );
    expect(screen.queryByRole('alert')).not.toBeInTheDocument();
    rerender(
      <RunningCoverageCallout
        warnings={['Hero › Body (en) › Link: Not found']}
        uiLocale="en"
      />,
    );
    const callout = screen.getByRole('alert');
    expect(
      within(callout).getByText("Some content couldn't be read"),
    ).toBeInTheDocument();
    expect(
      within(callout).getByText("The links in it aren't in this report:"),
    ).toBeInTheDocument();
    // Warning paths read with " > ".
    expect(within(callout).getByRole('listitem')).toHaveTextContent(
      'Hero > Body (en) > Link: Not found',
    );
  });
});

describe('coverageText', () => {
  it('explains what a settled report leaves out', () => {
    const cancelled =
      "It covers only the records read and the URLs processed until then. URLs that weren't checked show as “Not checked”.";
    const unread =
      "Some content couldn't be read, so the links in it aren't in this report:";
    expect(coverageText('complete', [], 0, 'en')).toEqual({});
    expect(coverageText('cancelled', [], 3, 'en')).toEqual({ lead: cancelled });
    // A canceled scan that left content unread still says what it covers,
    // in one sentence, then lists that content: two sentences in all.
    expect(coverageText('cancelled', ['Issue'], 0, 'en')).toEqual({
      lead: "It covers only the records read until then, and URLs that weren't checked show as “Not checked”.",
      listIntro: unread,
    });
    // Unread content explains the gap before the URLs that weren't checked.
    expect(coverageText('partial', ['Issue'], 4, 'en')).toEqual({
      listIntro: unread,
    });
    expect(coverageText('partial', [], 1, 'en').lead).toBe(
      "1 URL wasn't checked. Recheck it, or scan again.",
    );
    expect(coverageText('partial', [], 1200, 'en').lead).toBe(
      "1,200 URLs weren't checked. Recheck them one by one, or scan again.",
    );
    expect(coverageText('partial', [], 0, 'en')).toEqual({});
  });
});
