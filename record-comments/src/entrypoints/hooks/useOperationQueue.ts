import { parseComments } from '@ctypes/comments';
import type { CommentOperation } from '@ctypes/operations';
import { buildClient, type Client } from '@datocms/cma-client-browser';
import { calculateBackoffDelay, delay } from '@utils/backoff';
import { getCommentRetryInfo } from '@utils/errorCategorization';
import {
  applyOperation,
  findOperationComment,
} from '@utils/operationApplicators';
import { isValidCommentArray } from '@utils/typeGuards';
import type { RenderItemFormSidebarCtx } from 'datocms-plugin-sdk';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { ERROR_MESSAGES, RETRY_LIMITS, TIMING } from '@/constants';
import { logDebug, logError } from '@/utils/errorLogger';
import { validateCommentsStorageFields } from '@/utils/commentsStorage';

type CommentRecord = Awaited<ReturnType<Client['items']['list']>>[number];

type OperationContext = {
  client: Client;
  modelId: string;
  recordId: string;
  op: CommentOperation;
  onRecordCreated: (id: string) => void;
  editBaselineContent?: string;
  creationId: string;
};

type OperationCallbacks = {
  isActive: () => boolean;
  alertIfMounted: (msg: string) => void;
  clearRetryState: () => void;
  startCooldown: () => void;
};

function parseExistingCommentsOrThrow(content: unknown) {
  let decoded = content;
  if (typeof content === 'string') {
    if (!content.trim()) return [];
    try {
      decoded = JSON.parse(content);
    } catch {
      throw new Error('Existing comment storage is malformed.');
    }
  }
  if (decoded == null) return [];
  if (!isValidCommentArray(decoded)) {
    throw new Error('Existing comment storage is malformed.');
  }
  return parseComments(decoded);
}

async function findAggregateRecord(
  client: Client,
  commentsModelId: string,
  modelId: string,
  recordId: string,
): Promise<CommentRecord | null> {
  const existingRecords = await client.items.list({
    filter: {
      type: commentsModelId,
      fields: {
        model_id: { eq: modelId },
        record_id: { eq: recordId },
      },
    },
    page: { limit: 2 },
  });

  if (existingRecords.length > 1) {
    throw new Error('Multiple comments records exist for this record.');
  }
  return existingRecords[0] ?? null;
}

function getCurrentVersion(record: CommentRecord): string {
  const currentVersion = record.meta?.current_version;
  if (currentVersion == null || String(currentVersion).length === 0) {
    throw new Error('Comment storage version is missing.');
  }
  return String(currentVersion);
}

function generateAggregateId(): string {
  const hex = crypto.randomUUID().replace(/-/g, '');
  const bytes = hex.match(/.{2}/g) ?? [];
  return btoa(
    String.fromCharCode(...bytes.map((byte) => Number.parseInt(byte, 16))),
  )
    .replace(/\+/g, '-')
    .replace(/\//g, '_')
    .replace(/=/g, '');
}

async function executeWithExistingRecord(
  ctx: OperationContext,
  callbacks: OperationCallbacks,
  currentRecordId: string,
): Promise<boolean> {
  const serverRecord = await ctx.client.items.find(currentRecordId);
  if (!callbacks.isActive()) return false;
  return applyToAggregateRecord(ctx, callbacks, serverRecord);
}

async function applyToAggregateRecord(
  ctx: OperationContext,
  callbacks: OperationCallbacks,
  aggregateRecord: CommentRecord,
): Promise<boolean> {
  const { client, op, modelId, recordId, onRecordCreated } = ctx;
  const { alertIfMounted, clearRetryState, startCooldown } = callbacks;
  const sanitized = sanitizeOperationForLogging(op);

  if (
    (aggregateRecord.model_id !== undefined &&
      aggregateRecord.model_id !== modelId) ||
    (aggregateRecord.record_id !== undefined &&
      aggregateRecord.record_id !== recordId)
  ) {
    throw new Error(
      'Comments record identity does not match the current record.',
    );
  }

  const existingComments = parseExistingCommentsOrThrow(
    aggregateRecord.content,
  );
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

  if (!callbacks.isActive()) return false;
  if (result.status === 'no_op_idempotent') {
    onRecordCreated(aggregateRecord.id);
    startCooldown();
    clearRetryState();
    return true;
  }

  if (op.type === 'EDIT_COMMENT') {
    const target = findOperationComment(
      existingComments,
      op.id,
      op.parentCommentId,
    );
    const content = JSON.stringify(target?.content);
    if (
      ctx.editBaselineContent !== undefined &&
      ctx.editBaselineContent !== content
    ) {
      alertIfMounted(
        'Your edit could not be saved because another user changed this comment.',
      );
      clearRetryState();
      return false;
    }
    ctx.editBaselineContent = content;
  }

  await client.items.update(aggregateRecord.id, {
    content: JSON.stringify(result.comments),
    meta: { current_version: getCurrentVersion(aggregateRecord) },
  });

  logDebug('Queued comment operation saved', {
    commentRecordId: aggregateRecord.id,
    modelId,
    op: sanitized,
    recordId,
  });
  onRecordCreated(aggregateRecord.id);
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
  const { startCooldown, clearRetryState } = callbacks;
  const sanitized = sanitizeOperationForLogging(op);

  const existingRecord = await findAggregateRecord(
    client,
    currentCommentsModelId,
    modelId,
    recordId,
  );

  if (!callbacks.isActive()) return false;

  if (existingRecord) {
    logDebug('Using existing comments record for queued operation', {
      commentRecordId: existingRecord.id,
      modelId,
      op: sanitized,
      recordId,
    });
    return applyToAggregateRecord(ctx, callbacks, existingRecord);
  }

  const result = applyOperation([], op);
  if (result.status !== 'applied') {
    if (result.failureReason) callbacks.alertIfMounted(result.failureReason);
    clearRetryState();
    return result.status === 'no_op_idempotent';
  }
  if (!callbacks.isActive()) return false;

  try {
    const newRecord = await client.items.create({
      id: ctx.creationId,
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
  } catch (error) {
    if (!callbacks.isActive()) return false;
    const recoveredRecord = await findAggregateRecord(
      client,
      currentCommentsModelId,
      modelId,
      recordId,
    );

    if (!recoveredRecord) {
      throw error;
    }

    logDebug('Recovered from concurrent comments record creation', {
      commentRecordId: recoveredRecord.id,
      modelId,
      op: sanitized,
      recordId,
    });
    return applyToAggregateRecord(ctx, callbacks, recoveredRecord);
  }
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

    while (queue.current.length > 0 && isMountedRef.current) {
      const operation = queue.current[0];
      try {
        // biome-ignore lint/performance/noAwaitInLoops: Each operation reads and writes the same aggregate, so requests must remain sequential.
        const didPersist = await executeWithRetry(operation);
        logDebug('Finished queued comment operation', {
          modelId,
          op: sanitizeOperationForLogging(operation),
          persisted: didPersist,
          recordId,
          remainingQueueLength: Math.max(queue.current.length - 1, 0),
        });
      } catch (error) {
        logError('Unexpected error in queued comment operation:', error);
      }
      if (queue.current[0] === operation) queue.current.shift();
      setPendingCountIfMounted(queue.current.length);
    }
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
  const writeClient = useMemo(
    () =>
      client?.config
        ? buildClient({
            ...client.config,
            autoRetry: false,
            requestTimeout: 30000,
          })
        : client,
    [client],
  );
  const queue = useRef<CommentOperation[]>([]);
  const validatedStorageRef = useRef(new WeakMap<Client, Set<string>>());
  const activeTargetRef = useRef({ client, modelId, recordId });
  activeTargetRef.current = { client, modelId, recordId };
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

  const updateRetryState = useCallback(
    (opType: string, count: number, message: string) => {
      if (!isMountedRef.current) return;

      setRetryState({
        isRetrying: true,
        operationType: opType,
        retryCount: count,
        message,
        wasTerminated: false,
        terminationReason: null,
      });
    },
    [],
  );

  const [isInCooldown, setIsInCooldown] = useState(false);
  const cooldownTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const commentRecordIdRef = useRef(commentRecordId);
  const receivedCommentRecordIdRef = useRef(commentRecordId);
  if (receivedCommentRecordIdRef.current !== commentRecordId) {
    commentRecordIdRef.current = commentRecordId;
    receivedCommentRecordIdRef.current = commentRecordId;
  }
  const commentsModelIdRef = useRef(commentsModelId);
  const receivedCommentsModelIdRef = useRef(commentsModelId);
  if (receivedCommentsModelIdRef.current !== commentsModelId) {
    commentsModelIdRef.current = commentsModelId;
    receivedCommentsModelIdRef.current = commentsModelId;
  }

  // biome-ignore lint/correctness/useExhaustiveDependencies: Changing the client or target must cancel operations for the previous record.
  useEffect(() => {
    queue.current = [];
    setPendingCount(0);
    commentRecordIdRef.current = receivedCommentRecordIdRef.current;
    commentsModelIdRef.current = receivedCommentsModelIdRef.current;
    // A navigation cancels unsent operations belonging to the previous record.
  }, [client, modelId, recordId]);

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
      if (!callbacks.isActive()) return false;

      const currentRecordId = commentRecordIdRef.current;
      const currentCommentsModelId = await resolveCurrentCommentsModelId(op);
      if (!callbacks.isActive()) return false;

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

      const validatedModels = validatedStorageRef.current.get(opCtx.client);
      if (!validatedModels?.has(currentCommentsModelId)) {
        const fields = await ctx.loadItemTypeFields(currentCommentsModelId);
        if (!callbacks.isActive()) return false;
        validateCommentsStorageFields(fields.map((field) => field.attributes));
        const models = validatedModels ?? new Set<string>();
        models.add(currentCommentsModelId);
        validatedStorageRef.current.set(opCtx.client, models);
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
      ctx,
    ],
  );

  const terminateRetry = useCallback(
    (
      op: CommentOperation,
      attempt: number,
      reason: 'max_attempts' | 'timeout',
      operationStartTime: number,
    ) => {
      const message =
        reason === 'max_attempts'
          ? ERROR_MESSAGES.MAX_RETRIES_EXCEEDED
          : ERROR_MESSAGES.OPERATION_TIMEOUT;
      logError('Retry terminated:', sanitizeOperationForLogging(op), {
        attempt,
        reason,
        durationMs: Date.now() - operationStartTime,
      });
      alertIfMounted(message);
      if (!isMountedRef.current) return;
      setRetryState({
        isRetrying: false,
        operationType: op.type,
        retryCount: attempt,
        message,
        wasTerminated: true,
        terminationReason: reason,
      });
    },
    [alertIfMounted],
  );

  const retryAfterFailure = useCallback(
    async (
      op: CommentOperation,
      opCtx: OperationContext,
      callbacks: OperationCallbacks,
      attempt: number,
      operationStartTime: number,
      retryInfo: ReturnType<typeof getCommentRetryInfo>,
    ): Promise<boolean> => {
      if (!callbacks.isActive()) return false;

      if (attempt >= RETRY_LIMITS.MAX_ATTEMPTS) {
        terminateRetry(op, attempt, 'max_attempts', operationStartTime);
        return false;
      }
      if (Date.now() - operationStartTime >= RETRY_LIMITS.MAX_DURATION_MS) {
        terminateRetry(op, attempt, 'timeout', operationStartTime);
        return false;
      }

      updateRetryState(
        op.type,
        attempt,
        retryInfo.versionConflict
          ? ERROR_MESSAGES.VERSION_CONFLICT_RETRYING
          : 'Connection interrupted. Retrying...',
      );

      const backoffDelay = Math.max(
        retryInfo.minimumDelayMs,
        calculateBackoffDelay(
          attempt,
          TIMING.VERSION_CONFLICT_BACKOFF_BASE,
          TIMING.VERSION_CONFLICT_BACKOFF_MAX,
        ),
      );
      logDebug('Retrying queued comment operation', {
        attempt,
        backoffDelayMs: backoffDelay,
        modelId,
        op: sanitizeOperationForLogging(op),
        recordId,
      });
      // Never start another request after the operation budget expires.
      const remainingDuration =
        RETRY_LIMITS.MAX_DURATION_MS - (Date.now() - operationStartTime);
      await delay(Math.min(backoffDelay, remainingDuration));
      if (!callbacks.isActive()) return false;

      if (Date.now() - operationStartTime >= RETRY_LIMITS.MAX_DURATION_MS) {
        terminateRetry(op, attempt, 'timeout', operationStartTime);
        return false;
      }

      return executeWithVersionConflictRetryRef.current(
        op,
        opCtx,
        callbacks,
        attempt,
        operationStartTime,
      );
    },
    [modelId, recordId, terminateRetry, updateRetryState],
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
        if (!callbacks.isActive()) return false;

        const retryInfo = getCommentRetryInfo(e);
        if (!retryInfo.retryable) {
          logError('Failed to save comment operation:', e, {
            op: sanitizeOperationForLogging(op),
          });
          alertIfMounted(ERROR_MESSAGES.SAVE_FAILED);
          clearRetryState();
          return false;
        }

        return retryAfterFailure(
          op,
          opCtx,
          callbacks,
          attempt + 1,
          operationStartTime,
          retryInfo,
        );
      }
    },
    [alertIfMounted, clearRetryState, executeAttemptOnce, retryAfterFailure],
  );

  executeWithVersionConflictRetryRef.current = executeWithVersionConflictRetry;

  const executeWithRetry = useCallback(
    async (op: CommentOperation): Promise<boolean> => {
      if (!writeClient || !recordId || !isMountedRef.current) {
        logDebug('Skipped queued comment operation before execution', {
          hasClient: !!client,
          isMounted: isMountedRef.current,
          modelId,
          op: sanitizeOperationForLogging(op),
          recordId,
        });
        return false;
      }

      const isActive = () =>
        isMountedRef.current &&
        activeTargetRef.current.client === client &&
        activeTargetRef.current.modelId === modelId &&
        activeTargetRef.current.recordId === recordId;
      const opCtx: OperationContext = {
        client: writeClient,
        modelId,
        recordId,
        op,
        editBaselineContent:
          op.type === 'EDIT_COMMENT' && op.expectedContent !== undefined
            ? JSON.stringify(op.expectedContent)
            : undefined,
        creationId: generateAggregateId(),
        onRecordCreated: (id) => {
          if (!isActive()) return;
          commentRecordIdRef.current = id;
          onRecordCreated(id);
        },
      };

      const callbacks: OperationCallbacks = {
        isActive,
        alertIfMounted: (message) => {
          if (isActive()) alertIfMounted(message);
        },
        clearRetryState: () => {
          if (isActive()) clearRetryState();
        },
        startCooldown: () => {
          if (isActive()) startCooldown();
        },
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
      writeClient,
      clearRetryState,
      executeWithVersionConflictRetry,
      modelId,
      onRecordCreated,
      recordId,
      startCooldown,
    ],
  );

  const isProcessingRef = useRef(false);
  const executeWithRetryRef = useRef(executeWithRetry);
  executeWithRetryRef.current = executeWithRetry;
  const processQueue = useCallback(async () => {
    if (isProcessingRef.current || queue.current.length === 0 || !client) {
      return;
    }

    await processQueueSequentially(
      queue,
      (operation) => executeWithRetryRef.current(operation),
      setIsProcessingIfMounted,
      setPendingCountIfMounted,
      isMountedRef,
      isProcessingRef,
      modelId,
      recordId,
    );
  }, [
    client,
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
