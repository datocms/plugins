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
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
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
  projectUsers: Map<string, UserInfo>,
): ResolvedAuthor {
  const user = projectUsers.get(userId);

  if (user) {
    return {
      id: user.id,
      email: user.email,
      name: user.name,
      avatarUrl:
        user.avatarUrl ?? (user.email ? getGravatarUrl(user.email, 48) : null),
    };
  }

  if (userId.startsWith('legacy-email:')) {
    try {
      const email = decodeURIComponent(userId.slice('legacy-email:'.length));
      return {
        id: userId,
        email,
        name: email,
        avatarUrl: getGravatarUrl(email, 48),
      };
    } catch {
      // Invalid historical IDs still use the ordinary unknown-user fallback.
    }
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
  projectUsers: Map<string, UserInfo>,
): UserMention | null {
  const user = projectUsers.get(stored.id);
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
  projectModels: Map<string, ModelInfo>,
): ModelMention | null {
  const model = projectModels.get(stored.id);
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
  modelFields: Map<string, FieldInfo>,
): FieldMention | null {
  // Find field by fieldPath
  const field = modelFields.get(stored.fieldPath);

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

function createResolvedAssetFromMention(mention: AssetMention): ResolvedAsset {
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

async function fetchReferencedAsset(
  client: Client,
  cache: ResolutionCache['assets'],
  pending: Set<string>,
  assetId: string,
  shouldContinue: () => boolean,
) {
  const isPending = () => shouldContinue() && pending.has(assetId);
  if (!isPending()) return;
  try {
    const upload = await client.uploads.find(assetId);
    if (!isPending()) return;
    cache.set(assetId, {
      id: assetId,
      filename: upload.filename ?? upload.basename ?? `Asset #${assetId}`,
      url: upload.url,
      thumbnailUrl: getAssetThumbnailUrl(upload.mime_type ?? '', upload.url),
      mimeType: upload.mime_type ?? 'application/octet-stream',
    });
  } catch (error) {
    if (!isPending()) return;
    logError('Failed to fetch asset', error, { assetId });
    cache.set(assetId, 'error');
  } finally {
    if (shouldContinue()) pending.delete(assetId);
  }
}

function pruneUnusedEntities<T>(
  cache: Map<string, T>,
  pending: Set<string>,
  activeIds: Set<string>,
) {
  for (const id of cache.keys()) {
    if (activeIds.has(id)) continue;
    cache.delete(id);
    pending.delete(id);
  }
}

function markLoadingEntitiesAsError<T>(
  cache: Map<string, T | 'loading' | 'error'>,
  pending: Set<string>,
  ids: string[],
) {
  for (const id of ids) {
    pending.delete(id);
    if (cache.get(id) === 'loading') cache.set(id, 'error');
  }
}

function seedResolvedEntity<T>(
  cache: Map<string, T | 'loading' | 'error'>,
  pending: Set<string>,
  id: string,
  next: T,
  isSame: (current: T | 'loading' | 'error' | undefined, next: T) => boolean,
): boolean {
  if (isSame(cache.get(id), next)) return false;
  cache.set(id, next);
  pending.delete(id);
  return true;
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
  const generationRef = useRef(0);
  const queuedFetchesRef = useRef(0);
  const fetchQueueRef = useRef(Promise.resolve());

  const usersById = useMemo(() => {
    const users = new Map<string, UserInfo>();
    for (const user of projectUsers) {
      if (!users.has(user.id)) users.set(user.id, user);
      if (user.email && !users.has(user.email)) users.set(user.email, user);
    }
    return users;
  }, [projectUsers]);
  const modelsById = useMemo(
    () => new Map(projectModels.map((model) => [model.id, model])),
    [projectModels],
  );
  const fieldsByPath = useMemo(
    () => new Map(modelFields.map((field) => [field.fieldPath, field])),
    [modelFields],
  );

  // biome-ignore lint/correctness/useExhaustiveDependencies: Client and locale changes invalidate the resolution cache.
  useEffect(() => {
    generationRef.current += 1;
    cacheRef.current = { records: new Map(), assets: new Map() };
    pendingRecordsRef.current.clear();
    pendingAssetsRef.current.clear();
    queuedFetchesRef.current = 0;
    setIsResolving(false);
    setCacheVersion((version) => version + 1);
    return () => {
      generationRef.current += 1;
    };
  }, [client, mainLocale]);

  const seedResolvedMentionsFromSegments = useCallback(
    (segments: CommentSegment[]) => {
      let didSeed = false;

      for (const segment of segments) {
        if (segment.type !== 'mention') continue;

        if (segment.mention.type === 'record') {
          didSeed =
            seedResolvedEntity(
              cacheRef.current.records,
              pendingRecordsRef.current,
              segment.mention.id,
              createResolvedRecordFromMention(segment.mention),
              isSameResolvedRecord,
            ) || didSeed;
        } else if (segment.mention.type === 'asset') {
          didSeed =
            seedResolvedEntity(
              cacheRef.current.assets,
              pendingAssetsRef.current,
              segment.mention.id,
              createResolvedAssetFromMention(segment.mention),
              isSameResolvedAsset,
            ) || didSeed;
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
          return resolveUserMention(stored, usersById);

        case 'model':
          return resolveModelMention(stored, modelsById);

        case 'field':
          return resolveFieldMention(stored, fieldsByPath);

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
    [usersById, modelsById, fieldsByPath],
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
      const resolvedAuthor = resolveAuthorById(comment.authorId, usersById);
      const resolvedUpvoters = comment.upvoterIds.map((upvoterId) =>
        resolveAuthorById(upvoterId, usersById),
      );

      return {
        id: comment.id,
        dateISO: comment.dateISO,
        content: resolvedContent,
        storedContent: comment.content,
        author: resolvedAuthor,
        upvoters: resolvedUpvoters,
        replies: comment.replies ? [] : undefined,
        parentCommentId: comment.parentCommentId,
      };
    },
    [resolveSegment, usersById],
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
      seenRecordIds.add(mentionId);
      if (isUncached && !isPending && !isSeen) {
        recordsToFetch.push({ id: mentionId, modelId });
      }
    };

    const collectAssetMention = (mentionId: string) => {
      const cached = cacheRef.current.assets.get(mentionId);
      const isUncached = !cached || cached === 'error';
      const isPending = pendingAssetsRef.current.has(mentionId);
      const isSeen = seenAssetIds.has(mentionId);
      seenAssetIds.add(mentionId);
      if (isUncached && !isPending && !isSeen) {
        assetsToFetch.push(mentionId);
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

    const pendingComments = [...comments];
    while (pendingComments.length > 0) {
      const comment = pendingComments.pop();
      if (!comment) continue;
      processSegments(comment.content);
      for (const reply of comment.replies ?? []) pendingComments.push(reply);
    }
    return { recordsToFetch, assetsToFetch, seenRecordIds, seenAssetIds };
  }, []);

  const resolveRecordBatch = useCallback(
    async (
      recordsToFetch: Array<{ id: string; modelId: string }>,
      shouldContinue: () => boolean,
    ) => {
      if (!client || recordsToFetch.length === 0 || !shouldContinue()) return;

      const recordResults = await getRecordTitles(
        client,
        recordsToFetch.map((record) => ({
          recordId: record.id,
          modelId: record.modelId,
        })),
        mainLocale,
        shouldContinue,
      );
      if (!shouldContinue()) return;

      for (const record of recordsToFetch) {
        if (!pendingRecordsRef.current.has(record.id)) continue;
        const result = recordResults.get(record.id);
        const model = itemTypes[record.modelId];
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
    async (assetsToFetch: string[], shouldContinue: () => boolean) => {
      if (!client) return;
      let nextIndex = 0;
      const worker = async () => {
        while (nextIndex < assetsToFetch.length && shouldContinue()) {
          // biome-ignore lint/performance/noAwaitInLoops: Each of four workers processes one request at a time.
          await fetchReferencedAsset(
            client,
            cacheRef.current.assets,
            pendingAssetsRef.current,
            assetsToFetch[nextIndex++],
            shouldContinue,
          );
        }
      };
      await Promise.all(
        Array.from({ length: Math.min(4, assetsToFetch.length) }, worker),
      );
    },
    [client],
  );

  const fetchAsyncEntities = useCallback(
    async (
      recordsToFetch: Array<{ id: string; modelId: string }>,
      assetsToFetch: string[],
      generation: number,
    ) => {
      const shouldContinue = () => generationRef.current === generation;
      if (!shouldContinue()) return;
      try {
        await resolveRecordBatch(recordsToFetch, shouldContinue);
        if (shouldContinue()) setCacheVersion((version) => version + 1);
        await resolveAssetBatch(assetsToFetch, shouldContinue);
      } catch (error) {
        if (!shouldContinue()) return;
        logError('Failed to fetch async entities', error);
        markLoadingEntitiesAsError(
          cacheRef.current.records,
          pendingRecordsRef.current,
          recordsToFetch.map((record) => record.id),
        );
        markLoadingEntitiesAsError(
          cacheRef.current.assets,
          pendingAssetsRef.current,
          assetsToFetch,
        );
      } finally {
        if (shouldContinue()) {
          queuedFetchesRef.current -= 1;
          setIsResolving(queuedFetchesRef.current > 0);
          setCacheVersion((version) => version + 1);
        }
      }
    },
    [resolveRecordBatch, resolveAssetBatch],
  );

  const prefetchEntities = useCallback(
    (comments: CommentType[]) => {
      if (!client) return;
      const { recordsToFetch, assetsToFetch, seenRecordIds, seenAssetIds } =
        collectAsyncMentions(comments);
      // Retain only display data needed by the current list, rather than every
      // entity encountered while navigating many records in a long session.
      pruneUnusedEntities(
        cacheRef.current.records,
        pendingRecordsRef.current,
        seenRecordIds,
      );
      pruneUnusedEntities(
        cacheRef.current.assets,
        pendingAssetsRef.current,
        seenAssetIds,
      );
      if (recordsToFetch.length === 0 && assetsToFetch.length === 0) return;

      // Mark requests before queueing so repeated renders cannot duplicate them.
      for (const record of recordsToFetch) {
        pendingRecordsRef.current.add(record.id);
        cacheRef.current.records.set(record.id, 'loading');
      }
      for (const assetId of assetsToFetch) {
        pendingAssetsRef.current.add(assetId);
        cacheRef.current.assets.set(assetId, 'loading');
      }
      const generation = generationRef.current;
      queuedFetchesRef.current += 1;
      setIsResolving(true);

      // One continuous queue also bounds overlapping prefetch calls. A context
      // change discards old results and stops its remaining requests.
      fetchQueueRef.current = fetchQueueRef.current.then(() =>
        fetchAsyncEntities(recordsToFetch, assetsToFetch, generation),
      );
    },
    [client, collectAsyncMentions, fetchAsyncEntities],
  );

  const resolveComments = useCallback(
    (comments: CommentType[]): ResolvedCommentType[] => {
      const resolved = comments.map(resolveComment);
      const pending = comments.map((comment, index) => ({
        comment,
        resolved: resolved[index],
      }));
      while (pending.length > 0) {
        const entry = pending.pop();
        if (!entry?.comment.replies) continue;
        entry.resolved.replies = entry.comment.replies.map(resolveComment);
        for (let index = 0; index < entry.comment.replies.length; index += 1) {
          pending.push({
            comment: entry.comment.replies[index],
            resolved: entry.resolved.replies[index],
          });
        }
      }
      return resolved;
    },
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
