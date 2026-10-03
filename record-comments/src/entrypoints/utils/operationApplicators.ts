import type { CommentType } from '@ctypes/comments';
import type {
  AddCommentOp,
  AddReplyOp,
  CommentOperation,
  DeleteCommentOp,
  EditCommentOp,
  OperationResult,
  UpvoteCommentOp,
} from '@ctypes/operations';
import { logWarn } from '@/utils/errorLogger';

type CommentLocation = {
  comment: CommentType;
  siblings: CommentType[];
  index: number;
  parent?: CommentLocation;
};

/** Iterative traversal also handles deeply nested imported threads. */
function findCommentLocation(
  comments: CommentType[],
  id: string,
): CommentLocation | undefined {
  const stack: {
    siblings: CommentType[];
    index: number;
    parent?: CommentLocation;
  }[] = [{ siblings: comments, index: 0 }];
  const visited = new WeakSet<CommentType>();

  while (stack.length > 0) {
    const frame = stack[stack.length - 1];
    if (frame.index >= frame.siblings.length) {
      stack.pop();
      continue;
    }
    const index = frame.index++;
    const comment = frame.siblings[index];
    if (visited.has(comment)) continue;
    visited.add(comment);
    const location: CommentLocation = {
      comment,
      siblings: frame.siblings,
      index,
      parent: frame.parent,
    };
    if (comment.id === id) return location;
    if (comment.replies?.length) {
      stack.push({ siblings: comment.replies, index: 0, parent: location });
    }
  }
  return undefined;
}

function findTargetLocation(
  comments: CommentType[],
  id: string,
  parentCommentId?: string,
): CommentLocation | undefined {
  if (!parentCommentId) {
    const index = comments.findIndex((comment) => comment.id === id);
    return index < 0
      ? undefined
      : { comment: comments[index], siblings: comments, index };
  }
  const parent = findCommentLocation(comments, parentCommentId);
  const index =
    parent?.comment.replies?.findIndex((reply) => reply.id === id) ?? -1;
  if (!parent || index < 0 || !parent.comment.replies) return undefined;
  return {
    comment: parent.comment.replies[index],
    siblings: parent.comment.replies,
    index,
    parent,
  };
}

export function findOperationComment(
  comments: CommentType[],
  id: string,
  parentCommentId?: string,
): CommentType | undefined {
  return findTargetLocation(comments, id, parentCommentId)?.comment;
}

type CommentResolution =
  | { success: true; location: CommentLocation }
  | { success: false; result: OperationResult };

/**
 * Configuration for failure messages when resolving comment targets.
 * Each operation provides user-facing error messages appropriate to the context
 * (e.g., edit vs delete have different implications for lost user work).
 */
type ResolutionFailureConfig = {
  operationName: string;
  parentMissingReason: string;
  targetMissingReason: string;
  /** If true, target not found returns no_op_idempotent (e.g., delete of already-deleted comment) */
  targetNotFoundIsIdempotent?: boolean;
};

function resolveCommentTarget(
  comments: CommentType[],
  targetId: string,
  parentCommentId: string | undefined,
  config: ResolutionFailureConfig,
): CommentResolution {
  if (parentCommentId && !findCommentLocation(comments, parentCommentId)) {
    logWarn(`${config.operationName}: parent ${parentCommentId} not found`);
    return {
      success: false,
      result: {
        comments,
        status: 'failed_parent_missing',
        failureReason: config.parentMissingReason,
      },
    };
  }
  const location = findTargetLocation(comments, targetId, parentCommentId);
  if (!location) {
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
  return { success: true, location };
}

/** Copy only arrays/ancestors along the changed path; preserve unrelated threads. */
function replaceComment(
  location: CommentLocation,
  replacement?: CommentType,
): CommentType[] {
  let current = location;
  let siblings = current.siblings.slice();
  if (replacement) siblings[current.index] = replacement;
  else siblings.splice(current.index, 1);

  while (current.parent) {
    const parent = current.parent;
    const parentSiblings = parent.siblings.slice();
    parentSiblings[parent.index] = { ...parent.comment, replies: siblings };
    siblings = parentSiblings;
    current = parent;
  }
  return siblings;
}

export function applyOperation(
  comments: CommentType[],
  op: CommentOperation,
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

function applyAddComment(
  comments: CommentType[],
  op: AddCommentOp,
): OperationResult {
  if (findCommentLocation(comments, op.comment.id)) {
    return { comments, status: 'no_op_idempotent' };
  }
  return { comments: [op.comment, ...comments], status: 'applied' };
}

function applyDeleteComment(
  comments: CommentType[],
  op: DeleteCommentOp,
): OperationResult {
  const resolution = resolveCommentTarget(comments, op.id, op.parentCommentId, {
    operationName: 'DELETE_COMMENT',
    parentMissingReason: 'The comment thread was deleted by another user.',
    targetMissingReason: 'The comment was deleted by another user.',
    targetNotFoundIsIdempotent: true,
  });

  if (!resolution.success) {
    return resolution.result;
  }

  return { comments: replaceComment(resolution.location), status: 'applied' };
}

function applyEditComment(
  comments: CommentType[],
  op: EditCommentOp,
): OperationResult {
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

  const { location } = resolution;
  if (
    JSON.stringify(location.comment.content) === JSON.stringify(op.newContent)
  ) {
    return { comments, status: 'no_op_idempotent' };
  }
  return {
    comments: replaceComment(location, {
      ...location.comment,
      content: op.newContent,
    }),
    status: 'applied',
  };
}

function applyUpvoteComment(
  comments: CommentType[],
  op: UpvoteCommentOp,
): OperationResult {
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

  const { location } = resolution;
  const hasUpvoted = location.comment.upvoterIds.includes(op.userId);
  if (hasUpvoted === (op.action === 'add')) {
    return { comments, status: 'no_op_idempotent' };
  }
  const upvoterIds =
    op.action === 'add'
      ? [...location.comment.upvoterIds, op.userId]
      : location.comment.upvoterIds.filter((id) => id !== op.userId);
  return {
    comments: replaceComment(location, { ...location.comment, upvoterIds }),
    status: 'applied',
  };
}

function applyAddReply(
  comments: CommentType[],
  op: AddReplyOp,
): OperationResult {
  const parent = findCommentLocation(comments, op.parentCommentId);
  if (!parent) {
    logWarn(
      `ADD_REPLY: parent ${op.parentCommentId} not found - user's reply content is lost`,
    );
    return {
      comments,
      status: 'failed_parent_missing',
      failureReason:
        'Your reply could not be saved because the comment was deleted by another user.',
    };
  }

  if (findCommentLocation(comments, op.reply.id)) {
    return { comments, status: 'no_op_idempotent' };
  }

  return {
    comments: replaceComment(parent, {
      ...parent.comment,
      replies: [op.reply, ...(parent.comment.replies ?? [])],
    }),
    status: 'applied',
  };
}
