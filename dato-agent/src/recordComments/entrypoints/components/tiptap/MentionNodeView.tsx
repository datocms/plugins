import type { MentionType } from '@ctypes/mentions';
import type { ReactNodeViewProps } from '@tiptap/react';
import { NodeViewWrapper } from '@tiptap/react';
import { attrsToMention } from '@utils/attrsToMention';
import Button from 'datocms-react-ui/Button';
import { useProjectDataContext } from '@/entrypoints/contexts/ProjectDataContext';
import { CloseIcon } from '../../../../icons';
import { MentionChip } from '../MentionChip';
import styles from '../shared/MentionDisplay.module.css';
import { useMentionClick } from './MentionClickContext';

type MentionNodeViewProps = ReactNodeViewProps;

function stopEditorEvent(event: React.MouseEvent) {
  event.preventDefault();
  event.stopPropagation();
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
    const { onMentionClick, editable = editor.isEditable } = useMentionClick();
    const { currentRecordId, projectUsers } = useProjectDataContext();
    const mention = attrsToMention(
      mentionType,
      node.attrs as Record<string, unknown>,
    );

    return (
      <NodeViewWrapper
        as="span"
        className={styles.node}
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
          <span className={styles.invalid}>[invalid mention]</span>
        )}
        {mention?.type === 'file' && editable && (
          // The cross clears the file from the draft, only while the editor
          // can change it. Mouse down must not move the caret or the
          // selection of the editor.
          <Button
            icon={CloseIcon}
            iconOnly
            label={`Remove ${mention.filename}`}
            onClick={(event) => {
              stopEditorEvent(event);
              if (editor.isEditable) deleteNode();
            }}
            onMouseDown={stopEditorEvent}
            size="micro"
            tone="ghost"
          />
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
