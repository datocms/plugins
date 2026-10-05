import { buildClient, type Client } from '@datocms/cma-client-browser';
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
import { isFatalProviderFailure } from '../providers/errors';
import { createAltTextProvider } from '../providers/factory';
import type {
  AltTextProvider,
  AltTextProviderConfig,
} from '../providers/types';
import {
  acquireFieldGenerationLock,
  getLatestFieldContext,
  recordFieldValueWrite,
} from './fieldContext';

const IMGIX_FORMAT = 'jpg';
const IMGIX_QUALITY = '80';
const IMGIX_FIT = 'max';
const IMGIX_WIDTH = '1024';
const IMGIX_HEIGHT = '1024';
const GENERATION_CONCURRENCY = 3;
// Allows the CMA read, Gemini image download and provider retry budgets.
// Individual HTTP attempts still time out and abort at 30/60 seconds.
const GENERATION_TIMEOUT_MS = 365_000;
const GENERATION_TOAST_DURATION_MS = 5_000;
const GENERATION_PROGRESS_INTERVAL_MS = 6_000;
const OPENAI_MAX_OUTPUT_TOKENS = 1_000;
const GEMINI_MAX_OUTPUT_TOKENS = 1_000;
const MAX_DISPLAYED_ERRORS = 8;
const UPLOAD_BATCH_SIZE = 50;
const LOCALE_SAVE_BATCH_SIZE = 10;
const activeUploadRuns = new Set<string>();
const UNKNOWN_ERROR = 'Unknown error';

export type AltGenerationMode = 'missing-only' | 'overwrite-all';

type GenerationTarget = {
  asset: FileFieldValue;
  index: number;
};

type CmaUpload = Awaited<ReturnType<Client['uploads']['find']>>;

type UploadUpdateSummary = {
  updatedAltCount: number;
  updatedUploadCount: number;
};

/** Keep diagnostic memory bounded even if every locale of every asset fails. */
class GenerationErrors {
  count = 0;
  messages: string[] = [];

  add(message: string): void {
    this.count += 1;
    if (this.messages.length < MAX_DISPLAYED_ERRORS) {
      this.messages.push(
        message.length > 1_000 ? `${message.slice(0, 1_000)}…` : message,
      );
    }
  }

  format(): string {
    const remaining = this.count - this.messages.length;
    return `Alt text generation errors:\n${[
      ...this.messages,
      ...(remaining > 0 ? [`…and ${remaining} more error(s).`] : []),
    ].join('\n')}`;
  }
}

type UploadMetadataUpdate = NonNullable<
  Parameters<Client['uploads']['update']>[1]['default_field_metadata']
>;

type LocalizedAltUpdate = NonNullable<UploadMetadataUpdate['alt']>;

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

  const workerCount = Number.isFinite(concurrency)
    ? Math.max(1, Math.min(Math.floor(concurrency), items.length))
    : 1;
  const results = new Array<SettledResult<R>>(items.length);
  let nextIndex = 0;

  const worker = async (): Promise<void> => {
    while (nextIndex < items.length) {
      const index = nextIndex++;
      try {
        results[index] = {
          status: 'fulfilled',
          // biome-ignore lint/performance/noAwaitInLoops: Each worker must wait before claiming more work to bound concurrency.
          value: await mapper(items[index], index),
        };
      } catch (reason) {
        results[index] = { status: 'rejected', reason };
      }
    }
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
      reject(
        new Error(
          `Alt text generation timed out after ${GENERATION_TIMEOUT_MS / 1000} seconds.`,
        ),
      );
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
    signal.throwIfAborted();

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

function showGenerationToast(
  ctx: GenerationFeedbackCtx,
  message: string,
): void {
  void ctx
    .customToast({
      type: 'warning',
      message,
      dismissOnPageChange: true,
      dismissAfterTimeout: GENERATION_TOAST_DURATION_MS,
    })
    .catch(() => undefined);
}

function showGenerationStarted(ctx: GenerationFeedbackCtx): void {
  showGenerationToast(ctx, 'Generating alts, this can take some time…');
}

function countLabel(count: number, singular: string): string {
  return `${count} ${singular}${count === 1 ? '' : 's'}`;
}

async function writeFieldValue(
  ctx: ExecuteFieldDropdownActionCtx,
  value: FileFieldValue | FileFieldValue[],
): Promise<void> {
  await ctx.setFieldValue(ctx.fieldPath, value);
  recordFieldValueWrite(ctx, value);
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
    const latestCtx = getLatestFieldContext(ctx);
    const current = latestCtx && getFieldValue(latestCtx);
    if (
      !isFileFieldValue(current) ||
      current.upload_id !== asset.upload_id ||
      current.alt !== asset.alt
    ) {
      await ctx.notice(
        'Newer field changes were preserved; no alt text was changed.',
      );
      return;
    }
    await writeFieldValue(latestCtx ?? ctx, { ...current, alt });
    await ctx.notice(
      `Alt text generated with ${PROVIDER_LABELS[configuration.provider]}.`,
    );
  } catch (error) {
    await ctx.alert(`Could not generate alt text: ${getErrorMessage(error)}`);
  }
}

type GalleryState = {
  cache: Map<string, Promise<SettledResult<string>>>;
  errors: GenerationErrors;
  updated: number;
  processed: number;
  stopped: boolean;
};

async function generateGalleryTarget(
  asset: FileFieldValue,
  state: GalleryState,
  provider: AltTextProvider,
  client: Client,
  configuration: PluginConfiguration,
  locale: string,
): Promise<string | undefined> {
  if (state.stopped) return undefined;
  let pending = state.cache.get(asset.upload_id);
  if (!pending) {
    pending = generateAltForAsset(
      asset,
      provider,
      client,
      configuration,
      locale,
    )
      .then((value): SettledResult<string> => ({ status: 'fulfilled', value }))
      .catch((error): SettledResult<string> => {
        if (fatalGenerationFailure(error)) state.stopped = true;
        return { status: 'rejected', reason: getErrorMessage(error) };
      });
    state.cache.set(asset.upload_id, pending);
  }
  const result = await pending;
  state.processed += 1;
  if (result.status === 'rejected')
    throw new Error(getErrorMessage(result.reason));
  return result.value;
}

async function applyGalleryBatch(
  ctx: ExecuteFieldDropdownActionCtx,
  assets: FileFieldValue[],
  batch: GenerationTarget[],
  results: SettledResult<string | undefined>[],
  state: GalleryState,
): Promise<boolean> {
  const latestCtx = getLatestFieldContext(ctx);
  const current = latestCtx && getFieldValue(latestCtx);
  if (
    !isFileFieldValueArray(current) ||
    current.length !== assets.length ||
    current.some((entry, index) => entry.upload_id !== assets[index].upload_id)
  ) {
    state.errors.add(
      'The gallery changed while generating alt text; newer field changes were preserved.',
    );
    return false;
  }
  const updated = [...current];
  let applied = 0;
  for (const [index, result] of results.entries()) {
    const target = batch[index];
    if (result.status === 'rejected') {
      state.errors.add(
        `${target.asset.upload_id}: ${getErrorMessage(result.reason)}`,
      );
    } else if (
      result.value !== undefined &&
      current[target.index].alt === target.asset.alt
    ) {
      updated[target.index] = { ...current[target.index], alt: result.value };
      applied += 1;
    }
  }
  if (applied > 0) {
    await writeFieldValue(latestCtx ?? ctx, updated);
    state.updated += applied;
  }
  return true;
}

async function generateGalleryAlts(
  assets: FileFieldValue[],
  provider: AltTextProvider,
  client: Client,
  configuration: PluginConfiguration,
  ctx: ExecuteFieldDropdownActionCtx,
  mode: AltGenerationMode,
) {
  const targets = assets.flatMap((asset, index) =>
    shouldProcessAsset(asset, mode) ? [{ asset, index }] : [],
  );
  if (targets.length === 0) {
    await ctx.notice('No assets need alt text generation.');
    return;
  }
  showGenerationStarted(ctx);
  const state: GalleryState = {
    cache: new Map(),
    errors: new GenerationErrors(),
    updated: 0,
    processed: 0,
    stopped: false,
  };
  let lastProgress = Date.now();
  const report = () => {
    const now = Date.now();
    if (
      targets.length <= UPLOAD_BATCH_SIZE ||
      now - lastProgress < GENERATION_PROGRESS_INTERVAL_MS
    )
      return;
    lastProgress = now;
    showGenerationToast(
      ctx,
      `Generating gallery alt texts… ${state.processed} of ${targets.length} entries processed; ${state.updated} alt texts applied.`,
    );
  };
  const timer =
    targets.length > UPLOAD_BATCH_SIZE
      ? setInterval(report, GENERATION_PROGRESS_INTERVAL_MS)
      : undefined;
  try {
    for (
      let offset = 0;
      offset < targets.length && !state.stopped;
      offset += UPLOAD_BATCH_SIZE
    ) {
      const batch = targets.slice(offset, offset + UPLOAD_BATCH_SIZE);
      // biome-ignore lint/performance/noAwaitInLoops: Apply each bounded gallery batch before generating another.
      const results = await mapSettledWithConcurrency(
        batch,
        GENERATION_CONCURRENCY,
        async ({ asset }) => {
          const result = await generateGalleryTarget(
            asset,
            state,
            provider,
            client,
            configuration,
            ctx.locale,
          );
          report();
          return result;
        },
      );
      if (!(await applyGalleryBatch(ctx, assets, batch, results, state))) break;
    }
  } finally {
    if (timer !== undefined) clearInterval(timer);
  }
  if (state.updated > 0) {
    await ctx.notice(
      `${countLabel(state.updated, 'alt text')} generated with ${PROVIDER_LABELS[configuration.provider]}.`,
    );
  }
  if (state.stopped) {
    await ctx.notice(
      `Generation stopped after a service error; ${state.processed} of ${targets.length} gallery entries processed. Applied alt texts were kept.`,
    );
  }
  if (state.errors.count > 0) await ctx.alert(state.errors.format());
}

function nonImageSkipMessage(count: number): string {
  return `${count} non-image asset${count === 1 ? '' : 's'} skipped.`;
}

function uploadLabel(upload: CmaUpload): string {
  return upload.filename.trim() || upload.id;
}

function uploadAltForLocale(upload: CmaUpload, locale: string): unknown {
  return upload.default_field_metadata.alt[locale];
}

function selectedUploadLabel(upload: Upload): string {
  return upload.attributes.filename.trim() || upload.id;
}

function buildUploadMetadataUpdate(
  upload: CmaUpload,
  original: CmaUpload,
  alts: Map<string, string>,
  mode: AltGenerationMode,
): { metadata: UploadMetadataUpdate; updatedAltCount: number } {
  // The server merges inner locale maps; send only generated locales.
  const fieldKeyedAlts: LocalizedAltUpdate = {};
  let updatedAltCount = 0;

  for (const [locale, alt] of alts) {
    const currentAlt = uploadAltForLocale(upload, locale);
    // Even overwrite mode must not overwrite an edit made after generation began.
    if (
      currentAlt !== uploadAltForLocale(original, locale) ||
      (mode === 'missing-only' && hasAltText(currentAlt)) ||
      currentAlt === alt
    ) {
      continue;
    }
    fieldKeyedAlts[locale] = alt;
    updatedAltCount += 1;
  }

  return {
    metadata: { alt: fieldKeyedAlts },
    updatedAltCount,
  };
}

async function confirmUploadOverwrite(
  ctx: ExecuteUploadsDropdownActionCtx,
  selectedCount: number,
): Promise<boolean> {
  const result = await ctx.openConfirm({
    title: 'Regenerate asset alt texts?',
    content: `This will immediately replace existing default alt text for the selected image assets in every locale (${countLabel(selectedCount, 'asset')} selected). This action cannot be undone.`,
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

function fatalCmaFailure(error: unknown): boolean {
  if (typeof error !== 'object' || error === null || !('response' in error)) {
    return false;
  }
  const response = error.response;
  return (
    typeof response === 'object' &&
    response !== null &&
    'status' in response &&
    [401, 402, 403, 429].includes(Number(response.status))
  );
}

function fatalGenerationFailure(error: unknown): boolean {
  return isFatalProviderFailure(error) || fatalCmaFailure(error);
}

async function saveUploadAlts(
  client: Client,
  original: CmaUpload,
  alts: Map<string, string>,
  mode: AltGenerationMode,
): Promise<number> {
  const latest = await client.uploads.find(original.id);
  if (!latest.is_image || latest.url !== original.url) {
    throw new Error(
      'The asset image changed while alt text was being generated.',
    );
  }
  const { metadata, updatedAltCount } = buildUploadMetadataUpdate(
    latest,
    original,
    alts,
    mode,
  );
  if (updatedAltCount === 0) {
    return 0;
  }
  await client.uploads.update(latest.id, {
    default_field_metadata: metadata as UploadMetadataUpdate,
  });
  return updatedAltCount;
}

type UploadRunState = {
  errors: GenerationErrors;
  summary: UploadUpdateSummary;
  stopped: boolean;
  loaded: number;
  completed: number;
  images: number;
  nonImages: number;
  processedLocales: number;
  targetCount: number;
  targetAssets: number;
  generatedCount: number;
};

async function processUpload(
  upload: CmaUpload,
  locales: string[],
  mode: AltGenerationMode,
  client: Client,
  provider: AltTextProvider,
  configuration: PluginConfiguration,
  state: UploadRunState,
): Promise<void> {
  const alts = new Map<string, string>();
  let savedForUpload = 0;
  const save = async () => {
    if (alts.size === 0) return;
    try {
      const count = await saveUploadAlts(client, upload, alts, mode);
      savedForUpload += count;
      state.summary.updatedAltCount += count;
    } catch (error) {
      state.errors.add(
        `${uploadLabel(upload)}: Could not save generated alt text: ${getErrorMessage(error)}`,
      );
      if (fatalCmaFailure(error)) state.stopped = true;
    } finally {
      alts.clear();
    }
  };

  for (const locale of locales) {
    if (state.stopped) break;
    if (
      mode === 'missing-only' &&
      hasAltText(uploadAltForLocale(upload, locale))
    )
      continue;
    try {
      alts.set(
        locale,
        // biome-ignore lint/performance/noAwaitInLoops: Assets already have three workers; locales stay sequential and flush after ten successes.
        await generateAltForUpload(upload, provider, configuration, locale),
      );
      state.generatedCount += 1;
    } catch (error) {
      state.errors.add(
        `${uploadLabel(upload)} (${locale}): ${getErrorMessage(error)}`,
      );
      if (fatalGenerationFailure(error)) state.stopped = true;
    } finally {
      state.processedLocales += 1;
    }
    if (alts.size >= LOCALE_SAVE_BATCH_SIZE) await save();
  }
  await save();
  if (savedForUpload > 0) state.summary.updatedUploadCount += 1;
  state.completed += 1;
}

function createUploadProgress(
  ctx: ExecuteUploadsDropdownActionCtx,
  state: UploadRunState,
  selectedCount: number,
  localeCount: number,
): { start: () => void; report: () => void; dispose: () => void } {
  const large = selectedCount > UPLOAD_BATCH_SIZE;
  let started = false;
  let lastUpdate = Date.now();
  let timer: ReturnType<typeof setInterval> | undefined;
  const report = () => {
    const now = Date.now();
    if (!started || now - lastUpdate < GENERATION_PROGRESS_INTERVAL_MS) return;
    lastUpdate = now;
    showGenerationToast(
      ctx,
      `Generating alt texts… ${state.loaded} of ${selectedCount} assets checked; ${state.processedLocales} locale versions processed; ${state.completed} assets finished; ${state.summary.updatedAltCount} alt texts saved.`,
    );
  };
  return {
    start: () => {
      if (started) return;
      started = true;
      showGenerationToast(
        ctx,
        large
          ? `Generating alt texts for ${countLabel(selectedCount, 'selected asset')} across ${countLabel(localeCount, 'locale')}…`
          : `Generating ${countLabel(state.targetCount, 'alt text')} for ${countLabel(state.targetAssets, 'asset')} across ${countLabel(localeCount, 'locale')}…`,
      );
      timer = setInterval(report, GENERATION_PROGRESS_INTERVAL_MS);
    },
    report,
    dispose: () => {
      if (timer !== undefined) clearInterval(timer);
    },
  };
}

async function loadUploadBatch(
  batch: Upload[],
  locales: string[],
  mode: AltGenerationMode,
  client: Client,
  state: UploadRunState,
  report: () => void,
): Promise<CmaUpload[]> {
  const loaded = await mapSettledWithConcurrency(
    batch,
    GENERATION_CONCURRENCY,
    async (entry) => {
      if (state.stopped) return undefined;
      try {
        return await client.uploads.find(entry.id);
      } catch (error) {
        if (fatalCmaFailure(error)) state.stopped = true;
        throw error;
      } finally {
        state.loaded += 1;
        report();
      }
    },
  );
  const targets: CmaUpload[] = [];
  for (const [index, result] of loaded.entries()) {
    if (result.status === 'rejected') {
      state.errors.add(
        `${selectedUploadLabel(batch[index])}: Could not load asset: ${getErrorMessage(result.reason)}`,
      );
      continue;
    }
    const upload = result.value;
    if (!upload) continue;
    if (!upload.is_image) {
      state.nonImages += 1;
      continue;
    }
    state.images += 1;
    const missing = locales.reduce(
      (count, locale) =>
        count +
        (mode === 'overwrite-all' ||
        !hasAltText(uploadAltForLocale(upload, locale))
          ? 1
          : 0),
      0,
    );
    state.targetCount += missing;
    if (missing > 0) {
      targets.push(upload);
      state.targetAssets += 1;
    }
  }
  return targets;
}

async function reportUploadRun(
  ctx: ExecuteUploadsDropdownActionCtx,
  configuration: PluginConfiguration,
  state: UploadRunState,
  selectedCount: number,
): Promise<void> {
  const messages: string[] = [];
  if (state.summary.updatedAltCount > 0) {
    messages.push(
      `${countLabel(state.summary.updatedAltCount, 'alt text')} generated for ${countLabel(state.summary.updatedUploadCount, 'asset')} with ${PROVIDER_LABELS[configuration.provider]}.`,
    );
  } else if (state.generatedCount > 0 && state.errors.count === 0) {
    messages.push(
      'No alt texts were changed because newer asset metadata was preserved.',
    );
  } else if (state.targetCount === 0 && state.errors.count === 0) {
    messages.push(
      state.images === 0
        ? 'No image assets selected.'
        : 'All selected image assets already have alt text for every locale.',
    );
  }
  if (state.nonImages > 0) messages.push(nonImageSkipMessage(state.nonImages));
  if (state.stopped)
    messages.push(
      `Generation stopped after a service error; ${state.loaded} of ${selectedCount} assets checked, ${state.processedLocales} locale versions processed. Saved metadata was kept.`,
    );
  if (messages.length > 0) await ctx.notice(messages.join(' '));
  if (state.errors.count > 0) await ctx.alert(state.errors.format());
}

async function executeUploadRun(
  ctx: ExecuteUploadsDropdownActionCtx,
  selected: Upload[],
  locales: string[],
  mode: AltGenerationMode,
  client: Client,
  configuration: PluginConfiguration,
  state: UploadRunState,
  progress: ReturnType<typeof createUploadProgress>,
): Promise<void> {
  let provider: AltTextProvider | undefined;
  if (selected.length > UPLOAD_BATCH_SIZE) progress.start();
  // No project-wide record/model/reference scan. The SDK provides the complete selection.
  for (
    let offset = 0;
    offset < selected.length && !state.stopped;
    offset += UPLOAD_BATCH_SIZE
  ) {
    // biome-ignore lint/performance/noAwaitInLoops: Finish and release each upload batch before loading the next fifty.
    const targets = await loadUploadBatch(
      selected.slice(offset, offset + UPLOAD_BATCH_SIZE),
      locales,
      mode,
      client,
      state,
      progress.report,
    );
    if (targets.length === 0 || state.stopped) continue;
    provider ??= createAltTextProvider(providerConfig(configuration));
    progress.start();
    const activeProvider = provider;
    await mapSettledWithConcurrency(
      targets,
      GENERATION_CONCURRENCY,
      async (upload) => {
        if (state.stopped) return;
        try {
          await processUpload(
            upload,
            locales,
            mode,
            client,
            activeProvider,
            configuration,
            state,
          );
        } catch (error) {
          state.errors.add(`${uploadLabel(upload)}: ${getErrorMessage(error)}`);
        }
        progress.report();
      },
    );
  }
  await reportUploadRun(ctx, configuration, state, selected.length);
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
  const scope = JSON.stringify([ctx.cmaBaseUrl, ctx.environment, ctx.site.id]);
  if (activeUploadRuns.has(scope)) {
    await ctx.notice(
      'Alt text generation is already running for selected assets.',
    );
    return;
  }
  activeUploadRuns.add(scope);
  const selected = Array.from(
    new Map(uploads.map((upload) => [upload.id, upload])).values(),
  );
  const locales = Array.from(new Set(ctx.site.attributes.locales));
  const state: UploadRunState = {
    errors: new GenerationErrors(),
    summary: { updatedAltCount: 0, updatedUploadCount: 0 },
    stopped: false,
    loaded: 0,
    completed: 0,
    images: 0,
    nonImages: 0,
    processedLocales: 0,
    targetCount: 0,
    targetAssets: 0,
    generatedCount: 0,
  };
  const progress = createUploadProgress(
    ctx,
    state,
    selected.length,
    locales.length,
  );
  try {
    const client = buildClient({
      apiToken: ctx.currentUserAccessToken,
      environment: ctx.environment,
      baseUrl: ctx.cmaBaseUrl,
    });
    if (
      mode === 'overwrite-all' &&
      selected.length > 0 &&
      !(await confirmUploadOverwrite(ctx, selected.length))
    )
      return;
    await executeUploadRun(
      ctx,
      selected,
      locales,
      mode,
      client,
      configuration,
      state,
      progress,
    );
  } catch (error) {
    await ctx.alert(
      `Unexpected error while generating asset alt text: ${getErrorMessage(error)}`,
    );
  } finally {
    progress.dispose();
    activeUploadRuns.delete(scope);
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

  const release = acquireFieldGenerationLock(ctx);
  if (!release) {
    await ctx.notice('Alt text generation is already running for this field.');
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
    console.error(
      'Unexpected alt text generation error:',
      getErrorMessage(error),
    );
    await ctx.alert(
      `Unexpected error while generating alt text: ${getErrorMessage(error)}`,
    );
  } finally {
    if (didDisableField) {
      try {
        await ctx.disableField(ctx.fieldPath, false);
      } catch (error) {
        console.error(
          'Could not re-enable the asset field:',
          getErrorMessage(error),
        );
      }
    }
    release();
  }
}
