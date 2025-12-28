import Mention from '@tiptap/extension-mention';
import { ReactNodeViewRenderer } from '@tiptap/react';
import type { ReactNodeViewProps } from '@tiptap/react';
import type { Mention as MentionType } from '@ctypes/mentions';

/**
 * Type for TipTap NodeView components that render mention chips.
 * Uses ReactNodeViewProps which includes the ref prop expected by ReactNodeViewRenderer.
 */
type MentionNodeViewComponent = React.ComponentType<ReactNodeViewProps>;

/**
 * Configuration for creating a mention extension.
 */
export type MentionExtensionConfig = {
  /** Unique name for this mention type (e.g., 'userMention', 'fieldMention') */
  name: string;
  /** Trigger character (e.g., '@', '#', '$', '^', '&') */
  trigger: string;
  /** The mention type (e.g., 'user', 'field', 'model', 'asset', 'record') */
  mentionType: MentionType['type'];
  /** Node view component for rendering the mention chip */
  nodeViewComponent: MentionNodeViewComponent;
  /** Additional attributes to store (derived from Mention type) */
  extraAttrs?: Record<string, { default?: unknown }>;
};

/**
 * Base attributes that all mention types share.
 */
const BASE_ATTRS = {
  type: { default: null },
} as const;

/**
 * Attributes specific to each mention type.
 */
const MENTION_TYPE_ATTRS: Record<MentionType['type'], Record<string, { default?: unknown }>> = {
  user: {
    id: { default: null },
    name: { default: null },
    email: { default: null },
    avatarUrl: { default: null },
  },
  field: {
    apiKey: { default: null },
    label: { default: null },
    localized: { default: false },
    fieldPath: { default: null },
    locale: { default: null },
    fieldType: { default: null },
  },
  asset: {
    id: { default: null },
    filename: { default: null },
    url: { default: null },
    thumbnailUrl: { default: null },
    mimeType: { default: null },
  },
  record: {
    id: { default: null },
    title: { default: null },
    modelId: { default: null },
    modelApiKey: { default: null },
    modelName: { default: null },
    modelEmoji: { default: null },
    thumbnailUrl: { default: null },
    isSingleton: { default: false },
  },
  model: {
    id: { default: null },
    apiKey: { default: null },
    name: { default: null },
    isBlockModel: { default: false },
  },
};

/**
 * Creates a TipTap mention extension for a specific mention type.
 *
 * This factory extends TipTap's Mention extension to:
 * - Store all mention metadata as node attributes
 * - Use a React component for custom rendering (MentionChip)
 * - Support the Suggestion plugin for dropdown autocomplete
 *
 * The caller MUST configure the suggestion via .configure({ suggestion: {...} })
 * including char, render, items, etc.
 */
export function createMentionExtension(config: MentionExtensionConfig) {
  const { name, mentionType, nodeViewComponent } = config;

  const typeAttrs = MENTION_TYPE_ATTRS[mentionType];

  return Mention.extend({
    name,

    // Define all attributes for this mention type
    addAttributes() {
      return {
        ...BASE_ATTRS,
        ...typeAttrs,
        ...(config.extraAttrs ?? {}),
      };
    },

    // Parse from HTML (for clipboard paste)
    parseHTML() {
      return [
        {
          tag: `span[data-mention-type="${mentionType}"]`,
        },
      ];
    },

    // Render to HTML
    renderHTML({ HTMLAttributes }) {
      return ['span', { 'data-mention-type': mentionType, ...HTMLAttributes }];
    },

    // Use React component for rendering in the editor
    addNodeView() {
      return ReactNodeViewRenderer(nodeViewComponent);
    },
  });
}

/**
 * Type helper to extract the insert command name from a mention extension.
 */
export type MentionInsertCommand<T extends string> = `insert${Capitalize<T>}`;
