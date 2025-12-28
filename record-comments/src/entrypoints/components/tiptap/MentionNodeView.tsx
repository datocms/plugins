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

/**
 * TipTap NodeView component for rendering mention chips inside the editor.
 *
 * This component:
 * - Wraps the existing MentionChip component
 * - Ensures mentions are non-editable (contentEditable=false)
 * - Provides consistent styling between editor and display
 * - Renders fallback for invalid mention data
 */

type MentionNodeViewProps = ReactNodeViewProps;

/**
 * Fallback component for invalid mentions
 */
function InvalidMentionFallback() {
  return (
    <span style={{ color: '#888', fontStyle: 'italic', fontSize: 'inherit' }}>
      [invalid mention]
    </span>
  );
}

/**
 * Converts TipTap node attributes to a Mention object.
 * Uses type guards for safe validation instead of unsafe type assertions.
 */
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
        // Debug: check each field individually
        console.warn('[MentionNodeView] Invalid field mention attrs', {
          attrs,
          checks: {
            apiKey: { value: attrs.apiKey, isString: typeof attrs.apiKey === 'string' },
            label: { value: attrs.label, isString: typeof attrs.label === 'string' },
            localized: { value: attrs.localized, type: typeof attrs.localized },
            fieldPath: { value: attrs.fieldPath, isString: typeof attrs.fieldPath === 'string' },
            locale: { value: attrs.locale, type: typeof attrs.locale },
            fieldType: { value: attrs.fieldType, type: typeof attrs.fieldType },
          },
        });
        return null;
      }
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
        // Use centralized defaults (see tiptapDefaults.ts for rationale)
        isBlockModel: applyModelMentionDefaults.isBlockModel(attrs.isBlockModel),
      };

    default:
      return null;
  }
}

/**
 * ================================================================================
 * MENTION NODE VIEW FACTORY
 * ================================================================================
 *
 * All five mention types follow the same rendering pattern:
 * 1. Extract mention type from attrs
 * 2. Convert attrs to Mention object
 * 3. Render MentionChip or fallback
 *
 * This factory consolidates the pattern into a single function that generates
 * the appropriate NodeView component for each mention type.
 *
 * WHY A FACTORY:
 * - Reduces code duplication (~15 lines per mention type → 1 line each)
 * - Changes to rendering logic only need to be made in one place
 * - Still exports named components for TipTap extension configuration
 *
 * ================================================================================
 */

type MentionType = 'user' | 'field' | 'asset' | 'record' | 'model';

/**
 * Factory function that creates a NodeView component for a specific mention type.
 *
 * @param mentionType - The type of mention this component handles
 * @param needsProjectUsers - Whether this mention type needs projectUsers context (only 'user' does)
 */
function createMentionNodeView(mentionType: MentionType, needsProjectUsers = false) {
  // Create and return the NodeView component
  return function MentionNodeView({ node }: MentionNodeViewProps) {
    const { onMentionClick } = useMentionClick();
    // Only destructure projectUsers if needed (optimization)
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

/**
 * NodeView component for User mentions (@)
 * Includes projectUsers for avatar URL resolution
 */
export const UserMentionNodeView = createMentionNodeView('user', true);

/**
 * NodeView component for Field mentions (#)
 */
export const FieldMentionNodeView = createMentionNodeView('field');

/**
 * NodeView component for Asset mentions (^)
 */
export const AssetMentionNodeView = createMentionNodeView('asset');

/**
 * NodeView component for Record mentions (&)
 */
export const RecordMentionNodeView = createMentionNodeView('record');

/**
 * NodeView component for Model mentions ($)
 */
export const ModelMentionNodeView = createMentionNodeView('model');
