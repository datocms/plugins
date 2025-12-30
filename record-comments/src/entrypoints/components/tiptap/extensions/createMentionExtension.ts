import Mention from '@tiptap/extension-mention';
import { ReactNodeViewRenderer } from '@tiptap/react';
import type { ReactNodeViewProps } from '@tiptap/react';
import type { Mention as MentionType } from '@ctypes/mentions';

type MentionNodeViewComponent = React.ComponentType<ReactNodeViewProps>;

export type MentionExtensionConfig = {
  name: string;
  trigger: string;
  mentionType: MentionType['type'];
  nodeViewComponent: MentionNodeViewComponent;
  extraAttrs?: Record<string, { default?: unknown }>;
};

const BASE_ATTRS = {
  type: { default: null },
} as const;

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
 * Creates a TipTap mention extension. Caller must configure suggestion via
 * .configure({ suggestion: {...} }).
 */
export function createMentionExtension(config: MentionExtensionConfig) {
  const { name, mentionType, nodeViewComponent } = config;

  const typeAttrs = MENTION_TYPE_ATTRS[mentionType];

  return Mention.extend({
    name,

    addAttributes() {
      return {
        ...BASE_ATTRS,
        ...typeAttrs,
        ...(config.extraAttrs ?? {}),
      };
    },

    parseHTML() {
      return [
        {
          tag: `span[data-mention-type="${mentionType}"]`,
        },
      ];
    },

    renderHTML({ HTMLAttributes }) {
      return ['span', { 'data-mention-type': mentionType, ...HTMLAttributes }];
    },

    addNodeView() {
      return ReactNodeViewRenderer(nodeViewComponent);
    },
  });
}

export type MentionInsertCommand<T extends string> = `insert${Capitalize<T>}`;
