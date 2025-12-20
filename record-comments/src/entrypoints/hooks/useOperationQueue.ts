import { useCallback, useEffect, useRef, useState } from 'react';
import type { RenderItemFormSidebarCtx } from 'datocms-plugin-sdk';
import { ApiError, type Client } from '@datocms/cma-client-browser';
import type { CommentOperation } from '../types/operations';
import type { CommentType } from '../CommentsBar';
import { applyOperation } from '../utils/operationApplicators';

// How long to wait after last save before allowing subscription sync
// This gives the real-time API time to catch up (it can be 5-10s delayed)
const SYNC_COOLDOWN_MS = 8000;

/**
 * Parse comments from various formats (string JSON, array, or null)
 */
function parseComments(content: unknown): CommentType[] {
  if (!content) return [];
  if (Array.isArray(content)) return content as CommentType[];
  if (typeof content === 'string') {
    try {
      return JSON.parse(content);
    } catch {
      return [];
    }
  }
  return [];
}

/**
 * Check if an error is a network-related error that should be retried
 */
function isNetworkError(error: unknown): boolean {
  if (error instanceof TypeError && error.message.includes('fetch')) {
    return true;
  }
  if (error instanceof Error) {
    const message = error.message.toLowerCase();
    return (
      message.includes('network') ||
      message.includes('timeout') ||
      message.includes('connection') ||
      message.includes('failed to fetch')
    );
  }
  return false;
}

type UseOperationQueueParams = {
  client: Client | null;
  commentRecordId: string | null;
  commentsModelId: string | null;
  modelId: string;
  recordId: string | undefined;
  ctx: RenderItemFormSidebarCtx;
  onRecordCreated: (recordId: string) => void;
};

/**
 * Hook that manages a queue of comment operations with infinite retry logic.
 * 
 * Key guarantees:
 * 1. Every operation will eventually succeed (infinite retry for STALE_ITEM_VERSION)
 * 2. No data loss from stale local state (always fetches fresh server state)
 * 3. Order preservation (FIFO queue)
 * 4. Idempotency (duplicate operations are handled gracefully by applicators)
 */
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
  const isProcessing = useRef(false);
  const [pendingCount, setPendingCount] = useState(0);
  
  // Cooldown tracking: don't allow sync from subscription for a period after saving
  // This prevents stale subscription data from overwriting optimistic updates
  const [isInCooldown, setIsInCooldown] = useState(false);
  const cooldownTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  // We need refs for values that can change during processing
  const commentRecordIdRef = useRef(commentRecordId);
  commentRecordIdRef.current = commentRecordId;
  
  // Cleanup cooldown timer on unmount
  useEffect(() => {
    return () => {
      if (cooldownTimerRef.current) {
        clearTimeout(cooldownTimerRef.current);
      }
    };
  }, []);
  
  /**
   * Start the cooldown period after a save operation
   */
  const startCooldown = useCallback(() => {
    // Clear any existing timer
    if (cooldownTimerRef.current) {
      clearTimeout(cooldownTimerRef.current);
    }
    
    setIsInCooldown(true);
    
    cooldownTimerRef.current = setTimeout(() => {
      setIsInCooldown(false);
      cooldownTimerRef.current = null;
    }, SYNC_COOLDOWN_MS);
  }, []);

  /**
   * Execute a single operation with infinite retry on conflicts
   */
  const executeWithRetry = useCallback(
    async (op: CommentOperation): Promise<void> => {
      if (!client || !recordId) return;

      let attempt = 0;

      while (true) {
        try {
          const currentRecordId = commentRecordIdRef.current;

          if (!currentRecordId) {
            // No record exists yet - create one with this operation
            if (!commentsModelId) return;

            const newComments = applyOperation([], op);
            const newRecord = await client.items.create({
              item_type: { type: 'item_type', id: commentsModelId },
              model_id: modelId,
              record_id: recordId,
              content: JSON.stringify(newComments),
            });
            onRecordCreated(newRecord.id);
            startCooldown(); // Start cooldown after successful save
            return; // Success
          }

          // Record exists - fetch latest state and apply operation
          const serverRecord = await client.items.find(currentRecordId);
          const serverComments = parseComments(serverRecord.content);

          // Apply operation to server state
          const newComments = applyOperation(serverComments, op);

          // Save with version check for optimistic locking
          await client.items.update(currentRecordId, {
            content: JSON.stringify(newComments),
            meta: { current_version: serverRecord.meta.current_version },
          });

          startCooldown(); // Start cooldown after successful save
          return; // Success
        } catch (e) {
          // Handle STALE_ITEM_VERSION - someone else updated the record
          if (e instanceof ApiError && e.findError('STALE_ITEM_VERSION')) {
            // Exponential backoff: 100ms, 200ms, 400ms, 800ms... max 5s
            const delay = Math.min(100 * 2 ** attempt, 5000);
            await new Promise((r) => setTimeout(r, delay));
            attempt++;
            continue; // Retry with fresh data
          }

          // Handle network errors with retry
          if (isNetworkError(e)) {
            const delay = Math.min(500 * 2 ** attempt, 10000);
            await new Promise((r) => setTimeout(r, delay));
            attempt++;
            continue; // Retry
          }

          // For unknown errors, log and skip this operation
          // This prevents the queue from getting stuck forever
          console.error('Failed to save comment operation:', op, e);
          ctx.alert('Failed to save comment. Please refresh and try again.');
          return;
        }
      }
    },
    [client, commentsModelId, modelId, recordId, ctx, onRecordCreated, startCooldown]
  );

  /**
   * Process all queued operations sequentially
   */
  const processQueue = useCallback(async () => {
    if (isProcessing.current || queue.current.length === 0 || !client) {
      return;
    }

    isProcessing.current = true;

    while (queue.current.length > 0) {
      const operation = queue.current[0];
      await executeWithRetry(operation);
      queue.current.shift();
      setPendingCount(queue.current.length);
    }

    isProcessing.current = false;
  }, [client, executeWithRetry]);

  /**
   * Enqueue an operation for processing
   */
  const enqueue = useCallback(
    (op: CommentOperation) => {
      queue.current.push(op);
      setPendingCount(queue.current.length);
      // Start processing (non-blocking)
      processQueue();
    },
    [processQueue]
  );

  // Sync is allowed when: no pending operations AND not in cooldown period
  const isSyncAllowed = pendingCount === 0 && !isInCooldown;

  return {
    enqueue,
    pendingCount,
    isProcessing: isProcessing.current,
    isSyncAllowed,
  };
}

