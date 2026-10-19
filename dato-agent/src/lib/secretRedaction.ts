/** Replacement marker shared by every redaction surface in the plugin. */
export const REDACTED_MARKER = '[redacted]';

const BEARER_PATTERN = /\b(Bearer\s+)[A-Za-z0-9._~+/-]+=*/gi;
const PROVIDER_KEY_PATTERN = /\bsk-[A-Za-z0-9_-]{12,}\b/g;
const SECRET_KEY = String.raw`["']?(?:api[_-]?key|access[_-]?token|authorization|client[_-]?secret|password|secret|token)["']?\s*[:=]\s*`;
// Skips values an earlier pass already redacted, so the output stays
// `Authorization: Bearer [redacted]`, not `[redacted] [redacted]`.
const ALREADY_REDACTED = String.raw`(?!["']?(?:[A-Za-z][\w-]*\s+)?\[redacted\])`;
// `Authorization: <scheme> <credential>`: keep a known scheme, drop the
// credential. Unknown first words fall through to the key/value pass below.
const AUTHORIZATION_SCHEME_PATTERN = new RegExp(
  String.raw`(\bauthorization["']?\s*[:=]\s*["']?)${ALREADY_REDACTED}((?:Basic|Bearer|Digest|DPoP|Negotiate|NTLM|Token|ApiKey|AWS4-HMAC-SHA256)\s+)[^"',\s}\]&]+`,
  'gi',
);
// Quoted values run to the closing quote (escapes included); bare values stop
// at a delimiter, and `&` ends one so URL query siblings survive.
const SECRET_KEY_VALUE_PATTERN = new RegExp(
  String.raw`(${SECRET_KEY})${ALREADY_REDACTED}(?:"(?:[^"\\]|\\.)*"|'(?:[^'\\]|\\.)*'|[^"',\s}\]&]+)`,
  'gi',
);

/**
 * Replaces one `key: value` match, preserving the value's quote style.
 *
 * @param match - The full match.
 * @param prefix - The key and separator.
 * @returns The prefix followed by the redacted value.
 */
const redactKeyValue = (match: string, prefix: string): string => {
  const quote = match.charAt(prefix.length);
  return quote === '"' || quote === "'"
    ? `${prefix}${quote}${REDACTED_MARKER}${quote}`
    : `${prefix}${REDACTED_MARKER}`;
};

/**
 * Redacts self-identifying credentials (`Bearer …` tokens and `sk-…` provider
 * keys) without touching surrounding structure. Safe for model-bound tool
 * output, where ordinary `token: value` content must survive.
 *
 * @param value - Text that can contain credentials.
 * @returns The text with credential tokens replaced by {@link REDACTED_MARKER}.
 */
export const redactCredentialTokens = (value: string): string =>
  value
    .replace(BEARER_PATTERN, `$1${REDACTED_MARKER}`)
    .replace(PROVIDER_KEY_PATTERN, REDACTED_MARKER);

/**
 * Redacts credential tokens plus `key=value` / `key: value` secrets, such as
 * `?access_token=…` in URLs or `"api_key": "…"` in serialized JSON. Use for
 * text that leaves the runtime: persisted conversations and diagnostics.
 *
 * @param value - Text that can contain credentials.
 * @returns The text with every recognized secret replaced by {@link REDACTED_MARKER}.
 */
export const redactSecrets = (value: string): string =>
  redactCredentialTokens(value)
    .replace(AUTHORIZATION_SCHEME_PATTERN, `$1$2${REDACTED_MARKER}`)
    .replace(SECRET_KEY_VALUE_PATTERN, redactKeyValue);
