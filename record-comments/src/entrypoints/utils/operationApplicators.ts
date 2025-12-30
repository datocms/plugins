import type { CommentType, Upvoter } from '@ctypes/comments';
import type {
  CommentOperation,
  AddCommentOp,
  DeleteCommentOp,
  EditCommentOp,
  UpvoteCommentOp,
  AddReplyOp,
  OperationResult,
} from '@ctypes/operations';
import { logWarn } from '@/utils/errorLogger';

function findTopLevelComment(comments: CommentType[], id: string): CommentType | undefined {
  return comments.find((c) => c.id === id);
}

function findReply(parent: CommentType, replyId: string): CommentType | undefined {
  return parent.replies?.find((r) => r.id === replyId);
}

type CommentResolutionSuccess = {
  success: true;
  isReply: boolean;
  parent?: CommentType;
  target: CommentType;
};

type CommentResolutionFailure = {
  success: false;
  result: OperationResult;
};

type CommentResolution = CommentResolutionSuccess | CommentResolutionFailure;

type ResolutionFailureConfig = {
  operationName: string;
  parentMissingReason: string;
  targetMissingReason: string;
  targetNotFoundIsIdempotent?: boolean;
};

function resolveCommentTarget(
  comments: CommentType[],
  targetId: string,
  parentCommentId: string | undefined,
  config: ResolutionFailureConfig
): CommentResolution {
  if (parentCommentId) {
    const parent = findTopLevelComment(comments, parentCommentId);
    if (!parent) {
      logWarn(
        `${config.operationName}: parent ${parentCommentId} not found - parent may have been deleted by another user`
      );
      return {
        success: false,
        result: {
          comments,
          status: 'failed_parent_missing',
          failureReason: config.parentMissingReason,
        },
      };
    }

    const reply = findReply(parent, targetId);
    if (!reply) {
      if (config.targetNotFoundIsIdempotent) {
        return {
          success: false,
          result: { comments, status: 'no_op_idempotent' },
        };
      }
      logWarn(`${config.operationName}: reply ${targetId} not found in parent ${parentCommentId}`);
      return {
        success: false,
        result: {
          comments,
          status: 'failed_target_missing',
          failureReason: config.targetMissingReason,
        },
      };
    }

    return { success: true, isReply: true, parent, target: reply };
  }

  const comment = findTopLevelComment(comments, targetId);
  if (!comment) {
    if (config.targetNotFoundIsIdempotent) {
      return {
        success: false,
        result: { comments, status: 'no_op_idempotent' },
      };
    }
    logWarn(`${config.operationName}: comment ${targetId} not found`);
    return {
      success: false,
      result: {
        comments,
        status: 'failed_target_missing',
        failureReason: config.targetMissingReason,
      },
    };
  }

  return { success: true, isReply: false, target: comment };
}

function applyCommentUpdate(
  comments: CommentType[],
  targetId: string,
  parentCommentId: string | undefined,
  updateFn: (comment: CommentType) => CommentType
): CommentType[] {
  if (parentCommentId) {
    return comments.map((c) =>
      c.id === parentCommentId
        ? { ...c, replies: c.replies?.map((r) => (r.id === targetId ? updateFn(r) : r)) }
        : c
    );
  }
  return comments.map((c) => (c.id === targetId ? updateFn(c) : c));
}

export function applyOperation(
  comments: CommentType[],
  op: CommentOperation
): OperationResult {
  switch (op.type) {
    case 'ADD_COMMENT':
      return applyAddComment(comments, op);
    case 'DELETE_COMMENT':
      return applyDeleteComment(comments, op);
    case 'EDIT_COMMENT':
      return applyEditComment(comments, op);
    case 'UPVOTE_COMMENT':
      return applyUpvoteComment(comments, op);
    case 'ADD_REPLY':
      return applyAddReply(comments, op);
  }
}

function applyAddComment(comments: CommentType[], op: AddCommentOp): OperationResult {
  if (comments.some((c) => c.id === op.comment.id)) {
    return { comments, status: 'no_op_idempotent' };
  }
  return { comments: [op.comment, ...comments], status: 'applied' };
}

function applyDeleteComment(comments: CommentType[], op: DeleteCommentOp): OperationResult {
  const resolution = resolveCommentTarget(comments, op.id, op.parentCommentId, {
    operationName: 'DELETE_COMMENT',
    parentMissingReason: 'The comment thread was deleted by another user.',
    targetMissingReason: 'The comment was deleted by another user.',
    targetNotFoundIsIdempotent: true,
  });

  if (!resolution.success) {
    return resolution.result;
  }

  if (resolution.isReply) {
    const newComments = comments.map((c) =>
      c.id === op.parentCommentId
        ? { ...c, replies: c.replies?.filter((r) => r.id !== op.id) }
        : c
    );
    return { comments: newComments, status: 'applied' };
  }

  return { comments: comments.filter((c) => c.id !== op.id), status: 'applied' };
}

function applyEditComment(comments: CommentType[], op: EditCommentOp): OperationResult {
  const resolution = resolveCommentTarget(comments, op.id, op.parentCommentId, {
    operationName: 'EDIT_COMMENT',
    parentMissingReason:
      'Your edit could not be saved because the comment thread was deleted by another user.',
    targetMissingReason: op.parentCommentId
      ? 'The reply you were editing was deleted by another user.'
      : 'The comment you were editing was deleted by another user.',
  });

  if (!resolution.success) {
    return resolution.result;
  }

  const newComments = applyCommentUpdate(
    comments,
    op.id,
    op.parentCommentId,
    (comment) => ({ ...comment, content: op.newContent })
  );
  return { comments: newComments, status: 'applied' };
}

function applyUpvoteComment(comments: CommentType[], op: UpvoteCommentOp): OperationResult {
  const resolution = resolveCommentTarget(comments, op.id, op.parentCommentId, {
    operationName: 'UPVOTE_COMMENT',
    parentMissingReason: 'The comment thread was deleted by another user.',
    targetMissingReason: op.parentCommentId
      ? 'The reply was deleted by another user.'
      : 'The comment was deleted by another user.',
  });

  if (!resolution.success) {
    return resolution.result;
  }

  const modifyUpvotes = (voters: Upvoter[]): Upvoter[] => {
    const hasUpvoted = voters.some((v) => v.email === op.user.email);

    if (op.action === 'add') {
      if (hasUpvoted) return voters;
      return [...voters, op.user];
    }
    return voters.filter((v) => v.email !== op.user.email);
  };

  const newComments = applyCommentUpdate(
    comments,
    op.id,
    op.parentCommentId,
    (comment) => ({ ...comment, usersWhoUpvoted: modifyUpvotes(comment.usersWhoUpvoted) })
  );
  return { comments: newComments, status: 'applied' };
}

function applyAddReply(comments: CommentType[], op: AddReplyOp): OperationResult {
  const parent = findTopLevelComment(comments, op.parentCommentId);
  if (!parent) {
    logWarn(`ADD_REPLY: parent ${op.parentCommentId} not found - user's reply content is lost`);
    return {
      comments,
      status: 'failed_parent_missing',
      failureReason: 'Your reply could not be saved because the comment was deleted by another user.',
    };
  }

  if (parent.replies?.some((r) => r.id === op.reply.id)) {
    return { comments, status: 'no_op_idempotent' };
  }

  const newComments = comments.map((c) => {
    if (c.id !== op.parentCommentId) return c;

    return {
      ...c,
      replies: [op.reply, ...(c.replies ?? [])],
    };
  });

  return { comments: newComments, status: 'applied' };
}


