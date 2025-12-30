import { useCallback, useEffect, useRef, useState } from 'react';
import type { RenderItemFormSidebarCtx, RenderPageCtx } from 'datocms-plugin-sdk';
import { ApiError, type Client } from '@datocms/cma-client-browser';
import type { CommentOperation } from '@ctypes/operations';
import { parseComments } from '@ctypes/comments';
import { applyOperation } from '@utils/operationApplicators';
import { delay, calculateBackoffDelay } from '@utils/backoff';
import { TIMING, ERROR_MESSAGES, RETRY_LIMITS } from '@/constants';
import { logError } from '@/utils/errorLogger';

function sanitizeOperationForLogging(op: CommentOperation): Record<string, unknown> {
  const base = { type: op.type };

  switch (op.type) {
    case 'ADD_COMMENT':
      return { ...base, commentId: op.comment.id };
    case 'DELETE_COMMENT':
      return { ...base, id: op.id, parentCommentId: op.parentCommentId };
    case 'EDIT_COMMENT':
      return { ...base, id: op.id, parentCommentId: op.parentCommentId };
    case 'UPVOTE_COMMENT':
      return { ...base, id: op.id, action: op.action, parentCommentId: op.parentCommentId };
    case 'ADD_REPLY':
      return { ...base, parentCommentId: op.parentCommentId, replyId: op.reply.id };
    default:
      return base;
  }
}

export type RetryState = {
  isRetrying: boolean;
  operationType: string | null;
  retryCount: number;
  message: string | null;
  wasTerminated: boolean;
  terminationReason: 'max_attempts' | 'timeout' | null;
};

type OperationQueueContext = RenderItemFormSidebarCtx | RenderPageCtx;

type UseOperationQueueParams = {
  client: Client | null;
  commentRecordId: string | null;
  commentsModelId: string | null;
  modelId: string;
  recordId: string | undefined;
  ctx: OperationQueueContext;
  onRecordCreated: (recordId: string) => void;
};

export function useOperationQueue({
  client,
  commentRecordId,
  commentsModelId,
  modelId,
  recordId,
  ctx,
  onRecordCreated,
}: UseOperationQueueParams) {
  const queue = useRef<CommentOperation[]>([]);
  const [isProcessing, setIsProcessing] = useState(false);
  const [pendingCount, setPendingCount] = useState(0);

  const [retryState, setRetryState] = useState<RetryState>({
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
  const commentRecordIdRef = useRef(commentRecordId);
  commentRecordIdRef.current = commentRecordId;

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
    async (op: CommentOperation): Promise<void> => {
      if (!client || !recordId) return;

      let attempt = 0;
      const operationStartTime = Date.now();

      while (true) {
        try {
          const currentRecordId = commentRecordIdRef.current;

          if (!currentRecordId) {
            if (!commentsModelId) return;

            const existingRecords = await client.items.list({
              filter: {
                type: commentsModelId,
                fields: {
                  model_id: { eq: modelId },
                  record_id: { eq: recordId },
                },
              },
              page: { limit: 1 },
            });

            if (existingRecords.length > 0) {
              const existingRecord = existingRecords[0];
              const existingComments = parseComments(existingRecord.content);
              const result = applyOperation(existingComments, op);

              if (result.status === 'failed_parent_missing' || result.status === 'failed_target_missing') {
                if (result.failureReason) ctx.alert(result.failureReason);
                clearRetryState();
                return;
              }

              await client.items.update(existingRecord.id, {
                content: JSON.stringify(result.comments),
                meta: { current_version: existingRecord.meta.current_version },
              });

              onRecordCreated(existingRecord.id);
              startCooldown();
              clearRetryState();
              return;
            }

            const result = applyOperation([], op);

            const newRecord = await client.items.create({
              item_type: { type: 'item_type', id: commentsModelId },
              model_id: modelId,
              record_id: recordId,
              content: JSON.stringify(result.comments),
            });

            onRecordCreated(newRecord.id);
            startCooldown();
            clearRetryState();
            return;
          }

          const serverRecord = await client.items.find(currentRecordId);
          const serverComments = parseComments(serverRecord.content);
          const result = applyOperation(serverComments, op);

          if (result.status === 'failed_parent_missing' || result.status === 'failed_target_missing') {
            if (result.failureReason) ctx.alert(result.failureReason);
            clearRetryState();
            return;
          }

          await client.items.update(currentRecordId, {
            content: JSON.stringify(result.comments),
            meta: { current_version: serverRecord.meta.current_version },
          });

          startCooldown();
          clearRetryState();
          return;

        } catch (e) {
          if (e instanceof ApiError && e.findError('STALE_ITEM_VERSION')) {
            attempt++;

            if (attempt >= RETRY_LIMITS.MAX_ATTEMPTS) {
              logError('Retry terminated: max attempts reached for version conflict:', sanitizeOperationForLogging(op), { attempt });
              ctx.alert(ERROR_MESSAGES.MAX_RETRIES_EXCEEDED);
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
              logError('Retry terminated: timeout reached for version conflict:', sanitizeOperationForLogging(op), { attempt, durationMs: Date.now() - operationStartTime });
              ctx.alert(ERROR_MESSAGES.OPERATION_TIMEOUT);
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

          logError('Failed to save comment operation:', e, { op: sanitizeOperationForLogging(op) });
          ctx.alert(ERROR_MESSAGES.SAVE_FAILED);
          clearRetryState();
          return;
        }
      }
    },
    [client, commentsModelId, modelId, recordId, ctx, onRecordCreated, startCooldown, clearRetryState, updateRetryState]
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
      logError('Unexpected error in processQueue - operation removed from queue:', e);
      queue.current.shift();
      setPendingCount(queue.current.length);
    } finally {
      isProcessingRef.current = false;
      setIsProcessing(false);
    }
  }, [client, executeWithRetry]);

  const enqueue = useCallback(
    (op: CommentOperation) => {
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
