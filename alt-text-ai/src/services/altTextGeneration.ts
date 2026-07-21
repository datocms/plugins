import {
  buildClient,
  type Client,
  type UploadLocaleKeyedDefaultFieldMetadata,
  type UploadLocaleKeyedDefaultFieldMetadataInRequest,
} from '@datocms/cma-client-browser';
import type {
  ExecuteFieldDropdownActionCtx,
  ExecuteUploadsDropdownActionCtx,
  FileFieldValue,
  Upload,
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
const GENERATION_CONCURRENCY = 3;
const GENERATION_TIMEOUT_MS = 60_000;
const GENERATION_TOAST_DURATION_MS = 5_000;
const GENERATION_PROGRESS_INTERVAL_MS = 6_000;
const OPENAI_MAX_OUTPUT_TOKENS = 1_000;
const GEMINI_MAX_OUTPUT_TOKENS = 1_000;
const MAX_DISPLAYED_ERRORS = 8;
const UNKNOWN_ERROR = 'Unknown error';

export type AltGenerationMode = 'missing-only' | 'overwrite-all';

type GenerationTarget = {
  asset: FileFieldValue;
  index: number;
};

type CmaUpload = Awaited<ReturnType<Client['uploads']['find']>>;

type UploadGenerationTarget = {
  upload: CmaUpload;
  locale: string;
};

type GeneratedUploadAlt = UploadGenerationTarget & {
  alt: string;
};

type UploadAltGroup = {
  upload: CmaUpload;
  alts: Map<string, string>;
};

type UploadLoadSummary = {
  uploads: CmaUpload[];
  errors: string[];
};

type UploadGenerationSummary = {
  groups: UploadAltGroup[];
  errors: string[];
};

type UploadUpdateSummary = {
  updatedAltCount: number;
  updatedUploadCount: number;
  errors: string[];
};

type UploadMetadataUpdate = NonNullable<
  Parameters<Client['uploads']['update']>[1]['default_field_metadata']
>;

type LocalizedAltUpdate = NonNullable<UploadMetadataUpdate['alt']>;

type FieldKeyedUploadMetadata = CmaUpload['default_field_metadata'];

type RuntimeUploadMetadata =
  | FieldKeyedUploadMetadata
  | UploadLocaleKeyedDefaultFieldMetadata;

type RuntimeUploadMetadataUpdate =
  | UploadMetadataUpdate
  | UploadLocaleKeyedDefaultFieldMetadataInRequest;

type GenerationFeedbackCtx = Pick<ExecuteFieldDropdownActionCtx, 'customToast'>;

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

function hasAltText(alt: unknown): boolean {
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

async function withGenerationTimeout(
  operation: (signal: AbortSignal) => Promise<string>,
): Promise<string> {
  const abortController = new AbortController();
  let timeoutId: ReturnType<typeof setTimeout> | undefined;
  const timeout = new Promise<never>((_resolve, reject) => {
    timeoutId = setTimeout(() => {
      reject(new Error('Alt text generation timed out after 60 seconds.'));
      abortController.abort();
    }, GENERATION_TIMEOUT_MS);
  });

  try {
    return await Promise.race([operation(abortController.signal), timeout]);
  } finally {
    if (timeoutId !== undefined) {
      clearTimeout(timeoutId);
    }
  }
}

function requestAltForUpload(
  upload: CmaUpload,
  assetId: string,
  provider: AltTextProvider,
  configuration: PluginConfiguration,
  locale: string,
  signal: AbortSignal,
): Promise<string> {
  if (!upload.is_image) {
    throw new Error(`Asset ${upload.id} is not an image.`);
  }

  return provider.generate({
    imageUrl: transformImageUrl(upload.url),
    assetId,
    locale,
    filename: upload.filename,
    promptTemplate: configuration.prompt,
    signal,
  });
}

async function generateAltForUpload(
  upload: CmaUpload,
  provider: AltTextProvider,
  configuration: PluginConfiguration,
  locale: string,
): Promise<string> {
  return withGenerationTimeout((signal) =>
    requestAltForUpload(
      upload,
      upload.id,
      provider,
      configuration,
      locale,
      signal,
    ),
  );
}

async function generateAltForAsset(
  asset: FileFieldValue,
  provider: AltTextProvider,
  client: Client,
  configuration: PluginConfiguration,
  locale: string,
): Promise<string> {
  return withGenerationTimeout(async (signal) => {
    const upload = await client.uploads.find(asset.upload_id);

    return requestAltForUpload(
      upload,
      asset.upload_id,
      provider,
      configuration,
      locale,
      signal,
    );
  });
}

function formatErrorSummary(messages: string[]): string {
  const visibleMessages = messages.slice(0, MAX_DISPLAYED_ERRORS);
  const remainingCount = messages.length - visibleMessages.length;

  if (remainingCount > 0) {
    visibleMessages.push(`…and ${remainingCount} more error(s).`);
  }

  return `Alt text generation errors:\n${visibleMessages.join('\n')}`;
}

function showGenerationToast(
  ctx: GenerationFeedbackCtx,
  message: string,
): void {
  void ctx.customToast({
    type: 'warning',
    message,
    dismissOnPageChange: true,
    dismissAfterTimeout: GENERATION_TOAST_DURATION_MS,
  });
}

function showGenerationStarted(ctx: GenerationFeedbackCtx): void {
  showGenerationToast(ctx, 'Generating alts, this can take some time…');
}

function countLabel(count: number, singular: string): string {
  return `${count} ${singular}${count === 1 ? '' : 's'}`;
}

function createUploadGenerationProgress(
  ctx: ExecuteUploadsDropdownActionCtx,
  targets: UploadGenerationTarget[],
  localeCount: number,
): (target: UploadGenerationTarget) => void {
  const targetTotalsByUpload = new Map<string, number>();
  const processedByUpload = new Map<string, number>();
  for (const target of targets) {
    targetTotalsByUpload.set(
      target.upload.id,
      (targetTotalsByUpload.get(target.upload.id) ?? 0) + 1,
    );
  }
  const uploadCount = targetTotalsByUpload.size;

  let processedTargetCount = 0;
  let finishedUploadCount = 0;
  let lastUpdateAt = Date.now();

  showGenerationToast(
    ctx,
    `Generating ${countLabel(targets.length, 'alt text')} for ${countLabel(uploadCount, 'asset')} across ${countLabel(localeCount, 'locale')}…`,
  );

  return (target) => {
    processedTargetCount += 1;
    const processedForUpload =
      (processedByUpload.get(target.upload.id) ?? 0) + 1;
    processedByUpload.set(target.upload.id, processedForUpload);

    if (processedForUpload === targetTotalsByUpload.get(target.upload.id)) {
      finishedUploadCount += 1;
    }

    const now = Date.now();
    if (
      processedTargetCount === targets.length ||
      now - lastUpdateAt < GENERATION_PROGRESS_INTERVAL_MS
    ) {
      return;
    }

    lastUpdateAt = now;
    showGenerationToast(
      ctx,
      `Generating alt texts… ${processedTargetCount} of ${targets.length} locale versions processed; ${finishedUploadCount} of ${uploadCount} assets finished.`,
    );
  };
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
    GENERATION_CONCURRENCY,
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

function nonImageSkipMessage(count: number): string {
  return `${count} non-image asset${count === 1 ? '' : 's'} skipped.`;
}

function uploadLabel(upload: CmaUpload): string {
  return upload.filename.trim() || upload.id;
}

function uploadMetadata(upload: CmaUpload): RuntimeUploadMetadata {
  return upload.default_field_metadata as unknown as RuntimeUploadMetadata;
}

function isFieldKeyedUploadMetadata(
  metadata: RuntimeUploadMetadata,
): metadata is FieldKeyedUploadMetadata {
  return 'focal_point' in metadata;
}

function uploadAltForLocale(upload: CmaUpload, locale: string): unknown {
  const metadata = uploadMetadata(upload);

  return isFieldKeyedUploadMetadata(metadata)
    ? metadata.alt[locale]
    : metadata[locale]?.alt;
}

function selectedUploadLabel(upload: Upload): string {
  return upload.attributes.filename.trim() || upload.id;
}

function uploadGenerationTargets(
  uploads: CmaUpload[],
  locales: string[],
  mode: AltGenerationMode,
): UploadGenerationTarget[] {
  return uploads.flatMap((upload) =>
    locales
      .filter(
        (locale) =>
          mode === 'overwrite-all' ||
          !hasAltText(uploadAltForLocale(upload, locale)),
      )
      .map((locale) => ({ upload, locale })),
  );
}

function buildUploadMetadataUpdate(
  upload: CmaUpload,
  alts: Map<string, string>,
  mode: AltGenerationMode,
): { metadata: RuntimeUploadMetadataUpdate; updatedAltCount: number } {
  const metadata = uploadMetadata(upload);
  const fieldKeyed = isFieldKeyedUploadMetadata(metadata);
  const fieldKeyedAlts: LocalizedAltUpdate = fieldKeyed
    ? { ...metadata.alt }
    : {};
  const localeKeyedUpdate: UploadLocaleKeyedDefaultFieldMetadataInRequest = {};
  let updatedAltCount = 0;

  for (const [locale, alt] of alts) {
    const currentAlt = fieldKeyed
      ? metadata.alt[locale]
      : metadata[locale]?.alt;
    if (mode === 'missing-only' && hasAltText(currentAlt)) {
      continue;
    }

    if (fieldKeyed) {
      fieldKeyedAlts[locale] = alt;
    } else {
      localeKeyedUpdate[locale] = { alt };
    }
    updatedAltCount += 1;
  }

  return {
    metadata: fieldKeyed ? { alt: fieldKeyedAlts } : localeKeyedUpdate,
    updatedAltCount,
  };
}

async function confirmUploadOverwrite(
  ctx: ExecuteUploadsDropdownActionCtx,
  imageCount: number,
): Promise<boolean> {
  const result = await ctx.openConfirm({
    title: 'Regenerate asset alt texts?',
    content: `This will immediately replace existing default alt text for ${imageCount} image asset${imageCount === 1 ? '' : 's'} in every locale. This action cannot be undone.`,
    choices: [
      {
        label: 'Regenerate alt texts',
        value: true,
        intent: 'negative',
      },
    ],
    cancel: {
      label: 'Cancel',
      value: false,
    },
  });

  return result === true;
}

async function loadSelectedUploads(
  client: Client,
  selectedUploads: Upload[],
): Promise<UploadLoadSummary> {
  const results = await mapSettledWithConcurrency(
    selectedUploads,
    GENERATION_CONCURRENCY,
    (upload) => client.uploads.find(upload.id),
  );
  const uploads: CmaUpload[] = [];
  const errors: string[] = [];

  for (const [index, result] of results.entries()) {
    if (result.status === 'rejected') {
      errors.push(
        `${selectedUploadLabel(selectedUploads[index])}: Could not load asset: ${getErrorMessage(result.reason)}`,
      );
    } else {
      uploads.push(result.value);
    }
  }

  return { uploads, errors };
}

async function reportNoUploadTargets(
  ctx: ExecuteUploadsDropdownActionCtx,
  selectedCount: number,
  imageCount: number,
  nonImageCount: number,
  errors: string[],
): Promise<void> {
  if (imageCount === 0) {
    if (selectedCount === 0 || nonImageCount > 0) {
      await ctx.notice('No image assets selected.');
    }
  } else {
    const skippedMessage = nonImageCount
      ? ` ${nonImageSkipMessage(nonImageCount)}`
      : '';
    await ctx.notice(
      `All selected image assets already have alt text for every locale.${skippedMessage}`,
    );
  }

  if (errors.length > 0) {
    await ctx.alert(formatErrorSummary(errors));
  }
}

async function generateUploadTargetAlts(
  targets: UploadGenerationTarget[],
  provider: AltTextProvider,
  configuration: PluginConfiguration,
  onTargetSettled: (target: UploadGenerationTarget) => void,
): Promise<UploadGenerationSummary> {
  const results = await mapSettledWithConcurrency(
    targets,
    GENERATION_CONCURRENCY,
    async (target): Promise<GeneratedUploadAlt> => {
      try {
        return {
          ...target,
          alt: await generateAltForUpload(
            target.upload,
            provider,
            configuration,
            target.locale,
          ),
        };
      } finally {
        onTargetSettled(target);
      }
    },
  );
  const groupsByUpload = new Map<string, UploadAltGroup>();
  const errors: string[] = [];

  for (const [index, result] of results.entries()) {
    const target = targets[index];
    if (result.status === 'rejected') {
      errors.push(
        `${uploadLabel(target.upload)} (${target.locale}): ${getErrorMessage(result.reason)}`,
      );
      continue;
    }

    const group = groupsByUpload.get(result.value.upload.id) ?? {
      upload: result.value.upload,
      alts: new Map<string, string>(),
    };
    group.alts.set(result.value.locale, result.value.alt);
    groupsByUpload.set(result.value.upload.id, group);
  }

  return { groups: Array.from(groupsByUpload.values()), errors };
}

async function updateUploadAlts(
  client: Client,
  groups: UploadAltGroup[],
  mode: AltGenerationMode,
): Promise<UploadUpdateSummary> {
  const results = await mapSettledWithConcurrency(
    groups,
    GENERATION_CONCURRENCY,
    async ({ upload, alts }) => {
      const latestUpload = await client.uploads.find(upload.id);
      if (!latestUpload.is_image) {
        throw new Error('The asset is no longer an image.');
      }

      const { metadata, updatedAltCount } = buildUploadMetadataUpdate(
        latestUpload,
        alts,
        mode,
      );

      if (updatedAltCount > 0) {
        await client.uploads.update(latestUpload.id, {
          default_field_metadata: metadata as UploadMetadataUpdate,
        });
      }

      return updatedAltCount;
    },
  );
  const summary: UploadUpdateSummary = {
    updatedAltCount: 0,
    updatedUploadCount: 0,
    errors: [],
  };

  for (const [index, result] of results.entries()) {
    if (result.status === 'rejected') {
      summary.errors.push(
        `${uploadLabel(groups[index].upload)}: Could not save generated alt text: ${getErrorMessage(result.reason)}`,
      );
    } else if (result.value > 0) {
      summary.updatedAltCount += result.value;
      summary.updatedUploadCount += 1;
    }
  }

  return summary;
}

async function reportUploadGeneration(
  ctx: ExecuteUploadsDropdownActionCtx,
  configuration: PluginConfiguration,
  generatedGroupCount: number,
  updateSummary: UploadUpdateSummary,
  nonImageCount: number,
  errors: string[],
): Promise<void> {
  const noticeMessages: string[] = [];

  if (updateSummary.updatedAltCount > 0) {
    noticeMessages.push(
      `${updateSummary.updatedAltCount} alt text${updateSummary.updatedAltCount === 1 ? '' : 's'} generated for ${updateSummary.updatedUploadCount} asset${updateSummary.updatedUploadCount === 1 ? '' : 's'} with ${PROVIDER_LABELS[configuration.provider]}.`,
    );
  } else if (generatedGroupCount > 0 && errors.length === 0) {
    noticeMessages.push(
      'No alt texts were changed because newer asset metadata was preserved.',
    );
  }

  if (nonImageCount > 0) {
    noticeMessages.push(nonImageSkipMessage(nonImageCount));
  }

  if (noticeMessages.length > 0) {
    await ctx.notice(noticeMessages.join(' '));
  }

  if (errors.length > 0) {
    await ctx.alert(formatErrorSummary(errors));
  }
}

export async function runAltGenerationForUploads(
  ctx: ExecuteUploadsDropdownActionCtx,
  uploads: Upload[],
  mode: AltGenerationMode,
): Promise<void> {
  if (!ctx.currentUserAccessToken) {
    await ctx.alert(
      'This plugin needs the currentUserAccessToken permission to update asset metadata. Grant the permission and try again.',
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

  try {
    const client = buildClient({
      apiToken: ctx.currentUserAccessToken,
      environment: ctx.environment,
      baseUrl: ctx.cmaBaseUrl,
    });
    const loadSummary = await loadSelectedUploads(client, uploads);
    const imageUploads = loadSummary.uploads.filter(
      (upload) => upload.is_image,
    );
    const nonImageCount = loadSummary.uploads.length - imageUploads.length;
    const locales = Array.from(new Set(ctx.site.attributes.locales));
    const targets = uploadGenerationTargets(imageUploads, locales, mode);

    if (targets.length === 0) {
      await reportNoUploadTargets(
        ctx,
        uploads.length,
        imageUploads.length,
        nonImageCount,
        loadSummary.errors,
      );
      return;
    }

    if (
      mode === 'overwrite-all' &&
      !(await confirmUploadOverwrite(ctx, imageUploads.length))
    ) {
      return;
    }

    const provider = createAltTextProvider(providerConfig(configuration));
    const reportProgress = createUploadGenerationProgress(
      ctx,
      targets,
      locales.length,
    );
    const generationSummary = await generateUploadTargetAlts(
      targets,
      provider,
      configuration,
      reportProgress,
    );
    const updateSummary = await updateUploadAlts(
      client,
      generationSummary.groups,
      mode,
    );
    const errors = [
      ...loadSummary.errors,
      ...generationSummary.errors,
      ...updateSummary.errors,
    ];

    await reportUploadGeneration(
      ctx,
      configuration,
      generationSummary.groups.length,
      updateSummary,
      nonImageCount,
      errors,
    );
  } catch (error) {
    console.error('Unexpected upload alt text generation error:', error);
    await ctx.alert(
      `Unexpected error while generating asset alt text: ${getErrorMessage(error)}`,
    );
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
