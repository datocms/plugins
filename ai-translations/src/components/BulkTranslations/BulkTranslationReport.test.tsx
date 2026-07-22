import { fireEvent, render, screen } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { BulkReportRow } from '../../utils/translation/bulkReport';
import { BulkTranslationReport } from './BulkTranslationReport';

vi.mock('../../utils/downloadTextFile', () => ({
  downloadTextFile: vi.fn(),
}));

import { downloadTextFile } from '../../utils/downloadTextFile';

const rows: BulkReportRow[] = [
  {
    recordId: '42',
    recordTitle: 'Grand Hotel',
    editUrl: 'https://admin.datocms.com/editor/item_types/m1/items/42/edit',
    status: 'error',
    fieldPath: 'title',
    locale: 'fr',
    severity: 'error',
    checkId: 'length-validator',
    reason: 'Translation is 80 characters but the field allows at most 60.',
  },
  {
    recordId: '7',
    status: 'completed-with-warnings',
    fieldPath: 'subtitle',
    locale: 'de',
    severity: 'warning',
    checkId: 'no-op',
    reason: 'Unchanged from source.',
  },
];

describe('BulkTranslationReport', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    Object.defineProperty(navigator, 'clipboard', {
      value: { writeText: vi.fn().mockResolvedValue(undefined) },
      configurable: true,
    });
  });

  it('renders every flagged row (no truncation)', () => {
    render(<BulkTranslationReport rows={rows} onClose={vi.fn()} />);
    // getByText throws when absent, so a successful lookup asserts presence.
    expect(screen.getByText(/at most 60/)).toBeTruthy();
    expect(screen.getByText(/Unchanged from source/)).toBeTruthy();
    // Both record ids appear.
    expect(screen.getByText(/42/)).toBeTruthy();
    expect(screen.getByText(/\b7\b/)).toBeTruthy();
  });

  it('links the record title to its editor and still shows the record id', () => {
    render(<BulkTranslationReport rows={rows} onClose={vi.fn()} />);
    const link = screen.getByRole('link', { name: 'Grand Hotel' });
    expect(link.getAttribute('href')).toBe(
      'https://admin.datocms.com/editor/item_types/m1/items/42/edit',
    );
    expect(link.getAttribute('target')).toBe('_blank');
    expect(link.getAttribute('rel')).toBe('noreferrer');
    // The opaque id remains visible/copyable next to the title.
    expect(screen.getByText('42')).toBeTruthy();
  });

  // The two menus each render Plaintext/CSV/JSON options; getAllByRole returns
  // them in DOM order — Copy menu first, then Export menu.
  const copyOption = (name: RegExp) =>
    screen.getAllByRole('button', { name })[0];
  const exportOption = (name: RegExp) =>
    screen.getAllByRole('button', { name })[1];

  it('offers Copy and Export dropdowns, each with Plaintext/CSV/JSON', () => {
    render(<BulkTranslationReport rows={rows} onClose={vi.fn()} />);
    expect(screen.getByRole('button', { name: /copy report as/i })).toBeTruthy();
    expect(screen.getByRole('button', { name: /export report as/i })).toBeTruthy();
    expect(screen.getAllByRole('button', { name: /^CSV$/ })).toHaveLength(2);
    expect(screen.getAllByRole('button', { name: /^JSON$/ })).toHaveLength(2);
    expect(screen.getAllByRole('button', { name: /^Plaintext$/ })).toHaveLength(2);
  });

  it('exports CSV/JSON carrying the human report plus the machine token column', () => {
    const withToken = [
      { ...rows[0], machineReadableStatus: 'v1:token-42' },
      rows[1],
    ];
    render(<BulkTranslationReport rows={withToken} onClose={vi.fn()} />);

    fireEvent.click(exportOption(/^CSV$/));
    const [filename, mime, csv] = vi.mocked(downloadTextFile).mock.calls[0];
    expect(filename).toMatch(/\.csv$/);
    expect(mime).toContain('csv');
    // Human detail AND the machine column.
    expect(csv).toContain('length-validator');
    expect(csv).toContain('Machine readable status');
    expect(csv).toContain('v1:token-42');

    fireEvent.click(exportOption(/^JSON$/));
    const [, , json] = vi.mocked(downloadTextFile).mock.calls[1];
    expect(json).toContain('length-validator');
    expect(json).toContain('machineReadableStatus');
    expect(json).toContain('v1:token-42');
  });

  it('copies the report as plaintext to the clipboard', () => {
    render(<BulkTranslationReport rows={rows} onClose={vi.fn()} />);
    fireEvent.click(copyOption(/^Plaintext$/));
    expect(navigator.clipboard.writeText).toHaveBeenCalledTimes(1);
    const copied = vi.mocked(navigator.clipboard.writeText).mock.calls[0][0];
    expect(copied).toMatch(/across 2 records/i);
    expect(copied).toContain('Grand Hotel');
  });

  it('invokes onClose when the close control is clicked', () => {
    const onClose = vi.fn();
    render(<BulkTranslationReport rows={rows} onClose={onClose} />);
    fireEvent.click(screen.getByRole('button', { name: /close|dismiss/i }));
    expect(onClose).toHaveBeenCalledTimes(1);
  });
});
