import { describe, expect, it } from 'vitest';
import { displayHost, displayPath, displayUrl } from './urls';

describe('displayPath', () => {
  it('shows the redirect path of draft-mode URLs', () => {
    expect(
      displayPath('https://site.com/api/draft?token=s3cret&redirect=/blog/a'),
    ).toBe('/blog/a');
  });

  it('drops the token and keeps other params readable', () => {
    expect(displayPath('https://site.com/blog/a?token=s3cret&q=a b')).toBe(
      '/blog/a?q=a+b',
    );
  });

  it('returns malformed URLs unchanged instead of throwing', () => {
    expect(displayPath('/relative/path')).toBe('/relative/path');
    expect(displayHost('not a url')).toBe('');
    expect(displayUrl('/relative')).toBe('/relative');
  });
});

describe('displayUrl', () => {
  it('prefixes the host', () => {
    expect(displayUrl('https://site.com/api/draft?redirect=/a')).toBe(
      'site.com/a',
    );
  });
});
