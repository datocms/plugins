import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useQuerySubscription } from 'react-datocms';
import type { Client } from '@datocms/cma-client-browser';
import { COMMENT_FIELDS, GLOBAL_MODEL_ID, MENTION_STATE_MODEL_ID, TIMING } from '@/constants';
import type { CommentType } from '@ctypes/comments';
import type { MentionEntry, MentionStateContent } from '@ctypes/mentionState';
import type { CommentWithContext } from './useAllCommentsData';
import { buildMentionStateRecordId, parseMentionStateContent } from '@utils/mentionState';
import { getRecordTitles } from '@utils/recordTitleUtils';
import { logError } from '@/utils/errorLogger';
import { useMentionStateQueue } from './useMentionStateQueue';

const MENTION_STATE_QUERY = `
  query MentionState($modelId: String!, $recordId: String!) {
    allProjectComments(filter: { modelId: { eq: $modelId }, recordId: { eq: $recordId } }, first: 1) {
      id
      content
      updatedAt
    }
  }
`;

type MentionStateQueryResult = {
  allProjectComments: Array<{
    id: string;
    content: string | MentionStateContent | null;
    updatedAt: string;
  }>;
};

type UseMentionStateParams = {
  client: Client | null;
  userId: string;
  projectId: string;
  mainLocale: string;
  commentsModelId: string | null;
  cdaToken?: string;
  realTimeEnabled: boolean;
};

type UseMentionStateReturn = {
  mentions: CommentWithContext[];
  mentionEntries: MentionEntry[];
  isLoading: boolean;
  unreadCount: number;
  markAsRead: (mentionKey: string) => void;
  markAllAsRead: () => void;
};

function buildCacheKey(projectId: string, userId: string): string {
  return `mentionsCache:${projectId}:${userId}`;
}

function readCache(key: string): MentionStateContent | null {
  if (typeof localStorage === 'undefined') return null;
  try {
    const raw = localStorage.getItem(key);
    if (!raw) return null;
    const parsed = JSON.parse(raw) as MentionStateContent;
    return parseMentionStateContent(parsed);
  } catch {
    return null;
  }
}

function writeCache(key: string, content: MentionStateContent): void {
  if (typeof localStorage === 'undefined') return;
  try {
    localStorage.setItem(key, JSON.stringify(content));
  } catch {
    // Ignore storage errors
  }
}

function isCacheStale(updatedAt: string | null): boolean {
  if (!updatedAt) return true;
  const ts = Date.parse(updatedAt);
  if (Number.isNaN(ts)) return true;
  return Date.now() - ts > TIMING.MENTION_CACHE_TTL_MS;
}

function buildCommentWithContext(entry: MentionEntry, titleMap: Map<string, { title: string; modelName: string; isSingleton: boolean }>): CommentWithContext {
  const isGlobal = entry.modelId === GLOBAL_MODEL_ID;
  const titleInfo = titleMap.get(entry.recordId);

  const comment: CommentType = {
    id: entry.commentId,
    dateISO: entry.createdAt,
    content: entry.content,
    authorId: entry.authorId,
    upvoterIds: [],
    ...(entry.parentCommentId ? { parentCommentId: entry.parentCommentId } : {}),
  };

  return {
    comment,
    modelId: entry.modelId,
    recordId: entry.recordId,
    commentRecordId: '',
    isGlobal,
    isReply: entry.isReply ?? false,
    parentCommentId: entry.parentCommentId,
    recordTitle: titleInfo?.title,
    modelName: titleInfo?.modelName,
    isSingleton: titleInfo?.isSingleton,
    mentionKey: entry.key,
  };
}

function notifyMentions(entries: MentionEntry[]): void {
  if (entries.length === 0) return;
  if (typeof Notification === 'undefined') return;

  if (Notification.permission === 'default') {
    Notification.requestPermission().catch(() => undefined);
  }

  if (Notification.permission !== 'granted') return;

  for (const entry of entries) {
    const notification = new Notification('New mention', {
      body: 'You were mentioned in a comment.',
      tag: entry.key,
    });

    notification.onclick = () => {
      window.focus();
    };
  }
}

export function useMentionState({
  client,
  userId,
  projectId,
  mainLocale,
  commentsModelId,
  cdaToken,
  realTimeEnabled,
}: UseMentionStateParams): UseMentionStateReturn {
  const cacheKey = useMemo(() => buildCacheKey(projectId, userId), [projectId, userId]);
  const [mentionState, setMentionState] = useState<MentionStateContent>({
    unread: [],
    updatedAt: new Date(0).toISOString(),
  });
  const [isLoading, setIsLoading] = useState(true);
  const [titleMap, setTitleMap] = useState<Map<string, { title: string; modelName: string; isSingleton: boolean }>>(new Map());
  const hasInitializedRef = useRef(false);

  const mentionStateRef = useRef(mentionState);
  useEffect(() => {
    mentionStateRef.current = mentionState;
  }, [mentionState]);

  const mentionStateQueue = useMentionStateQueue({
    client,
    commentsModelId,
  });

  useEffect(() => {
    const cached = readCache(cacheKey);
    if (cached) {
      setMentionState(cached);
      setIsLoading(false);
      hasInitializedRef.current = true;
    }
  }, [cacheKey]);

  const fetchMentionState = useCallback(async () => {
    if (!client || !commentsModelId) {
      setIsLoading(false);
      return;
    }

    try {
      const records = await client.items.list({
        filter: {
          type: commentsModelId,
          fields: {
            [COMMENT_FIELDS.MODEL_ID]: { eq: MENTION_STATE_MODEL_ID },
            [COMMENT_FIELDS.RECORD_ID]: { eq: buildMentionStateRecordId(userId) },
          },
        },
        page: { limit: 1 },
      });

      if (records.length > 0) {
        const record = records[0];
        const content = parseMentionStateContent(record.content);
        const nextContent: MentionStateContent = {
          unread: content.unread,
          updatedAt: content.updatedAt || new Date().toISOString(),
        };
        setMentionState(nextContent);
        writeCache(cacheKey, nextContent);
        hasInitializedRef.current = true;
      } else {
        const empty = { unread: [], updatedAt: new Date().toISOString() };
        setMentionState(empty);
        writeCache(cacheKey, empty);
        hasInitializedRef.current = true;
      }
    } catch (error) {
      logError('Failed to fetch mention state', error, { userId });
    } finally {
      setIsLoading(false);
    }
  }, [client, commentsModelId, userId, cacheKey]);

  useEffect(() => {
    const cached = readCache(cacheKey);
    const cachedUpdatedAt = cached?.updatedAt ?? null;

    if (isCacheStale(cachedUpdatedAt)) {
      fetchMentionState();
    }
  }, [cacheKey, fetchMentionState]);

  useEffect(() => {
    if (realTimeEnabled) return;
    if (!client || !commentsModelId) return;

    const interval = setInterval(() => {
      fetchMentionState();
    }, TIMING.MENTION_POLL_INTERVAL_MS);

    return () => clearInterval(interval);
  }, [client, commentsModelId, realTimeEnabled, fetchMentionState]);

  const { data } = useQuerySubscription<MentionStateQueryResult>({
    query: MENTION_STATE_QUERY,
    variables: { modelId: MENTION_STATE_MODEL_ID, recordId: buildMentionStateRecordId(userId) },
    token: cdaToken ?? '',
    enabled: realTimeEnabled && !!cdaToken && !!commentsModelId,
    includeDrafts: true,
  });

  useEffect(() => {
    if (!data) return;
    if (!mentionStateQueue.isSyncAllowed) return;

    const record = data.allProjectComments[0];
    if (!record) {
      setMentionState({ unread: [], updatedAt: new Date().toISOString() });
      setIsLoading(false);
      return;
    }

    const content = parseMentionStateContent(record.content);
    const nextContent: MentionStateContent = {
      unread: content.unread,
      updatedAt: content.updatedAt || record.updatedAt || new Date().toISOString(),
    };

    const prevKeys = new Set(mentionStateRef.current.unread.map((entry) => entry.key));
    const newEntries = nextContent.unread.filter((entry) => !prevKeys.has(entry.key));

    if (hasInitializedRef.current && newEntries.length > 0) {
      notifyMentions(newEntries);
    }

    setMentionState(nextContent);
    writeCache(cacheKey, nextContent);
    setIsLoading(false);
    hasInitializedRef.current = true;
  }, [data, cacheKey, mentionStateQueue.isSyncAllowed]);

  useEffect(() => {
    const recordRequests: Array<{ recordId: string; modelId: string }> = [];
    const seen = new Set<string>();

    for (const entry of mentionState.unread) {
      if (entry.modelId === GLOBAL_MODEL_ID) continue;
      const key = `${entry.modelId}:${entry.recordId}`;
      if (seen.has(key)) continue;
      seen.add(key);
      recordRequests.push({ recordId: entry.recordId, modelId: entry.modelId });
    }

    if (!client || recordRequests.length === 0) {
      setTitleMap(new Map());
      return;
    }

    let isMounted = true;

    getRecordTitles(client, recordRequests, mainLocale)
      .then((map) => {
        if (!isMounted) return;
        setTitleMap(map);
      })
      .catch((error) => {
        if (!isMounted) return;
        logError('Failed to load record titles for mentions', error);
      });

    return () => {
      isMounted = false;
    };
  }, [client, mentionState.unread, mainLocale]);

  const mentions = useMemo(() => {
    const sorted = [...mentionState.unread].sort((a, b) => b.createdAt.localeCompare(a.createdAt));
    return sorted.map((entry) => buildCommentWithContext(entry, titleMap));
  }, [mentionState.unread, titleMap]);

  const markAsRead = useCallback(
    (mentionKey: string) => {
      setMentionState((prev) => {
        const nextUnread = prev.unread.filter((entry) => entry.key !== mentionKey);
        const nextContent = { unread: nextUnread, updatedAt: new Date().toISOString() };
        writeCache(cacheKey, nextContent);
        return nextContent;
      });

      mentionStateQueue.enqueue({
        type: 'UPDATE_MENTION_STATE',
        userId,
        removals: [mentionKey],
      });
    },
    [cacheKey, mentionStateQueue, userId]
  );

  const markAllAsRead = useCallback(() => {
    const keys = mentionStateRef.current.unread.map((entry) => entry.key);

    setMentionState({ unread: [], updatedAt: new Date().toISOString() });
    writeCache(cacheKey, { unread: [], updatedAt: new Date().toISOString() });

    if (keys.length > 0) {
      mentionStateQueue.enqueue({
        type: 'UPDATE_MENTION_STATE',
        userId,
        removals: keys,
      });
    }
  }, [cacheKey, mentionStateQueue, userId]);

  return {
    mentions,
    mentionEntries: mentionState.unread,
    isLoading,
    unreadCount: mentionState.unread.length,
    markAsRead,
    markAllAsRead,
  };
}
