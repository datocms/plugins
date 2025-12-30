import { NodeViewWrapper } from '@tiptap/react';
import type { ReactNodeViewProps } from '@tiptap/react';
import { MentionChip } from '../MentionChip';
import type { Mention } from '@ctypes/mentions';
import { useMentionClick } from './MentionClickContext';
import { useProjectDataContext } from '@/entrypoints/contexts/ProjectDataContext';
import {
  isValidUserMentionAttrs,
  isValidFieldMentionAttrs,
  isValidAssetMentionAttrs,
  isValidRecordMentionAttrs,
  isValidModelMentionAttrs,
} from '@utils/typeGuards';
import {
  applyFieldMentionDefaults,
  applyModelMentionDefaults,
} from '@utils/tiptapDefaults';

type MentionNodeViewProps = ReactNodeViewProps;

function InvalidMentionFallback() {
  return (
    <span style={{ color: '#888', fontStyle: 'italic', fontSize: 'inherit' }}>
      [invalid mention]
    </span>
  );
}

function attrsToMention(attrs: Record<string, unknown>): Mention | null {
  const type = attrs.type;
  if (typeof type !== 'string') {
    console.warn('[MentionNodeView] Invalid mention: type is not a string', { type, attrs });
    return null;
  }

  switch (type) {
    case 'user':
      if (!isValidUserMentionAttrs(attrs)) {
        console.warn('[MentionNodeView] Invalid user mention attrs', attrs);
        return null;
      }
      return {
        type: 'user',
        id: attrs.id,
        name: attrs.name,
        email: attrs.email,
        avatarUrl: attrs.avatarUrl,
      };

    case 'field':
      if (!isValidFieldMentionAttrs(attrs)) {
        console.warn('[MentionNodeView] Invalid field mention attrs', attrs);
        return null;
      }
      return {
        type: 'field',
        apiKey: attrs.apiKey,
        label: attrs.label,
        localized: applyFieldMentionDefaults.localized(attrs.localized),
        fieldPath: attrs.fieldPath,
        locale: attrs.locale ?? undefined,
        fieldType: attrs.fieldType ?? undefined,
      };

    case 'asset':
      if (!isValidAssetMentionAttrs(attrs)) return null;
      return {
        type: 'asset',
        id: attrs.id,
        filename: attrs.filename,
        url: attrs.url,
        thumbnailUrl: attrs.thumbnailUrl,
        mimeType: attrs.mimeType,
      };

    case 'record':
      if (!isValidRecordMentionAttrs(attrs)) return null;
      return {
        type: 'record',
        id: attrs.id,
        title: attrs.title,
        modelId: attrs.modelId,
        modelApiKey: attrs.modelApiKey,
        modelName: attrs.modelName,
        modelEmoji: attrs.modelEmoji,
        thumbnailUrl: attrs.thumbnailUrl,
        isSingleton: attrs.isSingleton,
      };

    case 'model':
      if (!isValidModelMentionAttrs(attrs)) return null;
      return {
        type: 'model',
        id: attrs.id,
        apiKey: attrs.apiKey,
        name: attrs.name,
        isBlockModel: applyModelMentionDefaults.isBlockModel(attrs.isBlockModel),
      };

    default:
      return null;
  }
}

type MentionType = 'user' | 'field' | 'asset' | 'record' | 'model';

function createMentionNodeView(mentionType: MentionType, needsProjectUsers = false) {
  return function MentionNodeView({ node }: MentionNodeViewProps) {
    const { onMentionClick } = useMentionClick();
    const { projectUsers } = useProjectDataContext();
    const mention = attrsToMention({ ...node.attrs, type: mentionType });

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
