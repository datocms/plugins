import { afterEach, describe, expect, it, vi } from 'vitest';
import { checkUrl } from './client';
import { prepareUrl } from './url';

const prepared = prepareUrl('https://example.com/article?a=1&b=2#section');
const newSignal = () => new AbortController().signal;

function response(status: number) {
  const cancel = vi.fn().mockResolvedValue(undefined);
  return { value: { status, body: { cancel } } as unknown as Response, cancel };
}

afterEach(() => vi.useRealTimers());

describe('checkUrl', () => {
  it('uses a credential-free proxied HEAD and stops after success', async () => {
    const fetchRequest = vi
      .fn<typeof fetch>()
      .mockResolvedValue(response(204).value);
    const result = await checkUrl(prepared, newSignal(), {
      fetch: fetchRequest,
      maxRetries: 0,
    });
    expect(result).toMatchObject({
      key: prepared.key,
      status: 'reachable',
      method: 'HEAD',
      httpStatus: 204,
    });
    expect(fetchRequest).toHaveBeenCalledOnce();
    expect(fetchRequest.mock.calls[0]).toEqual([
      `https://cors-proxy.datocms.com/?url=${encodeURIComponent(prepared.url)}`,
      {
        method: 'HEAD',
        credentials: 'omit',
        referrerPolicy: 'no-referrer',
        signal: expect.any(AbortSignal),
      },
    ]);
  });

  it.each([
    301, 403, 404, 405, 410, 429, 500,
  ])('falls back from HEAD %s to GET and cancels the response body', async (status) => {
    const getResponse = response(200);
    const fetchRequest = vi
      .fn<typeof fetch>()
      .mockResolvedValueOnce(response(status).value)
      .mockResolvedValueOnce(getResponse.value);
    const result = await checkUrl(prepared, newSignal(), {
      fetch: fetchRequest,
      maxRetries: 0,
    });
    expect(result).toMatchObject({
      status: 'reachable',
      method: 'GET',
      httpStatus: 200,
    });
    expect(fetchRequest.mock.calls.map((call) => call[1]?.method)).toEqual([
      'HEAD',
      'GET',
    ]);
    expect(getResponse.cancel).toHaveBeenCalledOnce();
  });

  it.each([404, 410])('only confirms broken after GET %s', async (status) => {
    const fetchRequest = vi
      .fn<typeof fetch>()
      .mockResolvedValue(response(status).value);
    expect(
      await checkUrl(prepared, newSignal(), {
        fetch: fetchRequest,
        maxRetries: 0,
      }),
    ).toMatchObject({
      status: 'broken',
      httpStatus: status,
      method: 'GET',
    });
  });

  it.each([
    0, 301, 403, 405, 500, 503,
  ])('does not call a GET %s response broken', async (status) => {
    const fetchRequest = vi
      .fn<typeof fetch>()
      .mockResolvedValue(response(status).value);
    expect(
      await checkUrl(prepared, newSignal(), {
        fetch: fetchRequest,
        maxRetries: 0,
      }),
    ).toMatchObject({
      status: 'unverified',
      httpStatus: status,
      method: 'GET',
    });
  });

  it('allows retries to be disabled while retaining the HEAD fallback', async () => {
    const fetchRequest = vi
      .fn<typeof fetch>()
      .mockRejectedValue(new TypeError('network'));
    expect(
      await checkUrl(prepared, newSignal(), {
        fetch: fetchRequest,
        maxRetries: 0,
      }),
    ).toMatchObject({
      status: 'unverified',
      method: 'GET',
    });
    expect(fetchRequest).toHaveBeenCalledTimes(2);
  });

  it('times out each attempt after ten seconds even when an adapter ignores abort', async () => {
    vi.useFakeTimers();
    const fetchRequest = vi
      .fn<typeof fetch>()
      .mockImplementation(() => new Promise(() => {}));
    const result = checkUrl(prepared, newSignal(), {
      fetch: fetchRequest,
      maxRetries: 0,
    });
    await vi.advanceTimersByTimeAsync(9_999);
    expect(fetchRequest).toHaveBeenCalledTimes(1);
    await vi.advanceTimersByTimeAsync(1);
    expect(fetchRequest).toHaveBeenCalledTimes(2);
    expect(fetchRequest.mock.calls[0][1]?.signal?.aborted).toBe(true);
    await vi.advanceTimersByTimeAsync(10_000);
    expect(await result).toMatchObject({
      status: 'unverified',
      message: expect.stringContaining('timed out'),
    });
    expect(fetchRequest.mock.calls[1][1]?.signal?.aborted).toBe(true);
    expect(vi.getTimerCount()).toBe(0);
  });

  it('cancels active requests without attempting a GET fallback', async () => {
    const controller = new AbortController();
    const fetchRequest = vi
      .fn<typeof fetch>()
      .mockImplementation(() => new Promise(() => {}));
    const result = checkUrl(prepared, controller.signal, {
      fetch: fetchRequest,
      maxRetries: 0,
    });
    await Promise.resolve();
    controller.abort();
    expect(await result).toMatchObject({ status: 'cancelled' });
    expect(fetchRequest).toHaveBeenCalledOnce();
    expect(fetchRequest.mock.calls[0][1]?.signal?.aborted).toBe(true);
  });

  it('does not fetch pre-cancelled or skipped/invalid URLs', async () => {
    const fetchRequest = vi.fn<typeof fetch>();
    const controller = new AbortController();
    controller.abort();
    expect(
      (
        await checkUrl(prepared, controller.signal, {
          fetch: fetchRequest,
          maxRetries: 0,
        })
      ).status,
    ).toBe('cancelled');
    await Promise.all(
      ['http://127.0.0.1', '/relative', 'https://'].map(async (url) => {
        const target = prepareUrl(url);
        expect(
          (
            await checkUrl(target, newSignal(), {
              fetch: fetchRequest,
              maxRetries: 0,
            })
          ).status,
        ).toBe(target.status);
      }),
    );
    expect(fetchRequest).not.toHaveBeenCalled();
  });

  describe('bounded automatic retries', () => {
    it('recovers a transient network failure with exponential backoff', async () => {
      vi.useFakeTimers();
      const fetchRequest = vi
        .fn<typeof fetch>()
        .mockRejectedValueOnce(new TypeError('HEAD unavailable'))
        .mockRejectedValueOnce(new TypeError('temporary network failure'))
        .mockRejectedValueOnce(new TypeError('temporary network failure'))
        .mockResolvedValueOnce(response(200).value);
      const result = checkUrl(prepared, newSignal(), { fetch: fetchRequest });
      await vi.advanceTimersByTimeAsync(0);
      expect(fetchRequest).toHaveBeenCalledTimes(2);
      await vi.advanceTimersByTimeAsync(999);
      expect(fetchRequest).toHaveBeenCalledTimes(2);
      await vi.advanceTimersByTimeAsync(1);
      expect(fetchRequest).toHaveBeenCalledTimes(3);
      await vi.advanceTimersByTimeAsync(1_999);
      expect(fetchRequest).toHaveBeenCalledTimes(3);
      await vi.advanceTimersByTimeAsync(1);
      expect(await result).toMatchObject({
        status: 'reachable',
        method: 'GET',
      });
      expect(fetchRequest).toHaveBeenCalledTimes(4);
      expect(vi.getTimerCount()).toBe(0);
    });

    it.each([
      408, 429, 500, 502, 503, 504,
    ])('limits retries for persistent HTTP %s', async (status) => {
      vi.useFakeTimers();
      const fetchRequest = vi
        .fn<typeof fetch>()
        .mockResolvedValueOnce(response(405).value)
        .mockResolvedValue(response(status).value);
      const result = checkUrl(prepared, newSignal(), {
        fetch: fetchRequest,
        maxRetries: 999,
      });
      await vi.runAllTimersAsync();
      expect(await result).toMatchObject({
        status: status === 429 ? 'blocked' : 'unverified',
        httpStatus: status,
        method: 'GET',
      });
      expect(fetchRequest).toHaveBeenCalledTimes(4);
      expect(vi.getTimerCount()).toBe(0);
    });

    it('honors a HEAD Retry-After before attempting GET', async () => {
      vi.useFakeTimers();
      const fetchRequest = vi
        .fn<typeof fetch>()
        .mockResolvedValueOnce(
          new Response(null, { status: 429, headers: { 'Retry-After': '2' } }),
        )
        .mockResolvedValueOnce(response(200).value);
      const result = checkUrl(prepared, newSignal(), { fetch: fetchRequest });
      await vi.advanceTimersByTimeAsync(1_999);
      expect(fetchRequest).toHaveBeenCalledOnce();
      await vi.advanceTimersByTimeAsync(1);
      expect(await result).toMatchObject({
        status: 'reachable',
        method: 'GET',
      });
      expect(fetchRequest).toHaveBeenCalledTimes(2);
    });

    it('recovers a transient GET 500 after backoff', async () => {
      vi.useFakeTimers();
      const fetchRequest = vi
        .fn<typeof fetch>()
        .mockResolvedValueOnce(response(405).value)
        .mockResolvedValueOnce(response(500).value)
        .mockResolvedValueOnce(response(200).value);
      const result = checkUrl(prepared, newSignal(), { fetch: fetchRequest });
      await vi.advanceTimersByTimeAsync(999);
      expect(fetchRequest).toHaveBeenCalledTimes(2);
      await vi.advanceTimersByTimeAsync(1);
      expect(await result).toMatchObject({
        status: 'reachable',
        method: 'GET',
      });
      expect(fetchRequest).toHaveBeenCalledTimes(3);
      expect(vi.getTimerCount()).toBe(0);
    });

    it('reads a HEAD 500 fallback immediately and does not retry the proxy bot refusal', async () => {
      vi.useFakeTimers();
      const fetchRequest = vi
        .fn<typeof fetch>()
        .mockResolvedValueOnce(response(500).value)
        .mockResolvedValueOnce(
          new Response(
            'Error proxying to API: RangeError: Responses may only be constructed with status codes in the range 200 to 599, inclusive.',
            { status: 500 },
          ),
        );
      const result = await checkUrl(prepared, newSignal(), {
        fetch: fetchRequest,
      });
      expect(result).toMatchObject({
        status: 'blocked',
        reason: 'bot-protection',
        method: 'GET',
      });
      expect(result.httpStatus).toBeUndefined();
      expect(fetchRequest).toHaveBeenCalledTimes(2);
      expect(vi.getTimerCount()).toBe(0);
    });

    it('honors Retry-After dates for GET retries', async () => {
      vi.useFakeTimers();
      vi.setSystemTime(new Date('2026-10-02T00:00:00Z'));
      const fetchRequest = vi
        .fn<typeof fetch>()
        .mockResolvedValueOnce(response(405).value)
        .mockResolvedValueOnce(
          new Response(null, {
            status: 503,
            headers: { 'Retry-After': 'Fri, 02 Oct 2026 00:00:05 GMT' },
          }),
        )
        .mockResolvedValueOnce(response(200).value);
      const result = checkUrl(prepared, newSignal(), { fetch: fetchRequest });
      await vi.advanceTimersByTimeAsync(4_999);
      expect(fetchRequest).toHaveBeenCalledTimes(2);
      await vi.advanceTimersByTimeAsync(1);
      expect(await result).toMatchObject({
        status: 'reachable',
        method: 'GET',
      });
      expect(fetchRequest).toHaveBeenCalledTimes(3);
    });

    it.each([
      '60',
      '99999999999999999999999999999999999999999999999999',
    ])('ends the check without an early retry when Retry-After is %s seconds', async (retryAfter) => {
      vi.useFakeTimers();
      const fetchRequest = vi.fn<typeof fetch>().mockResolvedValue(
        new Response(null, {
          status: 429,
          headers: { 'Retry-After': retryAfter },
        }),
      );
      const result = await checkUrl(prepared, newSignal(), {
        fetch: fetchRequest,
      });
      expect(result).toMatchObject({
        status: 'blocked',
        reason: 'rate-limited',
        method: 'HEAD',
      });
      expect(fetchRequest).toHaveBeenCalledOnce();
      expect(vi.getTimerCount()).toBe(0);
    });

    it('does not retry a bot protection page even when it uses a transient status', async () => {
      const fetchRequest = vi
        .fn<typeof fetch>()
        .mockResolvedValueOnce(response(405).value)
        .mockResolvedValueOnce(
          new Response('<title>Just a moment...</title>', { status: 503 }),
        );
      expect(
        await checkUrl(prepared, newSignal(), { fetch: fetchRequest }),
      ).toMatchObject({ status: 'blocked', reason: 'bot-protection' });
      expect(fetchRequest).toHaveBeenCalledTimes(2);
    });

    it('aborts a backoff immediately without another request or leftover timers', async () => {
      vi.useFakeTimers();
      const controller = new AbortController();
      const fetchRequest = vi
        .fn<typeof fetch>()
        .mockResolvedValue(
          new Response(null, { status: 429, headers: { 'Retry-After': '30' } }),
        );
      const result = checkUrl(prepared, controller.signal, {
        fetch: fetchRequest,
      });
      await vi.advanceTimersByTimeAsync(0);
      controller.abort();
      expect(await result).toMatchObject({ status: 'cancelled' });
      expect(fetchRequest).toHaveBeenCalledOnce();
      expect(vi.getTimerCount()).toBe(0);
    });

    it('does not retry a GET that timed out, even when fetch ignores the abort', async () => {
      vi.useFakeTimers();
      const fetchRequest = vi
        .fn<typeof fetch>()
        .mockImplementation(() => new Promise(() => {}));
      const result = checkUrl(prepared, newSignal(), { fetch: fetchRequest });
      await vi.advanceTimersByTimeAsync(20_000);
      expect(await result).toMatchObject({
        status: 'unverified',
        message: expect.stringContaining('timed out'),
      });
      expect(fetchRequest).toHaveBeenCalledTimes(2);
      for (const call of fetchRequest.mock.calls)
        expect(call[1]?.signal?.aborted).toBe(true);
      expect(vi.getTimerCount()).toBe(0);
    });
  });

  describe('reading unclear answers', () => {
    /** HEAD gets no body; GET answers with this status and page. */
    function check(status: number, body: string) {
      const fetchRequest = vi
        .fn<typeof fetch>()
        .mockResolvedValueOnce(new Response(null, { status }))
        .mockResolvedValueOnce(new Response(body, { status }));
      return checkUrl(prepared, newSignal(), {
        fetch: fetchRequest,
        maxRetries: 0,
      });
    }

    it.each([
      [
        'a Cloudflare challenge',
        403,
        '<!DOCTYPE html><html><head><title>Just a moment...</title></head><body><script src="/cdn-cgi/challenge-platform/h/b/orchestrate/chl_page/v1"></script></body></html>',
      ],
      [
        'a Cloudflare block page',
        403,
        '<html><head><title>Attention Required! | Cloudflare</title></head><body>Please complete the security check (captcha).</body></html>',
      ],
      [
        'a DataDome captcha',
        403,
        '<html><head><title>g2.com</title></head><body><script src="https://ct.captcha-delivery.com/c.js"></script></body></html>',
      ],
    ])('calls %s blocked, keeping its status', async (_name, status, body) => {
      expect(await check(status, body)).toMatchObject({
        status: 'blocked',
        reason: 'bot-protection',
        httpStatus: status,
        message: expect.stringContaining('blocks automated checks'),
      });
    });

    it("calls LinkedIn's non-standard status, which the proxy fails on, blocked", async () => {
      const result = await check(
        500,
        'Error proxying to API: RangeError: Responses may only be constructed with status codes in the range 200 to 599, inclusive.',
      );
      expect(result).toMatchObject({
        status: 'blocked',
        reason: 'bot-protection',
      });
      expect(result.httpStatus).toBeUndefined();
    });

    it.each([
      [429, 'rate-limited'],
      [401, 'sign-in'],
    ])('calls a %s blocked (%s)', async (status, reason) => {
      expect(await check(status, 'Too many requests')).toMatchObject({
        status: 'blocked',
        reason,
        httpStatus: status,
      });
    });

    it("calls a domain that doesn't exist broken, without the proxy's status", async () => {
      const result = await check(
        530,
        '<title>Origin DNS error | this-domain-does-not-exist.com | Cloudflare</title>',
      );
      expect(result).toMatchObject({
        status: 'broken',
        reason: 'dns',
        message: "The link's domain doesn't exist.",
      });
      expect(result.httpStatus).toBeUndefined();
    });

    it.each([
      [526, 'certificate'],
      [525, 'certificate'],
      [522, 'no-response'],
      [520, 'no-response'],
    ])("explains the proxy's %s without reporting it as the site's", async (status, reason) => {
      const result = await check(status, '<title>Cloudflare error</title>');
      expect(result).toMatchObject({ status: 'unverified', reason });
      expect(result.httpStatus).toBeUndefined();
    });

    it('recognizes the proxy refusing the plugin address', async () => {
      const result = await check(
        403,
        'Forbidden: Requests are only allowed from plugins-cdn.datocms.com or localhost',
      );
      expect(result).toMatchObject({
        status: 'unverified',
        reason: 'proxy-refused',
      });
      expect(result.httpStatus).toBeUndefined();
    });

    it('keeps other refusals unverified, since they can be real problems', async () => {
      // A private or missing S3 object answers 403 AccessDenied.
      const result = await check(
        403,
        '<?xml version="1.0" encoding="UTF-8"?><Error><Code>AccessDenied</Code><Message>Access Denied</Message></Error>',
      );
      expect(result).toMatchObject({ status: 'unverified', httpStatus: 403 });
      expect(result.reason).toBeUndefined();
      expect(await check(503, 'Service Unavailable')).toMatchObject({
        status: 'unverified',
        reason: 'server-error',
        httpStatus: 503,
      });
    });

    it('reads only the start of a large page', async () => {
      const marker = '<title>Just a moment...</title>';
      const result = await check(403, marker + 'x'.repeat(2_000_000));
      expect(result.status).toBe('blocked');
    });

    it('does not decode an oversized single chunk beyond the snippet budget', async () => {
      expect(
        await check(
          403,
          `${'x'.repeat(20_000)}<title>Just a moment...</title>`,
        ),
      ).toMatchObject({ status: 'unverified' });
    });

    it('finishes a stalled reader even if its cancel method never settles', async () => {
      vi.useFakeTimers();
      const read = vi.fn().mockImplementation(() => new Promise(() => {}));
      const cancel = vi.fn().mockImplementation(() => new Promise(() => {}));
      const stalled = {
        status: 403,
        body: { getReader: () => ({ read, cancel }) },
      } as unknown as Response;
      const fetchRequest = vi
        .fn<typeof fetch>()
        .mockResolvedValueOnce(response(405).value)
        .mockResolvedValueOnce(stalled);
      const result = checkUrl(prepared, newSignal(), { fetch: fetchRequest });
      await vi.advanceTimersByTimeAsync(3_000);
      expect(await result).toMatchObject({
        status: 'unverified',
        httpStatus: 403,
      });
      expect(cancel).toHaveBeenCalledOnce();
      expect(fetchRequest.mock.calls[1][1]?.signal?.aborted).toBe(true);
      expect(vi.getTimerCount()).toBe(0);
    });

    it('aborts a stalled body reader without waiting for the snippet timeout', async () => {
      vi.useFakeTimers();
      const controller = new AbortController();
      const read = vi.fn().mockImplementation(() => new Promise(() => {}));
      const cancel = vi.fn().mockResolvedValue(undefined);
      const stalled = {
        status: 403,
        body: { getReader: () => ({ read, cancel }) },
      } as unknown as Response;
      const fetchRequest = vi
        .fn<typeof fetch>()
        .mockResolvedValueOnce(response(405).value)
        .mockResolvedValueOnce(stalled);
      const result = checkUrl(prepared, controller.signal, {
        fetch: fetchRequest,
      });
      await vi.advanceTimersByTimeAsync(0);
      expect(read).toHaveBeenCalledOnce();
      controller.abort();
      expect(await result).toMatchObject({ status: 'cancelled' });
      await vi.advanceTimersByTimeAsync(0);
      expect(cancel).toHaveBeenCalledOnce();
      expect(vi.getTimerCount()).toBe(0);
    });
  });
});
