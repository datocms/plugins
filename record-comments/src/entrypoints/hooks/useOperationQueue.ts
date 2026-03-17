import { useCallback, useEffect, useRef, useState } from 'react';
import type { RenderItemFormSidebarCtx } from 'datocms-plugin-sdk';
import { ApiError, type Client } from '@datocms/cma-client-browser';
import type { CommentOperation } from '@ctypes/operations';
import { parseComments } from '@ctypes/comments';
import { applyOperation } from '@utils/operationApplicators';
import { delay, calculateBackoffDelay } from '@utils/backoff';
import { TIMING, ERROR_MESSAGES, RETRY_LIMITS } from '@/constants';
import { logDebug, logError } from '@/utils/errorLogger';

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

type UseOperationQueueParams = {
  client: Client | null;
  commentRecordId: string | null;
  commentsModelId: string | null;
  modelId: string;
  recordId: string | undefined;
  ctx: RenderItemFormSidebarCtx;
  onRecordCreated: (recordId: string) => void;
  resolveCommentsModelId: () => Promise<string | null>;
};

export function useOperationQueue({
  client,
  commentRecordId,
  commentsModelId,
  modelId,
  recordId,
  ctx,
  onRecordCreated,
  resolveCommentsModelId,
}: UseOperationQueueParams) {
  const queue = useRef<CommentOperation[]>([]);
  const [isProcessing, setIsProcessing] = useState(false);
  const [pendingCount, setPendingCount] = useState(0);
  const isMountedRef = useRef(true);

  const [retryState, setRetryState] = useState<RetryState>({
    isRetrying: false,
    operationType: null,
    retryCount: 0,
    message: null,
    wasTerminated: false,
    terminationReason: null,
  });

  const clearRetryState = useCallback(() => {
    if (!isMountedRef.current) return;

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
    if (!isMountedRef.current) return;

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
  const commentsModelIdRef = useRef(commentsModelId);
  commentsModelIdRef.current = commentsModelId;

  useEffect(() => {
    isMountedRef.current = true;

    return () => {
      isMountedRef.current = false;
      queue.current = [];
      if (cooldownTimerRef.current) {
        clearTimeout(cooldownTimerRef.current);
      }
    };
  }, []);

  const startCooldown = useCallback(() => {
    if (cooldownTimerRef.current) {
      clearTimeout(cooldownTimerRef.current);
    }

    if (!isMountedRef.current) return;
    setIsInCooldown(true);
    logDebug('Comment sync cooldown started', {
      durationMs: TIMING.SYNC_COOLDOWN_MS,
      modelId,
      recordId,
    });

    cooldownTimerRef.current = setTimeout(() => {
      if (!isMountedRef.current) return;
      setIsInCooldown(false);
      cooldownTimerRef.current = null;
      logDebug('Comment sync cooldown ended', {
        modelId,
        recordId,
      });
    }, TIMING.SYNC_COOLDOWN_MS);
  }, [modelId, recordId]);

  const alertIfMounted = useCallback(
    (message: string) => {
      if (isMountedRef.current) {
        ctx.alert(message);
      }
    },
    [ctx]
  );

  const setPendingCountIfMounted = useCallback((nextPendingCount: number) => {
    if (isMountedRef.current) {
      setPendingCount(nextPendingCount);
    }
  }, []);

  const setIsProcessingIfMounted = useCallback((nextValue: boolean) => {
    if (isMountedRef.current) {
      setIsProcessing(nextValue);
    }
  }, []);

  const canEnqueueOperation = useCallback((): boolean => {
    if (!client || !recordId) {
      alertIfMounted(ERROR_MESSAGES.SAVE_FAILED);
      clearRetryState();
      return false;
    }

    return true;
  }, [alertIfMounted, clearRetryState, client, recordId]);

  const executeWithRetry = useCallback(
    async (op: CommentOperation): Promise<boolean> => {
      if (!client || !recordId || !isMountedRef.current) {
        logDebug('Skipped queued comment operation before execution', {
          hasClient: !!client,
          isMounted: isMountedRef.current,
          modelId,
          op: sanitizeOperationForLogging(op),
          recordId,
        });
        return false;
      }

      let attempt = 0;
      const operationStartTime = Date.now();

      while (true) {
        try {
          if (!isMountedRef.current) return false;
          const currentRecordId = commentRecordIdRef.current;
          let currentCommentsModelId = commentsModelIdRef.current;

          if (!currentCommentsModelId) {
            logDebug('Resolving comments model ID for queued operation', {
              modelId,
              op: sanitizeOperationForLogging(op),
              recordId,
            });
            currentCommentsModelId = await resolveCommentsModelId();
            commentsModelIdRef.current = currentCommentsModelId;
            logDebug('Resolved comments model ID for queued operation', {
              commentsModelId: currentCommentsModelId,
              modelId,
              op: sanitizeOperationForLogging(op),
              recordId,
            });
          }

          if (!currentCommentsModelId) {
            logError('Failed to resolve comments model ID before saving comment operation', undefined, {
              modelId,
              op: sanitizeOperationForLogging(op),
              recordId,
            });
            alertIfMounted(ERROR_MESSAGES.SAVE_FAILED);
            clearRetryState();
            return false;
          }

          logDebug('Executing queued comment operation', {
            attempt: attempt + 1,
            commentRecordId: currentRecordId,
            commentsModelId: currentCommentsModelId,
            modelId,
            op: sanitizeOperationForLogging(op),
            recordId,
          });

          if (!currentRecordId) {
            const existingRecords = await client.items.list({
              filter: {
                type: currentCommentsModelId,
                fields: {
                  model_id: { eq: modelId },
                  record_id: { eq: recordId },
                },
              },
              page: { limit: 1 },
            });

            if (existingRecords.length > 0) {
              const existingRecord = existingRecords[0];
              logDebug('Using existing comments record for queued operation', {
                commentRecordId: existingRecord.id,
                modelId,
                op: sanitizeOperationForLogging(op),
                recordId,
              });
              const existingComments = parseComments(existingRecord.content);
              const result = applyOperation(existingComments, op);

              if (result.status === 'failed_parent_missing' || result.status === 'failed_target_missing') {
                logDebug('Skipping queued comment operation due to missing target', {
                  modelId,
                  op: sanitizeOperationForLogging(op),
                  recordId,
                  status: result.status,
                });
                if (result.failureReason) alertIfMounted(result.failureReason);
                clearRetryState();
                return false;
              }

              await client.items.update(existingRecord.id, {
                content: JSON.stringify(result.comments),
                meta: { current_version: existingRecord.meta.current_version },
              });

              logDebug('Queued comment operation saved', {
                commentRecordId: existingRecord.id,
                modelId,
                op: sanitizeOperationForLogging(op),
                recordId,
              });
              onRecordCreated(existingRecord.id);
              startCooldown();
              clearRetryState();
              return true;
            }

            const result = applyOperation([], op);

            const newRecord = await client.items.create({
              item_type: { type: 'item_type', id: currentCommentsModelId },
              model_id: modelId,
              record_id: recordId,
              content: JSON.stringify(result.comments),
            });

            logDebug('Created comments record for queued operation', {
              commentRecordId: newRecord.id,
              modelId,
              op: sanitizeOperationForLogging(op),
              recordId,
            });
            onRecordCreated(newRecord.id);
            startCooldown();
            clearRetryState();
            return true;
          }

          const serverRecord = await client.items.find(currentRecordId);
          const serverComments = parseComments(serverRecord.content);
          const result = applyOperation(serverComments, op);

          if (result.status === 'failed_parent_missing' || result.status === 'failed_target_missing') {
            logDebug('Skipping queued comment operation due to missing target', {
              commentRecordId: currentRecordId,
              modelId,
              op: sanitizeOperationForLogging(op),
              recordId,
              status: result.status,
            });
            if (result.failureReason) alertIfMounted(result.failureReason);
            clearRetryState();
            return false;
          }

          await client.items.update(currentRecordId, {
            content: JSON.stringify(result.comments),
            meta: { current_version: serverRecord.meta.current_version },
          });

          logDebug('Queued comment operation saved', {
            commentRecordId: currentRecordId,
            modelId,
            op: sanitizeOperationForLogging(op),
            recordId,
          });
          startCooldown();
          clearRetryState();
          return true;

        } catch (e) {
          if (!isMountedRef.current) return false;

          if (e instanceof ApiError && e.findError('STALE_ITEM_VERSION')) {
            attempt++;

            if (attempt >= RETRY_LIMITS.MAX_ATTEMPTS) {
              logError('Retry terminated: max attempts reached for version conflict:', sanitizeOperationForLogging(op), { attempt });
              alertIfMounted(ERROR_MESSAGES.MAX_RETRIES_EXCEEDED);
              if (isMountedRef.current) {
                setRetryState({
                  isRetrying: false,
                  operationType: op.type,
                  retryCount: attempt,
                  message: ERROR_MESSAGES.MAX_RETRIES_EXCEEDED,
                  wasTerminated: true,
                  terminationReason: 'max_attempts',
                });
              }
              return false;
            }

            if (Date.now() - operationStartTime >= RETRY_LIMITS.MAX_DURATION_MS) {
              logError('Retry terminated: timeout reached for version conflict:', sanitizeOperationForLogging(op), { attempt, durationMs: Date.now() - operationStartTime });
              alertIfMounted(ERROR_MESSAGES.OPERATION_TIMEOUT);
              if (isMountedRef.current) {
                setRetryState({
                  isRetrying: false,
                  operationType: op.type,
                  retryCount: attempt,
                  message: ERROR_MESSAGES.OPERATION_TIMEOUT,
                  wasTerminated: true,
                  terminationReason: 'timeout',
                });
              }
              return false;
            }

            updateRetryState(op.type, attempt);

            const backoffDelay = calculateBackoffDelay(
              attempt,
              TIMING.VERSION_CONFLICT_BACKOFF_BASE,
              TIMING.VERSION_CONFLICT_BACKOFF_MAX
            );
            logDebug('Retrying queued comment operation after version conflict', {
              attempt,
              backoffDelayMs: backoffDelay,
              modelId,
              op: sanitizeOperationForLogging(op),
              recordId,
            });
            await delay(backoffDelay);
            if (!isMountedRef.current) return false;
            continue;
          }

          logError('Failed to save comment operation:', e, { op: sanitizeOperationForLogging(op) });
          alertIfMounted(ERROR_MESSAGES.SAVE_FAILED);
          clearRetryState();
          return false;
        }
      }
    },
    [
      alertIfMounted,
      client,
      modelId,
      recordId,
      onRecordCreated,
      startCooldown,
      clearRetryState,
      updateRetryState,
      resolveCommentsModelId,
    ]
  );

  const isProcessingRef = useRef(false);
  const processQueue = useCallback(async () => {
    if (isProcessingRef.current || queue.current.length === 0 || !client) {
      return;
    }

    isProcessingRef.current = true;
    setIsProcessingIfMounted(true);

    try {
      logDebug('Processing queued comment operations', {
        modelId,
        pendingCount: queue.current.length,
        recordId,
      });
      while (queue.current.length > 0) {
        const operation = queue.current[0];
        const didPersist = await executeWithRetry(operation);
        logDebug('Finished queued comment operation', {
          modelId,
          op: sanitizeOperationForLogging(operation),
          persisted: didPersist,
          recordId,
          remainingQueueLength: Math.max(queue.current.length - 1, 0),
        });
        queue.current.shift();
        setPendingCountIfMounted(queue.current.length);

        if (!isMountedRef.current) {
          return;
        }
      }
    } catch (e) {
      logError('Unexpected error in processQueue - operation removed from queue:', e);
      queue.current.shift();
      setPendingCountIfMounted(queue.current.length);
    } finally {
      isProcessingRef.current = false;
      setIsProcessingIfMounted(false);
    }
  }, [
    client,
    executeWithRetry,
    modelId,
    recordId,
    setIsProcessingIfMounted,
    setPendingCountIfMounted,
  ]);

  const enqueue = useCallback(
    (op: CommentOperation): boolean => {
      if (!canEnqueueOperation()) {
        return false;
      }

      queue.current.push(op);
      logDebug('Queued comment operation', {
        modelId,
        op: sanitizeOperationForLogging(op),
        pendingCount: queue.current.length,
        recordId,
      });
      setPendingCountIfMounted(queue.current.length);
      processQueue();
      return true;
    },
    [canEnqueueOperation, modelId, processQueue, recordId, setPendingCountIfMounted]
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
