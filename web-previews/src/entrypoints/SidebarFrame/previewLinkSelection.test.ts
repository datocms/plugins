import { describe, expect, it } from 'vitest';
import type { PreviewLinkWithFrontend } from '../../types';
import { reconcilePreviewLinkSelection } from './previewLinkSelection';

const link = (
  frontendName: string,
  label: string,
  url: string,
): PreviewLinkWithFrontend => ({
  frontendName,
  label,
  url,
  reloadPreviewOnRecordUpdate: false,
});

describe('reconcilePreviewLinkSelection', () => {
  const a = link('Prod', 'Draft', 'https://a.com/x');
  const b = link('Staging', 'Draft', 'https://b.com/x');

  it('picks the first link without a selection', () => {
    expect(
      reconcilePreviewLinkSelection({
        selectedPreviewLink: undefined,
        previewLinks: [a, b],
      }),
    ).toBe(a);
  });

  it('returns undefined without links', () => {
    expect(
      reconcilePreviewLinkSelection({
        selectedPreviewLink: a,
        previewLinks: [],
      }),
    ).toBeUndefined();
  });

  it('keeps the same URL on refresh', () => {
    const refreshed = { ...b };
    expect(
      reconcilePreviewLinkSelection({
        selectedPreviewLink: b,
        previewLinks: [a, refreshed],
      }),
    ).toBe(refreshed);
  });

  it('follows a unique label when the URL changes', () => {
    const moved = link('Staging', 'Draft', 'https://b.com/new-slug');
    expect(
      reconcilePreviewLinkSelection({
        selectedPreviewLink: b,
        previewLinks: [a, moved],
      }),
    ).toBe(moved);
  });

  it('stays on the same frontend when the label is gone', () => {
    const renamed = link('Staging', 'Preview', 'https://b.com/y');
    expect(
      reconcilePreviewLinkSelection({
        selectedPreviewLink: b,
        previewLinks: [a, renamed],
      }),
    ).toBe(renamed);
  });
});
