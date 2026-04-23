import type {
  CommentType,
  ResolvedAuthor,
  ResolvedCommentType,
} from '@ctypes/comments';
import type {
  AssetMention,
  CommentSegment,
  FieldMention,
  Mention,
  ModelMention,
  RecordMention,
  StoredCommentSegment,
  StoredMention,
  UserMention,
} from '@ctypes/mentions';
import type { Client } from '@datocms/cma-client-browser';
import { extractLeadingEmoji } from '@utils/emojiUtils';
import { getRecordTitles } from '@utils/recordTitleUtils';
import type { UserInfo } from '@utils/userTransformers';
import type { ItemType } from 'datocms-plugin-sdk';
import { useCallback, useRef, useState } from 'react';
import { logError } from '@/utils/errorLogger';
import { getGravatarUrl } from '@/utils/helpers';
import type { FieldInfo, ModelInfo } from './useMentions';

// ============================================================================
// Types
// ============================================================================

type ResolvedRecord = {
  id: string;
  title: string;
  modelId: string;
  modelApiKey: string;
  modelName: string;
  modelEmoji: string | null;
  thumbnailUrl: string | null;
  isSingleton: boolean;
};

type ResolvedAsset = {
  id: string;
  filename: string;
  url: string;
  thumbnailUrl: string | null;
  mimeType: string;
};

type ResolutionCache = {
  records: Map<string, ResolvedRecord | 'loading' | 'error'>;
  assets: Map<string, ResolvedAsset | 'loading' | 'error'>;
};

type UseEntityResolverParams = {
  client: Client | null;
  projectUsers: UserInfo[];
  projectModels: ModelInfo[];
  modelFields: FieldInfo[];
  itemTypes: Record<string, ItemType | undefined>;
  mainLocale: string;
};

type UseEntityResolverReturn = {
  /** Starts async resolution for record/asset mentions found in comments. */
  prefetchEntities: (comments: CommentType[]) => void;
  seedResolvedMentionsFromSegments: (segments: CommentSegment[]) => void;
  resolveComments: (comments: CommentType[]) => ResolvedCommentType[];
  isResolving: boolean;
  /** Increments when async entities (records/assets) are resolved. Use as useMemo dependency. */
  cacheVersion: number;
};

// ============================================================================
// Helper Functions
// ============================================================================

function resolveAuthorById(
  userId: string,
  projectUsers: UserInfo[],
): ResolvedAuthor {
  const user = projectUsers.find((u) => u.id === userId || u.email === userId);

  if (user) {
    return {
      id: user.id,
      email: user.email,
      name: user.name,
      avatarUrl:
        user.avatarUrl ?? (user.email ? getGravatarUrl(user.email, 48) : null),
    };
  }

  // Fallback for unresolvable user ID
  return {
    id: userId,
    email: '',
    name: 'Unknown User',
    avatarUrl: null,
  };
}

function resolveUserMention(
  stored: { id: string },
  projectUsers: UserInfo[],
): UserMention | null {
  const user = projectUsers.find((u) => u.id === stored.id);
  if (!user) return null;

  return {
    type: 'user',
    id: user.id,
    name: user.name,
    email: user.email,
    avatarUrl: user.avatarUrl,
  };
}

function resolveModelMention(
  stored: { id: string },
  projectModels: ModelInfo[],
): ModelMention | null {
  const model = projectModels.find((m) => m.id === stored.id);
  if (!model) return null;

  return {
    type: 'model',
    id: model.id,
    apiKey: model.apiKey,
    name: model.name,
    isBlockModel: model.isBlockModel,
  };
}

function resolveFieldMention(
  stored: { fieldPath: string; locale?: string; modelId: string },
  modelFields: FieldInfo[],
): FieldMention | null {
  // Find field by fieldPath
  const field = modelFields.find((f) => f.fieldPath === stored.fieldPath);

  if (field) {
    return {
      type: 'field',
      apiKey: field.apiKey,
      label: field.label,
      localized: field.localized,
      fieldPath: field.fieldPath,
      locale: stored.locale,
      fieldType: field.fieldType,
    };
  }

  // Fallback: extract apiKey from fieldPath
  const pathParts = stored.fieldPath.split('.');
  const apiKey = pathParts[pathParts.length - 1] || stored.fieldPath;

  return {
    type: 'field',
    apiKey,
    label: apiKey,
    localized: !!stored.locale,
    fieldPath: stored.fieldPath,
    locale: stored.locale,
    fieldType: undefined,
  };
}

function createRecordMentionFromResolved(
  recordId: string,
  _modelId: string,
  resolved: ResolvedRecord,
): RecordMention {
  return {
    type: 'record',
    id: recordId,
    title: resolved.title,
    modelId: resolved.modelId,
    modelApiKey: resolved.modelApiKey,
    modelName: resolved.modelName,
    modelEmoji: resolved.modelEmoji,
    thumbnailUrl: resolved.thumbnailUrl,
    isSingleton: resolved.isSingleton,
  };
}

function createFallbackRecordMention(
  recordId: string,
  modelId: string,
): RecordMention {
  return {
    type: 'record',
    id: recordId,
    title: `Record #${recordId}`,
    modelId,
    modelApiKey: 'unknown',
    modelName: 'Unknown',
    modelEmoji: null,
    thumbnailUrl: null,
    isSingleton: false,
  };
}

function createAssetMentionFromResolved(
  assetId: string,
  resolved: ResolvedAsset,
): AssetMention {
  return {
    type: 'asset',
    id: assetId,
    filename: resolved.filename,
    url: resolved.url,
    thumbnailUrl: resolved.thumbnailUrl,
    mimeType: resolved.mimeType,
  };
}

function createFallbackAssetMention(assetId: string): AssetMention {
  return {
    type: 'asset',
    id: assetId,
    filename: `Asset #${assetId}`,
    url: '',
    thumbnailUrl: null,
    mimeType: 'application/octet-stream',
  };
}

// Asset thumbnails display at max 300px, use shared helper for imgix optimization
function getAssetThumbnailUrl(mimeType: string, url: string): string | null {
  if (mimeType.startsWith('image/')) {
    // dpr=2 for retina, q=80 for smaller file size, auto=format for webp/avif
    return `${url}?w=300&fit=max&auto=format&dpr=2&q=80`;
  }
  return null;
}

function createResolvedRecordFromMention(
  mention: RecordMention,
): ResolvedRecord {
  return {
    id: mention.id,
    title: mention.title,
    modelId: mention.modelId,
    modelApiKey: mention.modelApiKey,
    modelName: mention.modelName,
    modelEmoji: mention.modelEmoji,
    thumbnailUrl: mention.thumbnailUrl,
    isSingleton: mention.isSingleton ?? false,
  };
}

function createResolvedAssetFromMention(
  mention: AssetMention,
): ResolvedAsset {
  return {
    id: mention.id,
    filename: mention.filename,
    url: mention.url,
    thumbnailUrl: mention.thumbnailUrl,
    mimeType: mention.mimeType,
  };
}

function isSameResolvedRecord(
  current: ResolvedRecord | 'loading' | 'error' | undefined,
  next: ResolvedRecord,
): boolean {
  return (
    current !== undefined &&
    current !== 'loading' &&
    current !== 'error' &&
    current.id === next.id &&
    current.title === next.title &&
    current.modelId === next.modelId &&
    current.modelApiKey === next.modelApiKey &&
    current.modelName === next.modelName &&
    current.modelEmoji === next.modelEmoji &&
    current.thumbnailUrl === next.thumbnailUrl &&
    current.isSingleton === next.isSingleton
  );
}

function isSameResolvedAsset(
  current: ResolvedAsset | 'loading' | 'error' | undefined,
  next: ResolvedAsset,
): boolean {
  return (
    current !== undefined &&
    current !== 'loading' &&
    current !== 'error' &&
    current.id === next.id &&
    current.filename === next.filename &&
    current.url === next.url &&
    current.thumbnailUrl === next.thumbnailUrl &&
    current.mimeType === next.mimeType
  );
}

// ============================================================================
// Hook
// ============================================================================

export function useEntityResolver(
  params: UseEntityResolverParams,
): UseEntityResolverReturn {
  const {
    client,
    projectUsers,
    projectModels,
    modelFields,
    itemTypes,
    mainLocale,
  } = params;

  const [isResolving, setIsResolving] = useState(false);
  const cacheRef = useRef<ResolutionCache>({
    records: new Map(),
    assets: new Map(),
  });

  // Track pending fetches to avoid duplicate requests
  const pendingRecordsRef = useRef<Set<string>>(new Set());
  const pendingAssetsRef = useRef<Set<string>>(new Set());

  // Cache version increments when async entities are resolved, triggering re-renders
  const [cacheVersion, setCacheVersion] = useState(0);

  const seedResolvedMentionsFromSegments = useCallback(
    (segments: CommentSegment[]) => {
      let didSeed = false;

      for (const segment of segments) {
        if (segment.type !== 'mention') continue;

        if (segment.mention.type === 'record') {
          const next = createResolvedRecordFromMention(segment.mention);
          const current = cacheRef.current.records.get(segment.mention.id);

          if (!isSameResolvedRecord(current, next)) {
            cacheRef.current.records.set(segment.mention.id, next);
            pendingRecordsRef.current.delete(segment.mention.id);
            didSeed = true;
          }
        } else if (segment.mention.type === 'asset') {
          const next = createResolvedAssetFromMention(segment.mention);
          const current = cacheRef.current.assets.get(segment.mention.id);

          if (!isSameResolvedAsset(current, next)) {
            cacheRef.current.assets.set(segment.mention.id, next);
            pendingAssetsRef.current.delete(segment.mention.id);
            didSeed = true;
          }
        }
      }

      if (didSeed) {
        setCacheVersion((n) => n + 1);
      }
    },
    [],
  );

  const resolveMention = useCallback(
    (stored: StoredMention): Mention | null => {
      switch (stored.type) {
        case 'user':
          return resolveUserMention(stored, projectUsers);

        case 'model':
          return resolveModelMention(stored, projectModels);

        case 'field':
          return resolveFieldMention(stored, modelFields);

        case 'record': {
          const cached = cacheRef.current.records.get(stored.id);
          if (cached && cached !== 'loading' && cached !== 'error') {
            return createRecordMentionFromResolved(
              stored.id,
              stored.modelId,
              cached,
            );
          }
          // Return fallback while loading
          return createFallbackRecordMention(stored.id, stored.modelId);
        }

        case 'asset': {
          const cached = cacheRef.current.assets.get(stored.id);
          if (cached && cached !== 'loading' && cached !== 'error') {
            return createAssetMentionFromResolved(stored.id, cached);
          }
          // Return fallback while loading
          return createFallbackAssetMention(stored.id);
        }

        default:
          return null;
      }
    },
    [projectUsers, projectModels, modelFields],
  );

  const resolveSegment = useCallback(
    (segment: StoredCommentSegment): CommentSegment => {
      if (segment.type === 'text') {
        return segment;
      }

      const mention = resolveMention(segment.mention);
      if (!mention) {
        // Fallback for unresolvable mentions
        return { type: 'text', content: '[deleted mention]' };
      }

      return { type: 'mention', mention };
    },
    [resolveMention],
  );

  const resolveComment = useCallback(
    (comment: CommentType): ResolvedCommentType => {
      const resolvedContent = comment.content.map(resolveSegment);
      const resolvedAuthor = resolveAuthorById(comment.authorId, projectUsers);
      const resolvedUpvoters = comment.upvoterIds.map((upvoterId) =>
        resolveAuthorById(upvoterId, projectUsers),
      );

      return {
        id: comment.id,
        dateISO: comment.dateISO,
        content: resolvedContent,
        author: resolvedAuthor,
        upvoters: resolvedUpvoters,
        replies: comment.replies?.map((reply) => resolveComment(reply)),
        parentCommentId: comment.parentCommentId,
      };
    },
    [resolveSegment, projectUsers],
  );

  const collectAsyncMentions = useCallback((comments: CommentType[]) => {
    const recordsToFetch: Array<{ id: string; modelId: string }> = [];
    const assetsToFetch: string[] = [];
    const seenRecordIds = new Set<string>();
    const seenAssetIds = new Set<string>();

    const collectRecordMention = (mentionId: string, modelId: string) => {
      const cached = cacheRef.current.records.get(mentionId);
      const isUncached = !cached || cached === 'error';
      const isPending = pendingRecordsRef.current.has(mentionId);
      const isSeen = seenRecordIds.has(mentionId);
      if (isUncached && !isPending && !isSeen) {
        recordsToFetch.push({ id: mentionId, modelId });
        seenRecordIds.add(mentionId);
      }
    };

    const collectAssetMention = (mentionId: string) => {
      const cached = cacheRef.current.assets.get(mentionId);
      const isUncached = !cached || cached === 'error';
      const isPending = pendingAssetsRef.current.has(mentionId);
      const isSeen = seenAssetIds.has(mentionId);
      if (isUncached && !isPending && !isSeen) {
        assetsToFetch.push(mentionId);
        seenAssetIds.add(mentionId);
      }
    };

    const processSegments = (segments: StoredCommentSegment[]) => {
      for (const segment of segments) {
        if (segment.type !== 'mention') continue;
        if (segment.mention.type === 'record') {
          collectRecordMention(segment.mention.id, segment.mention.modelId);
        } else if (segment.mention.type === 'asset') {
          collectAssetMention(segment.mention.id);
        }
      }
    };

    const processComments = (cmts: CommentType[]) => {
      for (const comment of cmts) {
        processSegments(comment.content);
        if (comment.replies) {
          processComments(comment.replies);
        }
      }
    };

    processComments(comments);
    return { recordsToFetch, assetsToFetch };
  }, []);

  const resolveRecordBatch = useCallback(
    async (recordsToFetch: Array<{ id: string; modelId: string }>) => {
      if (!client || recordsToFetch.length === 0) return;

      const recordResults = await getRecordTitles(
        client,
        recordsToFetch.map((r) => ({ recordId: r.id, modelId: r.modelId })),
        mainLocale,
      );

      for (const record of recordsToFetch) {
        if (!pendingRecordsRef.current.has(record.id)) {
          continue;
        }

        const result = recordResults.get(record.id);
        const model = Object.values(itemTypes).find(
          (it) => it?.id === record.modelId,
        );

        if (result) {
          const { emoji: modelEmoji } = extractLeadingEmoji(result.modelName);
          cacheRef.current.records.set(record.id, {
            id: record.id,
            title: result.title,
            modelId: record.modelId,
            modelApiKey: model?.attributes.api_key ?? 'unknown',
            modelName: result.modelName,
            modelEmoji,
            thumbnailUrl: null,
            isSingleton: result.isSingleton,
          });
        } else {
          cacheRef.current.records.set(record.id, 'error');
        }
        pendingRecordsRef.current.delete(record.id);
      }
    },
    [client, itemTypes, mainLocale],
  );

  const resolveAssetBatch = useCallback(
    async (assetsToFetch: string[]) => {
      if (!client) return;

      const assetPromises = assetsToFetch.map(async (assetId) => {
        try {
          const upload = await client.uploads.find(assetId);
          if (!pendingAssetsRef.current.has(assetId)) {
            return;
          }

          cacheRef.current.assets.set(assetId, {
            id: assetId,
            filename: upload.filename ?? upload.basename ?? `Asset #${assetId}`,
            url: upload.url,
            thumbnailUrl: getAssetThumbnailUrl(
              upload.mime_type ?? '',
              upload.url,
            ),
            mimeType: upload.mime_type ?? 'application/octet-stream',
          });
        } catch (error) {
          if (!pendingAssetsRef.current.has(assetId)) {
            return;
          }

          logError('Failed to fetch asset', error, { assetId });
          cacheRef.current.assets.set(assetId, 'error');
        } finally {
          pendingAssetsRef.current.delete(assetId);
        }
      });

      await Promise.all(assetPromises);
    },
    [client],
  );

  const markEntitiesAsError = useCallback(
    (
      recordsToFetch: Array<{ id: string; modelId: string }>,
      assetsToFetch: string[],
    ) => {
      for (const record of recordsToFetch) {
        pendingRecordsRef.current.delete(record.id);
        if (cacheRef.current.records.get(record.id) === 'loading') {
          cacheRef.current.records.set(record.id, 'error');
        }
      }
      for (const assetId of assetsToFetch) {
        pendingAssetsRef.current.delete(assetId);
        if (cacheRef.current.assets.get(assetId) === 'loading') {
          cacheRef.current.assets.set(assetId, 'error');
        }
      }
    },
    [],
  );

  const fetchAsyncEntities = useCallback(
    async (
      recordsToFetch: Array<{ id: string; modelId: string }>,
      assetsToFetch: string[],
    ) => {
      if (!client) return;
      if (recordsToFetch.length === 0 && assetsToFetch.length === 0) return;

      setIsResolving(true);

      // Mark as pending
      for (const record of recordsToFetch) {
        pendingRecordsRef.current.add(record.id);
        cacheRef.current.records.set(record.id, 'loading');
      }
      for (const assetId of assetsToFetch) {
        pendingAssetsRef.current.add(assetId);
        cacheRef.current.assets.set(assetId, 'loading');
      }

      try {
        await resolveRecordBatch(recordsToFetch);
        await resolveAssetBatch(assetsToFetch);
      } catch (error) {
        logError('Failed to fetch async entities', error);
        markEntitiesAsError(recordsToFetch, assetsToFetch);
      } finally {
        setIsResolving(false);
        setCacheVersion((n) => n + 1);
      }
    },
    [client, resolveRecordBatch, resolveAssetBatch, markEntitiesAsError],
  );

  const prefetchEntities = useCallback(
    (comments: CommentType[]) => {
      const { recordsToFetch, assetsToFetch } = collectAsyncMentions(comments);
      if (recordsToFetch.length === 0 && assetsToFetch.length === 0) return;
      void fetchAsyncEntities(recordsToFetch, assetsToFetch);
    },
    [collectAsyncMentions, fetchAsyncEntities],
  );

  const resolveComments = useCallback(
    (comments: CommentType[]): ResolvedCommentType[] =>
      comments.map(resolveComment),
    [resolveComment],
  );

  return {
    prefetchEntities,
    seedResolvedMentionsFromSegments,
    resolveComments,
    isResolving,
    cacheVersion,
  };
}
