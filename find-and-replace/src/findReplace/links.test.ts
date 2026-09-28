import { describe, expect, it } from 'vitest';
import { parseRecordKey, recordEditorPath, recordLink } from './links';

describe('recordLink', () => {
  it('opens the record on the admin domain in the primary environment', () => {
    expect(
      recordLink(
        {
          internalDomain: 'acme.admin.datocms.com',
          isEnvironmentPrimary: true,
          environment: 'main',
        },
        'article',
        'a1',
      ),
    ).toEqual({
      kind: 'href',
      href: 'https://acme.admin.datocms.com/editor/item_types/article/items/a1/edit',
    });
  });

  it('adds the environment on a sandbox', () => {
    expect(
      recordLink(
        {
          internalDomain: 'acme.admin.datocms.com',
          isEnvironmentPrimary: false,
          environment: 'feature-x',
        },
        'article',
        'a1',
      ),
    ).toEqual({
      kind: 'href',
      href: 'https://acme.admin.datocms.com/environments/feature-x/editor/item_types/article/items/a1/edit',
    });
  });

  it('falls back to a path for `navigateTo` without an admin domain', () => {
    expect(
      recordLink(
        {
          internalDomain: null,
          isEnvironmentPrimary: false,
          environment: 'feature-x',
        },
        'article',
        'a1',
      ),
    ).toEqual({
      kind: 'path',
      path: '/environments/feature-x/editor/item_types/article/items/a1/edit',
    });
    expect(
      recordEditorPath(
        { isEnvironmentPrimary: true, environment: 'main' },
        'page',
        'p1',
      ),
    ).toBe('/editor/item_types/page/items/p1/edit');
  });
});

describe('parseRecordKey', () => {
  it('splits a record key into model and record ids', () => {
    expect(parseRecordKey('article:a1')).toEqual({
      modelId: 'article',
      recordId: 'a1',
    });
    expect(parseRecordKey('a1')).toBeNull();
    expect(parseRecordKey(':a1')).toBeNull();
    expect(parseRecordKey('article:')).toBeNull();
  });
});
