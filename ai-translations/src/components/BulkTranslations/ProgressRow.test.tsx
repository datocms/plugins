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

  it('appends "with warnings" and reveals the detail in a tooltip on hover', () => {
    render(
      <ul>
        <ProgressRow update={warned} recordUrl="https://admin/r1" />
      </ul>,
    );
    expect(screen.getByText(/with warnings/i)).toBeTruthy();
    // The tooltip is rendered only while the row is hovered/focused.
    expect(screen.queryByRole('tooltip')).toBeNull();
    const row = screen.getByRole('listitem');
    fireEvent.mouseEnter(row);
    expect(screen.getByRole('tooltip').textContent).toContain(
      'Copied linked records',
    );
    fireEvent.mouseLeave(row);
    expect(screen.queryByRole('tooltip')).toBeNull();
  });

  it('shows no tooltip or suffix for a clean row, even on hover', () => {
    const clean: ProgressUpdate = { ...warned, warnings: undefined };
    render(
      <ul>
        <ProgressRow update={clean} />
      </ul>,
    );
    expect(screen.queryByRole('link')).toBeNull();
    expect(screen.getByText('Alpine Trail')).toBeTruthy();
    expect(screen.queryByText(/with warnings/i)).toBeNull();
    fireEvent.mouseEnter(screen.getByRole('listitem'));
    expect(screen.queryByRole('tooltip')).toBeNull();
  });
});
