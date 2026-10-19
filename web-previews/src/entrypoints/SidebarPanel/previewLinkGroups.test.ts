import { describe, expect, it } from 'vitest';
import type { PreviewLink } from '../../types';
import { groupLinksByPage, primaryLinkOf } from './previewLinkGroups';

const link = (label: string, url: string): PreviewLink => ({
  label,
  url,
  reloadPreviewOnRecordUpdate: false,
});

const draft = link('Draft version', 'https://site.com/api/draft?redirect=/a');
const published = link(
  'Published version',
  'https://site.com/api/draft/disable?redirect=/a',
);
const other = link('Other', 'https://site.com/b');

describe('groupLinksByPage', () => {
  it('groups draft and published links of the same page', () => {
    const groups = groupLinksByPage([published, draft, other]);
    expect([...groups.keys()]).toEqual(['site.com/a', 'site.com/b']);
    expect(groups.get('site.com/a')).toEqual([published, draft]);
  });
});

describe('primaryLinkOf', () => {
  it('prefers the link on the draft-mode route', () => {
    expect(
      primaryLinkOf([published, draft], 'https://site.com/api/draft?token=x'),
    ).toBe(draft);
  });

  it('falls back to a "draft" label, then the first link', () => {
    expect(primaryLinkOf([published, draft], undefined)).toBe(draft);
    expect(primaryLinkOf([published, other], undefined)).toBe(published);
  });
});
