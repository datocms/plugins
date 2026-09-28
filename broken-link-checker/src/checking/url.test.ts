import { describe, expect, it } from 'vitest';
import { prepareUrl } from './url';

describe('prepareUrl', () => {
  it('normalizes origins and strips fragments without losing query or path', () => {
    expect(prepareUrl(' HTTPS://Example.COM:443/a?x=1&x=2#heading ')).toEqual({
      key: 'https://example.com/a?x=1&x=2',
      url: 'https://example.com/a?x=1&x=2',
      hostname: 'example.com',
      status: 'queued',
      message: 'Waiting to check this URL.',
    });
    expect(prepareUrl('https://example.com/a#one').key).toBe(
      prepareUrl('https://example.com/a#two').key,
    );
    expect(prepareUrl('https://example.com/a?x=1').key).not.toBe(
      prepareUrl('https://example.com/a?x=2').key,
    );
  });

  it.each([
    '',
    '/page',
    '../page',
    '#heading',
    '//example.com/page',
    'www.example.com',
    'mailto:editor@example.com',
    'tel:12345',
    'ftp://example.com/file',
    'javascript:alert(1)',
    'data:text/plain,hello',
  ])('skips unsupported targets: %s', (url) => {
    expect(prepareUrl(url).status).toBe('skipped');
  });

  it.each([
    'https://',
    'http:/example.com',
    'https:example.com',
    'https://exa mple.com',
    'https://example.com/a b',
    'https://example.com/line\nbreak',
    'https://example.com\\page',
    'https://[invalid]/',
    'http://256.256.256.256',
    'https://example.com:99999',
  ])('flags malformed HTTP(S) URLs: %s', (url) => {
    expect(prepareUrl(url).status).toBe('invalid');
  });

  it.each([
    'https://user:password@example.com/',
    'https://user@example.com/',
    'http://localhost',
    'http://LOCALHOST.',
    'http://test.localhost',
    'http://127.0.0.1',
    'http://127.1',
    'http://2130706433',
    'http://0x7f000001',
    'http://10.1.2.3',
    'http://172.16.0.1',
    'http://192.168.1.1',
    'http://169.254.1.1',
    'http://100.64.0.1',
    'http://0.0.0.0',
    'http://224.0.0.1',
    'http://[::1]',
    'http://[::]',
    'http://[fc00::1]',
    'http://[fe80::1]',
    'http://[::ffff:127.0.0.1]',
  ])('does not queue credentialed or non-public literal targets: %s', (url) => {
    expect(prepareUrl(url).status).toBe('skipped');
  });

  it.each([
    'http://example.com',
    'https://8.8.8.8',
    'https://[2606:4700:4700::1111]',
    'https://localhost.example.com',
    'https://münich.example',
  ])('accepts public targets: %s', (url) => {
    expect(prepareUrl(url).status).toBe('queued');
  });
});
