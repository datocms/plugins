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
    message:
      "This address isn't written correctly. Look for a space or a missing slash.",
  });

  if (!/^https?:\/\//i.test(value)) {
    if (/^https?:/i.test(value)) return invalid();
    return skipped(
      'Only full web addresses, starting with http or https, are checked.',
    );
  }

  // URL accepts embedded newlines and backslashes that are usually editor typos.
  for (const character of value) {
    const code = character.charCodeAt(0);
    if (code <= 32 || code === 127 || character === '\\') return invalid();
  }

  let parsed: URL;
  try {
    parsed = new URL(value);
  } catch {
    return invalid();
  }

  if (parsed.username || parsed.password) {
    return skipped("Links with a username or password aren't checked.");
  }

  const hostname = parsed.hostname.toLowerCase();
  const host = hostname.replace(/^\[|\]$/g, '').replace(/\.$/, '');
  if (host === 'localhost' || host.endsWith('.localhost')) {
    return skipped("Local addresses aren't checked.");
  }

  if (ipaddr.isValid(host) && ipaddr.process(host).range() !== 'unicast') {
    return skipped("Private network addresses aren't checked.");
  }

  parsed.hash = '';
  const url = parsed.href;
  return {
    key: url,
    url,
    hostname,
    status: 'queued',
    message: 'Waiting to check this link.',
  };
}
