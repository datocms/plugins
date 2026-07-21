import { DEFAULT_ALT_TEXT_PROMPT } from '../config';
import {
  AltTextProviderError,
  createProviderHttpError,
  isAbortError,
  normalizeProviderFailure,
} from './errors';
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

async function readResponsePayload(response: Response): Promise<unknown> {
  const text = await response.text();
  if (!text.trim()) {
    return null;
  }

  try {
    return JSON.parse(text) as unknown;
  } catch {
    return text;
  }
}

export async function fetchProviderJson(
  provider: AltTextProviderId,
  url: string,
  init: RequestInit,
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

  let payload: unknown;
  try {
    payload = await readResponsePayload(response);
  } catch (error) {
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
  const chunkSize = 0x8000;
  let binary = '';

  for (let offset = 0; offset < bytes.length; offset += chunkSize) {
    const chunk = bytes.subarray(offset, offset + chunkSize);
    binary += String.fromCharCode(...chunk);
  }

  return btoa(binary);
}

export async function fetchImageAsBase64(
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
      'image_fetch',
      'Could not download the image for analysis.',
      { details: error },
    );
  }

  if (!response.ok) {
    throw new AltTextProviderError(
      provider,
      'image_fetch',
      `Could not download the image (HTTP ${response.status}).`,
      { status: response.status },
    );
  }

  try {
    const bytes = new Uint8Array(await response.arrayBuffer());
    const contentType = response.headers.get('content-type')?.split(';')[0];

    return {
      data: bytesToBase64(bytes),
      mimeType: contentType?.startsWith('image/') ? contentType : 'image/jpeg',
    };
  } catch (error) {
    if (isAbortError(error)) {
      throw error;
    }
    throw new AltTextProviderError(
      provider,
      'image_fetch',
      'Could not read the downloaded image.',
      { details: error },
    );
  }
}
