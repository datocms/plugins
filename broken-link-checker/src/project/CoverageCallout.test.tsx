import { render, screen } from '@testing-library/react';
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
});
