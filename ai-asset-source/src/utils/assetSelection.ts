import type { NewUpload, NewUploadDefaultFieldMetadata, RenderAssetSourceCtx } from 'datocms-plugin-sdk';
import {
  buildGenerationNotes,
  buildImportFilename,
  getImageOutputFormat,
} from './imageService';
import {
  MAX_HISTORY_BYTES,
  MAX_REQUESTS,
  type SelectedImage,
} from './imageBrowserState';
import { MAX_GENERATED_IMAGES } from './imageService/generationValidation';

export function buildUpload(
  locales: string[],
  { request, image }: SelectedImage,
): Omit<NewUpload, 'default_field_metadata'> & { default_field_metadata: NewUploadDefaultFieldMetadata } {
  const metadata: NewUploadDefaultFieldMetadata = {
    alt: Object.fromEntries(
      locales.map((locale) => [locale, request.request.prompt]),
    ),
  };
  return {
    resource: {
      base64: image.previewSrc,
      filename: buildImportFilename(
        request.request.prompt,
        request.createdAt,
        request.images.length > 1 ? image.position : undefined,
        getImageOutputFormat(image, request.request.outputFormat),
      ),
    },
    notes: buildGenerationNotes(request, image),
    tags: ['generated-image'],
    default_field_metadata: metadata,
  };
}

/**
 * The documented SDK handoff is void and closes the source. Dispatch this small,
 * bounded selection synchronously; an awaited queue would lose its iframe after
 * the first resource. This does not acknowledge final DatoCMS asset creation.
 */
export function selectImages(
  ctx: Pick<RenderAssetSourceCtx, 'select'>,
  locales: string[],
  selected: SelectedImage[],
  sentIds: Set<string>,
  onRejected: (id: string) => void,
): { sent: string[]; failed: string[] } {
  if (selected.length > MAX_REQUESTS * MAX_GENERATED_IMAGES) {
    throw new Error('This selection exceeds the asset source memory limit.');
  }
  // Structured-clone/JSON handoff also repeats the prompt for each locale.
  // Include metadata instead of treating small images as an unlimited payload.
  const localeOverhead = locales.reduce(
    (total, locale) => total + locale.length + 64,
    0,
  );
  const bytes = selected.reduce(
    (total, entry) =>
      total +
      2 *
        (entry.image.previewSrc.length +
          buildGenerationNotes(entry.request, entry.image).length +
          locales.length * entry.request.request.prompt.length +
          localeOverhead),
    0,
  );
  if (bytes > MAX_HISTORY_BYTES) {
    throw new Error('This selection exceeds the asset source memory limit.');
  }
  const sent: string[] = [];
  const failed: string[] = [];
  for (const entry of selected) {
    const id = entry.image.id;
    if (sentIds.has(id)) continue;
    sentIds.add(id);
    try {
      const result: unknown = ctx.select(buildUpload(locales, entry));
      // Penpal can return a Promise at runtime, despite the public void type.
      // Observe rejection without replaying an uncertain upload.
      if (result instanceof Promise) {
        void result.catch(() => {
          sentIds.delete(id);
          onRejected(id);
        });
      }
      sent.push(id);
    } catch {
      sentIds.delete(id);
      failed.push(id);
    }
  }
  return { sent, failed };
}
