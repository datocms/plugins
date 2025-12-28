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

/**
 * TipTap Serializer
 *
 * Converts between CommentSegment[] (storage format) and TipTap JSONContent (editor format).
 * This allows us to maintain backwards compatibility with existing comments while using
 * TipTap's rich editor internally.
 */

// Mention node type names in TipTap
const MENTION_NODE_TYPES = {
  user: 'userMention',
  field: 'fieldMention',
  asset: 'assetMention',
  record: 'recordMention',
  model: 'modelMention',
} as const;

/**
 * Converts a Mention object to TipTap node attributes.
 * All mention data is stored as node attributes so it can be serialized/deserialized.
 */
function mentionToAttrs(mention: Mention): Record<string, unknown> {
  // Store the full mention object as attrs
  // TipTap will handle serializing this to JSON
  return { ...mention };
}

/**
 * Converts TipTap node attributes back to a Mention object.
 * Returns null if attributes are invalid or missing required fields.
 */
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
        // Use centralized defaults (see tiptapDefaults.ts for rationale)
        localized: applyFieldMentionDefaults.localized(attrs.localized),
        fieldPath: attrs.fieldPath,
        // Convert null to undefined (TipTap stores default as null, but our type uses undefined)
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
        // Use centralized defaults (see tiptapDefaults.ts for rationale)
        isBlockModel: applyModelMentionDefaults.isBlockModel(attrs.isBlockModel),
      };

    default:
      return null;
  }
}

/**
 * Converts CommentSegment[] to TipTap JSONContent.
 * Used when loading comments into the editor.
 */
export function segmentsToTipTapDoc(segments: CommentSegment[]): JSONContent {
  if (segments.length === 0) {
    // Empty document with just a paragraph
    return {
      type: 'doc',
      content: [{ type: 'paragraph' }],
    };
  }

  const content: JSONContent[] = [];

  for (const segment of segments) {
    if (segment.type === 'text') {
      // Split text by newlines to create proper paragraph structure
      const lines = segment.content.split('\n');

      for (let i = 0; i < lines.length; i++) {
        const line = lines[i];
        if (line) {
          content.push({ type: 'text', text: line });
        }
        // Add hard break between lines (but not after the last line)
        if (i < lines.length - 1) {
          content.push({ type: 'hardBreak' });
        }
      }
    } else {
      // Mention segment
      const { mention } = segment;
      const nodeType = MENTION_NODE_TYPES[mention.type];
      content.push({
        type: nodeType,
        attrs: mentionToAttrs(mention),
      });
    }
  }

  // Wrap content in a paragraph
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

/**
 * Converts TipTap JSONContent to CommentSegment[].
 * Used when saving comments from the editor.
 */
export function tipTapDocToSegments(doc: JSONContent): CommentSegment[] {
  const segments: CommentSegment[] = [];
  let currentText = '';

  // Helper to flush accumulated text as a segment
  const flushText = () => {
    if (currentText) {
      segments.push({ type: 'text', content: currentText });
      currentText = '';
    }
  };

  // Process nodes recursively
  const processNode = (node: JSONContent) => {
    if (!node) return;

    // Handle text nodes
    if (node.type === 'text' && node.text) {
      currentText += node.text;
      return;
    }

    // Handle hard breaks as newlines
    if (node.type === 'hardBreak') {
      currentText += '\n';
      return;
    }

    // Handle mention nodes
    // Use .find() to properly narrow the type instead of .includes() with a type assertion.
    // This ensures we have a valid mention node type before calling attrsToMention.
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

    /**
     * PARAGRAPH NEWLINE HANDLING:
     * ---------------------------
     * Paragraphs add a newline BEFORE their content, but only if there's
     * already content accumulated. This produces the expected behavior:
     *
     * - First paragraph: No leading newline (condition is false)
     * - Subsequent paragraphs: Newline before content (condition is true)
     * - Empty paragraphs after content: Add a newline (blank line effect)
     * - Empty paragraphs at start: No newlines (stripped by cleanup below)
     *
     * Edge cases handled:
     * - "hello" + empty para + "world" → "hello\n\nworld" (blank line preserved)
     * - empty para + empty para + "text" → "text" (leading stripped)
     *
     * The cleanup step (lines ~252-264) strips leading whitespace-only text
     * to handle cases where TipTap produces leading empty paragraphs. This
     * is intentional - leading blank lines in comments are typically accidental.
     *
     * DO NOT modify this logic without testing the full matrix of paragraph
     * combinations. The current behavior matches user expectations for a
     * comment composer.
     */
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

    // Recursively process children for doc or other container nodes
    if (node.content) {
      for (const child of node.content) {
        processNode(child);
      }
    }
  };

  // Start processing from doc
  if (doc.content) {
    for (let i = 0; i < doc.content.length; i++) {
      const node = doc.content[i];
      // Reset text accumulator between top-level nodes
      if (i > 0 && node.type === 'paragraph') {
        // Paragraphs after the first add a newline
        // (handled in processNode)
      }
      processNode(node);
    }
  }

  // Flush any remaining text
  flushText();

  // Clean up: remove leading whitespace-only text segments before mentions
  while (segments.length > 0) {
    const first = segments[0];
    if (first.type === 'text') {
      // Strip ALL leading whitespace (including multiple newlines, spaces, tabs)
      first.content = first.content.replace(/^[\s\n\r]+/, '');
      // If segment is now empty, remove it entirely
      if (!first.content) {
        segments.shift();
        continue;
      }
    }
    break;
  }

  return segments;
}

/**
 * Creates an empty TipTap document.
 */
export function createEmptyDoc(): JSONContent {
  return {
    type: 'doc',
    content: [{ type: 'paragraph' }],
  };
}

/**
 * Checks if a TipTap document is empty (no content or only whitespace).
 */
export function isDocEmpty(doc: JSONContent): boolean {
  const segments = tipTapDocToSegments(doc);
  if (segments.length === 0) return true;
  if (segments.length === 1 && segments[0].type === 'text') {
    return !segments[0].content.trim();
  }
  return false;
}

// Export node type names for use in extensions
export { MENTION_NODE_TYPES };
