import { act, cleanup, screen, waitFor } from '@testing-library/react';
import RowList from 'datocms-react-ui/RowList';
import { afterEach, describe, expect, it } from 'vitest';
import { makeCtx, renderWithCanvas } from '../../test/renderWithCanvas';
import type { ProgressUpdate } from '../../utils/translation/ItemsDropdownUtils';
import { ProgressRow } from './ProgressRow';

const warned: ProgressUpdate = {
  recordIndex: 0,
  recordId: 'r1',
  status: 'completed',
  recordLabel: 'Alpine Trail',
  statusText: 'Translated',
  itemTypeId: 'm1',
  warnings: [
    'Copied linked records in "related".',
    'Skipped the empty field "summary".',
  ],
};

const RECORD_PATH = '/editor/item_types/m1/items/r1/edit';

function renderRow(
  update: ProgressUpdate,
  { recordPath, runEnded }: { recordPath?: string; runEnded?: boolean } = {},
) {
  return renderWithCanvas(
    <RowList>
      <ProgressRow
        update={update}
        recordPath={recordPath}
        runEnded={runEnded}
      />
    </RowList>,
    makeCtx({ site: { attributes: { internal_domain: 'admin.example' } } }),
  );
}

describe('ProgressRow', () => {
  afterEach(cleanup);

  it('opens the record editor, a page of the CMS, in a new tab', () => {
    renderRow(warned, { recordPath: RECORD_PATH });

    expect(screen.getByText('Alpine Trail')).toBeTruthy();
    const link = screen.getByRole('link', { name: 'Open the record' });
    // The Canvas gives the path its absolute URL on the internal domain.
    expect(link.getAttribute('href')).toBe(
      `https://admin.example${RECORD_PATH}`,
    );
    expect(link.getAttribute('target')).toBe('_blank');
  });

  it('counts the warnings and shows every one in a tooltip on focus', async () => {
    renderRow(warned, { recordPath: RECORD_PATH });

    const line = screen.getByText(/^Translated with 2 warnings:/);
    expect(line.textContent).toContain('Copied linked records');
    // The tooltip shows only while the line is hovered or focused.
    expect(screen.queryByRole('tooltip')).toBeNull();
    act(() => line.focus());
    const tooltip = await screen.findByRole('tooltip');
    expect(tooltip.textContent).toContain('Copied linked records');
    expect(tooltip.textContent).toContain('Skipped the empty field');
    act(() => line.blur());
    await waitFor(() => expect(screen.queryByRole('tooltip')).toBeNull());
  });

  it('shows no link, tooltip or warning for a clean row', () => {
    const clean: ProgressUpdate = { ...warned, warnings: undefined };
    renderRow(clean);

    expect(screen.queryByRole('link')).toBeNull();
    expect(screen.getByText('Alpine Trail')).toBeTruthy();
    expect(screen.getByText('Translated')).toBeTruthy();
    expect(screen.queryByText(/warning/i)).toBeNull();
    expect(screen.queryByRole('tooltip')).toBeNull();
    // Without warnings, the line is not a stop of the keyboard.
    expect(screen.getByText('Translated').getAttribute('tabindex')).toBeNull();
  });

  it('says "a warning" for a single warning', () => {
    renderRow({ ...warned, warnings: ['Skipped the empty field "summary".'] });

    expect(
      screen
        .getByText(
          'Translated with a warning: Skipped the empty field "summary".',
        )
        .getAttribute('tabindex'),
    ).toBe('0');
  });

  it('names a record without a label by its ID and shows its error', () => {
    renderRow({
      recordIndex: 1,
      recordId: 'r2',
      status: 'error',
      statusText: 'Record is no longer available',
      warnings: ['The record was deleted or is no longer accessible.'],
    });

    expect(screen.getByText('Record r2')).toBeTruthy();
    expect(
      screen.getByText(
        'Record is no longer available: The record was deleted or is no longer accessible.',
      ),
    ).toBeTruthy();
  });

  it('shows the step of a record that is being translated', () => {
    const { container } = renderRow({
      recordIndex: 2,
      recordId: 'r3',
      status: 'processing',
      recordLabel: 'Lake Walk',
      statusText: 'Translating to Italian [it]…',
    });

    expect(screen.getByText('Translating to Italian [it]…')).toBeTruthy();
    expect(container.querySelector('.Spinner')).not.toBeNull();
    expect(screen.queryByRole('tooltip')).toBeNull();
  });

  it('stops loading a record that the run left in progress', () => {
    const { container } = renderRow(
      {
        recordIndex: 2,
        recordId: 'r3',
        status: 'processing',
        recordLabel: 'Lake Walk',
        statusText: 'Translating to Italian [it]…',
      },
      { runEnded: true },
    );

    expect(screen.getByText('Stopped')).toBeTruthy();
    expect(screen.queryByText('Translating to Italian [it]…')).toBeNull();
    expect(container.querySelector('.Spinner')).toBeNull();
  });
});
