import type { RenderItemFormSidebarCtx, RenderPageCtx } from 'datocms-plugin-sdk';
import type { Client } from '@datocms/cma-client-browser';
import { GLOBAL_MODEL_ID, GLOBAL_RECORD_ID } from '@/constants';
import type { CommentType } from '@ctypes/comments';
import { COMMENTS_QUERY } from '@ctypes/comments';
import {
  useCommentsSubscription,
  type SubscriptionStatus,
  type SubscriptionErrorInfo,
  type UseCommentsSubscriptionReturn,
} from './useCommentsSubscription';

/**
 * GraphQL query for global comments.
 * Uses the special __global__ and __project__ identifiers.
 */
const GLOBAL_COMMENTS_QUERY = `
  query GlobalCommentsQuery($modelId: String!, $recordId: String!) {
    allProjectComments(
      filter: {
        modelId: { eq: $modelId },
        recordId: { eq: $recordId }
      }
      first: 1
    ) {
      id
      content
    }
  }
`;

/**
 * Context type for the useCommentsData hook.
 * - 'record': Sidebar context for a specific record (uses ctx.itemType.id and ctx.item?.id)
 * - 'global': Page context for global comments (uses GLOBAL_MODEL_ID and GLOBAL_RECORD_ID)
 */
export type CommentsDataContext = 'record' | 'global';

type BaseParams = {
  realTimeEnabled: boolean;
  cdaToken: string | undefined;
  client: Client | null;
  isSyncAllowed: boolean;
};

type RecordCommentsParams = BaseParams & {
  context: 'record';
  ctx: RenderItemFormSidebarCtx;
  /** Callback when subscription discovers the comment record ID */
  onCommentRecordIdChange: (id: string | null) => void;
};

type GlobalCommentsParams = BaseParams & {
  context: 'global';
  ctx: RenderPageCtx;
};

type UseCommentsDataParams = RecordCommentsParams | GlobalCommentsParams;

type UseCommentsDataReturn = {
  comments: CommentType[];
  setComments: React.Dispatch<React.SetStateAction<CommentType[]>>;
  isLoading: boolean;
  error: Error | null;
  errorInfo: SubscriptionErrorInfo | null;
  status: SubscriptionStatus;
  retry: () => void;
  /**
   * Full subscription result, only needed for components that manage the
   * comments model/record IDs directly (like GlobalCommentsChannel).
   */
  fullResult: UseCommentsSubscriptionReturn;
};

/**
 * Unified hook for managing comments data loading and subscriptions.
 *
 * Supports two contexts:
 * - 'record': For the sidebar panel, loads comments for the current record
 * - 'global': For the Comments Dashboard, loads project-wide global comments
 *
 * Both contexts share the same underlying subscription logic, just with
 * different query parameters and context sources.
 *
 * @example Record context (sidebar)
 * ```tsx
 * const { comments, setComments } = useCommentsData({
 *   context: 'record',
 *   ctx: sidebarCtx,
 *   realTimeEnabled,
 *   cdaToken,
 *   client,
 *   isSyncAllowed,
 *   onCommentRecordIdChange: setCommentRecordId,
 * });
 * ```
 *
 * @example Global context (dashboard)
 * ```tsx
 * const { comments, fullResult } = useCommentsData({
 *   context: 'global',
 *   ctx: pageCtx,
 *   realTimeEnabled,
 *   cdaToken,
 *   client,
 *   isSyncAllowed,
 * });
 * ```
 */
/**
 * Type guard to narrow UseCommentsDataParams to RecordCommentsParams.
 * This allows TypeScript to properly infer the context type without unsafe casts.
 */
function isRecordParams(params: UseCommentsDataParams): params is RecordCommentsParams {
  return params.context === 'record';
}

export function useCommentsData(params: UseCommentsDataParams): UseCommentsDataReturn {
  const { realTimeEnabled, cdaToken, client, isSyncAllowed } = params;

  // Use type guard for proper narrowing - avoids unsafe type assertions.
  // After this check, TypeScript knows exactly which context type we have.
  const isRecordContext = isRecordParams(params);

  // Extract values based on narrowed type
  let modelId: string;
  let recordId: string;
  let query: string;
  let subscriptionEnabled: boolean;
  let onCommentRecordIdChange: ((id: string | null) => void) | undefined;

  if (isRecordContext) {
    // TypeScript now knows params is RecordCommentsParams
    modelId = params.ctx.itemType.id;
    recordId = params.ctx.item?.id ?? '';
    query = COMMENTS_QUERY;
    subscriptionEnabled = !!params.ctx.item?.id;
    onCommentRecordIdChange = params.onCommentRecordIdChange;
  } else {
    // TypeScript now knows params is GlobalCommentsParams
    modelId = GLOBAL_MODEL_ID;
    recordId = GLOBAL_RECORD_ID;
    query = GLOBAL_COMMENTS_QUERY;
    subscriptionEnabled = true;
    onCommentRecordIdChange = undefined;
  }

  const result = useCommentsSubscription({
    ctx: params.ctx,
    realTimeEnabled,
    cdaToken,
    client,
    isSyncAllowed,
    query,
    variables: { modelId, recordId },
    filterParams: { modelId, recordId },
    subscriptionEnabled,
    onCommentRecordIdChange,
  });

  return {
    comments: result.comments,
    setComments: result.setComments,
    isLoading: result.isLoading,
    error: result.error,
    errorInfo: result.errorInfo,
    status: result.status,
    retry: result.retry,
    fullResult: result,
  };
}
