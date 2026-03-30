import type { JSONContent } from '@tiptap/react';
import type {
  CommentSegment,
  Mention,
  MentionType,
  StoredCommentSegment,
  StoredMention,
} from '@ctypes/mentions';
import { attrsToMention } from './attrsToMention';

// Converts between StoredCommentSegment[] (storage) and TipTap JSONContent (editor)

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

/**
 * Converts a full Mention to a slim StoredMention for persistence.
 * Only stores the minimal data needed to resolve the full mention later.
 */
export function mentionToStoredMention(mention: Mention): StoredMention {
  switch (mention.type) {
    case 'user':
      return { type: 'user', id: mention.id };
    case 'field':
      return {
        type: 'field',
        fieldPath: mention.fieldPath,
        ...(mention.locale && { locale: mention.locale }),
        modelId: '', // Will be set by caller with current record's model ID
      };
    case 'asset':
      return { type: 'asset', id: mention.id };
    case 'record':
      return { type: 'record', id: mention.id, modelId: mention.modelId };
    case 'model':
      return { type: 'model', id: mention.id };
  }
}

/**
 * Converts TipTap node attrs directly to StoredMention for persistence.
 */
function nodeAttrsToStoredMention(
  nodeType: string,
  attrs: Record<string, unknown>
): StoredMention | null {
  const mentionType = NODE_TYPE_TO_MENTION_TYPE[nodeType as NodeTypeValue];
  if (!mentionType) return null;

  // Extract only the fields needed for stored mentions
  switch (mentionType) {
    case 'user':
      if (typeof attrs.id !== 'string') return null;
      return { type: 'user', id: attrs.id };
    case 'field':
      if (typeof attrs.fieldPath !== 'string') return null;
      return {
        type: 'field',
        fieldPath: attrs.fieldPath,
        ...(typeof attrs.locale === 'string' && { locale: attrs.locale }),
        modelId: typeof attrs.modelId === 'string' ? attrs.modelId : '',
      };
    case 'asset':
      if (typeof attrs.id !== 'string') return null;
      return { type: 'asset', id: attrs.id };
    case 'record':
      if (typeof attrs.id !== 'string' || typeof attrs.modelId !== 'string') return null;
      return { type: 'record', id: attrs.id, modelId: attrs.modelId };
    case 'model':
      if (typeof attrs.id !== 'string') return null;
      return { type: 'model', id: attrs.id };
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

type TextSegment = { type: 'text'; content: string };
type MentionSegment<T> = { type: 'mention'; mention: T };
type GenericSegment<T> = TextSegment | MentionSegment<T>;

/**
 * Core TipTap doc to segments conversion logic.
 * Parameterized by mention converter function to avoid code duplication.
 */
function convertTipTapDoc<TMention>(
  doc: JSONContent,
  convertMention: (nodeType: string, attrs: Record<string, unknown>) => TMention | null
): GenericSegment<TMention>[] {
  const segments: GenericSegment<TMention>[] = [];
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
      const mention = convertMention(mentionNodeType, node.attrs ?? {});
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
    for (const child of doc.content) {
      processNode(child);
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

  // Strip trailing whitespace-only text segments
  while (segments.length > 0) {
    const last = segments[segments.length - 1];
    if (last.type === 'text') {
      last.content = last.content.replace(/[\s\n\r]+$/, '');
      if (!last.content) {
        segments.pop();
        continue;
      }
    }
    break;
  }

  return segments;
}

/**
 * Converts TipTap document to StoredCommentSegment[] for persistence.
 * Outputs slim mentions containing only IDs.
 */
export function tipTapDocToSegments(doc: JSONContent): StoredCommentSegment[] {
  return convertTipTapDoc(doc, nodeAttrsToStoredMention);
}

/**
 * Converts TipTap document to full CommentSegment[] for editing.
 * Used when loading comments into the TipTap editor - preserves full mention data.
 */
export function tipTapDocToFullSegments(doc: JSONContent): CommentSegment[] {
  return convertTipTapDoc(doc, nodeAttrsToMention);
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

/**
 * Converts full CommentSegment[] to StoredCommentSegment[] for persistence.
 * Used when saving edited content.
 */
export function segmentsToStoredSegments(segments: CommentSegment[]): StoredCommentSegment[] {
  return segments.map((segment) => {
    if (segment.type === 'text') {
      return segment;
    }
    return {
      type: 'mention',
      mention: mentionToStoredMention(segment.mention),
    };
  });
}

export { MENTION_NODE_TYPES };
