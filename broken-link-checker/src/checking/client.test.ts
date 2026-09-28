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
      await checkUrl(prepared, newSignal(), { fetch: fetchRequest }),
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
      await checkUrl(prepared, newSignal(), { fetch: fetchRequest }),
    ).toMatchObject({
      status: 'unverified',
      httpStatus: status,
      method: 'GET',
    });
  });

  it('falls back after HEAD network failure, but does not retry GET failures', async () => {
    const fetchRequest = vi
      .fn<typeof fetch>()
      .mockRejectedValue(new TypeError('network'));
    expect(
      await checkUrl(prepared, newSignal(), { fetch: fetchRequest }),
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
    const result = checkUrl(prepared, newSignal(), { fetch: fetchRequest });
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
      (await checkUrl(prepared, controller.signal, { fetch: fetchRequest }))
        .status,
    ).toBe('cancelled');
    await Promise.all(
      ['http://127.0.0.1', '/relative', 'https://'].map(async (url) => {
        const target = prepareUrl(url);
        expect(
          (await checkUrl(target, newSignal(), { fetch: fetchRequest })).status,
        ).toBe(target.status);
      }),
    );
    expect(fetchRequest).not.toHaveBeenCalled();
  });

  describe('reading unclear answers', () => {
    /** HEAD gets no body; GET answers with this status and page. */
    function check(status: number, body: string) {
      const fetchRequest = vi
        .fn<typeof fetch>()
        .mockResolvedValueOnce(new Response(null, { status }))
        .mockResolvedValueOnce(new Response(body, { status }));
      return checkUrl(prepared, newSignal(), { fetch: fetchRequest });
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
  });
});
