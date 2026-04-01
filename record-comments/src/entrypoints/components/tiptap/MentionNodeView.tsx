import type { MentionType } from '@ctypes/mentions';
import type { ReactNodeViewProps } from '@tiptap/react';
import { NodeViewWrapper } from '@tiptap/react';
import { attrsToMention } from '@utils/attrsToMention';
import { useProjectDataContext } from '@/entrypoints/contexts/ProjectDataContext';
import { MentionChip } from '../MentionChip';
import { useMentionClick } from './MentionClickContext';

type MentionNodeViewProps = ReactNodeViewProps;

function InvalidMentionFallback() {
  return (
    <span style={{ color: '#888', fontStyle: 'italic', fontSize: 'inherit' }}>
      [invalid mention]
    </span>
  );
}

function createMentionNodeView(
  mentionType: MentionType,
  needsProjectUsers = false,
) {
  return function MentionNodeView({ node }: MentionNodeViewProps) {
    const { onMentionClick } = useMentionClick();
    const { projectUsers } = useProjectDataContext();
    const mention = attrsToMention(
      mentionType,
      node.attrs as Record<string, unknown>,
    );

    return (
      <NodeViewWrapper as="span" contentEditable={false}>
        {mention ? (
          <MentionChip
            mention={mention}
            onClick={onMentionClick}
            isInComposer
            {...(needsProjectUsers && { projectUsers })}
          />
        ) : (
          <InvalidMentionFallback />
        )}
      </NodeViewWrapper>
    );
  };
}

export const UserMentionNodeView = createMentionNodeView('user', true);
export const FieldMentionNodeView = createMentionNodeView('field');
export const AssetMentionNodeView = createMentionNodeView('asset');
export const RecordMentionNodeView = createMentionNodeView('record');
export const ModelMentionNodeView = createMentionNodeView('model');
