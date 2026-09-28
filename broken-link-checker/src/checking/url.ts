import * as ipaddr from 'ipaddr.js';
import type { PreparedUrl } from '../types';

/** Prepare only public, absolute HTTP(S) links for the remote checker. */
export function prepareUrl(raw: string): PreparedUrl {
  const value = raw.trim();
  const skipped = (message: string): PreparedUrl => ({
    key: value,
    url: value,
    status: 'skipped',
    message,
  });
  const invalid = (): PreparedUrl => ({
    key: value,
    url: value,
    status: 'invalid',
    message: 'This is not a valid absolute HTTP or HTTPS URL.',
  });

  if (!/^https?:\/\//i.test(value)) {
    if (/^https?:/i.test(value)) return invalid();
    return skipped('Only absolute HTTP and HTTPS URLs can be checked.');
  }

  // URL accepts embedded newlines and backslashes that are usually editor typos.
  if (
    [...value].some(
      (character) =>
        character.charCodeAt(0) <= 32 ||
        character.charCodeAt(0) === 127 ||
        character === '\\',
    )
  )
    return invalid();

  let parsed: URL;
  try {
    parsed = new URL(value);
  } catch {
    return invalid();
  }

  if (parsed.username || parsed.password) {
    return skipped('URLs containing credentials are not sent to the checker.');
  }

  const hostname = parsed.hostname.toLowerCase();
  const host = hostname.replace(/^\[|\]$/g, '').replace(/\.$/, '');
  if (host === 'localhost' || host.endsWith('.localhost')) {
    return skipped('Localhost URLs are not checked.');
  }

  if (ipaddr.isValid(host) && ipaddr.process(host).range() !== 'unicast') {
    return skipped(
      'Private, local, and reserved IP addresses are not checked.',
    );
  }

  parsed.hash = '';
  const url = parsed.href;
  return {
    key: url,
    url,
    hostname,
    status: 'queued',
    message: 'Waiting to check this URL.',
  };
}
