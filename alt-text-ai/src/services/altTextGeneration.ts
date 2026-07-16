import { buildClient, type Client } from '@datocms/cma-client-browser';
import type {
  ExecuteFieldDropdownActionCtx,
  FileFieldValue,
} from 'datocms-plugin-sdk';
import get from 'lodash/get';
import {
  activeProviderValidationError,
  normalizePluginConfiguration,
  type PluginConfiguration,
  PROVIDER_LABELS,
} from '../config';
import { createAltTextProvider } from '../providers/factory';
import type {
  AltTextProvider,
  AltTextProviderConfig,
} from '../providers/types';

const IMGIX_FORMAT = 'jpg';
const IMGIX_QUALITY = '80';
const IMGIX_FIT = 'max';
const IMGIX_WIDTH = '1024';
const IMGIX_HEIGHT = '1024';
const GALLERY_CONCURRENCY = 3;
const GENERATION_TIMEOUT_MS = 60_000;
const GENERATION_TOAST_DURATION_MS = 5_000;
const OPENAI_MAX_OUTPUT_TOKENS = 1_000;
const GEMINI_MAX_OUTPUT_TOKENS = 1_000;
const MAX_DISPLAYED_ERRORS = 8;
const UNKNOWN_ERROR = 'Unknown error';

export type AltGenerationMode = 'missing-only' | 'overwrite-all';

type GenerationTarget = {
  asset: FileFieldValue;
  index: number;
};

export type SettledResult<T> =
  | { status: 'fulfilled'; value: T }
  | { status: 'rejected'; reason: unknown };

function getErrorMessage(error: unknown): string {
  return error instanceof Error
    ? error.message
    : String(error ?? UNKNOWN_ERROR);
}

function shouldOmitOpenAITokenLimit(model: string): boolean {
  const normalized = model.toLowerCase();
  const baseModel = normalized.startsWith('ft:')
    ? (normalized.split(':')[1] ?? '')
    : normalized;

  return (
    /-pro(?:[.-]|$)/.test(baseModel) || /^o[1-9](?:[.-]|$)/.test(baseModel)
  );
}

function providerConfig(
  configuration: PluginConfiguration,
): AltTextProviderConfig {
  switch (configuration.provider) {
    case 'alttext-ai':
      return {
        provider: 'alttext-ai',
        apiKey: configuration.altTextAiApiKey,
      };
    case 'openai':
      return {
        provider: 'openai',
        apiKey: configuration.openAiApiKey,
        model: configuration.openAiModel,
        ...(shouldOmitOpenAITokenLimit(configuration.openAiModel)
          ? {}
          : { maxOutputTokens: OPENAI_MAX_OUTPUT_TOKENS }),
      };
    case 'anthropic':
      return {
        provider: 'anthropic',
        apiKey: configuration.anthropicApiKey,
        model: configuration.anthropicModel,
        maxOutputTokens: 300,
      };
    case 'gemini':
      return {
        provider: 'gemini',
        apiKey: configuration.geminiApiKey,
        model: configuration.geminiModel,
        maxOutputTokens: GEMINI_MAX_OUTPUT_TOKENS,
      };
  }
}

function hasAltText(alt: string | null): boolean {
  return typeof alt === 'string' && alt.trim().length > 0;
}

export function shouldProcessAsset(
  asset: FileFieldValue,
  mode: AltGenerationMode,
): boolean {
  return mode === 'overwrite-all' || !hasAltText(asset.alt);
}

export function isFileFieldValue(value: unknown): value is FileFieldValue {
  return (
    typeof value === 'object' &&
    value !== null &&
    typeof (value as FileFieldValue).upload_id === 'string'
  );
}

function isFileFieldValueArray(value: unknown): value is FileFieldValue[] {
  return (
    Array.isArray(value) && value.every((asset) => isFileFieldValue(asset))
  );
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

export function transformImageUrl(url: string): string {
  const transformedUrl = new URL(url);
  transformedUrl.searchParams.set('fm', IMGIX_FORMAT);
  transformedUrl.searchParams.set('q', IMGIX_QUALITY);
  transformedUrl.searchParams.set('fit', IMGIX_FIT);
  transformedUrl.searchParams.set('w', IMGIX_WIDTH);
  transformedUrl.searchParams.set('h', IMGIX_HEIGHT);
  return transformedUrl.toString();
}

/**
 * Maps work with stable result ordering while limiting simultaneous requests.
 * A single rejected item does not stop the remaining gallery assets.
 */
export async function mapSettledWithConcurrency<T, R>(
  items: T[],
  concurrency: number,
  mapper: (item: T, index: number) => Promise<R>,
): Promise<SettledResult<R>[]> {
  if (items.length === 0) {
    return [];
  }

  const workerCount = Math.max(1, Math.min(concurrency, items.length));
  const results = new Array<SettledResult<R>>(items.length);
  let nextIndex = 0;

  const worker = async (): Promise<void> => {
    const index = nextIndex;
    nextIndex += 1;
    if (index >= items.length) {
      return;
    }

    try {
      results[index] = {
        status: 'fulfilled',
        value: await mapper(items[index], index),
      };
    } catch (reason) {
      results[index] = { status: 'rejected', reason };
    }

    await worker();
  };

  await Promise.all(Array.from({ length: workerCount }, () => worker()));
  return results;
}

async function generateAltForAsset(
  asset: FileFieldValue,
  provider: AltTextProvider,
  client: Client,
  configuration: PluginConfiguration,
  locale: string,
): Promise<string> {
  const abortController = new AbortController();
  let timeoutId: ReturnType<typeof setTimeout> | undefined;
  const timeout = new Promise<never>((_resolve, reject) => {
    timeoutId = setTimeout(() => {
      reject(new Error('Alt text generation timed out after 60 seconds.'));
      abortController.abort();
    }, GENERATION_TIMEOUT_MS);
  });

  const generation = (async () => {
    const upload = await client.uploads.find(asset.upload_id);

    if (!upload.is_image) {
      throw new Error(`Asset ${asset.upload_id} is not an image.`);
    }

    return provider.generate({
      imageUrl: transformImageUrl(upload.url),
      assetId: asset.upload_id,
      locale,
      filename: upload.filename,
      promptTemplate: configuration.prompt,
      signal: abortController.signal,
    });
  })();

  try {
    return await Promise.race([generation, timeout]);
  } finally {
    if (timeoutId !== undefined) {
      clearTimeout(timeoutId);
    }
  }
}

function formatErrorSummary(messages: string[]): string {
  const visibleMessages = messages.slice(0, MAX_DISPLAYED_ERRORS);
  const remainingCount = messages.length - visibleMessages.length;

  if (remainingCount > 0) {
    visibleMessages.push(`…and ${remainingCount} more error(s).`);
  }

  return `Alt text generation errors:\n${visibleMessages.join('\n')}`;
}

function showGenerationStarted(ctx: ExecuteFieldDropdownActionCtx): void {
  void ctx.customToast({
    type: 'warning',
    message: 'Generating alts, this can take some time…',
    dismissOnPageChange: true,
    dismissAfterTimeout: GENERATION_TOAST_DURATION_MS,
  });
}

async function generateSingleAlt(
  asset: FileFieldValue,
  provider: AltTextProvider,
  client: Client,
  configuration: PluginConfiguration,
  ctx: ExecuteFieldDropdownActionCtx,
  mode: AltGenerationMode,
) {
  if (!shouldProcessAsset(asset, mode)) {
    await ctx.notice('Alt text already exists for this asset.');
    return;
  }

  showGenerationStarted(ctx);

  try {
    const alt = await generateAltForAsset(
      asset,
      provider,
      client,
      configuration,
      ctx.locale,
    );
    await ctx.setFieldValue(ctx.fieldPath, { ...asset, alt });
    await ctx.notice(
      `Alt text generated with ${PROVIDER_LABELS[configuration.provider]}.`,
    );
  } catch (error) {
    await ctx.alert(`Could not generate alt text: ${getErrorMessage(error)}`);
  }
}

async function generateGalleryAlts(
  assets: FileFieldValue[],
  provider: AltTextProvider,
  client: Client,
  configuration: PluginConfiguration,
  ctx: ExecuteFieldDropdownActionCtx,
  mode: AltGenerationMode,
) {
  const targets: GenerationTarget[] = [];
  for (const [index, asset] of assets.entries()) {
    if (shouldProcessAsset(asset, mode)) {
      targets.push({ asset, index });
    }
  }

  if (targets.length === 0) {
    await ctx.notice('No assets need alt text generation.');
    return;
  }

  showGenerationStarted(ctx);

  const results = await mapSettledWithConcurrency(
    targets,
    GALLERY_CONCURRENCY,
    ({ asset }) =>
      generateAltForAsset(asset, provider, client, configuration, ctx.locale),
  );

  const updatedAssets = [...assets];
  const errorMessages: string[] = [];
  let updatedCount = 0;

  for (const [resultIndex, result] of results.entries()) {
    const { asset, index } = targets[resultIndex];
    if (result.status === 'rejected') {
      errorMessages.push(
        `${asset.upload_id}: ${getErrorMessage(result.reason)}`,
      );
      continue;
    }

    updatedAssets[index] = { ...asset, alt: result.value };
    updatedCount += 1;
  }

  if (updatedCount > 0) {
    await ctx.setFieldValue(ctx.fieldPath, updatedAssets);
    await ctx.notice(
      `${updatedCount} alt text${updatedCount === 1 ? '' : 's'} generated with ${
        PROVIDER_LABELS[configuration.provider]
      }.`,
    );
  }

  if (errorMessages.length > 0) {
    await ctx.alert(formatErrorSummary(errorMessages));
  }
}

export async function runAltGenerationForField(
  ctx: ExecuteFieldDropdownActionCtx,
  mode: AltGenerationMode,
) {
  if (ctx.disabled) {
    await ctx.notice('This field is read-only.');
    return;
  }

  if (!ctx.currentUserAccessToken) {
    await ctx.alert(
      'This plugin needs the currentUserAccessToken permission to load asset URLs. Grant the permission and try again.',
    );
    return;
  }

  const configuration = normalizePluginConfiguration(
    ctx.plugin.attributes.parameters,
  );
  const configurationError = activeProviderValidationError(configuration);
  if (configurationError) {
    await ctx.alert(
      `${configurationError} Configure the provider in the plugin settings.`,
    );
    return;
  }

  const currentFieldValue = getFieldValue(ctx);
  if (!hasGeneratableFieldValue(currentFieldValue)) {
    await ctx.notice('No asset selected in this field.');
    return;
  }

  let didDisableField = false;

  try {
    await ctx.disableField(ctx.fieldPath, true);
    didDisableField = true;
    const client = buildClient({
      apiToken: ctx.currentUserAccessToken,
      environment: ctx.environment,
      baseUrl: ctx.cmaBaseUrl,
    });
    const provider = createAltTextProvider(providerConfig(configuration));

    if (isFileFieldValueArray(currentFieldValue)) {
      await generateGalleryAlts(
        currentFieldValue,
        provider,
        client,
        configuration,
        ctx,
        mode,
      );
      return;
    }

    if (isFileFieldValue(currentFieldValue)) {
      await generateSingleAlt(
        currentFieldValue,
        provider,
        client,
        configuration,
        ctx,
        mode,
      );
      return;
    }

    await ctx.notice('No asset selected in this field.');
  } catch (error) {
    console.error('Unexpected alt text generation error:', error);
    await ctx.alert(
      `Unexpected error while generating alt text: ${getErrorMessage(error)}`,
    );
  } finally {
    if (didDisableField) {
      try {
        await ctx.disableField(ctx.fieldPath, false);
      } catch (error) {
        console.error('Could not re-enable the asset field:', error);
      }
    }
  }
}
