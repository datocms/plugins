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

export function normalizeWebsiteBaseUrl(value: unknown): string {
  const candidate = trimmedString(value);
  if (!candidate) {
    return '';
  }

  const url = httpUrl(candidate);
  return url ? url.replace(/\/$/, '') : '';
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

export async function loadWebPreviewFrontends(
  client: PreviewPluginClient,
): Promise<PreviewFrontend[]> {
  const plugins = await client.plugins.list();
  const install = plugins.find(
    (plugin) => plugin.package_name === WEB_PREVIEWS_PACKAGE_NAME,
  );
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

function previewResponseLinks(payload: unknown): PreviewLink[] | null {
  if (!isRecord(payload) || !Array.isArray(payload.previewLinks)) {
    return null;
  }

  const links: PreviewLink[] = [];
  for (const entry of payload.previewLinks) {
    if (!isRecord(entry)) {
      return null;
    }
    const label = trimmedString(entry.label);
    const url = httpUrl(trimmedString(entry.url));
    if (!label || !url) {
      return null;
    }
    links.push({ frontendName: '', label, url });
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

    const response = await fetchImpl(frontend.apiEndpointUrl, {
      method: 'POST',
      headers,
      body: payload,
      signal: controller.signal,
    });
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

function localizedText(value: unknown, locale: string): string | null {
  if (typeof value === 'string' && value.trim()) {
    return value.trim().replace(/^\/+/, '');
  }
  if (!isRecord(value)) {
    return null;
  }

  const preferred = value[locale];
  if (typeof preferred === 'string' && preferred.trim()) {
    return preferred.trim().replace(/^\/+/, '');
  }

  for (const entry of Object.values(value)) {
    if (typeof entry === 'string' && entry.trim()) {
      return entry.trim().replace(/^\/+/, '');
    }
  }

  return null;
}

function recordSlug(
  item: Record<string, unknown>,
  locale: string,
): string | null {
  const attributes = isRecord(item.attributes) ? item.attributes : undefined;
  if (!attributes) {
    return null;
  }

  for (const key of SLUG_FIELD_KEYS) {
    const slug = localizedText(attributes[key], locale);
    if (slug) {
      return slug;
    }
  }

  return null;
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

  let item: Record<string, unknown> | null = null;
  let itemType: Record<string, unknown> | null = null;
  if (client && frontends.length > 0) {
    const recordClient = client as unknown as RawRecordClient;
    item = rawData(await recordClient.items.rawFind(itemId));
    itemType = rawData(
      await recordClient.itemTypes.rawFind(relationshipId(item)),
    );
  } else if (client && host.websiteBaseUrl) {
    item = rawData(
      await (client as unknown as RawRecordClient).items.rawFind(itemId),
    );
  }

  const fetched =
    item && itemType && frontends.length > 0
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
    return {
      action: 'get_record_preview_links',
      itemId,
      locale,
      source: 'web_previews',
      links: fetched.links,
      errors: fetched.errors,
      message:
        'These are the full website URLs returned by the configured preview endpoints.',
    };
  }

  const fallback = inferredLink(
    host.websiteBaseUrl,
    item ? recordSlug(item, locale) : null,
  );
  if (fallback) {
    return {
      action: 'get_record_preview_links',
      itemId,
      locale,
      source: 'website_base_url',
      links: [fallback],
      errors: fetched.errors,
      message:
        'No preview endpoint returned a URL. This link was built from the configured website address and the record slug.',
    };
  }

  return {
    action: 'get_record_preview_links',
    itemId,
    locale,
    source: 'unavailable',
    links: [],
    errors: fetched.errors,
    slug: item ? recordSlug(item, locale) : null,
    message:
      'No website domain is configured. Give the editor the record slug and say the full URL is unavailable.',
  };
}
