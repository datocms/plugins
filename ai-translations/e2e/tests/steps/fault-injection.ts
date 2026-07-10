import type { Page, Route } from '@playwright/test';
import type { Vendor } from '../fixtures/providers';

/**
 * Glob patterns for each provider's request host. Provider SDKs run in the
 * browser (`dangerouslyAllowBrowser: true`), so their traffic is visible to
 * Playwright's `page.route()` — a fault-injection lane needs no provider API key
 * and runs in CI with an empty `.env.testing`.
 */
export const PROVIDER_HOST_PATTERNS: Record<Vendor, string> = {
  openai: '**/api.openai.com/**',
  google: '**/generativelanguage.googleapis.com/**',
  anthropic: '**/api.anthropic.com/**',
  deepl: '**/*.deepl.com/**',
};

/** Glob pattern for the DatoCMS Content Management API host. */
export const CMA_HOST_PATTERN = '**/site-api.datocms.com/**';

/** Vendor-shaped 429 error envelope, so the adapter classifies it as a rate limit. */
const rateLimitEnvelope = (vendor: Vendor): unknown => {
  switch (vendor) {
    case 'openai':
      return {
        error: {
          message: 'Rate limit reached.',
          type: 'rate_limit_exceeded',
          code: 'rate_limit_exceeded',
        },
      };
    case 'anthropic':
      return {
        type: 'error',
        error: { type: 'rate_limit_error', message: 'Rate limit reached.' },
      };
    case 'google':
      return {
        error: {
          code: 429,
          message: 'Resource has been exhausted.',
          status: 'RESOURCE_EXHAUSTED',
        },
      };
    case 'deepl':
      return { message: 'Too many requests, DeepL servers are overloaded.' };
  }
};

/** Vendor-shaped 401 error envelope, so the adapter classifies it as an auth failure. */
const authEnvelope = (vendor: Vendor): unknown => {
  switch (vendor) {
    case 'openai':
      return {
        error: {
          message: 'Incorrect API key provided.',
          type: 'invalid_request_error',
          code: 'invalid_api_key',
        },
      };
    case 'anthropic':
      return {
        type: 'error',
        error: { type: 'authentication_error', message: 'invalid x-api-key' },
      };
    case 'google':
      return {
        error: {
          code: 401,
          message: 'API key not valid.',
          status: 'UNAUTHENTICATED',
        },
      };
    case 'deepl':
      return {
        message:
          'Authorization failed. Please supply a valid auth_key parameter.',
      };
  }
};

/**
 * Fulfills matching provider requests with a `429`, mimicking a rate limit.
 *
 * @param page - The page whose provider traffic to intercept.
 * @param opts.vendor - Which provider host to fault.
 * @param opts.retryAfterSeconds - Sets a `retry-after` header when provided.
 * @param opts.failTimes - Fault only this many matching calls, then fall through
 *   to the real provider. Omit to fault every matching call.
 * @param opts.matchBody - Restrict the fault to requests whose POST body matches,
 *   e.g. `/fr/` to fail only the French locale's calls.
 */
export const injectRateLimit = async (
  page: Page,
  opts: {
    vendor: Vendor;
    retryAfterSeconds?: number;
    failTimes?: number;
    matchBody?: RegExp;
  },
): Promise<void> => {
  const { vendor, retryAfterSeconds, failTimes, matchBody } = opts;
  let remaining = failTimes;

  await page.route(PROVIDER_HOST_PATTERNS[vendor], async (route: Route) => {
    if (matchBody && !matchBody.test(route.request().postData() ?? '')) {
      return route.fallback();
    }
    if (remaining !== undefined) {
      if (remaining <= 0) return route.fallback();
      remaining -= 1;
    }

    const headers: Record<string, string> = {
      'content-type': 'application/json',
    };
    if (retryAfterSeconds !== undefined)
      headers['retry-after'] = String(retryAfterSeconds);

    await route.fulfill({
      status: 429,
      headers,
      body: JSON.stringify(rateLimitEnvelope(vendor)),
    });
  });
};

/**
 * Fulfills every matching provider request with a `401`, mimicking a bad key.
 * Auth is systemic and never auto-retried, so a single fault suffices.
 *
 * @param page - The page whose provider traffic to intercept.
 * @param vendor - Which provider host to fault.
 */
export const injectAuthError = async (
  page: Page,
  vendor: Vendor,
): Promise<void> => {
  await page.route(PROVIDER_HOST_PATTERNS[vendor], async (route: Route) => {
    await route.fulfill({
      status: 401,
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(authEnvelope(vendor)),
    });
  });
};

/**
 * Lets a CMA `PUT /items/:id` reach DatoCMS, then strips `attributes[field][locale]`
 * to `null` in the returned record before it reaches the plugin. This is the only
 * direct test of read-back verification: it fakes the CMA silently dropping a value
 * the run believed it wrote, which the structural check must catch.
 *
 * @param page - The page whose CMA traffic to intercept.
 * @param field - The localized field api_key to null out.
 * @param locale - The locale key to null out within that field.
 */
export const injectCmaFieldStrip = async (
  page: Page,
  field: string,
  locale: string,
): Promise<void> => {
  await page.route(CMA_HOST_PATTERN, async (route: Route) => {
    const request = route.request();
    if (
      request.method() !== 'PUT' ||
      !/\/items\/[^/]+$/.test(new URL(request.url()).pathname)
    ) {
      return route.fallback();
    }

    const response = await route.fetch();
    const json = (await response.json().catch(() => null)) as {
      data?: { attributes?: Record<string, unknown> };
    } | null;

    const localized = json?.data?.attributes?.[field];
    if (localized && typeof localized === 'object') {
      (localized as Record<string, unknown>)[locale] = null;
    }

    await route.fulfill({ response, json });
  });
};

/**
 * Removes every route registered by the helpers above.
 *
 * @param page - The page to clear.
 */
export const clearFaults = async (page: Page): Promise<void> => {
  await page.unrouteAll({ behavior: 'ignoreErrors' });
};
