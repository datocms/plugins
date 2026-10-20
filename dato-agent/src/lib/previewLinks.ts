import { buildClient } from '@datocms/cma-client-browser';

export const WEB_PREVIEWS_PACKAGE_NAME = 'datocms-plugin-web-previews';
export const PREVIEW_LINK_TIMEOUT_MS = 8_000;

export type PreviewHeader = {
  name: string;
  value: string;
};

export type PreviewFrontend = {
  name: string;
  apiEndpointUrl: string;
  customHeaders: PreviewHeader[];
};

export type PreviewLink = {
  frontendName: string;
  label: string;
  url: string;
  /**
   * The endpoint's URL had credentials, a query or a fragment. Those parts
   * can hold preview tokens, so `url` keeps only the origin and path, and
   * the link (often a draft preview) does not work as shown.
   */
  hasHiddenParameters?: boolean;
};

export type PreviewFrontendError = {
  frontendName: string;
  message: string;
};

export type FetchedPreviewLinks = {
  links: PreviewLink[];
  errors: PreviewFrontendError[];
};

type PluginInstall = {
  name: string;
  package_name: string | null;
  parameters: { [key: string]: unknown };
};

type PreviewPluginClient = {
  plugins: {
    list(): Promise<PluginInstall[]>;
  };
};

type RawRecordClient = {
  items: {
    rawFind(itemId: string): Promise<{ data?: unknown }>;
  };
  itemTypes: {
    rawFind(itemTypeId: string): Promise<{ data?: unknown }>;
  };
};

export type PreviewLinksHost = {
  siteId: string;
  environment: string;
  locale: string;
  cmaBaseUrl: string;
  accessToken: string | null | undefined;
  currentUser: unknown;
  savedFrontends: readonly PreviewFrontend[];
  websiteBaseUrl: string;
};

export type RecordPreviewLinksRequest = {
  itemId: string;
  locale?: string;
};

const SLUG_FIELD_KEYS = ['slug'] as const;

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function trimmedString(value: unknown): string {
  return typeof value === 'string' ? value.trim() : '';
}

function httpUrl(value: string): string | null {
  try {
    const url = new URL(value);
    if (url.protocol !== 'http:' && url.protocol !== 'https:') {
      return null;
    }
    return url.toString();
  } catch {
    return null;
  }
}

/**
 * Normalizes the configured website address. A bare host such as
 * `www.example.com` gets `https://`; other schemes are rejected, and so are
 * credentials, a query or a fragment, since the record slug is appended.
 *
 * @returns The address without a trailing slash, or `''` when invalid.
 */
export function normalizeWebsiteBaseUrl(value: unknown): string {
  const candidate = trimmedString(value);
  if (!candidate) {
    return '';
  }

  // `localhost:3000` has a colon but no scheme: a scheme never precedes a digit.
  const hasScheme = /^[a-z][a-z\d+.-]*:(?!\d)/i.test(candidate);
  const url = httpUrl(hasScheme ? candidate : `https://${candidate}`);
  if (!url) {
    return '';
  }
  // Rebuilt from origin and path, so even a bare `?` or `#` is rejected.
  const parsed = new URL(url);
  const pageAddress = `${parsed.origin}${parsed.pathname}`;
  return parsed.href === pageAddress ? pageAddress.replace(/\/$/, '') : '';
}

function normalizePreviewHeaders(value: unknown): PreviewHeader[] {
  if (!Array.isArray(value)) {
    return [];
  }

  const headers: PreviewHeader[] = [];
  for (const header of value) {
    if (!isRecord(header)) {
      continue;
    }
    const name = trimmedString(header.name);
    if (!name) {
      continue;
    }
    headers.push({
      name,
      value: typeof header.value === 'string' ? header.value : '',
    });
  }

  return headers;
}

function normalizePreviewFrontend(value: unknown): PreviewFrontend | null {
  if (!isRecord(value) || value.disabled === true) {
    return null;
  }

  const name = trimmedString(value.name);
  const apiEndpointUrl = httpUrl(trimmedString(value.apiEndpointUrl));
  if (!name || !apiEndpointUrl) {
    return null;
  }

  return {
    name,
    apiEndpointUrl,
    customHeaders: normalizePreviewHeaders(value.customHeaders),
  };
}

export function normalizePreviewFrontends(value: unknown): PreviewFrontend[] {
  if (!Array.isArray(value)) {
    return [];
  }

  const frontends: PreviewFrontend[] = [];
  for (const entry of value) {
    const frontend = normalizePreviewFrontend(entry);
    if (frontend) {
      frontends.push(frontend);
    }
  }

  return frontends;
}

function frontendsFromParameters(parameters: unknown): PreviewFrontend[] {
  if (!isRecord(parameters) || !Array.isArray(parameters.frontends)) {
    return [];
  }

  return normalizePreviewFrontends(
    parameters.frontends.map((frontend) => {
      if (!isRecord(frontend)) {
        return frontend;
      }
      return {
        name: frontend.name,
        disabled: frontend.disabled,
        apiEndpointUrl: frontend.previewWebhook,
        customHeaders: frontend.customHeaders,
      };
    }),
  );
}

/**
 * Whether a plugin installed by URL (no package name) is a Web Previews copy:
 * it has that name, or its parameters hold frontends with preview webhooks.
 */
function isPrivateWebPreviewsInstall(plugin: PluginInstall): boolean {
  if (plugin.package_name) {
    return false;
  }
  if (plugin.name.trim().toLowerCase() === 'web previews') {
    return true;
  }
  const { frontends } = plugin.parameters;
  return (
    Array.isArray(frontends) &&
    frontends.some(
      (frontend) =>
        isRecord(frontend) && typeof frontend.previewWebhook === 'string',
    )
  );
}

export async function loadWebPreviewFrontends(
  client: PreviewPluginClient,
): Promise<PreviewFrontend[]> {
  const plugins = await client.plugins.list();
  // The marketplace package wins over a privately installed copy.
  const install =
    plugins.find(
      (plugin) => plugin.package_name === WEB_PREVIEWS_PACKAGE_NAME,
    ) ?? plugins.find(isPrivateWebPreviewsInstall);
  if (!install) {
    return [];
  }

  return frontendsFromParameters(install.parameters);
}

function errorMessage(error: unknown, fallback: string): string {
  return error instanceof Error && error.message.trim()
    ? error.message.trim()
    : fallback;
}

// Longer links are skipped so a huge response cannot block the iframe.
const MAX_LINK_LENGTH = 8_192;

/**
 * Keeps only the page address (origin and path) of a link. Userinfo, query
 * and fragment never reach the model, whatever their names: any of them can
 * carry a preview token. Tokens embedded in the path (`/preview/<token>/…`)
 * are kept by design: the path is the page address.
 */
function pageAddressLink(link: PreviewLink): PreviewLink {
  const url = new URL(link.url);
  const pageAddress = `${url.origin}${url.pathname}`;
  return url.href === pageAddress
    ? link
    : { ...link, url: pageAddress, hasHiddenParameters: true };
}

/**
 * Reads the links of a Web Previews response. Like Web Previews, a link
 * without a label or an HTTP URL is skipped instead of failing the frontend.
 *
 * @returns The valid links, or `null` when the payload has no link list.
 */
function previewResponseLinks(payload: unknown): PreviewLink[] | null {
  if (!isRecord(payload) || !Array.isArray(payload.previewLinks)) {
    return null;
  }

  const links: PreviewLink[] = [];
  for (const entry of payload.previewLinks) {
    if (!isRecord(entry)) {
      continue;
    }
    const label = trimmedString(entry.label);
    const rawUrl = trimmedString(entry.url);
    const url = rawUrl.length <= MAX_LINK_LENGTH ? httpUrl(rawUrl) : null;
    if (label && url) {
      links.push(pageAddressLink({ frontendName: '', label, url }));
    }
  }

  return links;
}

async function requestFrontendLinks(
  frontend: PreviewFrontend,
  payload: string,
  signal: AbortSignal | undefined,
  fetchImpl: typeof fetch,
  timeoutMs: number,
): Promise<FetchedPreviewLinks> {
  const controller = new AbortController();
  const timeout = setTimeout(() => {
    controller.abort();
  }, timeoutMs);
  const abortFromParent = () => controller.abort();
  signal?.addEventListener('abort', abortFromParent, { once: true });

  try {
    if (signal?.aborted) {
      throw new Error('The preview link request was cancelled.');
    }

    const headers = new Headers({ 'Content-Type': 'application/json' });
    for (const header of frontend.customHeaders) {
      headers.set(header.name, header.value);
    }

    const { hostname } = new URL(frontend.apiEndpointUrl);
    const isLoopback = hostname === 'localhost' || hostname === '127.0.0.1';
    // Chromium's Local Network Access needs this for localhost endpoints, as
    // in Web Previews. Other browsers ignore the unknown option.
    const init: RequestInit & { targetAddressSpace?: 'loopback' } = {
      method: 'POST',
      headers,
      body: payload,
      signal: controller.signal,
      ...(isLoopback ? { targetAddressSpace: 'loopback' } : {}),
    };
    const response = await fetchImpl(frontend.apiEndpointUrl, init);
    if (response.status !== 200) {
      throw new Error(
        `The preview endpoint for "${frontend.name}" returned status ${response.status}.`,
      );
    }

    const links = previewResponseLinks(await response.json());
    if (!links) {
      throw new Error(
        `The preview endpoint for "${frontend.name}" returned an invalid payload.`,
      );
    }

    return {
      links: links.map((link) => ({ ...link, frontendName: frontend.name })),
      errors: [],
    };
  } catch (error) {
    const timedOut = controller.signal.aborted && !signal?.aborted;
    return {
      links: [],
      errors: [
        {
          frontendName: frontend.name,
          message: timedOut
            ? `The preview endpoint for "${frontend.name}" timed out.`
            : errorMessage(error, 'The preview link request failed.'),
        },
      ],
    };
  } finally {
    clearTimeout(timeout);
    signal?.removeEventListener('abort', abortFromParent);
  }
}

export async function fetchPreviewLinks({
  frontends,
  payload,
  signal,
  fetchImpl = fetch,
  timeoutMs = PREVIEW_LINK_TIMEOUT_MS,
}: {
  frontends: readonly PreviewFrontend[];
  payload: unknown;
  signal?: AbortSignal;
  fetchImpl?: typeof fetch;
  timeoutMs?: number;
}): Promise<FetchedPreviewLinks> {
  const body = JSON.stringify(payload);
  const results = await Promise.all(
    frontends.map((frontend) =>
      requestFrontendLinks(frontend, body, signal, fetchImpl, timeoutMs),
    ),
  );

  return {
    links: results.flatMap((result) => result.links),
    errors: results.flatMap((result) => result.errors),
  };
}

function rawData(response: { data?: unknown }): Record<string, unknown> {
  if (!isRecord(response.data)) {
    throw new Error('DatoCMS returned an unexpected record payload.');
  }
  return response.data;
}

function relationshipId(record: Record<string, unknown>): string {
  const relationships = isRecord(record.relationships)
    ? record.relationships
    : undefined;
  const itemType =
    relationships && isRecord(relationships.item_type)
      ? relationships.item_type
      : undefined;
  const data = itemType && isRecord(itemType.data) ? itemType.data : undefined;
  const id = trimmedString(data?.id);
  if (!id) {
    throw new Error('The record model could not be determined.');
  }
  return id;
}

type SlugLookup = {
  slug: string | null;
  /** The slug is localized and exists only in other locales. */
  isMissingInLocale: boolean;
};

const NO_SLUG: SlugLookup = { slug: null, isMissingInLocale: false };

function slugText(value: unknown): string | null {
  return typeof value === 'string' && value.trim()
    ? value.trim().replace(/^\/+/, '')
    : null;
}

/**
 * Reads the record slug in the requested locale only: another locale's slug
 * would produce a URL for the wrong language.
 */
function recordSlug(
  item: Record<string, unknown> | null,
  locale: string,
): SlugLookup {
  const attributes =
    item && isRecord(item.attributes) ? item.attributes : undefined;
  if (!attributes) {
    return NO_SLUG;
  }

  for (const key of SLUG_FIELD_KEYS) {
    const value = attributes[key];
    if (!isRecord(value)) {
      const slug = slugText(value);
      if (slug) {
        return { slug, isMissingInLocale: false };
      }
      continue;
    }

    const slug = slugText(value[locale]);
    if (slug) {
      return { slug, isMissingInLocale: false };
    }
    if (Object.values(value).some((entry) => slugText(entry))) {
      return { slug: null, isMissingInLocale: true };
    }
  }

  return NO_SLUG;
}

function serializableUser(user: unknown): unknown {
  try {
    return JSON.parse(JSON.stringify(user ?? null)) as unknown;
  } catch {
    return null;
  }
}

async function resolveFrontends(
  client: PreviewPluginClient | null,
  savedFrontends: readonly PreviewFrontend[],
): Promise<PreviewFrontend[]> {
  if (!client) {
    return [...savedFrontends];
  }

  try {
    const live = await loadWebPreviewFrontends(client);
    return live.length > 0 ? live : [...savedFrontends];
  } catch {
    return [...savedFrontends];
  }
}

function inferredLink(
  websiteBaseUrl: string,
  slug: string | null,
): PreviewLink | null {
  if (!websiteBaseUrl || !slug) {
    return null;
  }

  const url = httpUrl(
    `${websiteBaseUrl.replace(/\/$/, '')}/${slug.replace(/^\/+/, '')}`,
  );
  if (!url) {
    return null;
  }

  return {
    frontendName: 'Website address',
    label: 'Website',
    url,
  };
}

const HIDDEN_PARAMETERS_GUIDANCE =
  'Each URL is a page address with its query, fragment and credentials removed. A link with hasHiddenParameters (often a draft preview that needs a token) may not work as shown: for the exact link, tell the editor to use the Web Previews sidebar of the full record editor. In the Agent inspector that sidebar is not visible, so first offer open_record_in_full_editor when that tool is available. Never reveal, guess or ask for preview tokens.';

/**
 * Adds guidance that matches the mix of plain and hidden-parameter links.
 *
 * @param hasSlugFallback - A website-address link was appended because every
 *   endpoint link had hidden parameters.
 */
function previewLinksMessage(
  links: readonly PreviewLink[],
  hasSlugFallback: boolean,
): string {
  const base =
    'These are the website page addresses returned by the configured preview endpoints.';
  const hiddenCount = links.filter((link) => link.hasHiddenParameters).length;
  if (hiddenCount === 0) {
    return base;
  }
  if (hiddenCount < links.length) {
    return `${base} ${HIDDEN_PARAMETERS_GUIDANCE} Prefer the links without hasHiddenParameters.`;
  }
  return `${base} ${HIDDEN_PARAMETERS_GUIDANCE} Every endpoint link had parameters removed: give the editor the page address without its parameters, and say it may not be exact or may need parameters (for example, a draft preview).${
    hasSlugFallback
      ? ' The "Website address" link was built from the configured website address and the record slug: offer it as the likely published URL.'
      : ''
  }`;
}

/**
 * Adds a website-address link when every endpoint link had hidden
 * parameters, so the editor still gets a published candidate.
 */
function withSlugFallback(
  links: readonly PreviewLink[],
  websiteBaseUrl: string,
  item: Record<string, unknown> | null,
  locale: string,
): PreviewLink[] {
  const isAllHidden = links.every((link) => link.hasHiddenParameters);
  const fallback = isAllHidden
    ? inferredLink(websiteBaseUrl, recordSlug(item, locale).slug)
    : null;
  return fallback ? [...links, fallback] : [...links];
}

/** Explains why no website URL is available, for each failure state. */
function unavailableMessage({
  hasAccessToken,
  hasFrontends,
  hasFrontendErrors,
  hasWebsiteBaseUrl,
  locale,
  slugLookup,
}: {
  hasAccessToken: boolean;
  hasFrontends: boolean;
  hasFrontendErrors: boolean;
  hasWebsiteBaseUrl: boolean;
  locale: string;
  slugLookup: SlugLookup;
}): string {
  const unavailable = 'Say the full URL is unavailable.';
  if (!hasAccessToken && (hasFrontends || hasWebsiteBaseUrl)) {
    return `The current user's DatoCMS access token is unavailable, so the record could not be read and no preview endpoint was called. ${unavailable}`;
  }
  if (slugLookup.isMissingInLocale) {
    return `The record has no slug in locale "${locale}". Do not use another locale's slug. ${unavailable}`;
  }
  if (hasFrontendErrors) {
    return `The configured preview endpoints failed (see errors)${
      hasWebsiteBaseUrl
        ? ' and the record has no slug'
        : ' and no website address is configured'
    }. ${unavailable}`;
  }
  if (hasWebsiteBaseUrl) {
    return `The record has no slug, so the configured website address cannot be completed. ${unavailable}`;
  }
  return 'No website domain is configured. Give the editor the record slug and say the full URL is unavailable.';
}

/**
 * Reads the record, plus its model when preview endpoints need it. Skips the
 * reads when neither endpoints nor a website address can use them.
 */
async function loadRecord(
  client: object | null,
  itemId: string,
  hasFrontends: boolean,
  hasWebsiteBaseUrl: boolean,
): Promise<{
  item: Record<string, unknown> | null;
  itemType: Record<string, unknown> | null;
}> {
  if (!client || !(hasFrontends || hasWebsiteBaseUrl)) {
    return { item: null, itemType: null };
  }

  const recordClient = client as RawRecordClient;
  const item = rawData(await recordClient.items.rawFind(itemId));
  const itemType = hasFrontends
    ? rawData(await recordClient.itemTypes.rawFind(relationshipId(item)))
    : null;
  return { item, itemType };
}

export async function getRecordPreviewLinks(
  host: PreviewLinksHost,
  request: RecordPreviewLinksRequest,
  signal?: AbortSignal,
): Promise<Record<string, unknown>> {
  const itemId = request.itemId.trim();
  if (!itemId) {
    throw new Error('A record ID is required to look up preview links.');
  }
  const locale = request.locale?.trim() || host.locale.trim() || 'en';
  const accessToken = host.accessToken?.trim();
  const client = accessToken
    ? buildClient({
        apiToken: accessToken,
        environment: host.environment,
        baseUrl: host.cmaBaseUrl,
      })
    : null;
  const frontends = await resolveFrontends(client, host.savedFrontends);

  const { item, itemType } = await loadRecord(
    client,
    itemId,
    frontends.length > 0,
    Boolean(host.websiteBaseUrl),
  );

  const hasFetchedFrontends = Boolean(item && itemType && frontends.length > 0);
  const fetched = hasFetchedFrontends
    ? await fetchPreviewLinks({
        frontends,
        signal,
        payload: {
          item,
          itemType,
          currentUser: serializableUser(host.currentUser),
          siteId: host.siteId,
          environmentId: host.environment,
          locale,
        },
      })
    : { links: [], errors: [] };

  if (fetched.links.length > 0) {
    const links = withSlugFallback(
      fetched.links,
      host.websiteBaseUrl,
      item,
      locale,
    );
    return {
      action: 'get_record_preview_links',
      itemId,
      locale,
      source: 'web_previews',
      links,
      errors: fetched.errors,
      message: previewLinksMessage(
        fetched.links,
        links.length > fetched.links.length,
      ),
    };
  }

  // A frontend that answered without links is authoritative: the record has
  // no page there, so a slug-based guess would be wrong.
  const hasEmptyEndpointAnswer =
    hasFetchedFrontends && fetched.errors.length < frontends.length;
  if (hasEmptyEndpointAnswer) {
    return {
      action: 'get_record_preview_links',
      itemId,
      locale,
      source: 'web_previews',
      links: [],
      errors: fetched.errors,
      message: `The configured preview endpoints returned no link for this record in locale "${locale}". Say the record has no website page there; do not guess a URL.`,
    };
  }

  const slugLookup = recordSlug(item, locale);
  const fallback = inferredLink(host.websiteBaseUrl, slugLookup.slug);
  if (fallback) {
    return {
      action: 'get_record_preview_links',
      itemId,
      locale,
      source: 'website_base_url',
      links: [fallback],
      errors: fetched.errors,
      message: `${
        fetched.errors.length > 0
          ? 'The preview endpoints failed.'
          : 'No preview endpoint returned a URL.'
      } This link was built from the configured website address and the record slug, so it may miss locale prefixes or parent paths.`,
    };
  }

  return {
    action: 'get_record_preview_links',
    itemId,
    locale,
    source: 'unavailable',
    links: [],
    errors: fetched.errors,
    slug: slugLookup.slug,
    message: unavailableMessage({
      hasAccessToken: Boolean(client),
      hasFrontends: frontends.length > 0,
      hasFrontendErrors: fetched.errors.length > 0,
      hasWebsiteBaseUrl: Boolean(host.websiteBaseUrl),
      locale,
      slugLookup,
    }),
  };
}
