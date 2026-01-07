import type { JSONContent } from '@tiptap/react';
import type { CommentSegment, Mention, MentionType } from '@ctypes/mentions';
import { attrsToMention } from './attrsToMention';

// Converts between CommentSegment[] (storage) and TipTap JSONContent (editor)

const MENTION_NODE_TYPES = {
  user: 'userMention',
  field: 'fieldMention',
  asset: 'assetMention',
  record: 'recordMention',
  model: 'modelMention',
} as const;

type NodeTypeValue = (typeof MENTION_NODE_TYPES)[keyof typeof MENTION_NODE_TYPES];

const NODE_TYPE_TO_MENTION_TYPE: Record<NodeTypeValue, MentionType> = {
  userMention: 'user',
  fieldMention: 'field',
  assetMention: 'asset',
  recordMention: 'record',
  modelMention: 'model',
};

function mentionToAttrs(mention: Mention): Record<string, unknown> {
  return { ...mention };
}

function nodeAttrsToMention(
  nodeType: string,
  attrs: Record<string, unknown>
): Mention | null {
  const mentionType = NODE_TYPE_TO_MENTION_TYPE[nodeType as NodeTypeValue];
  if (!mentionType) return null;
  return attrsToMention(mentionType, attrs);
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
      const mention = nodeAttrsToMention(mentionNodeType, node.attrs ?? {});
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
