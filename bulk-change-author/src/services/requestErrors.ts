function asObject(value: unknown): Record<string, unknown> {
  return value && typeof value === 'object'
    ? (value as Record<string, unknown>)
    : {};
}

/** Short summary of a CMA error: its HTTP status and DatoCMS error codes. */
export function describeApiError(error: unknown): string {
  const response = asObject(asObject(error).response);
  if (typeof response.status !== 'number') return 'Request failed.';
  const data = asObject(response.body).data;
  const codes = (Array.isArray(data) ? data : [])
    .map((entry) => asObject(asObject(entry).attributes).code)
    .filter((code): code is string => typeof code === 'string')
    .slice(0, 3);
  return `HTTP ${response.status}${codes.length ? ` (${codes.join(', ')})` : ''}`;
}

export function isAuthenticationError(error: unknown): boolean {
  return asObject(asObject(error).response).status === 401;
}
