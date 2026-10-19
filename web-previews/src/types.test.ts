import { describe, expect, it } from 'vitest';
import { isValidPreviewLink, isValidResponse } from './types';

describe('isValidPreviewLink', () => {
  it('accepts an absolute http(s) URL with a label', () => {
    expect(isValidPreviewLink({ label: 'Draft', url: 'https://a.com/x' })).toBe(
      true,
    );
    expect(
      isValidPreviewLink({ label: 'Local', url: 'http://localhost:4000/' }),
    ).toBe(true);
  });

  it.each([
    ['relative URL', { label: 'Draft', url: '/x' }],
    ['malformed URL', { label: 'Draft', url: 'not a url' }],
    ['non-http URL', { label: 'Draft', url: 'javascript:alert(1)' }],
    ['missing label', { url: 'https://a.com' }],
    ['non-string url', { label: 'Draft', url: 42 }],
    ['null', null],
  ])('rejects a %s', (_name, data) => {
    expect(isValidPreviewLink(data)).toBe(false);
  });
});

describe('isValidResponse', () => {
  it('accepts any previewLinks array, leaving links to be checked one by one', () => {
    expect(isValidResponse({ previewLinks: [{ url: '/x' }] })).toBe(true);
  });

  it('rejects payloads without a previewLinks array', () => {
    expect(isValidResponse({ previewLinks: 'x' })).toBe(false);
    expect(isValidResponse({})).toBe(false);
  });
});
