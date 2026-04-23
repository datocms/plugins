import type { CommentType } from '@ctypes/comments';
import { COMMENTS_QUERY } from '@ctypes/comments';
import type { Client } from '@datocms/cma-client-browser';
import type { RenderItemFormSidebarCtx } from 'datocms-plugin-sdk';
import {
  type CommentsStorageProblem,
  type SubscriptionErrorInfo,
  type SubscriptionStatus,
  type UseCommentsSubscriptionReturn,
  useCommentsSubscription,
} from './useCommentsSubscription';

type UseCommentsDataParams = {
  realTimeEnabled: boolean;
  cdaToken: string | undefined;
  client: Client | null;
  commentsModelId: string | null;
  isSyncAllowed: boolean;
  /** Current user's ID for identifying their drafts */
  currentUserId: string;
  /** Callback when a draft reply's parent comment was deleted */
  onOrphanedDraft?: () => void;
  /** Called before sync updates are applied - use to save scroll position */
  onBeforeSync?: () => void;
  /** Called after sync updates are applied - use to restore scroll position */
  onAfterSync?: () => void;
  ctx: RenderItemFormSidebarCtx;
  onCommentRecordIdChange: (id: string | null) => void;
};

type UseCommentsDataReturn = {
  comments: CommentType[];
  setComments: React.Dispatch<React.SetStateAction<CommentType[]>>;
  isLoading: boolean;
  error: Error | null;
  errorInfo: SubscriptionErrorInfo | null;
  status: SubscriptionStatus;
  retry: () => void;
  isAutoReconnecting: boolean;
  storageProblem: CommentsStorageProblem | null;
  fullResult: UseCommentsSubscriptionReturn;
};

export function useCommentsData(
  params: UseCommentsDataParams,
): UseCommentsDataReturn {
  const {
    realTimeEnabled,
    cdaToken,
    client,
    commentsModelId,
    isSyncAllowed,
    currentUserId,
    onOrphanedDraft,
    onBeforeSync,
    onAfterSync,
  } = params;

  const modelId = params.ctx.itemType.id;
  const recordId = params.ctx.item?.id ?? '';
  const subscriptionEnabled = !!params.ctx.item?.id;

  const result = useCommentsSubscription({
    ctx: params.ctx,
    realTimeEnabled,
    cdaToken,
    client,
    commentsModelId,
    isSyncAllowed,
    query: COMMENTS_QUERY,
    variables: { modelId, recordId },
    filterParams: { modelId, recordId },
    subscriptionEnabled,
    onCommentRecordIdChange: params.onCommentRecordIdChange,
    currentUserId,
    onOrphanedDraft,
    onBeforeSync,
    onAfterSync,
  });

  return {
    comments: result.comments,
    setComments: result.setComments,
    isLoading: result.isLoading,
    error: result.error,
    errorInfo: result.errorInfo,
    status: result.status,
    retry: result.retry,
    isAutoReconnecting: result.isAutoReconnecting,
    storageProblem: result.storageProblem,
    fullResult: result,
  };
}
