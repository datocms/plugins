type ErrorInfo = {
  status?: number;
  headers: Record<string, string>;
  codes: string[];
  retryable: boolean;
  ambiguous: boolean;
};

function asObject(value: unknown): Record<string, unknown> {
  return value && typeof value === 'object'
    ? (value as Record<string, unknown>)
    : {};
}

export function getApiErrorInfo(error: unknown): ErrorInfo {
  const object = asObject(error);
  const response = asObject(object.response);
  const status =
    typeof response.status === 'number' ? response.status : undefined;
  const data = asObject(response.body).data;
  const entries = Array.isArray(data)
    ? data.map((item) => asObject(asObject(item).attributes))
    : [];
  const codes = entries
    .flatMap(({ code }) =>
      typeof code === 'string' && /^[A-Z_0-9]{1,100}$/.test(code) ? [code] : [],
    )
    .slice(0, 3);
  const headers: Record<string, string> = {};
  for (const [key, value] of Object.entries(asObject(response.headers))) {
    if (typeof value === 'string') headers[key.toLowerCase()] = value;
  }
  const transient = entries.some((entry) => entry.transient === true);
  return {
    status,
    headers,
    codes,
    retryable:
      status === undefined || status === 429 || status >= 500 || transient,
    ambiguous: status === undefined || status >= 500 || status < 400,
  };
}

// Never retain API errors: they contain authorization headers and response payloads.
export function describeApiError(error: unknown): string {
  const { status, codes } = getApiErrorInfo(error);
  return status === undefined
    ? 'Request failed.'
    : `HTTP ${status}${codes.length ? ` (${codes.join(', ')})` : ''}`;
}

export function retryDelay(
  error: unknown,
  attempt: number,
  now: number,
  random: number,
): number {
  const { headers } = getApiErrorInfo(error);
  const retryAfter = headers['retry-after'];
  const seconds = retryAfter !== undefined ? Number(retryAfter) : NaN;
  const date =
    retryAfter !== undefined && !Number.isFinite(seconds)
      ? Date.parse(retryAfter)
      : NaN;
  const reset = Number(headers['x-ratelimit-reset']);
  const backoff =
    Math.min(30_000, 1000 * 2 ** attempt) + Math.floor(random * 250);
  return Math.max(
    backoff,
    Number.isFinite(seconds) ? Math.max(0, seconds * 1000) : 0,
    Number.isFinite(date) ? Math.max(0, date - now) : 0,
    Number.isFinite(reset) ? Math.max(0, reset * 1000) : 0,
  );
}
