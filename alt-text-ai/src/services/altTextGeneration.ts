import { Client, buildClient } from '@datocms/cma-client-browser';
import {
  type ExecuteFieldDropdownActionCtx,
  type FileFieldValue,
} from 'datocms-plugin-sdk';
import get from 'lodash/get';

const ALT_TEXT_API_URL = 'https://alttext.ai/api/v1/images';
const IMGIX_FORMAT = 'jpeg';
const IMGIX_WIDTH = '1024';
const DATO_CLIENT_NAME = 'datocms';
const UNKNOWN_ERROR = 'Unknown error';

export type AltGenerationMode = 'missing-only' | 'overwrite-all';

type AltTextApiResponse = {
  alt_text?: string;
  error_code?: string;
  errors?: { base?: string[] };
};

function getErrorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error ?? UNKNOWN_ERROR);
}

function formatAltTextErrorMessage(result: AltTextApiResponse): string {
  const errorCode = result.error_code ?? 'unknown_error';
  const baseMessage = result.errors?.base?.[0];

  return baseMessage ? `${errorCode}: ${baseMessage}` : errorCode;
}

function transformImageUrl(url: string): string {
  const transformedUrl = new URL(url);
  transformedUrl.searchParams.set('fm', IMGIX_FORMAT);
  transformedUrl.searchParams.set('w', IMGIX_WIDTH);
  return transformedUrl.toString();
}

function parseApiKey(ctx: ExecuteFieldDropdownActionCtx): string | null {
  const apiKey = ctx.plugin.attributes.parameters.apiKey;
  if (typeof apiKey !== 'string' || apiKey.trim() === '') {
    return null;
  }

  return apiKey.trim();
}

function hasAltText(alt: string | null): boolean {
  return typeof alt === 'string' && alt.trim().length > 0;
}

function shouldProcessAsset(asset: FileFieldValue, mode: AltGenerationMode): boolean {
  if (mode === 'overwrite-all') {
    return true;
  }

  return !hasAltText(asset.alt);
}

function isFileFieldValue(value: unknown): value is FileFieldValue {
  return (
    typeof value === 'object' &&
    value !== null &&
    typeof (value as FileFieldValue).upload_id === 'string'
  );
}

function isFileFieldValueArray(value: unknown): value is FileFieldValue[] {
  return Array.isArray(value) && value.every((asset) => isFileFieldValue(asset));
}

function getFieldValue(ctx: ExecuteFieldDropdownActionCtx): unknown {
  return get(ctx.formValues, ctx.fieldPath);
}

export function hasGeneratableFieldValue(value: unknown): boolean {
  if (isFileFieldValue(value)) {
    return true;
  }

  return isFileFieldValueArray(value) && value.length > 0;
}

async function fetchAlt(
  apiKey: string,
  client: Client,
  asset: FileFieldValue,
  locale: string,
): Promise<AltTextApiResponse> {
  const { url } = await client.uploads.find(asset.upload_id);

  // Use Imgix to keep payload format and size under control for AltText.ai.
  const response = await fetch(ALT_TEXT_API_URL, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'X-API-Key': apiKey,
      'X-Client': DATO_CLIENT_NAME,
    },
    body: JSON.stringify({
      image: {
        url: transformImageUrl(url),
        asset_id: `dato-${asset.upload_id}`,
      },
      lang: locale,
    }),
  });

  let result: AltTextApiResponse | undefined;
  try {
    result = (await response.json()) as AltTextApiResponse;
  } catch {
    // Ignore parsing errors and map them into a normalized error.
  }

  if (!response.ok) {
    return {
      error_code: `http_${response.status}`,
      errors: {
        base: [
          result?.errors?.base?.[0] ||
            result?.error_code ||
            response.statusText ||
            'Request failed',
        ],
      },
    };
  }

  if (!result) {
    return {
      error_code: 'invalid_response',
      errors: { base: ['Could not parse AltText.ai response'] },
    };
  }

  return result;
}

async function generateSingleAlt(
  asset: FileFieldValue,
  apiKey: string,
  client: Client,
  ctx: ExecuteFieldDropdownActionCtx,
  mode: AltGenerationMode,
) {
  if (!shouldProcessAsset(asset, mode)) {
    await ctx.notice('Alt text already exists for this asset.');
    return;
  }

  const result = await fetchAlt(apiKey, client, asset, ctx.locale);

  if (result.error_code) {
    await ctx.alert(`Error fetching alt text: ${formatAltTextErrorMessage(result)}`);
    return;
  }

  await ctx.setFieldValue(ctx.fieldPath, {
    ...asset,
    alt: result.alt_text ?? asset.alt,
  });
}

async function generateGalleryAlts(
  assets: FileFieldValue[],
  apiKey: string,
  client: Client,
  ctx: ExecuteFieldDropdownActionCtx,
  mode: AltGenerationMode,
) {
  const assetsToProcess = assets
    .map((asset, index) => ({ asset, index }))
    .filter(({ asset }) => shouldProcessAsset(asset, mode));

  if (assetsToProcess.length === 0) {
    await ctx.notice('No assets need alt text generation.');
    return;
  }

  const results = await Promise.allSettled(
    assetsToProcess.map(({ asset }) => fetchAlt(apiKey, client, asset, ctx.locale)),
  );

  let hasAtLeastOneSuccessfulUpdate = false;
  const updatedAssets = [...assets];
  const errorMessages: string[] = [];

  assetsToProcess.forEach(({ asset, index }, resultIndex) => {
    const outcome = results[resultIndex];
    if (outcome.status === 'rejected') {
      errorMessages.push(
        `Image ${asset.upload_id}: request_failed: ${getErrorMessage(outcome.reason)}`,
      );
      return;
    }

    const result = outcome.value;
    if (result.error_code) {
      errorMessages.push(
        `Image ${asset.upload_id}: ${formatAltTextErrorMessage(result)}`,
      );
      return;
    }

    updatedAssets[index] = {
      ...asset,
      alt: result.alt_text ?? asset.alt,
    };
    hasAtLeastOneSuccessfulUpdate = true;
  });

  if (errorMessages.length > 0) {
    await ctx.alert(`Alt text errors:\n${errorMessages.join('\n')}`);
  }

  if (hasAtLeastOneSuccessfulUpdate) {
    await ctx.setFieldValue(ctx.fieldPath, updatedAssets);
  }
}

export async function runAltGenerationForField(
  ctx: ExecuteFieldDropdownActionCtx,
  mode: AltGenerationMode,
) {
  if (!ctx.currentUserAccessToken) {
    await ctx.alert(
      'This plugin needs the currentUserAccessToken to function. Please give it that permission and try again.',
    );
    return;
  }

  const apiKey = parseApiKey(ctx);
  if (!apiKey) {
    await ctx.alert('Please configure your AltText.ai API key in the plugin settings.');
    return;
  }

  const currentFieldValue = getFieldValue(ctx);
  if (!hasGeneratableFieldValue(currentFieldValue)) {
    await ctx.notice('No asset selected in this field.');
    return;
  }

  try {
    const client = buildClient({ apiToken: ctx.currentUserAccessToken });

    if (isFileFieldValueArray(currentFieldValue)) {
      await generateGalleryAlts(currentFieldValue, apiKey, client, ctx, mode);
      return;
    }

    if (isFileFieldValue(currentFieldValue)) {
      await generateSingleAlt(currentFieldValue, apiKey, client, ctx, mode);
      return;
    }

    await ctx.notice('No asset selected in this field.');
  } catch (error) {
    console.error(error);
    await ctx.alert(
      `Unexpected error while generating alt text: ${getErrorMessage(error)}`,
    );
  }
}
