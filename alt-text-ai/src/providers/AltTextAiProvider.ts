import {
  AltTextProviderError,
  type AltTextProviderErrorCode,
  extractProviderErrorMessage,
} from './errors';
import {
  asRecord,
  fetchProviderJson,
  finalizeAltText,
  prepareGenerationInput,
} from './shared';
import type {
  AltTextAiProviderConfig,
  AltTextProvider,
  GenerateAltTextInput,
} from './types';

const DEFAULT_ENDPOINT = 'https://alttext.ai/api/v1/images';
const CLIENT_NAME = 'datocms';

function buildAssetId(assetId: string): string | undefined {
  if (!assetId) {
    return undefined;
  }

  return assetId.startsWith('dato-') ? assetId : `dato-${assetId}`;
}

function errorCodeForAltTextAi(message: string): AltTextProviderErrorCode {
  const normalized = message.toLowerCase();
  if (/credit|quota|usage limit/.test(normalized)) {
    return 'quota';
  }
  if (/api.?key|unauthori[sz]ed|forbidden/.test(normalized)) {
    return 'auth';
  }
  return 'provider';
}

function extractLocalizedAltText(
  payload: Record<string, unknown>,
  locale: string,
): string {
  const altTexts = asRecord(payload.alt_texts);
  if (altTexts) {
    const exact = altTexts[locale];
    if (typeof exact === 'string') {
      return exact;
    }

    const language = locale.split('-')[0];
    const fallback = language ? altTexts[language] : undefined;
    if (typeof fallback === 'string') {
      return fallback;
    }
  }

  return typeof payload.alt_text === 'string' ? payload.alt_text : '';
}

export default class AltTextAiProvider implements AltTextProvider {
  public readonly id = 'alttext-ai' as const;
  private readonly apiKey: string;
  private readonly endpoint: string;

  constructor(config: AltTextAiProviderConfig) {
    this.apiKey = config.apiKey;
    this.endpoint = config.endpoint ?? DEFAULT_ENDPOINT;
  }

  async generate(input: GenerateAltTextInput): Promise<string> {
    const prepared = prepareGenerationInput(this.id, input);
    const payload = await fetchProviderJson(this.id, this.endpoint, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'X-API-Key': this.apiKey,
        'X-Client': CLIENT_NAME,
      },
      body: JSON.stringify({
        image: {
          url: prepared.imageUrl,
          asset_id: buildAssetId(prepared.assetId),
        },
        lang: prepared.locale,
      }),
      signal: prepared.signal,
    });
    const result = asRecord(payload);

    if (!result) {
      throw new AltTextProviderError(
        this.id,
        'invalid_response',
        'The provider returned an invalid response.',
        { details: payload },
      );
    }

    if (typeof result.error_code === 'string' && result.error_code) {
      const message = extractProviderErrorMessage(result, result.error_code);
      throw new AltTextProviderError(
        this.id,
        errorCodeForAltTextAi(message),
        message,
        { details: result },
      );
    }

    return finalizeAltText(
      this.id,
      extractLocalizedAltText(result, prepared.locale),
    );
  }
}
