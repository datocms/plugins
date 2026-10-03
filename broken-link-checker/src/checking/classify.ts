import type { CheckReason, CheckResult, PreparedUrl } from '../types';

/** What one request through the proxy returned: the status, and the start of the page for unclear answers. */
export type Attempt = {
  status: number;
  body?: string;
  /** Retry-After is seconds or an HTTP date, normalized at receipt. */
  retryAfterMs?: number;
};

export function isSuccessful(httpStatus: number): boolean {
  return httpStatus >= 200 && httpStatus < 300;
}

/** A page that exists (2xx) or is gone (404, 410) says enough; any other answer is worth reading. */
export function needsBody(httpStatus: number): boolean {
  return !isSuccessful(httpStatus) && httpStatus !== 404 && httpStatus !== 410;
}

/** The proxy only serves plugins installed from the marketplace or run on localhost. */
const PROXY_REFUSED = /^Forbidden: Requests are only allowed from/;

/**
 * The proxy fails on statuses outside 200–599. LinkedIn answers automated
 * requests with 999, so this is its bot block.
 */
const PROXY_BAD_STATUS =
  /^Error proxying to API: RangeError: Responses may only be constructed with status codes/;

/** Cloudflare's own error page when the link's domain doesn't resolve (error 1016). */
const DNS_ERROR = /Origin DNS error|Error code 1016|error 1016/i;

/**
 * Challenge and block pages of common bot protection services: Cloudflare,
 * DataDome, HUMAN (PerimeterX), Imperva, Akamai, AWS WAF, Sucuri and Vercel.
 */
const BOT_PROTECTION = [
  /<title>\s*Just a moment\.\.\.\s*<\/title>/i,
  /<title>\s*Attention Required! \| Cloudflare\s*<\/title>/i,
  /challenge-platform|cf-chl-|cf_chl_|cf-turnstile/i,
  /captcha-delivery\.com|datadome/i,
  /px-captcha|perimeterx|human security/i,
  /_Incapsula_Resource|Incapsula incident/i,
  /Access Denied[\s\S]{0,400}Reference #|errors\.edgesuite\.net/i,
  /awswaf|aws-waf-token/i,
  /Sucuri WebSite Firewall/i,
  /Vercel Security Checkpoint/i,
  /captcha/i,
];

const MESSAGES: Record<CheckReason, string> = {
  'bot-protection':
    'This site blocks automated checks. Open the link to check it yourself.',
  'rate-limited':
    'The site is limiting automated requests. Check the link again later.',
  'sign-in':
    "The page asks for a sign-in, so it can't be checked automatically.",
  dns: "The link's domain doesn't exist.",
  certificate:
    "The site's security certificate is invalid, so browsers warn visitors before opening it.",
  'no-response': "The site didn't respond. It may be down, or only briefly.",
  'server-error':
    'The site answered with a server error. It may be temporary: check the link again later.',
  'proxy-refused':
    "The link checking service refused this plugin's address. It only accepts the plugin when it's installed from the marketplace or run on localhost.",
};

type Verdict = {
  status: CheckResult['status'];
  reason?: CheckReason;
  /** False when the status came from the proxy, not from the site. */
  fromSite: boolean;
};

function isBotProtection(body: string): boolean {
  return BOT_PROTECTION.some((pattern) => pattern.test(body));
}

/** Statuses the proxy's own Cloudflare edge sends when it can't get an answer from the site. */
function edgeVerdict(httpStatus: number, body: string): Verdict | undefined {
  if (httpStatus === 530)
    return DNS_ERROR.test(body)
      ? { status: 'broken', reason: 'dns', fromSite: false }
      : { status: 'unverified', reason: 'no-response', fromSite: false };
  if (httpStatus === 525 || httpStatus === 526)
    return { status: 'unverified', reason: 'certificate', fromSite: false };
  if (httpStatus >= 520 && httpStatus <= 524)
    return { status: 'unverified', reason: 'no-response', fromSite: false };
  return undefined;
}

function verdictFor(
  httpStatus: number,
  method: 'HEAD' | 'GET',
  body = '',
): Verdict | undefined {
  if (httpStatus === 403 && PROXY_REFUSED.test(body))
    return { status: 'unverified', reason: 'proxy-refused', fromSite: false };
  if (httpStatus === 500 && PROXY_BAD_STATUS.test(body))
    return { status: 'blocked', reason: 'bot-protection', fromSite: false };
  const edge = edgeVerdict(httpStatus, body);
  if (edge) return edge;
  if (method === 'GET' && (httpStatus === 404 || httpStatus === 410))
    return { status: 'broken', fromSite: true };
  if (httpStatus >= 400 && isBotProtection(body))
    return { status: 'blocked', reason: 'bot-protection', fromSite: true };
  if (httpStatus === 429)
    return { status: 'blocked', reason: 'rate-limited', fromSite: true };
  if (httpStatus === 401)
    return { status: 'blocked', reason: 'sign-in', fromSite: true };
  if (httpStatus >= 500 && httpStatus < 600)
    return { status: 'unverified', reason: 'server-error', fromSite: true };
  return undefined;
}

function defaultMessage(status: CheckResult['status'], httpStatus: number) {
  if (status === 'reachable')
    return `The URL responded with HTTP ${httpStatus}.`;
  if (status === 'broken')
    return `The URL responded with HTTP ${httpStatus} to a GET request.`;
  return `HTTP ${httpStatus} does not establish whether this link is broken.`;
}

/**
 * Turns the proxy's answer into a result. Only a GET 404 or 410, or a domain
 * that doesn't exist, is broken. Sites that refuse automated checks are
 * "blocked", which isn't a problem with the link. Statuses the proxy made up
 * (its own refusals and edge errors) aren't reported as the site's.
 */
export function classifyAttempt(
  prepared: PreparedUrl,
  attempt: Attempt,
  method: 'HEAD' | 'GET',
): CheckResult {
  const { status: httpStatus, body } = attempt;
  const verdict: Verdict = isSuccessful(httpStatus)
    ? { status: 'reachable', fromSite: true }
    : (verdictFor(httpStatus, method, body) ?? {
        status: 'unverified',
        fromSite: true,
      });
  return {
    key: prepared.key,
    url: prepared.url,
    status: verdict.status,
    message: verdict.reason
      ? MESSAGES[verdict.reason]
      : defaultMessage(verdict.status, httpStatus),
    httpStatus: verdict.fromSite ? httpStatus : undefined,
    method,
    checkedAt: new Date().toISOString(),
    ...(verdict.reason ? { reason: verdict.reason } : {}),
  };
}
