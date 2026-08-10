function ipv4Octets(hostname: string): number[] | undefined {
  const parts = hostname.split('.');
  if (parts.length !== 4) return undefined;
  const octets = parts.map((part) => Number(part));
  return octets.every(
    (octet) => Number.isInteger(octet) && octet >= 0 && octet <= 255,
  )
    ? octets
    : undefined;
}

function isNonPublicIpv4(hostname: string): boolean {
  const octets = ipv4Octets(hostname);
  if (!octets) return false;
  const [first = 0, second = 0] = octets;
  return (
    first === 0 ||
    first === 10 ||
    first === 127 ||
    (first === 100 && second >= 64 && second <= 127) ||
    (first === 169 && second === 254) ||
    (first === 172 && second >= 16 && second <= 31) ||
    (first === 192 && second === 168) ||
    first >= 224
  );
}

function isNonPublicIpv6(hostname: string): boolean {
  const normalized = hostname
    .toLocaleLowerCase()
    .replace(/^\[|\]$/gu, '')
    .split('%', 1)[0];
  if (!normalized.includes(':')) return false;
  if (
    normalized === '::' ||
    normalized === '::1' ||
    normalized.startsWith('fc') ||
    normalized.startsWith('fd') ||
    /^fe[89ab]/u.test(normalized) ||
    normalized.startsWith('ff')
  ) {
    return true;
  }
  const mappedIpv4 = normalized.match(/(?:^|:)ffff:(\d+\.\d+\.\d+\.\d+)$/u);
  return mappedIpv4 ? isNonPublicIpv4(mappedIpv4[1] ?? '') : false;
}

function isLocalHostname(hostname: string): boolean {
  const normalized = hostname.toLocaleLowerCase().replace(/\.$/u, '');
  return (
    normalized === 'localhost' ||
    normalized.endsWith('.localhost') ||
    normalized.endsWith('.local') ||
    isNonPublicIpv4(normalized) ||
    isNonPublicIpv6(normalized)
  );
}

/**
 * Accepts only browser-downloadable public HTTP(S) URLs. Literal private and
 * local-network targets are rejected before any request is made.
 */
export function parsePublicAssetUrl(rawUrl: string): URL {
  let url: URL;
  try {
    url = new URL(rawUrl);
  } catch {
    throw new Error('The asset URL is not valid.');
  }
  if (url.protocol !== 'https:' && url.protocol !== 'http:') {
    throw new Error('Asset URLs must use HTTP or HTTPS.');
  }
  if (url.username || url.password) {
    throw new Error('Asset URLs cannot contain credentials.');
  }
  if (isLocalHostname(url.hostname)) {
    throw new Error(
      'Asset URLs cannot point to this device or a private network. Attach the file from your computer instead.',
    );
  }
  return url;
}
