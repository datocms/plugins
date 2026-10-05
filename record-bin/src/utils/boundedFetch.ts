// Bounds both the connection and the response body of the legacy lambda
// restore request, with real cancellation.
async function bufferResponse(response: Response): Promise<Response> {
  const reader = response.body?.getReader();
  const chunks: Uint8Array<ArrayBuffer>[] = [];
  let bytes = 0;
  if (reader) {
    for (;;) {
      const chunk = await reader.read();
      if (chunk.done) break;
      bytes += chunk.value.byteLength;
      if (bytes > 16 * 1024 * 1024) {
        await reader.cancel();
        throw new Error('Response exceeded the bounded buffer.');
      }
      chunks.push(chunk.value);
    }
  }
  return new Response(
    response.status === 204 || response.status === 304
      ? null
      : new Blob(chunks),
    {
      status: response.status,
      statusText: response.statusText,
      headers: response.headers,
    },
  );
}

export function createBoundedFetch(timeoutMs = 30_000): typeof fetch {
  return async (input, init) => {
    const controller = new AbortController();
    const timer = setTimeout(
      () =>
        controller.abort(
          new DOMException('Request timed out.', 'TimeoutError'),
        ),
      timeoutMs,
    );
    try {
      const response = await fetch(input, {
        ...init,
        signal: controller.signal,
      });
      return await bufferResponse(response);
    } finally {
      clearTimeout(timer);
    }
  };
}
