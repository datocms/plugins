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

  it('shows every warning in the line, and in full in a tooltip on focus', async () => {
    renderRow(warned, { recordPath: RECORD_PATH });

    const line = screen.getByText(
      'Translated. Copied linked records in "related". Skipped the empty field "summary".',
      { exact: false },
    );
    // The line is cut with an ellipsis: the tooltip shows only while the
    // line is hovered or focused.
    expect(line.getAttribute('tabindex')).toBe('0');
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

  it('names a record without a label by its ID and shows its error', () => {
    renderRow({
      recordIndex: 1,
      recordId: 'r2',
      status: 'error',
      statusText: 'Failed',
      warnings: ["DeepL's usage limit is reached."],
    });

    expect(screen.getByText('Record r2')).toBeTruthy();
    expect(
      screen.getByText("Failed. DeepL's usage limit is reached.", {
        exact: false,
      }),
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

    expect(screen.getByText('Not translated')).toBeTruthy();
    expect(screen.queryByText('Translating to Italian [it]…')).toBeNull();
    expect(container.querySelector('.Spinner')).toBeNull();
  });
});
