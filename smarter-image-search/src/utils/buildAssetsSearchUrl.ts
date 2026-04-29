const REGEX_META = /[.*+?^${}()|[\]\\]/g;

function escapeRegex(value: string): string {
  return value.replace(REGEX_META, '\\$&');
}

export function splitKeywords(input: string): string[] {
  return input
    .split(/\s+/)
    .map((token) => token.trim())
    .filter((token) => token.length > 0);
}

export function buildLookaheadPattern(keywords: string[]): string {
  return keywords.map((keyword) => `(?=.*${escapeRegex(keyword)})`).join('');
}

export function buildAssetsSearchUrl(rawInput: string): string | null {
  const keywords = splitKeywords(rawInput);
  if (keywords.length === 0) {
    return null;
  }

  const pattern = buildLookaheadPattern(keywords);
  const params = [
    `filter[fields][filename][matches][pattern]=${encodeURIComponent(pattern)}`,
    'filter[fields][filename][matches][case_sensitive]=false',
    'filter[fields][filename][matches][regexp]=true',
  ].join('&');

  return `/media/assets?${params}`;
}
