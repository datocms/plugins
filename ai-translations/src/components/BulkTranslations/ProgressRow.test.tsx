import { fireEvent, render, screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import type { ProgressUpdate } from '../../utils/translation/ItemsDropdownUtils';
import { ProgressRow } from './ProgressRow';

const warned: ProgressUpdate = {
  recordIndex: 0,
  recordId: 'r1',
  status: 'completed',
  recordLabel: 'Alpine Trail',
  statusText: 'Translated',
  itemTypeId: 'm1',
  warnings: ['Copied linked records in "related".'],
};

describe('ProgressRow', () => {
  it('links the record title to its editor URL in a new tab', () => {
    render(
      <ul>
        <ProgressRow update={warned} recordUrl="https://admin/r1" />
      </ul>,
    );
    const link = screen.getByRole('link', { name: 'Alpine Trail' });
    expect(link.getAttribute('href')).toBe('https://admin/r1');
    expect(link.getAttribute('target')).toBe('_blank');
    expect(link.getAttribute('rel')).toContain('noreferrer');
  });

  it('reveals warning detail in an expandable panel on click, not hover', () => {
    render(
      <ul>
        <ProgressRow update={warned} recordUrl="https://admin/r1" />
      </ul>,
    );
    expect(screen.getByText(/— with warnings/i)).toBeTruthy();
    const toggle = screen.getByRole('button', { name: /details/i });
    // Collapsed by default: hovering does nothing, the detail is absent.
    expect(toggle.getAttribute('aria-expanded')).toBe('false');
    fireEvent.mouseEnter(screen.getByRole('listitem'));
    expect(screen.queryByText(/Copied linked records/)).toBeNull();
    // Click expands the inline detail panel.
    fireEvent.click(toggle);
    expect(toggle.getAttribute('aria-expanded')).toBe('true');
    expect(screen.getByText(/Copied linked records/)).toBeTruthy();
    // Click again collapses it.
    fireEvent.click(toggle);
    expect(screen.queryByText(/Copied linked records/)).toBeNull();
  });

  it('exposes an error row detail via the same expandable panel', () => {
    const errored: ProgressUpdate = {
      ...warned,
      status: 'error',
      statusText: 'Failed',
      warnings: ['Featherlight Rain Jacket (#r1): rate limit exceeded'],
    };
    render(
      <ul>
        <ProgressRow update={errored} />
      </ul>,
    );
    // Hidden until the disclosure is clicked (no hover reveal).
    expect(screen.queryByText(/rate limit exceeded/i)).toBeNull();
    fireEvent.click(screen.getByRole('button', { name: /details/i }));
    expect(screen.getByText(/rate limit exceeded/i)).toBeTruthy();
  });

  it('renders a live "now translating" sub-line for an in-progress row', () => {
    const inProgress: ProgressUpdate = {
      recordIndex: 0,
      recordId: 'r1',
      status: 'processing',
      recordLabel: 'Alpine Trail',
      activeField: {
        field: 'title',
        toLocale: 'it',
        sourcePreview: 'Hello world',
      },
    };
    render(
      <ul>
        <ProgressRow update={inProgress} />
      </ul>,
    );
    expect(screen.getByText('title')).toBeTruthy();
    expect(screen.getByText('Hello world')).toBeTruthy();
  });

  it('shows no disclosure or suffix for a clean row', () => {
    const clean: ProgressUpdate = { ...warned, warnings: undefined };
    render(
      <ul>
        <ProgressRow update={clean} />
      </ul>,
    );
    expect(screen.queryByRole('link')).toBeNull();
    expect(screen.getByText('Alpine Trail')).toBeTruthy();
    expect(screen.queryByText(/with warnings/i)).toBeNull();
    expect(screen.queryByRole('button', { name: /details/i })).toBeNull();
  });
});
