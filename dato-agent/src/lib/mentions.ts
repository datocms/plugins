import type {
  AssetMention,
  CommentSegment,
  LocalFileMention,
  Mention,
  ModelMention,
  RecordMention,
  UserMention,
} from '../recordComments/entrypoints/types/mentions';

export type {
  AssetMention,
  CommentSegment,
  FieldMention,
  LocalFileMention,
  Mention,
  ModelMention,
  RecordMention,
  UserMention,
} from '../recordComments/entrypoints/types/mentions';

export const MAX_MENTIONS_PER_MESSAGE = 20;
export const MAX_MENTION_LABEL_CHARACTERS = 240;
export const DEFAULT_MAX_COMMENT_SEGMENT_CHARACTERS = 20_000;

export type AgentComposerSubmission = {
  displayText: string;
  providerText: string;
  segments: CommentSegment[];
  attachments?: LocalFileAttachmentDescriptor[];
};

export type LocalFileAttachmentDescriptor = Pick<
  LocalFileMention,
  'id' | 'filename' | 'mimeType' | 'size' | 'lastModified'
>;

function boundedText(value: unknown, max = MAX_MENTION_LABEL_CHARACTERS) {
  return typeof value === 'string' ? value.trim().slice(0, max) : '';
}

function boundedId(value: unknown): string {
  const id = boundedText(value, 512);
  return [...id].some((character) => {
    const point = character.codePointAt(0) ?? 0;
    return point <= 31 || point === 127;
  })
    ? ''
    : id;
}

function normalizeUserMention(candidate: Record<string, unknown>) {
  const id = boundedId(candidate.id);
  const name = boundedText(candidate.name);
  if (!id || !name) return undefined;
  return {
    type: 'user',
    id,
    name,
    email: boundedText(candidate.email, 320),
    avatarUrl: boundedText(candidate.avatarUrl, 2_000) || null,
  } satisfies UserMention;
}

function normalizeFieldMention(candidate: Record<string, unknown>) {
  const apiKey = boundedText(candidate.apiKey, 128);
  const label = boundedText(candidate.label);
  const fieldPath = boundedId(candidate.fieldPath);
  if (!apiKey || !label || !fieldPath) return undefined;
  const locale = boundedText(candidate.locale, 64);
  const fieldType = boundedText(candidate.fieldType, 128);
  return {
    type: 'field',
    apiKey,
    label,
    localized: candidate.localized === true,
    fieldPath,
    ...(locale ? { locale } : {}),
    ...(fieldType ? { fieldType } : {}),
  } satisfies Extract<Mention, { type: 'field' }>;
}

function normalizeAssetMention(candidate: Record<string, unknown>) {
  const id = boundedId(candidate.id);
  const filename = boundedText(candidate.filename);
  if (!id || !filename) return undefined;
  return {
    type: 'asset',
    id,
    filename,
    url: boundedText(candidate.url, 2_000),
    thumbnailUrl: boundedText(candidate.thumbnailUrl, 2_000) || null,
    mimeType:
      boundedText(candidate.mimeType, 160) || 'application/octet-stream',
  } satisfies AssetMention;
}

function normalizeNonNegativeNumber(value: unknown): number | undefined {
  return typeof value === 'number' && Number.isFinite(value) && value >= 0
    ? value
    : undefined;
}

function normalizeLocalFileMention(candidate: Record<string, unknown>) {
  const id = boundedId(candidate.id);
  const filename = boundedText(candidate.filename);
  const size = normalizeNonNegativeNumber(candidate.size);
  const lastModified = normalizeNonNegativeNumber(candidate.lastModified);
  if (!id || !filename || size === undefined || lastModified === undefined) {
    return undefined;
  }
  return {
    type: 'file',
    id,
    filename,
    mimeType:
      boundedText(candidate.mimeType, 160) || 'application/octet-stream',
    size,
    lastModified,
  } satisfies LocalFileMention;
}

function normalizeRecordMention(candidate: Record<string, unknown>) {
  const id = boundedId(candidate.id);
  const title = boundedText(candidate.title);
  const modelId = boundedId(candidate.modelId);
  if (!id || !title || !modelId) return undefined;
  return {
    type: 'record',
    id,
    title,
    modelId,
    modelApiKey: boundedText(candidate.modelApiKey, 128),
    modelName: boundedText(candidate.modelName) || 'Record',
    modelEmoji: boundedText(candidate.modelEmoji, 16) || null,
    thumbnailUrl: boundedText(candidate.thumbnailUrl, 2_000) || null,
    ...(candidate.isSingleton === true ? { isSingleton: true } : {}),
  } satisfies RecordMention;
}

function normalizeModelMention(candidate: Record<string, unknown>) {
  const id = boundedId(candidate.id);
  const apiKey = boundedText(candidate.apiKey, 128);
  const name = boundedText(candidate.name);
  if (!id || !apiKey || !name) return undefined;
  return {
    type: 'model',
    id,
    apiKey,
    name,
    isBlockModel: candidate.isBlockModel === true,
  } satisfies ModelMention;
}

export function normalizeMention(value: unknown): Mention | undefined {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    return undefined;
  }

  const candidate = value as Record<string, unknown>;
  switch (candidate.type) {
    case 'user':
      return normalizeUserMention(candidate);
    case 'field':
      return normalizeFieldMention(candidate);
    case 'asset':
      return normalizeAssetMention(candidate);
    case 'file':
      return normalizeLocalFileMention(candidate);
    case 'record':
      return normalizeRecordMention(candidate);
    case 'model':
      return normalizeModelMention(candidate);
    default:
      return undefined;
  }
}

function normalizeCommentSegment(
  rawSegment: unknown,
  allowMention: boolean,
): CommentSegment | undefined {
  if (
    !rawSegment ||
    typeof rawSegment !== 'object' ||
    Array.isArray(rawSegment)
  ) {
    return undefined;
  }

  const candidate = rawSegment as Record<string, unknown>;
  if (candidate.type === 'text') {
    return typeof candidate.content === 'string' && candidate.content
      ? { type: 'text', content: candidate.content }
      : undefined;
  }
  if (candidate.type !== 'mention' || !allowMention) return undefined;
  const mention = normalizeMention(candidate.mention);
  return mention ? { type: 'mention', mention } : undefined;
}

function commentSegmentText(segment: CommentSegment): string {
  return segment.type === 'text'
    ? segment.content
    : mentionDisplayText(segment.mention);
}

function fitCommentSegment(
  segment: CommentSegment,
  remainingCharacters: number,
): { segment?: CommentSegment; complete: boolean } {
  const content = commentSegmentText(segment);
  if (content.length <= remainingCharacters) {
    return { segment, complete: content.length < remainingCharacters };
  }
  if (segment.type === 'mention' || remainingCharacters === 0) {
    return { complete: false };
  }
  return {
    segment: {
      type: 'text',
      content: segment.content.slice(0, remainingCharacters),
    },
    complete: false,
  };
}

export function normalizeCommentSegments(
  value: unknown,
  maxCharacters = DEFAULT_MAX_COMMENT_SEGMENT_CHARACTERS,
): CommentSegment[] | undefined {
  if (!Array.isArray(value) || !Number.isFinite(maxCharacters)) {
    return undefined;
  }

  const characterLimit = Math.max(0, Math.floor(maxCharacters));
  if (characterLimit === 0) return undefined;

  const segments: CommentSegment[] = [];
  let mentionCount = 0;
  let characterCount = 0;
  for (const rawSegment of value) {
    const segment = normalizeCommentSegment(
      rawSegment,
      mentionCount < MAX_MENTIONS_PER_MESSAGE,
    );
    if (!segment) continue;

    const fitted = fitCommentSegment(segment, characterLimit - characterCount);
    if (fitted.segment) {
      segments.push(fitted.segment);
      characterCount += commentSegmentText(fitted.segment).length;
      if (fitted.segment.type === 'mention') mentionCount += 1;
    }
    if (!fitted.complete) break;
  }

  return segments.length > 0 ? segments : undefined;
}

export function mentionDisplayText(mention: Mention): string {
  switch (mention.type) {
    case 'user':
      return `@${mention.name}`;
    case 'field':
      return `#${mention.apiKey}${mention.locale ? ` (${mention.locale})` : ''}`;
    case 'asset':
      return mention.filename;
    case 'file':
      return mention.filename;
    case 'record':
      return mention.title;
    case 'model':
      return mention.name;
  }
}

export function segmentsDisplayText(segments: readonly CommentSegment[]) {
  return segments
    .map((segment) =>
      segment.type === 'text'
        ? segment.content
        : mentionDisplayText(segment.mention),
    )
    .join('')
    .trim();
}

type ProviderReference =
  | { ref: number; type: 'user'; id: string; label: string }
  | {
      ref: number;
      type: 'field';
      fieldPath: string;
      apiKey: string;
      label: string;
      locale?: string;
    }
  | { ref: number; type: 'asset'; id: string; label: string }
  | {
      ref: number;
      type: 'file';
      id: string;
      label: string;
      mimeType: string;
      size: number;
      lastModified: number;
      bytesAvailable?: boolean;
    }
  | {
      ref: number;
      type: 'record';
      id: string;
      modelId: string;
      modelApiKey: string;
      label: string;
    }
  | {
      ref: number;
      type: 'model';
      id: string;
      apiKey: string;
      label: string;
      isBlockModel: boolean;
    };

function providerReference(mention: Mention, ref: number): ProviderReference {
  switch (mention.type) {
    case 'user':
      return { ref, type: 'user', id: mention.id, label: mention.name };
    case 'field':
      return {
        ref,
        type: 'field',
        fieldPath: mention.fieldPath,
        apiKey: mention.apiKey,
        label: mention.label,
        ...(mention.locale ? { locale: mention.locale } : {}),
      };
    case 'asset':
      return { ref, type: 'asset', id: mention.id, label: mention.filename };
    case 'file':
      return {
        ref,
        type: 'file',
        id: mention.id,
        label: mention.filename,
        mimeType: mention.mimeType,
        size: mention.size,
        lastModified: mention.lastModified,
      };
    case 'record':
      return {
        ref,
        type: 'record',
        id: mention.id,
        modelId: mention.modelId,
        modelApiKey: mention.modelApiKey,
        label: mention.title,
      };
    case 'model':
      return {
        ref,
        type: 'model',
        id: mention.id,
        apiKey: mention.apiKey,
        label: mention.name,
        isBlockModel: mention.isBlockModel,
      };
  }
}

/**
 * Produces provider-facing text while keeping exact identities host-authored.
 * Display labels remain untrusted content and are never interpreted as commands.
 */
export function segmentsProviderText(
  segments: readonly CommentSegment[],
  options: {
    localFileBytesAvailable?: (attachmentId: string) => boolean;
  } = {},
) {
  const references: ProviderReference[] = [];
  let nextRef = 1;
  const text = segments
    .map((segment) => {
      if (segment.type === 'text') return segment.content;
      const baseReference = providerReference(segment.mention, nextRef);
      const reference =
        baseReference.type === 'file' && options.localFileBytesAvailable
          ? {
              ...baseReference,
              bytesAvailable: options.localFileBytesAvailable(baseReference.id),
            }
          : baseReference;
      references.push(reference);
      nextRef += 1;
      return `${mentionDisplayText(segment.mention)} [ref:${reference.ref}]`;
    })
    .join('')
    .trim();

  if (references.length === 0) return text;

  const datocmsReferences = references.filter(
    (reference) => reference.type !== 'file',
  );
  const localFileReferences = references.filter(
    (reference) => reference.type === 'file',
  );
  const metadata = [
    ...(datocmsReferences.length > 0
      ? [
          `HOST-SELECTED DATOCMS REFERENCES\n${JSON.stringify(datocmsReferences)}`,
        ]
      : []),
    ...(localFileReferences.length > 0
      ? [
          `HOST-ATTACHED LOCAL FILES (NOT DATOCMS ASSETS)\n${JSON.stringify(localFileReferences)}`,
        ]
      : []),
  ];

  return `${text}\n\n${metadata.join('\n\n')}`;
}

export function mentionFromModel(
  model: Pick<ModelMention, 'id' | 'apiKey' | 'name' | 'isBlockModel'>,
): ModelMention {
  return { type: 'model', ...model };
}

export function mentionFromUser(
  user: Pick<UserMention, 'id' | 'name' | 'email' | 'avatarUrl'>,
): UserMention {
  return { type: 'user', ...user };
}

export function fallbackAssetMention(id: string, title: string): AssetMention {
  return {
    type: 'asset',
    id,
    filename: title,
    url: '',
    thumbnailUrl: null,
    mimeType: 'application/octet-stream',
  };
}

export function fallbackRecordMention({
  id,
  title,
  model,
}: {
  id: string;
  title: string;
  model?: Pick<
    RecordMention,
    'modelId' | 'modelApiKey' | 'modelName' | 'modelEmoji' | 'isSingleton'
  >;
}): RecordMention {
  return {
    type: 'record',
    id,
    title,
    modelId: model?.modelId ?? 'unknown',
    modelApiKey: model?.modelApiKey ?? '',
    modelName: model?.modelName ?? 'Record',
    modelEmoji: model?.modelEmoji ?? null,
    thumbnailUrl: null,
    ...(model?.isSingleton ? { isSingleton: true } : {}),
  };
}
