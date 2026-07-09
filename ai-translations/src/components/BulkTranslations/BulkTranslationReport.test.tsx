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

  it('downloads a CSV with the report when "Download CSV" is clicked', () => {
    render(<BulkTranslationReport rows={rows} onClose={vi.fn()} />);
    fireEvent.click(screen.getByRole('button', { name: /download csv/i }));
    expect(downloadTextFile).toHaveBeenCalledTimes(1);
    const [filename, mime, content] = vi.mocked(downloadTextFile).mock.calls[0];
    expect(filename).toMatch(/\.csv$/);
    expect(mime).toContain('csv');
    expect(content).toContain(
      'Record ID,Record title,Edit URL,Status,Field,Locale,Severity,Check,Reason',
    );
    expect(content).toContain('length-validator');
  });

  it('downloads JSON when "Download JSON" is clicked', () => {
    render(<BulkTranslationReport rows={rows} onClose={vi.fn()} />);
    fireEvent.click(screen.getByRole('button', { name: /download json/i }));
    const [filename, mime, content] = vi.mocked(downloadTextFile).mock.calls[0];
    expect(filename).toMatch(/\.json$/);
    expect(mime).toContain('json');
    expect(JSON.parse(content)).toHaveLength(2);
  });

  it('copies the CSV report to the clipboard when "Copy" is clicked', () => {
    render(<BulkTranslationReport rows={rows} onClose={vi.fn()} />);
    fireEvent.click(screen.getByRole('button', { name: /copy/i }));
    expect(navigator.clipboard.writeText).toHaveBeenCalledTimes(1);
    expect(
      vi.mocked(navigator.clipboard.writeText).mock.calls[0][0],
    ).toContain('length-validator');
  });

  it('invokes onClose when the close control is clicked', () => {
    const onClose = vi.fn();
    render(<BulkTranslationReport rows={rows} onClose={onClose} />);
    fireEvent.click(screen.getByRole('button', { name: /close|dismiss/i }));
    expect(onClose).toHaveBeenCalledTimes(1);
  });
});
