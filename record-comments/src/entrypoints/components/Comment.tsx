import { useEffect, useRef, useState } from "react";
import type { RenderItemFormSidebarCtx } from 'datocms-plugin-sdk';
import styles from "../styles/comment.module.css";
import Textarea from "react-textarea-autosize";
import ReactTimeAgo from "react-time-ago";
import type { CommentType } from "../CommentsBar";
import type { CommentSegment, Mention, MentionMapKey } from "../types/mentions";
import { createMentionKey } from "../types/mentions";
import {
  segmentsToEditableText,
  editableTextToSegments,
} from "../utils/mentionSerializer";
import { useMentions, type UserInfo, type FieldInfo, type ModelInfo } from "../hooks/useMentions";
import { getGravatarUrl } from "../../utils/helpers";
import FieldMentionDropdown from "./FieldMentionDropdown";
import UserMentionDropdown from "./UserMentionDropdown";
import ModelMentionDropdown from "./ModelMentionDropdown";

type CommentProps = {
  deleteComment: (dateISO: string, parentCommentISO?: string) => void;
  editComment: (
    dateISO: string,
    newContent: CommentSegment[],
    parentCommentISO?: string
  ) => void;
  upvoteComment: (
    dateISO: string,
    userUpvotedThisComment: boolean,
    parentCommentISO?: string
  ) => void;
  replyComment: (parentCommentISO: string) => void;
  commentObject: CommentType;
  currentUserEmail: string;
  isReply?: boolean;
  modelFields: FieldInfo[];
  projectUsers: UserInfo[];
  projectModels: ModelInfo[];
  onScrollToField: (fieldPath: string, localized: boolean, locale?: string) => void;
  onNavigateToUsers: () => void;
  onNavigateToModel: (modelId: string, isBlockModel: boolean) => void;
  onOpenAsset?: (assetId: string) => void;
  onOpenRecord?: (recordId: string, modelId: string) => void;
  ctx?: RenderItemFormSidebarCtx;
};

// Component to render comment content from structured segments
const CommentContentRenderer = ({
  segments,
  onScrollToField,
  onNavigateToUsers,
  onNavigateToModel,
  onOpenAsset,
  onOpenRecord,
}: {
  segments: CommentSegment[];
  onScrollToField: (fieldPath: string, localized: boolean, locale?: string) => void;
  onNavigateToUsers: () => void;
  onNavigateToModel: (modelId: string, isBlockModel: boolean) => void;
  onOpenAsset?: (assetId: string) => void;
  onOpenRecord?: (recordId: string, modelId: string) => void;
}) => {
  return (
    <>
      {segments.map((segment, index) => {
        if (segment.type === 'text') {
          const key = `text-${index}-${segment.content.slice(0, 10)}`;
          return <span key={key}>{segment.content}</span>;
        }

        const { mention } = segment;

        switch (mention.type) {
          case 'user': {
            const key = `user-${mention.id}-${index}`;
            return (
              <span key={key} className={styles.userMentionWrapper}>
                <button
                  type="button"
                  className={styles.userMention}
                  onClick={(e) => {
                    e.preventDefault();
                    e.stopPropagation();
                    onNavigateToUsers();
                  }}
                >
                  @{mention.name}
                </button>
                <span className={styles.userMentionTooltip}>
                  {mention.email}
                  <span className={styles.userMentionTooltipArrow} />
                </span>
              </span>
            );
          }

          case 'field': {
            // Fallback to apiKey for backwards compatibility with old mentions
            const fieldPath = mention.fieldPath ?? mention.apiKey;
            const key = `field-${fieldPath}-${mention.locale ?? ''}-${index}`;
            const hasLocale = !!mention.locale;
            // Format field type for display (e.g., "single_line" -> "Single line")
            const formattedFieldType = mention.fieldType 
              ? mention.fieldType.replace(/_/g, ' ').replace(/^\w/, c => c.toUpperCase())
              : null;
            return (
              <span key={key} className={styles.fieldMentionWrapper}>
                <button
                  type="button"
                  className={styles.fieldMention}
                  onClick={(e) => {
                    e.preventDefault();
                    e.stopPropagation();
                    // If mention has a specific locale, use it; otherwise use the localized flag
                    onScrollToField(fieldPath, mention.localized, mention.locale);
                  }}
                >
                  #{mention.apiKey}
                  {hasLocale && (
                    <span className={styles.fieldMentionLocaleBadge}>
                      {mention.locale}
                    </span>
                  )}
                </button>
                {formattedFieldType && (
                  <span className={styles.fieldMentionTooltip}>
                    {formattedFieldType}
                    <span className={styles.fieldMentionTooltipArrow} />
                  </span>
                )}
              </span>
            );
          }

          case 'asset': {
            const key = `asset-${mention.id}-${index}`;
            const hasThumbnail = !!mention.thumbnailUrl;
            
            // Assets with thumbnails (images/videos) render as Slack-style blocks
            if (hasThumbnail && mention.thumbnailUrl) {
              return (
                <span key={key} className={styles.assetMentionBlockWrapper}>
                  <button
                    type="button"
                    className={styles.assetMentionBlock}
                    onClick={(e) => {
                      e.preventDefault();
                      e.stopPropagation();
                      onOpenAsset?.(mention.id);
                    }}
                  >
                    <img
                      src={mention.thumbnailUrl}
                      alt={mention.filename}
                      className={styles.assetMentionBlockThumb}
                    />
                    <span className={styles.assetMentionBlockName}>{mention.filename}</span>
                  </button>
                </span>
              );
            }
            
            // Non-image assets remain inline
            // Truncate filename: keep first 6 chars + extension
            const getTruncatedFilename = (filename: string) => {
              const lastDot = filename.lastIndexOf('.');
              if (lastDot === -1) return filename.slice(0, 8);
              const name = filename.slice(0, lastDot);
              const ext = filename.slice(lastDot);
              if (name.length <= 6) return filename;
              return `${name.slice(0, 6)}…${ext}`;
            };
            
            return (
              <span key={key} className={styles.assetMentionWrapper}>
                <button
                  type="button"
                  className={`${styles.assetMention} ${styles.assetMentionNoThumb}`}
                  onClick={(e) => {
                    e.preventDefault();
                    e.stopPropagation();
                    onOpenAsset?.(mention.id);
                  }}
                >
                  <span className={styles.assetMentionName}>{getTruncatedFilename(mention.filename)}</span>
                </button>
                <span className={styles.assetMentionTooltip}>
                  {mention.filename}
                  <span className={styles.assetMentionTooltipArrow} />
                </span>
              </span>
            );
          }

          case 'record': {
            const key = `record-${mention.id}-${index}`;
            // Extract emoji from start of model name and get clean name
            const emojiMatch = mention.modelName.match(/^(\p{Emoji_Presentation}|\p{Emoji}\uFE0F?)\s*/u);
            const modelNameEmoji = emojiMatch ? emojiMatch[0].trim() : null;
            const cleanModelName = emojiMatch 
              ? mention.modelName.slice(emojiMatch[0].length) 
              : mention.modelName;
            // Use modelEmoji if available, otherwise use emoji from model name
            const displayEmoji = mention.modelEmoji ?? modelNameEmoji;
            // For singletons, show "Singleton" in tooltip; otherwise show model name
            const tooltipText = mention.isSingleton ? 'Singleton' : cleanModelName;
            
            return (
              <span key={key} className={styles.recordMentionWrapper}>
                <button
                  type="button"
                  className={`${styles.recordMention} ${!mention.thumbnailUrl ? styles.recordMentionNoThumb : ''}`}
                  onClick={(e) => {
                    e.preventDefault();
                    e.stopPropagation();
                    onOpenRecord?.(mention.id, mention.modelId);
                  }}
                >
                  {mention.thumbnailUrl && (
                    <img
                      src={mention.thumbnailUrl}
                      alt=""
                      className={styles.recordMentionThumb}
                    />
                  )}
                  {!mention.thumbnailUrl && displayEmoji && (
                    <span className={styles.recordMentionEmoji}>{displayEmoji}</span>
                  )}
                  <span className={styles.recordMentionTitle}>{mention.title}</span>
                </button>
                <span className={styles.recordMentionTooltip}>
                  {tooltipText}
                  <span className={styles.recordMentionTooltipArrow} />
                </span>
              </span>
            );
          }

          case 'model': {
            const key = `model-${mention.id}-${index}`;
            // Extract emoji from start of model name
            const modelEmojiMatch = mention.name.match(/^(\p{Emoji_Presentation}|\p{Emoji}\uFE0F?)\s*/u);
            const modelEmoji = modelEmojiMatch ? modelEmojiMatch[0].trim() : null;
            const cleanName = modelEmojiMatch 
              ? mention.name.slice(modelEmojiMatch[0].length) 
              : mention.name;
            
            return (
              <span key={key} className={styles.modelMentionWrapper}>
                <button
                  type="button"
                  className={styles.modelMention}
                  onClick={(e) => {
                    e.preventDefault();
                    e.stopPropagation();
                    onNavigateToModel(mention.id, mention.isBlockModel);
                  }}
                >
                  {modelEmoji ? (
                    <span className={styles.modelMentionEmoji}>{modelEmoji}</span>
                  ) : (
                    <svg className={styles.modelMentionIcon} viewBox="0 0 16 16" fill="currentColor">
                      <title>Model</title>
                      <path d="M1 2.5A1.5 1.5 0 0 1 2.5 1h3A1.5 1.5 0 0 1 7 2.5v3A1.5 1.5 0 0 1 5.5 7h-3A1.5 1.5 0 0 1 1 5.5v-3zm8 0A1.5 1.5 0 0 1 10.5 1h3A1.5 1.5 0 0 1 15 2.5v3A1.5 1.5 0 0 1 13.5 7h-3A1.5 1.5 0 0 1 9 5.5v-3zm-8 8A1.5 1.5 0 0 1 2.5 9h3A1.5 1.5 0 0 1 7 10.5v3A1.5 1.5 0 0 1 5.5 15h-3A1.5 1.5 0 0 1 1 13.5v-3zm8 0A1.5 1.5 0 0 1 10.5 9h3a1.5 1.5 0 0 1 1.5 1.5v3a1.5 1.5 0 0 1-1.5 1.5h-3A1.5 1.5 0 0 1 9 13.5v-3z"/>
                    </svg>
                  )}
                  {cleanName}
                </button>
                <span className={styles.modelMentionTooltip}>
                  {mention.isBlockModel ? 'Block' : 'Model'}: {mention.apiKey}
                  <span className={styles.modelMentionTooltipArrow} />
                </span>
              </span>
            );
          }

          default:
            return null;
        }
      })}
    </>
  );
};

// Helper to check if content is empty
function isContentEmpty(content: CommentSegment[]): boolean {
  if (content.length === 0) return true;
  return content.every(
    (seg) => seg.type === 'text' && seg.content.trim() === ''
  );
}

// Helper to initialize mentions map from existing segments
function initMentionsMapFromSegments(segments: CommentSegment[]): Map<MentionMapKey, Mention> {
  const map = new Map<MentionMapKey, Mention>();
  for (const segment of segments) {
    if (segment.type === 'mention') {
      const key = createMentionKey(segment.mention);
      map.set(key, segment.mention);
    }
  }
  return map;
}

const Comment = ({
  deleteComment,
  editComment,
  upvoteComment,
  replyComment,
  commentObject,
  currentUserEmail,
  isReply = false,
  modelFields,
  projectUsers,
  projectModels,
  onScrollToField,
  onNavigateToUsers,
  onNavigateToModel,
  onOpenAsset,
  onOpenRecord,
  ctx,
}: CommentProps) => {
  // Handle both old format (string) and new format ({ name, email })
  const userUpvotedThisComment = commentObject.usersWhoUpvoted.some(u => 
    typeof u === 'string' ? u === currentUserEmail : u.email === currentUserEmail
  );
  const textareaRef = useRef<HTMLTextAreaElement>(null);
  
  // Check if this is a new comment (empty content)
  const isNewComment = isContentEmpty(commentObject.content);
  const [isEditing, setIsEditing] = useState(isNewComment);
  const [repliesExpanded, setRepliesExpanded] = useState(false);
  const isTopLevel = "replies" in commentObject;
  const userIsAuthor = commentObject.author.email === currentUserEmail;
  
  const replies = isTopLevel ? commentObject.replies ?? [] : [];
  const replyCount = replies.length;
  const hasNewReply = replies.some(r => isContentEmpty(r.content));
  
  const avatarSize = isReply ? 24 : 32;
  const avatarUrl = getGravatarUrl(commentObject.author.email || '', avatarSize * 2);

  // Get upvoter names for tooltip
  const getUpvoterNames = () => {
    return commentObject.usersWhoUpvoted.map(u => {
      if (typeof u === 'object' && u.name) {
        return u.name;
      }
      const email = typeof u === 'string' ? u : u.email || '';
      const namePart = email.split('@')[0];
      return namePart
        .replace(/[._]/g, ' ')
        .replace(/\b\w/g, c => c.toUpperCase());
    }).join(', ');
  };

  // Initialize editable text and mentions map from current content
  const initialEditState = segmentsToEditableText(commentObject.content);
  const [textAreaValue, setTextAreaValue] = useState(initialEditState.editableText);
  const [mentionsMap, setMentionsMap] = useState<Map<MentionMapKey, Mention>>(
    () => initMentionsMapFromSegments(commentObject.content)
  );

  // Unified mentions hook
  const {
    activeDropdown,
    filteredUsers,
    filteredFields,
    filteredModels,
    selectedIndex,
    handleKeyDown: handleMentionKeyDown,
    handleChange: handleMentionChange,
    handleSelectUser,
    handleSelectField,
    handleSelectModel,
    closeDropdown,
    setCursorPosition,
  } = useMentions({
    users: projectUsers,
    fields: modelFields,
    models: projectModels,
    value: textAreaValue,
    onChange: setTextAreaValue,
    mentionsMap,
    onMentionsMapChange: setMentionsMap,
  });

  // Auto-expand when a new reply is being composed
  useEffect(() => {
    if (hasNewReply && !repliesExpanded) {
      setRepliesExpanded(true);
    }
  }, [hasNewReply, repliesExpanded]);

  // Sync local state when props change (from realtime updates)
  useEffect(() => {
    if (!isEditing) {
      const { editableText, mentionsMap: newMentionsMap } = segmentsToEditableText(commentObject.content);
      setTextAreaValue(editableText);
      setMentionsMap(newMentionsMap);
    }
  }, [commentObject.content, isEditing]);

  // Auto-focus textarea when editing
  useEffect(() => {
    if (isEditing && textareaRef.current) {
      textareaRef.current.focus();
      textareaRef.current.setSelectionRange(
        textareaRef.current.value.length,
        textareaRef.current.value.length
      );
    }
  }, [isEditing]);

  const handleSave = () => {
    if (!textAreaValue.trim()) {
      // If empty, delete the comment
      if (isTopLevel) {
        deleteComment(commentObject.dateISO);
      } else {
        deleteComment(commentObject.dateISO, commentObject.parentCommentISO);
      }
      return;
    }

    // Convert editable text back to segments
    const newContent = editableTextToSegments(textAreaValue, mentionsMap);
    
    setIsEditing(false);
    if (isTopLevel) {
      editComment(commentObject.dateISO, newContent);
    } else {
      editComment(commentObject.dateISO, newContent, commentObject.parentCommentISO);
    }
  };

  const handleDelete = () => {
    if (isTopLevel) {
      deleteComment(commentObject.dateISO);
    } else {
      deleteComment(commentObject.dateISO, commentObject.parentCommentISO);
    }
  };

  const handleUpvote = () => {
    if (isTopLevel) {
      upvoteComment(commentObject.dateISO, userUpvotedThisComment);
    } else {
      upvoteComment(commentObject.dateISO, userUpvotedThisComment, commentObject.parentCommentISO);
    }
  };

  const handleReply = () => {
    setRepliesExpanded(true);
    replyComment(commentObject.dateISO);
  };

  const handleKeyDown = (event: React.KeyboardEvent<HTMLTextAreaElement>) => {
    // Let mention system handle keys first if a dropdown is open
    if (activeDropdown) {
      const handled = handleMentionKeyDown(event);
      if (handled) return;
    }

    if (event.key === "Enter" && !event.shiftKey) {
      event.preventDefault();
      handleSave();
    }
    if (event.key === "Escape") {
      if (isNewComment) {
        // New comment, delete it
        handleDelete();
      } else {
        // Existing comment, cancel edit
        const { editableText, mentionsMap: originalMap } = segmentsToEditableText(commentObject.content);
        setTextAreaValue(editableText);
        setMentionsMap(originalMap);
        setIsEditing(false);
      }
    }
  };

  const handleBlur = () => {
    // Small delay to allow button clicks to register
    setTimeout(() => {
      if (!textAreaValue.trim() && isNewComment) {
        handleDelete();
      }
    }, 150);
  };

  const toggleReplies = () => {
    setRepliesExpanded(!repliesExpanded);
  };

  const handleStartEditing = () => {
    // Re-initialize from current content when starting to edit
    const { editableText, mentionsMap: newMentionsMap } = segmentsToEditableText(commentObject.content);
    setTextAreaValue(editableText);
    setMentionsMap(newMentionsMap);
    setIsEditing(true);
  };

  return (
    <div className={`${styles.comment} ${isReply ? styles.reply : ''}`}>
      {/* Hover Actions - absolute positioned at top-right of .comment */}
      {!isEditing && (
        <div className={styles.actionsWrapper}>
          <div className={styles.actionsTrigger}>
            <svg width="16" height="16" viewBox="0 0 16 16" fill="currentColor" role="img" aria-labelledby="moreActionsTitle">
              <title id="moreActionsTitle">More actions</title>
              <path d="M9.5 13a1.5 1.5 0 1 1-3 0 1.5 1.5 0 0 1 3 0zm0-5a1.5 1.5 0 1 1-3 0 1.5 1.5 0 0 1 3 0zm0-5a1.5 1.5 0 1 1-3 0 1.5 1.5 0 0 1 3 0z"/>
            </svg>
          </div>
          <div className={styles.actions}>
            {commentObject.usersWhoUpvoted.length === 0 && (
              <button
                type="button"
                className={`${styles.actionBtn} ${userUpvotedThisComment ? styles.actionBtnActive : ''}`}
                onClick={handleUpvote}
                title="Upvote"
              >
                <svg width="16" height="16" viewBox="0 0 24 24" fill="currentColor" role="img" aria-labelledby="upvoteBtnTitle">
                  <title id="upvoteBtnTitle">Upvote</title>
                  <path d="M2 20h2c.55 0 1-.45 1-1v-9c0-.55-.45-1-1-1H2v11zm19.83-7.12c.11-.25.17-.52.17-.8V11c0-1.1-.9-2-2-2h-5.5l.92-4.65c.05-.22.02-.46-.08-.66-.23-.45-.52-.86-.88-1.22L14 2 7.59 8.41C7.21 8.79 7 9.3 7 9.83v7.84C7 18.95 8.05 20 9.34 20h8.11c.7 0 1.36-.37 1.72-.97l2.66-6.15z"/>
                </svg>
              </button>
            )}
            
            {isTopLevel && (
              <button
                type="button"
                className={styles.actionBtn}
                onClick={handleReply}
                title="Reply"
              >
                <svg width="20" height="20" viewBox="0 0 16 16" fill="currentColor" role="img" aria-labelledby="replyBtnTitle">
                  <title id="replyBtnTitle">Reply</title>
                  <path d="M6.598 5.013a.144.144 0 0 1 .202.134V6.3a.5.5 0 0 0 .5.5c.667 0 2.013.005 3.3.822.984.624 1.99 1.76 2.595 3.876-1.02-.983-2.185-1.516-3.205-1.799a8.74 8.74 0 0 0-1.921-.306 7.404 7.404 0 0 0-.798.008h-.013l-.005.001h-.001L7.3 9.9l-.05-.498a.5.5 0 0 0-.45.498v1.153c0 .108-.11.176-.202.134L3.614 8.146a.145.145 0 0 1 0-.292l2.984-2.841z"/>
                </svg>
              </button>
            )}

            {userIsAuthor && (
              <>
                <button
                  type="button"
                  className={styles.actionBtn}
                  onClick={handleStartEditing}
                  title="Edit"
                >
                  <svg width="14" height="14" viewBox="0 0 16 16" fill="currentColor" role="img" aria-labelledby="editBtnTitle">
                    <title id="editBtnTitle">Edit</title>
                    <path d="M12.854.146a.5.5 0 0 0-.707 0L10.5 1.793 14.207 5.5l1.647-1.646a.5.5 0 0 0 0-.708l-3-3zm.646 6.061L9.793 2.5 3.293 9H3.5a.5.5 0 0 1 .5.5v.5h.5a.5.5 0 0 1 .5.5v.5h.5a.5.5 0 0 1 .5.5v.5h.5a.5.5 0 0 1 .5.5v.207l6.5-6.5zm-7.468 7.468A.5.5 0 0 1 6 13.5V13h-.5a.5.5 0 0 1-.5-.5V12h-.5a.5.5 0 0 1-.5-.5V11h-.5a.5.5 0 0 1-.5-.5V10h-.5a.499.499 0 0 1-.175-.032l-.179.178a.5.5 0 0 0-.11.168l-2 5a.5.5 0 0 0 .65.65l5-2a.5.5 0 0 0 .168-.11l.178-.178z"/>
                  </svg>
                </button>
                <button
                  type="button"
                  className={`${styles.actionBtn} ${styles.actionBtnDanger}`}
                  onClick={handleDelete}
                  title="Delete"
                >
                  <svg width="14" height="14" viewBox="0 0 16 16" fill="currentColor" role="img" aria-labelledby="deleteBtnTitle">
                    <title id="deleteBtnTitle">Delete</title>
                    <path d="M2.5 1a1 1 0 0 0-1 1v1a1 1 0 0 0 1 1H3v9a2 2 0 0 0 2 2h6a2 2 0 0 0 2-2V4h.5a1 1 0 0 0 1-1V2a1 1 0 0 0-1-1H10a1 1 0 0 0-1-1H7a1 1 0 0 0-1 1H2.5zm3 4a.5.5 0 0 1 .5.5v7a.5.5 0 0 1-1 0v-7a.5.5 0 0 1 .5-.5zM8 5a.5.5 0 0 1 .5.5v7a.5.5 0 0 1-1 0v-7A.5.5 0 0 1 8 5zm3 .5v7a.5.5 0 0 1-1 0v-7a.5.5 0 0 1 1 0z"/>
                  </svg>
                </button>
              </>
            )}
          </div>
        </div>
      )}

      {/* Comment body - hoverable area */}
      <div className={styles.commentBody} style={{ gridTemplateColumns: `${avatarSize}px 1fr` }}>
        <div className={styles.avatarContainer}>
          <img
            className={styles.avatar}
            src={avatarUrl}
            alt={commentObject.author.name}
            style={{ width: avatarSize, height: avatarSize }}
          />
        </div>

        <div className={styles.content}>
          <div className={styles.header}>
            <span className={styles.authorName}>{commentObject.author.name}</span>
            <span className={styles.timestamp}>
              <ReactTimeAgo date={new Date(commentObject.dateISO)} />
            </span>
          </div>

          {isEditing ? (
            <div className={styles.editContainer}>
              <Textarea
                ref={textareaRef}
                className={styles.textarea}
                value={textAreaValue}
                onChange={handleMentionChange}
                onKeyDown={handleKeyDown}
                onBlur={handleBlur}
                onClick={(e) => setCursorPosition(e.currentTarget.selectionStart)}
                onSelect={(e) => setCursorPosition(e.currentTarget.selectionStart)}
                placeholder="Write a comment..."
                minRows={1}
              />
              {activeDropdown === 'field' && (
                <FieldMentionDropdown
                  fields={filteredFields}
                  query=""
                  selectedIndex={selectedIndex}
                  onSelect={handleSelectField}
                  onClose={closeDropdown}
                  ctx={ctx}
                />
              )}
              {activeDropdown === 'user' && (
                <UserMentionDropdown
                  users={filteredUsers}
                  query=""
                  selectedIndex={selectedIndex}
                  onSelect={handleSelectUser}
                  onClose={closeDropdown}
                />
              )}
              {activeDropdown === 'model' && (
                <ModelMentionDropdown
                  models={filteredModels}
                  query=""
                  selectedIndex={selectedIndex}
                  onSelect={handleSelectModel}
                  onClose={closeDropdown}
                />
              )}
              <span className={styles.editHint}>
                Press Enter to save · Esc to cancel · # field · @ user · $ model
              </span>
            </div>
          ) : (
            <div className={styles.text}>
              <CommentContentRenderer
                segments={commentObject.content}
                onScrollToField={onScrollToField}
                onNavigateToUsers={onNavigateToUsers}
                onNavigateToModel={onNavigateToModel}
                onOpenAsset={onOpenAsset}
                onOpenRecord={onOpenRecord}
              />
            </div>
          )}

          <div className={styles.footer}>
            {/* Reactions / Upvotes */}
            {commentObject.usersWhoUpvoted.length > 0 && !isEditing && (
              <div className={styles.reactionWrapper}>
                <button
                  type="button"
                  className={`${styles.reaction} ${userUpvotedThisComment ? styles.reactionActive : ''}`}
                  onClick={handleUpvote}
                >
                  <svg width="16" height="16" viewBox="0 0 24 24" fill="currentColor" role="img" aria-labelledby="upvoteIconTitle">
                    <title id="upvoteIconTitle">Upvote</title>
                    <path d="M2 20h2c.55 0 1-.45 1-1v-9c0-.55-.45-1-1-1H2v11zm19.83-7.12c.11-.25.17-.52.17-.8V11c0-1.1-.9-2-2-2h-5.5l.92-4.65c.05-.22.02-.46-.08-.66-.23-.45-.52-.86-.88-1.22L14 2 7.59 8.41C7.21 8.79 7 9.3 7 9.83v7.84C7 18.95 8.05 20 9.34 20h8.11c.7 0 1.36-.37 1.72-.97l2.66-6.15z"/>
                  </svg>
                  <span>{commentObject.usersWhoUpvoted.length}</span>
                </button>
                <div className={styles.tooltip}>
                  {getUpvoterNames()}
                  <div className={styles.tooltipArrow} />
                </div>
              </div>
            )}

            {/* Reply count toggle - only for top-level comments with replies */}
            {isTopLevel && replyCount > 0 && !isEditing && (
              <button
                type="button"
                className={styles.replyToggle}
                onClick={toggleReplies}
              >
                {/* Stacked avatars of repliers */}
                <div className={styles.replyAvatars}>
                  {replies.slice(0, 3).map((reply, index) => (
                    <img
                      key={reply.dateISO}
                      src={getGravatarUrl(reply.author.email || '', 40)}
                      alt={reply.author.name}
                      className={styles.replyAvatar}
                      style={{ zIndex: 3 - index }}
                    />
                  ))}
                </div>
                <div className={styles.replyMeta}>
                  <span className={styles.replyText}>
                    {replyCount} {replyCount === 1 ? 'reply' : 'replies'}
                  </span>
                </div>
                <svg 
                  width="10" 
                  height="10" 
                  viewBox="0 0 16 16" 
                  fill="currentColor"
                  className={`${styles.chevron} ${repliesExpanded ? styles.chevronExpanded : ''}`}
                  role="img"
                  aria-labelledby="chevronTitle"
                >
                  <title id="chevronTitle">{repliesExpanded ? 'Collapse' : 'Expand'}</title>
                  <path d="M4.646 4.646a.5.5 0 0 1 .708 0L8 7.293l2.646-2.647a.5.5 0 0 1 .708.708l-3 3a.5.5 0 0 1-.708 0l-3-3a.5.5 0 0 1 0-.708z"/>
                </svg>
              </button>
            )}
          </div>
        </div>
      </div>

      {/* Collapsible Replies */}
      {isTopLevel && replyCount > 0 && repliesExpanded && (
        <div className={styles.replies}>
          {replies.map((reply) => (
            <Comment
              key={reply.dateISO}
              deleteComment={deleteComment}
              editComment={editComment}
              upvoteComment={upvoteComment}
              replyComment={replyComment}
              commentObject={reply}
              currentUserEmail={currentUserEmail}
              isReply
              modelFields={modelFields}
              projectUsers={projectUsers}
              projectModels={projectModels}
              onScrollToField={onScrollToField}
              onNavigateToUsers={onNavigateToUsers}
              onNavigateToModel={onNavigateToModel}
              onOpenAsset={onOpenAsset}
              onOpenRecord={onOpenRecord}
              ctx={ctx}
            />
          ))}
        </div>
      )}
    </div>
  );
};

export default Comment;
