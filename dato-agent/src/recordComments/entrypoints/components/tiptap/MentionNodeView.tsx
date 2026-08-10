import type { MentionType } from '@ctypes/mentions';
import type { ReactNodeViewProps } from '@tiptap/react';
import { NodeViewWrapper } from '@tiptap/react';
import { attrsToMention } from '@utils/attrsToMention';
import { useProjectDataContext } from '@/entrypoints/contexts/ProjectDataContext';
import { cn } from '@/utils/cn';
import { CloseIcon } from '../Icons';
import { MentionChip } from '../MentionChip';
import { useMentionClick } from './MentionClickContext';
import styles from './TipTapComposer.module.css';

type MentionNodeViewProps = ReactNodeViewProps;

function InvalidMentionFallback() {
  return (
    <span
      style={{
        color: 'var(--color--ink-subtle)',
        fontStyle: 'italic',
        fontSize: 'inherit',
      }}
    >
      [invalid mention]
    </span>
  );
}

function createMentionNodeView(
  mentionType: MentionType,
  needsProjectUsers = false,
) {
  return function MentionNodeView({
    deleteNode,
    editor,
    node,
  }: MentionNodeViewProps) {
    const { onMentionClick } = useMentionClick();
    const { currentRecordId, projectUsers } = useProjectDataContext();
    const mention = attrsToMention(
      mentionType,
      node.attrs as Record<string, unknown>,
    );
    const isLocalFile = mention?.type === 'file';
    const hasImagePreview =
      isLocalFile && mention.mimeType.startsWith('image/');

    return (
      <NodeViewWrapper
        as="span"
        className={cn(
          isLocalFile && styles.fileMentionNode,
          hasImagePreview && styles.fileMentionNodePreview,
        )}
        contentEditable={false}
      >
        {mention ? (
          <MentionChip
            mention={mention}
            onClick={onMentionClick}
            isInComposer
            currentRecordId={currentRecordId}
            {...(needsProjectUsers && { projectUsers })}
          />
        ) : (
          <InvalidMentionFallback />
        )}
        {isLocalFile && (
          <button
            aria-label={`Remove ${mention.filename}`}
            className={styles.fileMentionRemove}
            onClick={(event) => {
              event.preventDefault();
              event.stopPropagation();
              if (editor.isEditable) deleteNode();
            }}
            onMouseDown={(event) => {
              event.preventDefault();
              event.stopPropagation();
            }}
            type="button"
          >
            <CloseIcon />
          </button>
        )}
      </NodeViewWrapper>
    );
  };
}

export const UserMentionNodeView = createMentionNodeView('user', true);
export const FieldMentionNodeView = createMentionNodeView('field');
export const AssetMentionNodeView = createMentionNodeView('asset');
export const FileMentionNodeView = createMentionNodeView('file');
export const RecordMentionNodeView = createMentionNodeView('record');
export const ModelMentionNodeView = createMentionNodeView('model');
