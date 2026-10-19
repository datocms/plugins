/** Replacement marker shared by every redaction surface in the plugin. */
export const REDACTED_MARKER = '[redacted]';

const BEARER_PATTERN = /\b(Bearer\s+)[A-Za-z0-9._~+/-]+=*/gi;
const PROVIDER_KEY_PATTERN = /\bsk-[A-Za-z0-9_-]{12,}\b/g;
// `&` ends the value so a redacted URL query parameter keeps its siblings.
// The lookahead skips values the token pass already redacted, keeping
// `Authorization: Bearer [redacted]` readable.
const SECRET_KEY_VALUE_PATTERN =
  /(["']?(?:api[_-]?key|access[_-]?token|authorization|client[_-]?secret|password|secret|token)["']?\s*[:=]\s*["']?)(?!Bearer\s|\[redacted\])([^"',\s}\]&]+)/gi;

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
  redactCredentialTokens(value).replace(
    SECRET_KEY_VALUE_PATTERN,
    `$1${REDACTED_MARKER}`,
  );
