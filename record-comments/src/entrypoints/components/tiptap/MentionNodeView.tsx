import type { MentionType } from '@ctypes/mentions';
import type { ReactNodeViewProps } from '@tiptap/react';
import { NodeViewWrapper } from '@tiptap/react';
import { attrsToMention } from '@utils/attrsToMention';
import Pill from 'datocms-react-ui/Pill';
import { useProjectDataContext } from '@/entrypoints/contexts/ProjectDataContext';
import { MentionChip } from '../MentionChip';
import { useMentionClick } from './MentionClickContext';

type MentionNodeViewProps = ReactNodeViewProps;

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
      // The stable attribute lets the editor style a mention of any type
      <NodeViewWrapper
        as="span"
        contentEditable={false}
        data-mention-node={mentionType}
      >
        {mention ? (
          <MentionChip
            mention={mention}
            onClick={onMentionClick}
            {...(needsProjectUsers && { projectUsers })}
          />
        ) : (
          <Pill>Invalid mention</Pill>
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
