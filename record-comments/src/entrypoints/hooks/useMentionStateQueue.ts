import { useCallback, useEffect, useRef, useState } from 'react';
import type { Client } from '@datocms/cma-client-browser';
import { ApiError } from '@datocms/cma-client-browser';
import { COMMENT_FIELDS, ERROR_MESSAGES, MENTION_STATE_MODEL_ID, RETRY_LIMITS, TIMING } from '@/constants';
import type { MentionStateOperation } from '@ctypes/mentionState';
import { applyMentionStateOperation, buildMentionStateRecordId, parseMentionStateContent } from '@utils/mentionState';
import { delay, calculateBackoffDelay } from '@utils/backoff';
import { logError } from '@/utils/errorLogger';

export type MentionStateRetryState = {
  isRetrying: boolean;
  operationType: string | null;
  retryCount: number;
  message: string | null;
  wasTerminated: boolean;
  terminationReason: 'max_attempts' | 'timeout' | null;
};

type UseMentionStateQueueParams = {
  client: Client | null;
  commentsModelId: string | null;
};

export function useMentionStateQueue({ client, commentsModelId }: UseMentionStateQueueParams) {
  const queue = useRef<MentionStateOperation[]>([]);
  const [isProcessing, setIsProcessing] = useState(false);
  const [pendingCount, setPendingCount] = useState(0);

  const [retryState, setRetryState] = useState<MentionStateRetryState>({
    isRetrying: false,
    operationType: null,
    retryCount: 0,
    message: null,
    wasTerminated: false,
    terminationReason: null,
  });

  const clearRetryState = useCallback(() => {
    setRetryState({
      isRetrying: false,
      operationType: null,
      retryCount: 0,
      message: null,
      wasTerminated: false,
      terminationReason: null,
    });
  }, []);

  const updateRetryState = useCallback((opType: string, count: number) => {
    setRetryState({
      isRetrying: true,
      operationType: opType,
      retryCount: count,
      message: ERROR_MESSAGES.VERSION_CONFLICT_RETRYING,
      wasTerminated: false,
      terminationReason: null,
    });
  }, []);

  const [isInCooldown, setIsInCooldown] = useState(false);
  const cooldownTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => {
    return () => {
      if (cooldownTimerRef.current) {
        clearTimeout(cooldownTimerRef.current);
      }
    };
  }, []);

  const startCooldown = useCallback(() => {
    if (cooldownTimerRef.current) {
      clearTimeout(cooldownTimerRef.current);
    }

    setIsInCooldown(true);

    cooldownTimerRef.current = setTimeout(() => {
      setIsInCooldown(false);
      cooldownTimerRef.current = null;
    }, TIMING.SYNC_COOLDOWN_MS);
  }, []);

  const executeWithRetry = useCallback(
    async (op: MentionStateOperation): Promise<void> => {
      if (!client || !commentsModelId) return;

      let attempt = 0;
      const operationStartTime = Date.now();

      while (true) {
        try {
          const records = await client.items.list({
            filter: {
              type: commentsModelId,
              fields: {
                [COMMENT_FIELDS.MODEL_ID]: { eq: MENTION_STATE_MODEL_ID },
                [COMMENT_FIELDS.RECORD_ID]: { eq: buildMentionStateRecordId(op.userId) },
              },
            },
            page: { limit: 1 },
          });

          if (records.length > 0) {
            const record = records[0];
            const current = parseMentionStateContent(record.content);
            const { content, changed } = applyMentionStateOperation(current, op);

            if (!changed) {
              clearRetryState();
              return;
            }

            await client.items.update(record.id, {
              [COMMENT_FIELDS.CONTENT]: JSON.stringify(content),
              meta: { current_version: record.meta.current_version },
            });

            startCooldown();
            clearRetryState();
            return;
          }

          if (!op.additions || op.additions.length === 0) {
            clearRetryState();
            return;
          }

          const initialContent = {
            unread: op.additions,
            updatedAt: new Date().toISOString(),
          };

          await client.items.create({
            item_type: { type: 'item_type', id: commentsModelId },
            [COMMENT_FIELDS.MODEL_ID]: MENTION_STATE_MODEL_ID,
            [COMMENT_FIELDS.RECORD_ID]: buildMentionStateRecordId(op.userId),
            [COMMENT_FIELDS.CONTENT]: JSON.stringify(initialContent),
          });

          startCooldown();
          clearRetryState();
          return;
        } catch (e) {
          if (e instanceof ApiError && e.findError('STALE_ITEM_VERSION')) {
            attempt += 1;

            if (attempt >= RETRY_LIMITS.MAX_ATTEMPTS) {
              logError('Retry terminated: max attempts reached for mention state update', e, { attempt });
              setRetryState({
                isRetrying: false,
                operationType: op.type,
                retryCount: attempt,
                message: ERROR_MESSAGES.MAX_RETRIES_EXCEEDED,
                wasTerminated: true,
                terminationReason: 'max_attempts',
              });
              return;
            }

            if (Date.now() - operationStartTime >= RETRY_LIMITS.MAX_DURATION_MS) {
              logError('Retry terminated: timeout reached for mention state update', e, { attempt, durationMs: Date.now() - operationStartTime });
              setRetryState({
                isRetrying: false,
                operationType: op.type,
                retryCount: attempt,
                message: ERROR_MESSAGES.OPERATION_TIMEOUT,
                wasTerminated: true,
                terminationReason: 'timeout',
              });
              return;
            }

            updateRetryState(op.type, attempt);

            const backoffDelay = calculateBackoffDelay(
              attempt,
              TIMING.VERSION_CONFLICT_BACKOFF_BASE,
              TIMING.VERSION_CONFLICT_BACKOFF_MAX
            );
            await delay(backoffDelay);
            continue;
          }

          logError('Failed to save mention state operation', e, { op });
          clearRetryState();
          return;
        }
      }
    },
    [client, commentsModelId, clearRetryState, startCooldown, updateRetryState]
  );

  const isProcessingRef = useRef(false);
  const processQueue = useCallback(async () => {
    if (isProcessingRef.current || queue.current.length === 0 || !client) {
      return;
    }

    isProcessingRef.current = true;
    setIsProcessing(true);

    try {
      while (queue.current.length > 0) {
        const operation = queue.current[0];
        await executeWithRetry(operation);
        queue.current.shift();
        setPendingCount(queue.current.length);
      }
    } catch (e) {
      logError('Unexpected error in mention state queue - operation removed', e);
      queue.current.shift();
      setPendingCount(queue.current.length);
    } finally {
      isProcessingRef.current = false;
      setIsProcessing(false);
    }
  }, [client, executeWithRetry]);

  const enqueue = useCallback(
    (op: MentionStateOperation) => {
      queue.current.push(op);
      setPendingCount(queue.current.length);
      processQueue();
    },
    [processQueue]
  );

  const isSyncAllowed = pendingCount === 0 && !isInCooldown;

  return {
    enqueue,
    pendingCount,
    isProcessing,
    isSyncAllowed,
    retryState,
  };
}
