import { render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it, vi } from 'vitest';
import { CoverageCallout } from './CoverageCallout';

vi.mock(
  'datocms-react-ui',
  async () => (await import('../test/fixtures')).reactUi,
);

function show(count: number) {
  render(
    <CoverageCallout
      state="partial"
      scanning={false}
      warnings={Array.from({ length: count }, (_, index) => `Issue ${index}`)}
      notCheckedCount={0}
      uiLocale="en"
      scanAgain={{ disabledReason: null, onClick: vi.fn() }}
    />,
  );
}

describe('CoverageCallout at scale', () => {
  it('preserves the small issue list expansion', async () => {
    const user = userEvent.setup();
    show(8);
    expect(screen.getAllByRole('listitem')).toHaveLength(5);
    await user.click(screen.getByRole('button', { name: 'Show all 8 issues' }));
    expect(screen.getAllByRole('listitem')).toHaveLength(8);
    expect(screen.queryByRole('navigation')).not.toBeInTheDocument();
  });

  it('bounds expanded warnings and browses every issue using pages', async () => {
    const user = userEvent.setup();
    show(2_001);
    expect(screen.getAllByRole('listitem')).toHaveLength(5);
    await user.click(screen.getByRole('button', { name: 'Show 2,001 issues' }));
    expect(screen.getAllByRole('listitem')).toHaveLength(50);
    const pages = within(
      screen.getByRole('navigation', { name: 'Content reading issues' }),
    );
    expect(pages.getByText('Page 1 of 41')).toBeInTheDocument();
    expect(pages.getByRole('button', { name: '« Previous' })).toBeDisabled();
    await user.click(pages.getByRole('button', { name: 'Next »' }));
    expect(screen.queryByText('Issue 0')).not.toBeInTheDocument();
    expect(screen.getByText('Issue 50')).toBeInTheDocument();
    expect(screen.getAllByRole('listitem')).toHaveLength(50);
    await user.click(screen.getByRole('button', { name: 'Show fewer issues' }));
    expect(screen.getAllByRole('listitem')).toHaveLength(5);
    expect(screen.queryByRole('navigation')).not.toBeInTheDocument();
  });
});
