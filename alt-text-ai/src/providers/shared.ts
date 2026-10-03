import { DEFAULT_ALT_TEXT_PROMPT } from '../config';
import {
  AltTextProviderError,
  createProviderHttpError,
  isAbortError,
  isAltTextProviderError,
  normalizeProviderFailure,
} from './errors';
import {
  readBoundedResponseBytes,
  ResponseTooLargeError,
  throwIfAborted,
  withHttpRetries,
} from './http';
import type { AltTextProviderId, GenerateAltTextInput } from './types';

export { DEFAULT_ALT_TEXT_PROMPT };

export type PreparedGenerationInput = Omit<
  GenerateAltTextInput,
  'promptTemplate'
> & {
  prompt: string;
};

export function asRecord(value: unknown): Record<string, unknown> | null {
  return typeof value === 'object' && value !== null
    ? (value as Record<string, unknown>)
    : null;
}

export function joinApiUrl(baseUrl: string, path: string): string {
  return `${baseUrl.replace(/\/+$/, '')}/${path.replace(/^\/+/, '')}`;
}

type DisplayNamesConstructor = new (
  locales: string | string[],
  options: { type: 'language' },
) => { of(code: string): string | undefined };

function localePromptValue(locale: string): string {
  const normalizedLocale = locale.replace(/_/g, '-');
  const DisplayNames = (
    Intl as typeof Intl & { DisplayNames?: DisplayNamesConstructor }
  ).DisplayNames;

  if (DisplayNames) {
    try {
      const languageName = new DisplayNames(['en'], {
        type: 'language',
      }).of(normalizedLocale);

      if (languageName) {
        return `${languageName} (locale code "${locale}")`;
      }
    } catch {
      // Fall through to the unambiguous locale-code wording.
    }
  }

  return `the language identified by locale code "${locale}"`;
}

export function expandPromptTemplate(
  promptTemplate: string,
  variables: { locale: string; filename: string },
): string {
  const template = promptTemplate.trim() || DEFAULT_ALT_TEXT_PROMPT;

  return template
    .replace(/\{locale\}/g, () => localePromptValue(variables.locale))
    .replace(/\{filename\}/g, () => variables.filename)
    .trim();
}

function validatePublicImageUrl(
  provider: AltTextProviderId,
  imageUrl: string,
): string {
  try {
    const parsed = new URL(imageUrl);
    if (parsed.protocol !== 'https:' && parsed.protocol !== 'http:') {
      throw new Error('Unsupported URL protocol');
    }
    return parsed.toString();
  } catch {
    throw new AltTextProviderError(
      provider,
      'invalid_request',
      'The asset does not have a valid public image URL.',
    );
  }
}

export function prepareGenerationInput(
  provider: AltTextProviderId,
  input: GenerateAltTextInput,
): PreparedGenerationInput {
  const locale = input.locale.trim() || 'en';
  const filename = input.filename.trim();

  return {
    imageUrl: validatePublicImageUrl(provider, input.imageUrl.trim()),
    assetId: input.assetId.trim(),
    locale,
    filename,
    prompt: expandPromptTemplate(input.promptTemplate, { locale, filename }),
    signal: input.signal,
  };
}

const MAX_JSON_RESPONSE_BYTES = 8 * 1024 * 1024;
// Base64 expands bytes by 4/3. Leave room below Gemini's 20MB inline request cap.
export const MAX_INLINE_IMAGE_BYTES = 12 * 1024 * 1024;

async function readResponsePayload(
  response: Response,
  signal: AbortSignal,
): Promise<unknown> {
  const bytes = await readBoundedResponseBytes(
    response,
    MAX_JSON_RESPONSE_BYTES,
    signal,
  );
  const text = new TextDecoder().decode(bytes);
  if (!text.trim()) {
    return null;
  }

  try {
    return JSON.parse(text) as unknown;
  } catch {
    return text;
  }
}

async function fetchProviderJsonAttempt(
  provider: AltTextProviderId,
  url: string,
  init: RequestInit & { signal: AbortSignal },
  preserveFailure: (failure: AltTextProviderError) => void,
): Promise<unknown> {
  let response: Response;

  try {
    response = await fetch(url, init);
  } catch (error) {
    if (isAbortError(error)) {
      throw error;
    }
    throw normalizeProviderFailure(provider, error);
  }

  const httpFailure = response.ok
    ? undefined
    : createProviderHttpError(provider, response, null);
  if (httpFailure) {
    preserveFailure(httpFailure);
  }
  let payload: unknown;
  try {
    payload = await readResponsePayload(response, init.signal);
  } catch (error) {
    if (httpFailure) {
      throw httpFailure;
    }
    if (isAbortError(error)) {
      throw error;
    }
    throw new AltTextProviderError(
      provider,
      'invalid_response',
      'Could not read the provider response.',
      { status: response.status, details: error },
    );
  }

  if (!response.ok) {
    throw createProviderHttpError(provider, response, payload);
  }

  if (payload === null || typeof payload === 'string') {
    throw new AltTextProviderError(
      provider,
      'invalid_response',
      'The provider returned an invalid JSON response.',
      { status: response.status, details: payload },
    );
  }

  return payload;
}

export function fetchProviderJson(
  provider: AltTextProviderId,
  url: string,
  init: RequestInit,
): Promise<unknown> {
  const readOnly =
    !init.method || ['GET', 'HEAD'].includes(init.method.toUpperCase());
  return withHttpRetries(
    provider,
    init.signal,
    readOnly,
    (signal, preserveFailure) =>
      fetchProviderJsonAttempt(
        provider,
        url,
        { ...init, signal },
        preserveFailure,
      ),
    `${provider}:${new URL(url).origin}`,
  );
}

function removeWrappingMarkdown(text: string): string {
  return text
    .replace(/^```(?:text|plaintext|markdown)?\s*/i, '')
    .replace(/\s*```$/, '')
    .trim();
}

function removeWrappingQuotes(text: string): string {
  const quotePairs: Array<[string, string]> = [
    ['"', '"'],
    ["'", "'"],
    ['“', '”'],
    ['‘', '’'],
    ['`', '`'],
  ];

  for (const [opening, closing] of quotePairs) {
    if (text.startsWith(opening) && text.endsWith(closing)) {
      return text.slice(opening.length, -closing.length).trim();
    }
  }

  return text;
}

export function sanitizeAltText(value: string): string {
  let sanitized = removeWrappingMarkdown(value);

  for (let attempt = 0; attempt < 4; attempt += 1) {
    const previous = sanitized;
    sanitized = removeWrappingQuotes(sanitized.trim())
      .replace(/^(?:alt(?:ernative)?\s*text|description)\s*:\s*/i, '')
      .trim();

    if (sanitized === previous) {
      break;
    }
  }

  return sanitized.replace(/\s+/g, ' ').trim();
}

export function finalizeAltText(
  provider: AltTextProviderId,
  value: string,
): string {
  const altText = sanitizeAltText(value);

  if (!altText) {
    throw new AltTextProviderError(
      provider,
      'empty_response',
      'The provider returned no alt text.',
    );
  }

  return altText;
}

function bytesToBase64(bytes: Uint8Array): string {
  // A multiple of three avoids padding between chunks and a full binary-string copy.
  const chunkSize = 0x6000;
  const chunks: string[] = [];

  for (let offset = 0; offset < bytes.length; offset += chunkSize) {
    const chunk = bytes.subarray(offset, offset + chunkSize);
    chunks.push(btoa(String.fromCharCode(...chunk)));
  }

  return chunks.join('');
}

function supportedImageMimeType(
  provider: AltTextProviderId,
  response: Response,
): string {
  const contentType = response.headers
    .get('content-type')
    ?.split(';')[0]
    ?.trim()
    .toLowerCase();
  const supportedTypes = [
    'image/png',
    'image/jpeg',
    'image/webp',
    'image/heic',
    'image/heif',
  ];
  if (!contentType || !supportedTypes.includes(contentType)) {
    void response.body?.cancel().catch(() => {});
    throw new AltTextProviderError(
      provider,
      'image_fetch',
      'The downloaded file has an unsupported image format.',
    );
  }
  return contentType;
}

async function fetchImageAsBase64Attempt(
  provider: AltTextProviderId,
  imageUrl: string,
  signal?: AbortSignal,
): Promise<{ data: string; mimeType: string }> {
  let response: Response;

  try {
    response = await fetch(imageUrl, { signal });
  } catch (error) {
    if (isAbortError(error)) {
      throw error;
    }
    throw new AltTextProviderError(
      provider,
      'network',
      'Could not download the image for analysis.',
      { details: error },
    );
  }

  if (!response.ok) {
    const httpFailure = createProviderHttpError(provider, response, null);
    void response.body?.cancel().catch(() => {});
    if (response.status === 429) {
      throw httpFailure;
    }
    throw new AltTextProviderError(
      provider,
      'image_fetch',
      `Could not download the image (HTTP ${response.status}).`,
      { status: response.status },
    );
  }

  try {
    const contentType = supportedImageMimeType(provider, response);
    const bytes = await readBoundedResponseBytes(
      response,
      MAX_INLINE_IMAGE_BYTES,
      signal,
    );
    if (!bytes.byteLength) {
      throw new AltTextProviderError(
        provider,
        'image_fetch',
        'The downloaded image is empty.',
      );
    }
    throwIfAborted(signal);

    return {
      data: bytesToBase64(bytes),
      mimeType: contentType,
    };
  } catch (error) {
    if (isAbortError(error) || isAltTextProviderError(error)) {
      throw error;
    }
    throw new AltTextProviderError(
      provider,
      error instanceof ResponseTooLargeError ? 'image_fetch' : 'network',
      error instanceof ResponseTooLargeError
        ? 'The image exceeds the 12 MiB analysis download limit.'
        : 'Could not read the downloaded image.',
      { details: error },
    );
  }
}

export function fetchImageAsBase64(
  provider: AltTextProviderId,
  imageUrl: string,
  signal?: AbortSignal,
): Promise<{ data: string; mimeType: string }> {
  return withHttpRetries(provider, signal, true, (requestSignal) =>
    fetchImageAsBase64Attempt(provider, imageUrl, requestSignal),
  );
}
