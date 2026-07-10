import { describe, expect, it } from 'vitest';
import { parseRetryAfter, retryAfterFromHeaders } from './retryAfter';

const NOW = Date.parse('2015-10-21T07:28:00Z');

describe('parseRetryAfter', () => {
  it('parses delta-seconds', () => expect(parseRetryAfter('120', NOW)).toBe(120_000));
  it('parses zero', () => expect(parseRetryAfter('0', NOW)).toBe(0));
  it('parses an HTTP-date in the future', () =>
    expect(parseRetryAfter('Wed, 21 Oct 2015 07:29:00 GMT', NOW)).toBe(60_000));
  it('clamps a past HTTP-date to 0', () =>
    expect(parseRetryAfter('Wed, 21 Oct 2015 07:27:00 GMT', NOW)).toBe(0));
  it('returns undefined for junk', () => expect(parseRetryAfter('soon', NOW)).toBeUndefined());
  it('returns undefined for null/empty', () => {
    expect(parseRetryAfter(null, NOW)).toBeUndefined();
    expect(parseRetryAfter('', NOW)).toBeUndefined();
  });
  it('rejects negative delta-seconds', () => expect(parseRetryAfter('-5', NOW)).toBeUndefined());
});

describe('retryAfterFromHeaders', () => {
  it('reads a Headers instance', () =>
    expect(retryAfterFromHeaders(new Headers({ 'retry-after': '30' }), NOW)).toBe(30_000));
  it('reads a plain record case-insensitively', () =>
    expect(retryAfterFromHeaders({ 'Retry-After': '30' }, NOW)).toBe(30_000));
  it('returns undefined when the header is absent (CORS-hidden)', () =>
    expect(retryAfterFromHeaders(new Headers(), NOW)).toBeUndefined());
  it('returns undefined for a non-headers value', () =>
    expect(retryAfterFromHeaders(undefined, NOW)).toBeUndefined());
});
