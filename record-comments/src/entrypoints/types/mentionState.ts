import type { StoredCommentSegment } from './mentions';

export type MentionEntry = {
  key: string;
  commentId: string;
  recordId: string;
  modelId: string;
  createdAt: string;
  authorId: string;
  content: StoredCommentSegment[];
  isReply?: boolean;
  parentCommentId?: string;
};

export type MentionStateContent = {
  unread: MentionEntry[];
  updatedAt: string;
};

export type MentionStateOperation = {
  type: 'UPDATE_MENTION_STATE';
  userId: string;
  additions?: MentionEntry[];
  removals?: string[];
};
