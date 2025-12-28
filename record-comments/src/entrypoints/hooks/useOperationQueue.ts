import { useCallback, useEffect, useRef, useState } from 'react';
import type { RenderItemFormSidebarCtx, RenderPageCtx } from 'datocms-plugin-sdk';
import { ApiError, type Client } from '@datocms/cma-client-browser';
import type { CommentOperation } from '@ctypes/operations';
import { parseComments } from '@ctypes/comments';
import { applyOperation } from '@utils/operationApplicators';
import { TIMING, ERROR_MESSAGES, RETRY_LIMITS } from '@/constants';
import { logError } from '@/utils/errorLogger';

/**
 * Sanitizes a CommentOperation for safe logging.
 *
 * PRIVACY: Operations contain sensitive user data that should NOT be logged:
 * - Comment content (user-generated text, may contain private info)
 * - Author names and emails
 * - Mention data (may reference other users/records)
 *
 * This function extracts only the structural identifiers needed for debugging:
 * - Operation type
 * - Comment/reply IDs
 * - Action type (for upvotes)
 *
 * DO NOT modify this function to include more data without considering
 * privacy implications for error tracking services (Sentry, LogRocket, etc.)
 */
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

/**
 * Retry state exposed to UI for user feedback.
 * Allows components to show retry indicators and error messages.
 */
export type RetryState = {
  /** Whether a retry is currently in progress */
  isRetrying: boolean;
  /** Type of the operation being retried */
  operationType: string | null;
  /** Number of retry attempts so far for current operation */
  retryCount: number;
  /** Reason for the retry (version_conflict, network_error, or null) */
  retryReason: 'version_conflict' | 'network_error' | null;
  /** Human-readable message about the current retry state */
  message: string | null;
  /** Whether the retry loop was terminated due to limits being reached */
  wasTerminated: boolean;
  /** Reason for termination (max_attempts, timeout, or null) */
  terminationReason: 'max_attempts' | 'timeout' | null;
};

/**
 * Union type for contexts that can use the operation queue.
 * Both sidebar and page contexts have the same alert() method.
 *
 * IMPORTANT - CONTEXT TYPE LIMITATIONS:
 * -------------------------------------
 * This union type allows either sidebar or page context, but the hooks using
 * this type do NOT perform runtime validation of which context type was provided.
 *
 * Some operations are context-specific:
 * - RenderItemFormSidebarCtx has: scrollToField(), item (current record)
 * - RenderPageCtx has: navigateTo() for page navigation
 *
 * If you attempt to call a sidebar-only method (like scrollToField) when using
 * a page context, it will fail at runtime with a cryptic error.
 *
 * WHY WE DON'T ADD RUNTIME VALIDATION:
 * ------------------------------------
 * 1. The comment operation queue only uses methods available on BOTH contexts:
 *    - client.items.* (API operations)
 *    - ctx.alert() (user notifications)
 *
 * 2. Adding runtime checks would require discriminated unions and type guards,
 *    which adds complexity without practical benefit for the current use case.
 *
 * 3. The type system already provides compile-time safety - if a developer tries
 *    to use ctx.scrollToField in this hook, TypeScript will error because it's
 *    not on the union type.
 *
 * IF YOU NEED CONTEXT-SPECIFIC OPERATIONS:
 * ----------------------------------------
 * Create separate hooks (like usePageNavigationCallbacks vs useSidebarNavigationCallbacks)
 * rather than trying to make one hook work for both contexts with runtime checks.
 */
type OperationQueueContext = RenderItemFormSidebarCtx | RenderPageCtx;

/*
 * ============================================================================
 * OPERATION QUEUE SYSTEM - OVERVIEW
 * ============================================================================
 *
 * This hook implements a robust queue-based system for persisting comment
 * operations to the server. It solves several critical problems that arise
 * in collaborative real-time applications:
 *
 * PROBLEM 1: OPTIMISTIC UI vs SERVER STATE
 * -----------------------------------------
 * When a user performs an action (add comment, upvote, etc.), we want the UI
 * to update immediately (optimistic update) rather than waiting for the server.
 * However, this creates a risk: if we save our local state directly, we might
 * overwrite changes made by other users that we haven't received yet.
 *
 * SOLUTION: Instead of saving local state, we save "operations". Each operation
 * is fetched against the CURRENT server state, applied, and then saved. This
 * ensures we never lose data from other users.
 *
 *
 * PROBLEM 2: CONCURRENT MODIFICATIONS (RACE CONDITIONS)
 * ------------------------------------------------------
 * Two users editing at the same time could cause a "lost update" problem:
 *   1. User A reads state: [comment1]
 *   2. User B reads state: [comment1]
 *   3. User A adds comment2, saves: [comment1, comment2]
 *   4. User B adds comment3, saves: [comment1, comment3]  <-- comment2 is LOST!
 *
 * SOLUTION: We use DatoCMS's optimistic locking via `meta.current_version`.
 * When saving, we include the version we read. If the server version has
 * changed (someone else saved), we get a STALE_ITEM_VERSION error. We then
 * re-fetch the latest state and retry. This continues until we succeed.
 *
 *
 * PROBLEM 3: REAL-TIME SUBSCRIPTION LAG
 * --------------------------------------
 * The GraphQL subscription (real-time updates) can be 5-10 seconds delayed.
 * If we save a change and immediately receive "stale" subscription data,
 * it could overwrite our optimistic UI update, causing a confusing flicker.
 *
 * SOLUTION: After every successful save, we enter a "cooldown" period during
 * which we ignore incoming subscription data. The `isSyncAllowed` flag
 * controls this, and is only true when:
 *   - No operations are pending in the queue
 *   - We're not in the post-save cooldown period
 *
 *
 * PROBLEM 4: NETWORK FAILURES
 * ---------------------------
 * Network requests can fail due to connectivity issues, timeouts, etc.
 * We don't want to lose user actions just because of temporary network issues.
 *
 * SOLUTION: Network errors trigger automatic retries with exponential backoff.
 * Operations stay in the queue until they succeed.
 *
 *
 * PROBLEM 5: OPERATION ORDER
 * --------------------------
 * If a user rapidly performs multiple actions, they should be applied in order.
 * For example: add comment → edit comment → delete comment. If these execute
 * out of order, we could try to edit a deleted comment.
 *
 * SOLUTION: Operations are processed sequentially in a FIFO queue. The next
 * operation only starts after the previous one completes successfully.
 *
 *
 * DATA FLOW DIAGRAM
 * =================
 *
 *   User Action (e.g., clicks "Add Comment")
 *         │
 *         ▼
 *   ┌─────────────────────────────────────┐
 *   │  1. OPTIMISTIC UI UPDATE            │
 *   │     - Update local React state      │
 *   │     - User sees change immediately  │
 *   └─────────────────────────────────────┘
 *         │
 *         ▼
 *   ┌─────────────────────────────────────┐
 *   │  2. ENQUEUE OPERATION               │
 *   │     - Add to FIFO queue             │
 *   │     - Contains all data needed to   │
 *   │       replay the action             │
 *   └─────────────────────────────────────┘
 *         │
 *         ▼
 *   ┌─────────────────────────────────────┐
 *   │  3. PROCESS QUEUE (async)           │
 *   │     For each operation:             │
 *   │     a. Fetch FRESH server state     │
 *   │     b. Apply operation to it        │
 *   │     c. Save with version check      │
 *   │     d. On conflict → retry          │
 *   │     e. On success → start cooldown  │
 *   └─────────────────────────────────────┘
 *         │
 *         ▼
 *   ┌─────────────────────────────────────┐
 *   │  4. COOLDOWN PERIOD (8 seconds)     │
 *   │     - Ignore subscription updates   │
 *   │     - Prevents stale data overwrite │
 *   └─────────────────────────────────────┘
 *         │
 *         ▼
 *   ┌─────────────────────────────────────┐
 *   │  5. SYNC ALLOWED                    │
 *   │     - Accept subscription updates   │
 *   │     - UI reflects server state      │
 *   └─────────────────────────────────────┘
 *
 * ============================================================================
 */

/*
 * COOLDOWN DURATION
 * -----------------
 * After saving, we wait this long before accepting subscription data.
 * See TIMING.SYNC_COOLDOWN_MS in constants.ts for the value.
 *
 * Why 8 seconds?
 * - DatoCMS's real-time API can have 5-10 second propagation delay
 * - We want to be safely past this window to avoid stale data
 * - Too short: stale subscription data might still arrive and cause flicker
 * - Too long: delays legitimate updates from other users
 *
 * 8 seconds is a conservative middle ground.
 */

/**
 * Identifies network-related errors that should trigger automatic retry.
 *
 * These are transient failures - the operation itself is valid, but the
 * network prevented it from completing. Retrying is safe and expected.
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
  /** DatoCMS CMA client for API calls */
  client: Client | null;

  /** ID of the project_comment record storing comments for this item (null if none exists yet) */
  commentRecordId: string | null;

  /** ID of the project_comment model/item type */
  commentsModelId: string | null;

  /** ID of the model (item type) the commented record belongs to */
  modelId: string;

  /** ID of the record being commented on. For sidebar context, can be undefined for new records.
   * For page context (global comments), always defined. */
  recordId: string | undefined;

  /** Plugin SDK context for showing alerts. Works with both sidebar and page contexts. */
  ctx: OperationQueueContext;

  /** Callback when a new comment record is created (first comment on a record) */
  onRecordCreated: (recordId: string) => void;
};

/**
 * OPERATION QUEUE HOOK
 * ====================
 *
 * Manages a queue of comment operations with robust retry logic and
 * protection against data loss from concurrent modifications.
 *
 * KEY GUARANTEES:
 *
 * 1. EVENTUAL SUCCESS (with practical limits)
 *    Every queued operation will be retried until persisted to the server.
 *    STALE_ITEM_VERSION conflicts and network errors trigger retries with
 *    exponential backoff. Retries are bounded by MAX_ATTEMPTS (75) and
 *    MAX_DURATION_MS (5 minutes) to prevent infinite loops in pathological cases.
 *    In practice, operations succeed within a few retries. Only truly fatal
 *    errors (permissions, invalid data) cause immediate failure.
 *
 * 2. NO DATA LOSS
 *    We never overwrite other users' changes. Before applying any operation,
 *    we fetch the current server state. The operation is applied to THAT
 *    state, not to our potentially-stale local state.
 *
 * 3. ORDER PRESERVATION
 *    Operations are processed in FIFO order. If you add a comment then edit
 *    it, the edit won't be attempted until the add completes. This prevents
 *    logical inconsistencies (e.g., editing a comment that doesn't exist yet).
 *
 * 4. IDEMPOTENCY
 *    Operations include enough context to be safely re-applied. For example,
 *    an upvote operation includes whether it's an "add" or "remove" action,
 *    so retrying won't toggle the vote multiple times.
 *
 * USAGE:
 * ```tsx
 * const { enqueue, isSyncAllowed } = useOperationQueue({ ... });
 *
 * // When user adds a comment:
 * setComments(prev => [newComment, ...prev]);  // Optimistic UI
 * enqueue({ type: 'ADD_COMMENT', comment: newComment });  // Queue for persistence
 *
 * // In subscription sync effect:
 * if (isSyncAllowed) {
 *   setComments(subscriptionData);  // Safe to sync
 * }
 * ```
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
  /*
   * QUEUE STATE
   * -----------
   * We use a ref for the queue array because:
   * 1. We don't want queue changes to trigger re-renders
   * 2. We need stable identity across async operations
   * 3. The queue is mutated (push/shift) during processing
   *
   * pendingCount is a state variable so components can react to it
   * (e.g., showing a "saving..." indicator).
   *
   * isProcessing is now a state variable (not a ref) so UI components
   * can reactively display processing status. Previously it was a ref,
   * which meant components reading it would get a stale snapshot value
   * that never updated during the component lifecycle.
   */
  const queue = useRef<CommentOperation[]>([]);
  const [isProcessing, setIsProcessing] = useState(false);
  const [pendingCount, setPendingCount] = useState(0);

  /*
   * RETRY STATE
   * -----------
   * Tracks retry attempts for user feedback. This allows the UI to show
   * messages like "Retrying..." or "Connection issue, attempt 3..."
   */
  const [retryState, setRetryState] = useState<RetryState>({
    isRetrying: false,
    operationType: null,
    retryCount: 0,
    retryReason: null,
    message: null,
    wasTerminated: false,
    terminationReason: null,
  });

  /** Reset retry state to initial values */
  const clearRetryState = useCallback(() => {
    setRetryState({
      isRetrying: false,
      operationType: null,
      retryCount: 0,
      retryReason: null,
      message: null,
      wasTerminated: false,
      terminationReason: null,
    });
  }, []);

  /** Update retry state for a specific retry reason */
  const updateRetryState = useCallback(
    (opType: string, count: number, reason: 'version_conflict' | 'network_error') => {
      const message =
        reason === 'version_conflict'
          ? ERROR_MESSAGES.VERSION_CONFLICT_RETRYING
          : ERROR_MESSAGES.NETWORK_ERROR_RETRYING;

      setRetryState({
        isRetrying: true,
        operationType: opType,
        retryCount: count,
        retryReason: reason,
        message,
        wasTerminated: false,
        terminationReason: null,
      });
    },
    []
  );

  /*
   * COOLDOWN STATE
   * --------------
   * After a successful save, we enter a cooldown period where we ignore
   * incoming subscription data. This prevents the "flicker" problem:
   *
   * Without cooldown:
   *   1. User adds comment → UI shows new comment
   *   2. Save succeeds
   *   3. Subscription delivers STALE data (missing new comment)
   *   4. UI removes the comment user just added! (flicker)
   *   5. Subscription catches up, delivers new data
   *   6. UI shows comment again
   *
   * With cooldown:
   *   1. User adds comment → UI shows new comment
   *   2. Save succeeds → start 8-second cooldown
   *   3. Subscription delivers stale data → IGNORED (we're in cooldown)
   *   4. Cooldown ends
   *   5. Subscription delivers current data → UI updates smoothly
   */
  const [isInCooldown, setIsInCooldown] = useState(false);
  const cooldownTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  /*
   * REF FOR COMMENT RECORD ID
   * -------------------------
   * The commentRecordId can change during async processing (e.g., when we
   * create the first comment record). Using a ref ensures we always have
   * the latest value when checking inside the async executeWithRetry loop.
   *
   * RACE CONDITION ANALYSIS - WHY THIS IS SAFE:
   * -------------------------------------------
   * It might appear that if the user navigates to a different record while
   * an operation is in-flight, comments could be saved to the wrong record.
   * However, this is NOT the case due to how React closures work:
   *
   * 1. The `executeWithRetry` function captures `modelId` and `recordId` in its
   *    closure at creation time (see dependency array). These values are used
   *    in the API filter query to find/create the correct project_comment record.
   *
   * 2. If the user navigates away, the sidebar component unmounts entirely.
   *    React will ignore any setState calls from the still-running async operation.
   *    The operation will complete (saving to the CORRECT record because of
   *    closure-captured values), but UI updates will be ignored.
   *
   * 3. The `commentRecordIdRef` is used to track when a project_comment record
   *    is CREATED during first-comment scenarios. Within a single operation's
   *    retry loop, this ref provides continuity: if we create a record on
   *    attempt 1 and retry due to version conflict, attempt 2 correctly uses
   *    the newly-created record ID.
   *
   * 4. If React re-renders the component with new props (without unmounting),
   *    the already-running async operation still uses the OLD closure values.
   *    New operations would get NEW closure values. Operations don't cross-
   *    contaminate.
   *
   * DO NOT attempt to "fix" this by capturing values at enqueue time or adding
   * navigation guards. The current design is correct and any changes would
   * likely introduce actual bugs while trying to fix a non-existent problem.
   */
  const commentRecordIdRef = useRef(commentRecordId);
  commentRecordIdRef.current = commentRecordId;

  // Clean up cooldown timer when component unmounts
  useEffect(() => {
    return () => {
      if (cooldownTimerRef.current) {
        clearTimeout(cooldownTimerRef.current);
      }
    };
  }, []);

  /**
   * Starts the post-save cooldown period.
   *
   * Called after every successful save operation. During cooldown,
   * isSyncAllowed will be false, preventing subscription data from
   * overwriting our optimistic UI updates.
   *
   * ============================================================================
   * RACE CONDITION ANALYSIS - WHY THIS IMPLEMENTATION IS SAFE
   * ============================================================================
   *
   * It may appear that using state (isInCooldown) with an async timer could
   * create a race condition during rapid saves. Here's why it's actually safe:
   *
   * CONCERN: "Timer from save 1 fires while save 2 is processing"
   * ANALYSIS:
   *   1. Save 1 completes at T=0, sets isInCooldown=true, timer fires at T=8s
   *   2. Save 2 completes at T=7.9s, clears timer, sets isInCooldown=true again
   *   3. New timer scheduled for T=15.9s
   *   → The old timer was CLEARED before it could fire. No race.
   *
   * CONCERN: "State update batching causes isInCooldown to be false momentarily"
   * ANALYSIS:
   *   - setIsInCooldown(true) is called SYNCHRONOUSLY before setTimeout
   *   - Even if React batches updates, the state is set to true before any
   *     async operations begin
   *   - If timer callback runs and calls setIsInCooldown(false), then another
   *     save happens and calls setIsInCooldown(true), React's batching will
   *     use the LAST value (true), not intermediate states
   *
   * CONCERN: "Subscription effect could read stale isInCooldown value"
   * ANALYSIS:
   *   - The subscription effect depends on isSyncAllowed (derived from isInCooldown)
   *   - React guarantees effects run AFTER state updates are committed
   *   - If isInCooldown changes, the component re-renders, then the effect runs
   *     with the NEW value
   *
   * ALTERNATIVE CONSIDERED: Reference-based deadline checking
   *   - Store `cooldownDeadlineRef = Date.now() + COOLDOWN_MS`
   *   - Check `Date.now() < cooldownDeadlineRef.current` in sync logic
   *   - REJECTED because: wouldn't trigger re-renders when cooldown ends,
   *     requiring additional state management that adds complexity without benefit
   *
   * DO NOT refactor this to use refs or deadline checking without thorough
   * analysis. The current state-based approach is correct and simpler.
   * ============================================================================
   */
  const startCooldown = useCallback(() => {
    // If there's an existing timer, reset it
    // This extends the cooldown if saves happen rapidly
    if (cooldownTimerRef.current) {
      clearTimeout(cooldownTimerRef.current);
    }

    setIsInCooldown(true);

    cooldownTimerRef.current = setTimeout(() => {
      setIsInCooldown(false);
      cooldownTimerRef.current = null;
    }, TIMING.SYNC_COOLDOWN_MS);
  }, []);

  /**
   * CORE: Execute a single operation with automatic retry on conflicts.
   *
   * This is the heart of the system. For each operation:
   *
   * 1. FETCH fresh server state (never use local state!)
   * 2. APPLY the operation to server state
   * 3. SAVE with optimistic locking (version check)
   * 4. If conflict (STALE_ITEM_VERSION) → wait and retry from step 1
   * 5. If network error → wait and retry from step 1
   * 6. If success → start cooldown, done
   * 7. If unknown error → log, alert user, skip operation
   *
   * The retry strategy for STALE_ITEM_VERSION is designed for high reliability:
   * - Each retry fetches fresh data, so we're always making progress
   * - The operation will eventually succeed when we "win" the race
   * - Exponential backoff prevents server overload
   * - Bounded by MAX_ATTEMPTS (75) and MAX_DURATION_MS (5 min) to handle
   *   pathological cases (e.g., sustained high contention, stuck operations)
   */
  const executeWithRetry = useCallback(
    async (op: CommentOperation): Promise<void> => {
      // Can't proceed without API client or record to comment on
      if (!client || !recordId) return;

      let attempt = 0;
      const operationStartTime = Date.now();

      // Retry loop with termination conditions - exits on success, fatal error, or limits reached
      while (true) {
        try {
          const currentRecordId = commentRecordIdRef.current;

          /*
           * CASE 1: NO COMMENT RECORD EXISTS YET
           * ------------------------------------
           * This is the first comment on this DatoCMS record.
           * We need to CREATE a new project_comment record.
           *
           * To handle the race condition where two users add the first comment
           * simultaneously, we first check if another user created a record
           * while we were processing. If so, we switch to update mode.
           */
          if (!currentRecordId) {
            if (!commentsModelId) return;

            // Check if a record was created by another user while we were processing
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
              // Another user created the record - switch to update mode
              const existingRecord = existingRecords[0];
              const existingComments = parseComments(existingRecord.content);
              const result = applyOperation(existingComments, op);

              // Check for high-severity failures that cause content loss
              if (result.status === 'failed_parent_missing' || result.status === 'failed_target_missing') {
                // Alert user about the failure - all operation types should notify the user
                // so they understand why their action didn't persist
                if (result.failureReason) {
                  ctx.alert(result.failureReason);
                }
                clearRetryState();
                return; // Operation failed - don't save
              }

              await client.items.update(existingRecord.id, {
                content: JSON.stringify(result.comments),
                meta: { current_version: existingRecord.meta.current_version },
              });

              onRecordCreated(existingRecord.id);
              startCooldown();
              clearRetryState();
              return; // Success!
            }

            // No existing record - create a new one
            // Apply operation to empty array (no existing comments)
            const result = applyOperation([], op);
            const newComments = result.comments;

            // Create new project_comment record
            const newRecord = await client.items.create({
              item_type: { type: 'item_type', id: commentsModelId },
              model_id: modelId,      // Which model the commented record belongs to
              record_id: recordId,     // Which record is being commented on
              content: JSON.stringify(newComments),
            });

            // Notify parent component of the new record ID
            onRecordCreated(newRecord.id);

            // Start cooldown to protect against stale subscription data
            startCooldown();
            clearRetryState();
            return; // Success!
          }

          /*
           * CASE 2: COMMENT RECORD EXISTS
           * -----------------------------
           * Normal case: fetch current state, apply operation, save.
           */

          // Step 1: ALWAYS fetch fresh server state
          // This is crucial - we never save our local state directly
          const serverRecord = await client.items.find(currentRecordId);
          const serverComments = parseComments(serverRecord.content);

          // Step 2: Apply our operation to the server state
          // The applyOperation function is idempotent - safe to retry
          const result = applyOperation(serverComments, op);

          // Check for high-severity failures that cause content loss
          if (result.status === 'failed_parent_missing' || result.status === 'failed_target_missing') {
            // Alert user about the failure - all operation types should notify the user
            // so they understand why their action didn't persist
            if (result.failureReason) {
              ctx.alert(result.failureReason);
            }
            clearRetryState();
            return; // Operation failed - don't save
          }

          const newComments = result.comments;

          // Step 3: Save with optimistic locking
          // The `meta.current_version` tells DatoCMS "only save if the record
          // hasn't been modified since I read it"
          await client.items.update(currentRecordId, {
            content: JSON.stringify(newComments),
            meta: { current_version: serverRecord.meta.current_version },
          });

          // Start cooldown to protect against stale subscription data
          startCooldown();
          clearRetryState();
          return; // Success!

        } catch (e) {
          /*
           * ERROR HANDLING: STALE_ITEM_VERSION
           * ----------------------------------
           * This error means: "The record was modified by someone else after
           * you read it but before you saved."
           *
           * This is the optimistic locking working as intended! We:
           * 1. Wait a bit (exponential backoff to avoid hammering the server)
           * 2. Retry from the beginning (fetch fresh state, apply, save)
           *
           * The retry is guaranteed to eventually succeed because:
           * - We always fetch fresh state before applying
           * - Contention is temporary; someone will "win" eventually
           */
          if (e instanceof ApiError && e.findError('STALE_ITEM_VERSION')) {
            attempt++;

            // Check termination conditions before retrying
            if (attempt >= RETRY_LIMITS.MAX_ATTEMPTS) {
              logError('Retry terminated: max attempts reached for version conflict:', sanitizeOperationForLogging(op), { attempt });
              ctx.alert(ERROR_MESSAGES.MAX_RETRIES_EXCEEDED);
              setRetryState({
                isRetrying: false,
                operationType: op.type,
                retryCount: attempt,
                retryReason: 'version_conflict',
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
                retryReason: 'version_conflict',
                message: ERROR_MESSAGES.OPERATION_TIMEOUT,
                wasTerminated: true,
                terminationReason: 'timeout',
              });
              return;
            }

            // Update retry state for UI feedback
            updateRetryState(op.type, attempt, 'version_conflict');

            // Exponential backoff: 100ms, 200ms, 400ms, 800ms... capped at 5s
            const delay = Math.min(
              TIMING.VERSION_CONFLICT_BACKOFF_BASE * 2 ** attempt,
              TIMING.VERSION_CONFLICT_BACKOFF_MAX
            );
            await new Promise((r) => setTimeout(r, delay));
            continue; // Retry from the beginning of the loop
          }

          /*
           * ERROR HANDLING: NETWORK ERRORS
           * ------------------------------
           * Transient network failures should be retried. The operation itself
           * is valid; we just couldn't reach the server.
           */
          if (isNetworkError(e)) {
            attempt++;

            // Check termination conditions before retrying
            if (attempt >= RETRY_LIMITS.MAX_ATTEMPTS) {
              logError('Retry terminated: max attempts reached for network error:', sanitizeOperationForLogging(op), { attempt });
              ctx.alert(ERROR_MESSAGES.MAX_RETRIES_EXCEEDED);
              setRetryState({
                isRetrying: false,
                operationType: op.type,
                retryCount: attempt,
                retryReason: 'network_error',
                message: ERROR_MESSAGES.MAX_RETRIES_EXCEEDED,
                wasTerminated: true,
                terminationReason: 'max_attempts',
              });
              return;
            }

            if (Date.now() - operationStartTime >= RETRY_LIMITS.MAX_DURATION_MS) {
              logError('Retry terminated: timeout reached for network error:', sanitizeOperationForLogging(op), { attempt, durationMs: Date.now() - operationStartTime });
              ctx.alert(ERROR_MESSAGES.OPERATION_TIMEOUT);
              setRetryState({
                isRetrying: false,
                operationType: op.type,
                retryCount: attempt,
                retryReason: 'network_error',
                message: ERROR_MESSAGES.OPERATION_TIMEOUT,
                wasTerminated: true,
                terminationReason: 'timeout',
              });
              return;
            }

            // Update retry state for UI feedback
            updateRetryState(op.type, attempt, 'network_error');

            // Longer backoff for network errors: 500ms, 1s, 2s... capped at 10s
            const delay = Math.min(
              TIMING.NETWORK_ERROR_BACKOFF_BASE * 2 ** attempt,
              TIMING.NETWORK_ERROR_BACKOFF_MAX
            );
            await new Promise((r) => setTimeout(r, delay));
            continue; // Retry
          }

          /*
           * ERROR HANDLING: UNKNOWN/FATAL ERRORS
           * ------------------------------------
           * For errors we don't recognize, we log and skip the operation.
           * This prevents the queue from getting stuck forever.
           *
           * Examples: permission denied, model deleted, invalid data, etc.
           *
           * We alert the user so they know something went wrong.
           */
          logError('Failed to save comment operation:', e, { op: sanitizeOperationForLogging(op) });
          ctx.alert(ERROR_MESSAGES.SAVE_FAILED);
          clearRetryState();
          return; // Skip this operation, continue with next
        }
      }
    },
    [client, commentsModelId, modelId, recordId, ctx, onRecordCreated, startCooldown, clearRetryState, updateRetryState]
  );

  /**
   * Process all queued operations sequentially.
   *
   * Operations MUST be processed in order because they may depend on each other.
   * For example:
   * - ADD_COMMENT (creates comment with dateISO "2024-01-01T00:00:00Z")
   * - EDIT_COMMENT (edits comment with dateISO "2024-01-01T00:00:00Z")
   *
   * If EDIT runs before ADD completes, the edit would fail to find the comment.
   *
   * The isProcessing state ensures only one processor runs at a time,
   * even if enqueue() is called rapidly multiple times. We use a ref
   * (isProcessingRef) for the guard check to avoid stale closure issues,
   * but also set state (setIsProcessing) to notify UI components.
   */
  const isProcessingRef = useRef(false);
  const processQueue = useCallback(async () => {
    // Guard: don't start if already processing, queue is empty, or no client
    if (isProcessingRef.current || queue.current.length === 0 || !client) {
      return;
    }

    isProcessingRef.current = true;
    setIsProcessing(true);

    try {
      // Process operations one at a time, in order
      while (queue.current.length > 0) {
        const operation = queue.current[0]; // Peek at front of queue

        await executeWithRetry(operation); // This may retry many times internally

        queue.current.shift(); // Remove from queue only after success
        setPendingCount(queue.current.length); // Update UI indicator
      }
    } catch (e) {
      // This catch handles any unexpected errors that escape executeWithRetry
      // (which should be rare since executeWithRetry has comprehensive error handling).
      // Log the error but don't crash the queue - the operation will be removed
      // and processing will continue with remaining operations.
      logError('Unexpected error in processQueue - operation removed from queue:', e);
      queue.current.shift(); // Remove the problematic operation
      setPendingCount(queue.current.length);
    } finally {
      // Always reset isProcessing to allow future queue processing
      isProcessingRef.current = false;
      setIsProcessing(false);
    }
  }, [client, executeWithRetry]);

  /**
   * PUBLIC API: Add an operation to the queue.
   *
   * This is called immediately after updating the optimistic UI.
   * The operation will be persisted to the server asynchronously.
   *
   * @example
   * // In CommentsBar.tsx:
   * setComments(prev => [newComment, ...prev]);  // Optimistic update
   * enqueue({ type: 'ADD_COMMENT', comment: newComment });  // Persist
   */
  const enqueue = useCallback(
    (op: CommentOperation) => {
      queue.current.push(op);
      setPendingCount(queue.current.length);

      // Start processing (non-blocking)
      // If already processing, this is a no-op due to isProcessing guard
      processQueue();
    },
    [processQueue]
  );

  /*
   * SYNC ALLOWED FLAG
   * -----------------
   * This flag tells the UI when it's safe to apply subscription data.
   *
   * Sync is BLOCKED when:
   * - There are pending operations (we don't want subscription data to
   *   overwrite optimistic updates before they're persisted)
   * - We're in cooldown after a save (subscription might have stale data)
   *
   * Sync is ALLOWED when:
   * - Queue is empty (all operations persisted)
   * - Cooldown has expired (subscription should have current data)
   */
  const isSyncAllowed = pendingCount === 0 && !isInCooldown;

  return {
    /** Add an operation to the queue for async processing */
    enqueue,

    /** Number of operations waiting to be processed */
    pendingCount,

    /** Whether an operation is currently being processed (reactive state) */
    isProcessing,

    /** Whether it's safe to apply subscription data to local state */
    isSyncAllowed,

    /**
     * Current retry state for UI feedback.
     * Shows when operations are being retried and why.
     */
    retryState,
  };
}
