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

type BaseParams = {
  realTimeEnabled: boolean;
  cdaToken: string | undefined;
  client: Client | null;
  isSyncAllowed: boolean;
  /** Current user's ID for identifying their drafts */
  currentUserId: string;
  /** Callback when a draft reply's parent comment was deleted */
  onOrphanedDraft?: () => void;
  /** Called before sync updates are applied - use to save scroll position */
  onBeforeSync?: () => void;
  /** Called after sync updates are applied - use to restore scroll position */
  onAfterSync?: () => void;
};

type RecordCommentsParams = BaseParams & {
  context: 'record';
  ctx: RenderItemFormSidebarCtx;
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
  isAutoReconnecting: boolean;
  fullResult: UseCommentsSubscriptionReturn;
};

function isRecordParams(params: UseCommentsDataParams): params is RecordCommentsParams {
  return params.context === 'record';
}

export function useCommentsData(params: UseCommentsDataParams): UseCommentsDataReturn {
  const { realTimeEnabled, cdaToken, client, isSyncAllowed, currentUserId, onOrphanedDraft, onBeforeSync, onAfterSync } = params;
  const isRecordContext = isRecordParams(params);

  let modelId: string;
  let recordId: string;
  let subscriptionEnabled: boolean;
  let onCommentRecordIdChange: ((id: string | null) => void) | undefined;

  if (isRecordContext) {
    modelId = params.ctx.itemType.id;
    recordId = params.ctx.item?.id ?? '';
    subscriptionEnabled = !!params.ctx.item?.id;
    onCommentRecordIdChange = params.onCommentRecordIdChange;
  } else {
    modelId = GLOBAL_MODEL_ID;
    recordId = GLOBAL_RECORD_ID;
    subscriptionEnabled = true;
    onCommentRecordIdChange = undefined;
  }

  const result = useCommentsSubscription({
    ctx: params.ctx,
    realTimeEnabled,
    cdaToken,
    client,
    isSyncAllowed,
    query: COMMENTS_QUERY,
    variables: { modelId, recordId },
    filterParams: { modelId, recordId },
    subscriptionEnabled,
    onCommentRecordIdChange,
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
    fullResult: result,
  };
}
