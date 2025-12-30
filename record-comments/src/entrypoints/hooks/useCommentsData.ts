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
  fullResult: UseCommentsSubscriptionReturn;
};

function isRecordParams(params: UseCommentsDataParams): params is RecordCommentsParams {
  return params.context === 'record';
}

export function useCommentsData(params: UseCommentsDataParams): UseCommentsDataReturn {
  const { realTimeEnabled, cdaToken, client, isSyncAllowed } = params;
  const isRecordContext = isRecordParams(params);

  let modelId: string;
  let recordId: string;
  let query: string;
  let subscriptionEnabled: boolean;
  let onCommentRecordIdChange: ((id: string | null) => void) | undefined;

  if (isRecordContext) {
    modelId = params.ctx.itemType.id;
    recordId = params.ctx.item?.id ?? '';
    query = COMMENTS_QUERY;
    subscriptionEnabled = !!params.ctx.item?.id;
    onCommentRecordIdChange = params.onCommentRecordIdChange;
  } else {
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
