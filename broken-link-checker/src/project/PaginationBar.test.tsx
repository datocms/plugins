import { render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import { PaginationBar, pageWindowFor } from './PaginationBar';

vi.mock(
  'datocms-react-ui',
  async () => (await import('../test/fixtures')).reactUi,
);

describe('PaginationBar', () => {
  it('fits the page numbers to the main pane, and to the frame until the pane is measured', () => {
    // The Info sidebar leaves 650px of a 1000px frame.
    expect(pageWindowFor(650, false)).toBe(5);
    expect(pageWindowFor(580, false)).toBe(3);
    expect(pageWindowFor(800, false)).toBe(10);
    expect(pageWindowFor(undefined, false)).toBe(10);
    expect(pageWindowFor(undefined, true)).toBe(3);
  });

  it('drops "Show:" with the 3-page window', () => {
    const props = {
      page: 150,
      pageCount: 300,
      perPage: 50 as const,
      onPage: vi.fn(),
      onPerPage: vi.fn(),
    };
    const { rerender } = render(<PaginationBar {...props} pageWindow={5} />);
    expect(screen.getByLabelText('URLs per page')).toBeInTheDocument();
    expect(
      screen.getByRole('button', { name: 'Page 148' }),
    ).toBeInTheDocument();
    expect(
      screen.queryByRole('button', { name: 'Page 147' }),
    ).not.toBeInTheDocument();

    rerender(<PaginationBar {...props} pageWindow={3} />);
    expect(screen.queryByLabelText('URLs per page')).not.toBeInTheDocument();
    expect(
      screen.queryByRole('button', { name: 'Page 148' }),
    ).not.toBeInTheDocument();
    expect(
      screen.getByRole('button', { name: 'Page 149' }),
    ).toBeInTheDocument();
  });
});
