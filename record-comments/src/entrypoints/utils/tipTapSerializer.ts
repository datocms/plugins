import type { JSONContent } from '@tiptap/react';
import type { CommentSegment, Mention } from '@ctypes/mentions';
import {
  isValidUserMentionAttrs,
  isValidFieldMentionAttrs,
  isValidAssetMentionAttrs,
  isValidRecordMentionAttrs,
  isValidModelMentionAttrs,
} from './typeGuards';
import {
  applyFieldMentionDefaults,
  applyModelMentionDefaults,
} from './tiptapDefaults';

// Converts between CommentSegment[] (storage) and TipTap JSONContent (editor)

const MENTION_NODE_TYPES = {
  user: 'userMention',
  field: 'fieldMention',
  asset: 'assetMention',
  record: 'recordMention',
  model: 'modelMention',
} as const;

function mentionToAttrs(mention: Mention): Record<string, unknown> {
  return { ...mention };
}

function attrsToMention(nodeType: string, attrs: Record<string, unknown>): Mention | null {
  switch (nodeType) {
    case MENTION_NODE_TYPES.user:
      if (!isValidUserMentionAttrs(attrs)) return null;
      return {
        type: 'user',
        id: attrs.id,
        name: attrs.name,
        email: attrs.email,
        avatarUrl: attrs.avatarUrl,
      };

    case MENTION_NODE_TYPES.field:
      if (!isValidFieldMentionAttrs(attrs)) return null;
      return {
        type: 'field',
        apiKey: attrs.apiKey,
        label: attrs.label,
        localized: applyFieldMentionDefaults.localized(attrs.localized),
        fieldPath: attrs.fieldPath,
        locale: attrs.locale ?? undefined,
        fieldType: attrs.fieldType ?? undefined,
      };

    case MENTION_NODE_TYPES.asset:
      if (!isValidAssetMentionAttrs(attrs)) return null;
      return {
        type: 'asset',
        id: attrs.id,
        filename: attrs.filename,
        url: attrs.url,
        thumbnailUrl: attrs.thumbnailUrl,
        mimeType: attrs.mimeType,
      };

    case MENTION_NODE_TYPES.record:
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

    case MENTION_NODE_TYPES.model:
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

export function segmentsToTipTapDoc(segments: CommentSegment[]): JSONContent {
  if (segments.length === 0) {
    return {
      type: 'doc',
      content: [{ type: 'paragraph' }],
    };
  }

  const content: JSONContent[] = [];

  for (const segment of segments) {
    if (segment.type === 'text') {
      const lines = segment.content.split('\n');

      for (let i = 0; i < lines.length; i++) {
        const line = lines[i];
        if (line) {
          content.push({ type: 'text', text: line });
        }
        if (i < lines.length - 1) {
          content.push({ type: 'hardBreak' });
        }
      }
    } else {
      const { mention } = segment;
      const nodeType = MENTION_NODE_TYPES[mention.type];
      content.push({
        type: nodeType,
        attrs: mentionToAttrs(mention),
      });
    }
  }

  return {
    type: 'doc',
    content: [
      {
        type: 'paragraph',
        content: content.length > 0 ? content : undefined,
      },
    ],
  };
}

export function tipTapDocToSegments(doc: JSONContent): CommentSegment[] {
  const segments: CommentSegment[] = [];
  let currentText = '';

  const flushText = () => {
    if (currentText) {
      segments.push({ type: 'text', content: currentText });
      currentText = '';
    }
  };

  const processNode = (node: JSONContent) => {
    if (!node) return;

    if (node.type === 'text' && node.text) {
      currentText += node.text;
      return;
    }

    if (node.type === 'hardBreak') {
      currentText += '\n';
      return;
    }

    const mentionNodeType = node.type
      ? Object.values(MENTION_NODE_TYPES).find((t) => t === node.type)
      : undefined;

    if (mentionNodeType) {
      flushText();
      const mention = attrsToMention(mentionNodeType, node.attrs ?? {});
      if (mention) {
        segments.push({ type: 'mention', mention });
      }
      return;
    }

    // Paragraphs add newline BEFORE content (except first paragraph).
    // Leading empty paragraphs are stripped in cleanup step below.
    if (node.type === 'paragraph') {
      if (segments.length > 0 || currentText) {
        currentText += '\n';
      }
      if (node.content) {
        for (const child of node.content) {
          processNode(child);
        }
      }
      return;
    }

    if (node.content) {
      for (const child of node.content) {
        processNode(child);
      }
    }
  };

  if (doc.content) {
    for (let i = 0; i < doc.content.length; i++) {
      processNode(doc.content[i]);
    }
  }

  flushText();

  // Strip leading whitespace-only text segments
  while (segments.length > 0) {
    const first = segments[0];
    if (first.type === 'text') {
      first.content = first.content.replace(/^[\s\n\r]+/, '');
      if (!first.content) {
        segments.shift();
        continue;
      }
    }
    break;
  }

  return segments;
}

export function createEmptyDoc(): JSONContent {
  return {
    type: 'doc',
    content: [{ type: 'paragraph' }],
  };
}

export function isDocEmpty(doc: JSONContent): boolean {
  const segments = tipTapDocToSegments(doc);
  if (segments.length === 0) return true;
  if (segments.length === 1 && segments[0].type === 'text') {
    return !segments[0].content.trim();
  }
  return false;
}

export { MENTION_NODE_TYPES };
