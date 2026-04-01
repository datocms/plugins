import { parseComments } from '@ctypes/comments';
import type { CommentOperation } from '@ctypes/operations';
import { ApiError, type Client } from '@datocms/cma-client-browser';
import { calculateBackoffDelay, delay } from '@utils/backoff';
import { applyOperation } from '@utils/operationApplicators';
import type { RenderItemFormSidebarCtx } from 'datocms-plugin-sdk';
import { useCallback, useEffect, useRef, useState } from 'react';
import { ERROR_MESSAGES, RETRY_LIMITS, TIMING } from '@/constants';
import { logDebug, logError } from '@/utils/errorLogger';

type OperationContext = {
  client: Client;
  modelId: string;
  recordId: string;
  op: CommentOperation;
  onRecordCreated: (id: string) => void;
};

type OperationCallbacks = {
  alertIfMounted: (msg: string) => void;
  clearRetryState: () => void;
  startCooldown: () => void;
};

async function executeWithExistingRecord(
  ctx: OperationContext,
  callbacks: OperationCallbacks,
  currentRecordId: string,
): Promise<boolean> {
  const { client, op, modelId, recordId } = ctx;
  const { alertIfMounted, clearRetryState, startCooldown } = callbacks;
  const sanitized = sanitizeOperationForLogging(op);

  const serverRecord = await client.items.find(currentRecordId);
  const serverComments = parseComments(serverRecord.content);
  const result = applyOperation(serverComments, op);

  if (
    result.status === 'failed_parent_missing' ||
    result.status === 'failed_target_missing'
  ) {
    logDebug('Skipping queued comment operation due to missing target', {
      commentRecordId: currentRecordId,
      modelId,
      op: sanitized,
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
    op: sanitized,
    recordId,
  });
  startCooldown();
  clearRetryState();
  return true;
}

async function executeWithoutExistingRecord(
  ctx: OperationContext,
  callbacks: OperationCallbacks,
  currentCommentsModelId: string,
): Promise<boolean> {
  const { client, op, modelId, recordId, onRecordCreated } = ctx;
  const { alertIfMounted, clearRetryState, startCooldown } = callbacks;
  const sanitized = sanitizeOperationForLogging(op);

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
      op: sanitized,
      recordId,
    });

    const existingComments = parseComments(existingRecord.content);
    const result = applyOperation(existingComments, op);

    if (
      result.status === 'failed_parent_missing' ||
      result.status === 'failed_target_missing'
    ) {
      logDebug('Skipping queued comment operation due to missing target', {
        modelId,
        op: sanitized,
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
      op: sanitized,
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
    op: sanitized,
    recordId,
  });
  onRecordCreated(newRecord.id);
  startCooldown();
  clearRetryState();
  return true;
}

async function executeSingleAttempt(
  ctx: OperationContext,
  callbacks: OperationCallbacks,
  currentRecordId: string | null,
  currentCommentsModelId: string,
): Promise<boolean> {
  if (currentRecordId) {
    return executeWithExistingRecord(ctx, callbacks, currentRecordId);
  }
  return executeWithoutExistingRecord(ctx, callbacks, currentCommentsModelId);
}

async function processQueueSequentially(
  queue: { current: CommentOperation[] },
  executeWithRetry: (op: CommentOperation) => Promise<boolean>,
  setIsProcessingIfMounted: (value: boolean) => void,
  setPendingCountIfMounted: (count: number) => void,
  isMountedRef: { current: boolean },
  isProcessingRef: { current: boolean },
  modelId: string,
  recordId: string | undefined,
): Promise<void> {
  if (isProcessingRef.current || queue.current.length === 0) {
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

    const processNextOperation = async (): Promise<void> => {
      if (queue.current.length === 0 || !isMountedRef.current) return;

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

      if (isMountedRef.current && queue.current.length > 0) {
        return processNextOperation();
      }
    };

    await processNextOperation();
  } catch (e) {
    logError(
      'Unexpected error in processQueue - operation removed from queue:',
      e,
    );
    queue.current.shift();
    setPendingCountIfMounted(queue.current.length);
  } finally {
    isProcessingRef.current = false;
    setIsProcessingIfMounted(false);
  }
}

function sanitizeOperationForLogging(
  op: CommentOperation,
): Record<string, unknown> {
  const base = { type: op.type };

  switch (op.type) {
    case 'ADD_COMMENT':
      return { ...base, commentId: op.comment.id };
    case 'DELETE_COMMENT':
      return { ...base, id: op.id, parentCommentId: op.parentCommentId };
    case 'EDIT_COMMENT':
      return { ...base, id: op.id, parentCommentId: op.parentCommentId };
    case 'UPVOTE_COMMENT':
      return {
        ...base,
        id: op.id,
        action: op.action,
        parentCommentId: op.parentCommentId,
      };
    case 'ADD_REPLY':
      return {
        ...base,
        parentCommentId: op.parentCommentId,
        replyId: op.reply.id,
      };
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

  // Ref to break the circular dependency between retryAfterVersionConflict
  // and executeWithVersionConflictRetry (each calls the other recursively).
  const executeWithVersionConflictRetryRef = useRef<
    (
      op: CommentOperation,
      opCtx: OperationContext,
      callbacks: OperationCallbacks,
      attempt: number,
      operationStartTime: number,
    ) => Promise<boolean>
  >(async () => false);

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
    [ctx],
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

  const resolveCurrentCommentsModelId = useCallback(
    async (op: CommentOperation): Promise<string | null> => {
      const existingId = commentsModelIdRef.current;
      if (existingId) return existingId;

      logDebug('Resolving comments model ID for queued operation', {
        modelId,
        op: sanitizeOperationForLogging(op),
        recordId,
      });
      const resolvedId = await resolveCommentsModelId();
      commentsModelIdRef.current = resolvedId;
      logDebug('Resolved comments model ID for queued operation', {
        commentsModelId: resolvedId,
        modelId,
        op: sanitizeOperationForLogging(op),
        recordId,
      });
      return resolvedId;
    },
    [modelId, recordId, resolveCommentsModelId],
  );

  const executeAttemptOnce = useCallback(
    async (
      op: CommentOperation,
      opCtx: OperationContext,
      callbacks: OperationCallbacks,
      attempt: number,
    ): Promise<boolean> => {
      if (!isMountedRef.current) return false;

      const currentRecordId = commentRecordIdRef.current;
      const currentCommentsModelId = await resolveCurrentCommentsModelId(op);

      if (!currentCommentsModelId) {
        logError(
          'Failed to resolve comments model ID before saving comment operation',
          undefined,
          { modelId, op: sanitizeOperationForLogging(op), recordId },
        );
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

      return executeSingleAttempt(
        opCtx,
        callbacks,
        currentRecordId,
        currentCommentsModelId,
      );
    },
    [
      alertIfMounted,
      clearRetryState,
      modelId,
      recordId,
      resolveCurrentCommentsModelId,
    ],
  );

  const retryAfterVersionConflict = useCallback(
    async (
      op: CommentOperation,
      opCtx: OperationContext,
      callbacks: OperationCallbacks,
      attempt: number,
      operationStartTime: number,
    ): Promise<boolean> => {
      if (!isMountedRef.current) return false;

      if (attempt >= RETRY_LIMITS.MAX_ATTEMPTS) {
        logError(
          'Retry terminated: max attempts reached for version conflict:',
          sanitizeOperationForLogging(op),
          { attempt },
        );
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
        logError(
          'Retry terminated: timeout reached for version conflict:',
          sanitizeOperationForLogging(op),
          { attempt, durationMs: Date.now() - operationStartTime },
        );
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
        TIMING.VERSION_CONFLICT_BACKOFF_MAX,
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

      return executeWithVersionConflictRetryRef.current(
        op,
        opCtx,
        callbacks,
        attempt,
        operationStartTime,
      );
    },
    [alertIfMounted, modelId, recordId, updateRetryState],
  );

  const executeWithVersionConflictRetry = useCallback(
    async (
      op: CommentOperation,
      opCtx: OperationContext,
      callbacks: OperationCallbacks,
      attempt: number,
      operationStartTime: number,
    ): Promise<boolean> => {
      try {
        return await executeAttemptOnce(op, opCtx, callbacks, attempt);
      } catch (e) {
        if (!isMountedRef.current) return false;

        if (!(e instanceof ApiError && e.findError('STALE_ITEM_VERSION'))) {
          logError('Failed to save comment operation:', e, {
            op: sanitizeOperationForLogging(op),
          });
          alertIfMounted(ERROR_MESSAGES.SAVE_FAILED);
          clearRetryState();
          return false;
        }

        return retryAfterVersionConflict(
          op,
          opCtx,
          callbacks,
          attempt + 1,
          operationStartTime,
        );
      }
    },
    [
      alertIfMounted,
      clearRetryState,
      executeAttemptOnce,
      retryAfterVersionConflict,
    ],
  );

  // Keep the ref in sync so retryAfterVersionConflict can call the latest version
  executeWithVersionConflictRetryRef.current = executeWithVersionConflictRetry;

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

      const opCtx: OperationContext = {
        client,
        modelId,
        recordId,
        op,
        onRecordCreated,
      };

      const callbacks: OperationCallbacks = {
        alertIfMounted,
        clearRetryState,
        startCooldown,
      };

      return executeWithVersionConflictRetry(
        op,
        opCtx,
        callbacks,
        0,
        Date.now(),
      );
    },
    [
      alertIfMounted,
      client,
      clearRetryState,
      executeWithVersionConflictRetry,
      modelId,
      onRecordCreated,
      recordId,
      startCooldown,
    ],
  );

  const isProcessingRef = useRef(false);
  const processQueue = useCallback(async () => {
    if (isProcessingRef.current || queue.current.length === 0 || !client) {
      return;
    }

    await processQueueSequentially(
      queue,
      executeWithRetry,
      setIsProcessingIfMounted,
      setPendingCountIfMounted,
      isMountedRef,
      isProcessingRef,
      modelId,
      recordId,
    );
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
    [
      canEnqueueOperation,
      modelId,
      processQueue,
      recordId,
      setPendingCountIfMounted,
    ],
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
