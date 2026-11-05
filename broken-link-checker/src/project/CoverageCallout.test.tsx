import { fireEvent, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it } from 'vitest';
import { renderInCanvas } from '../test/canvas';
import {
  CoverageCallout,
  coverageText,
  RunningCoverageCallout,
} from './CoverageCallout';

const SHOW_UNREAD = "Show what couldn't be read";

const issues = (count: number) =>
  Array.from({ length: count }, (_, index) => `Issue ${index}`);

function show(count: number) {
  renderInCanvas(
    <CoverageCallout
      tone="warning"
      title="Scan incomplete"
      listIntro="Some content couldn't be read, so its links aren't in this report."
      warnings={issues(count)}
      uiLocale="en"
    />,
  );
  return screen.getByRole('alert');
}

describe('CoverageCallout', () => {
  it('shows the issues on demand, with their controls under the callout', async () => {
    const user = userEvent.setup();
    const callout = show(8);
    // The callout stays short: its sentence, and the issues behind a button.
    expect(screen.queryByRole('listitem')).not.toBeInTheDocument();
    const toggle = screen.getByRole('button', { name: SHOW_UNREAD });
    // A callout holds no buttons.
    expect(callout).not.toContainElement(toggle);
    await user.click(toggle);
    expect(screen.getAllByRole('listitem')).toHaveLength(8);
    // Nor a list: the issues show under it.
    expect(callout).not.toContainElement(screen.getByRole('list'));
    expect(screen.queryByRole('navigation')).not.toBeInTheDocument();
    await user.click(
      screen.getByRole('button', { name: "Hide what couldn't be read" }),
    );
    expect(screen.queryByRole('listitem')).not.toBeInTheDocument();
  });

  it('names a model once when a field of it gives the same reason', async () => {
    const user = userEvent.setup();
    renderInCanvas(
      <CoverageCallout
        tone="warning"
        listIntro="Some content couldn't be read, so its links aren't in this report."
        warnings={[
          "Article: Some blocks couldn't be read.",
          "Article › Content: Some blocks couldn't be read.",
          'Author: Access was refused.',
        ]}
        uiLocale="en"
      />,
    );
    await user.click(screen.getByRole('button', { name: SHOW_UNREAD }));
    expect(
      screen.getAllByRole('listitem').map((item) => item.textContent),
    ).toEqual([
      "Article > Content: Some blocks couldn't be read.",
      'Author: Access was refused.',
    ]);
  });

  it('says each reason once, after the places that give it', async () => {
    const user = userEvent.setup();
    renderInCanvas(
      <CoverageCallout
        tone="warning"
        listIntro="Some content couldn't be read, so its links aren't in this report."
        warnings={[
          "Article › Content: Some blocks couldn't be read.",
          "Event: Your role can't see these records.",
          "Job posting: Your role can't see these records.",
          "Landing page › Sections: Some blocks couldn't be read.",
        ]}
        uiLocale="en"
      />,
    );
    await user.click(screen.getByRole('button', { name: SHOW_UNREAD }));
    expect(
      screen.getAllByRole('listitem').map((item) => item.textContent),
    ).toEqual([
      "Article > Content, Landing page > Sections: Some blocks couldn't be read.",
      "Event, Job posting: Your role can't see these records.",
    ]);
  });

  it('pages more than 100 issues, 50 at a time', async () => {
    const user = userEvent.setup();
    const callout = show(120);
    await user.click(screen.getByRole('button', { name: SHOW_UNREAD }));
    expect(screen.getAllByRole('listitem')).toHaveLength(50);
    const pages = screen.getByRole('navigation', {
      name: 'Content issues pagination',
    });
    expect(callout).not.toContainElement(pages);
    fireEvent.click(within(pages).getByRole('button', { name: 'Next page' }));
    expect(screen.getByText('Issue 50')).toBeInTheDocument();
    fireEvent.click(within(pages).getByRole('button', { name: 'Next page' }));
    expect(screen.getAllByRole('listitem')).toHaveLength(20);
    expect(screen.getByText('Issue 119')).toBeInTheDocument();
  });

  it('warns about unread content while a scan runs, and says nothing otherwise', async () => {
    const user = userEvent.setup();
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
      within(callout).getByText("Its links aren't in this report."),
    ).toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: SHOW_UNREAD }));
    // Warning paths read with " > ".
    expect(screen.getByRole('listitem')).toHaveTextContent(
      'Hero > Body (en) > Link: Not found',
    );
  });
});

describe('coverageText', () => {
  it('explains what a settled report leaves out', () => {
    const cancelled =
      'This report covers only what was checked before you stopped the scan.';
    const unread =
      "Some content couldn't be read, so its links aren't in this report.";
    expect(coverageText('complete', [], 0, 'en')).toEqual({});
    // The facts under it count the links not checked.
    expect(coverageText('cancelled', [], 3, 'en')).toEqual({
      lead: cancelled,
      listIntro: undefined,
    });
    // A canceled scan that left content unread says what it covers, then
    // that some content couldn't be read: two sentences in all.
    expect(coverageText('cancelled', ['Issue'], 0, 'en')).toEqual({
      lead: cancelled,
      listIntro: unread,
    });
    // Unread content explains the gap before the URLs that weren't checked.
    expect(coverageText('partial', ['Issue'], 4, 'en')).toEqual({
      listIntro: unread,
    });
    expect(coverageText('partial', [], 1, 'en').lead).toBe(
      "1 link wasn't checked. Recheck it, or scan again.",
    );
    expect(coverageText('partial', [], 1200, 'en').lead).toBe(
      "1,200 links weren't checked. Recheck them one by one, or scan again.",
    );
    expect(coverageText('partial', [], 0, 'en')).toEqual({});
  });
});
