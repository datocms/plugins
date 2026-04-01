import { memo, useCallback, useMemo } from 'react';
import type { CommentSegment, Mention, UserMention } from '@ctypes/mentions';
import { areSegmentsEqual } from '@utils/comparisonHelpers';
import { useNavigationContext } from '@/entrypoints/contexts/NavigationCallbacksContext';
import { useProjectDataContext } from '@/entrypoints/contexts/ProjectDataContext';
import { MentionDisplay } from './shared/MentionDisplay';
import type { NavigableUserType } from '@utils/navigationHelpers';

type CommentContentRendererProps = {
  segments: CommentSegment[];
};

function arePropsEqual(
  prev: CommentContentRendererProps,
  next: CommentContentRendererProps
): boolean {
  return areSegmentsEqual(prev.segments, next.segments);
}

const CommentContentRenderer = memo(function CommentContentRenderer({
  segments,
}: CommentContentRendererProps) {
  const nav = useNavigationContext();
  const { projectUsers, typedUsers } = useProjectDataContext();

  // Returns 'owner' as fallback for org/account users (non-clickable)
  const getUserType = useCallback(
    (mention: UserMention): NavigableUserType => {
      let match = typedUsers.find((tu) => tu.user.id === mention.id);

      if (!match && mention.email) {
        match = typedUsers.find((tu) => tu.user.email === mention.email);
      }

      if (!match) {
        return 'owner';
      }

      switch (match.userType) {
        case 'user':
          return 'user';
        case 'sso':
          return 'sso';
        default:
          return 'owner';
      }
    },
    [typedUsers]
  );

  const userMentionTypes = useMemo(() => {
    const result = new Map<string, NavigableUserType>();
    for (const segment of segments) {
      if (segment.type === 'mention' && segment.mention.type === 'user') {
        result.set(segment.mention.id, getUserType(segment.mention));
      }
    }
    return result;
  }, [segments, getUserType]);

  const createMentionClickHandler = useCallback(
    (mention: Mention) => {
      switch (mention.type) {
        case 'user': {
          const userType = userMentionTypes.get(mention.id) ?? 'owner';
          if (userType === 'owner') return undefined;
          return () => nav.handleNavigateToUsers(userType);
        }
        case 'field': {
          if (!nav.handleScrollToField) return undefined;
          const fieldPath = mention.fieldPath ?? mention.apiKey;
          return () => nav.handleScrollToField?.(fieldPath, mention.localized, mention.locale);
        }
        case 'asset':
          return () => nav.handleOpenAsset(mention.id);
        case 'record':
          return () => nav.handleOpenRecord(mention.id, mention.modelId);
        case 'model':
          return () => nav.handleNavigateToModel(mention.id, mention.isBlockModel);
        default:
          return undefined;
      }
    },
    [nav, userMentionTypes]
  );

  // Index keys acceptable: segments are immutable and never reordered
  return (
    <>
      {segments.map((segment, index) => {
        if (segment.type === 'text') {
          const key = `text-${index}`;
          return <span key={key}>{segment.content}</span>;
        }

        const { mention } = segment;
        const mentionKey = getMentionKey(mention, index);
        const tooltipId = getTooltipId(mention, index);
        const clickHandler = createMentionClickHandler(mention);

        let isClickable = true;
        let isProjectOwner = false;

        if (mention.type === 'field') {
          isClickable = !!nav.handleScrollToField;
        } else if (mention.type === 'user') {
          const userType = userMentionTypes.get(mention.id) ?? 'owner';
          isProjectOwner = userType === 'owner';
          isClickable = !isProjectOwner;
        }

        return (
          <MentionDisplay
            key={mentionKey}
            mention={mention}
            onClick={clickHandler}
            isClickable={isClickable}
            isProjectOwner={isProjectOwner}
            tooltipId={tooltipId}
            projectUsers={projectUsers}
          />
        );
      })}
    </>
  );
}, arePropsEqual);

function getMentionIdentifier(mention: Mention, index: number, prefix: string): string {
  const base = (() => {
    switch (mention.type) {
      case 'user':
        return `user-${mention.id}`;
      case 'field': {
        const fieldPath = mention.fieldPath ?? mention.apiKey;
        return `field-${fieldPath}-${mention.locale ?? ''}`;
      }
      case 'asset':
        return `asset-${mention.id}`;
      case 'record':
        return `record-${mention.id}`;
      case 'model':
        return `model-${mention.id}`;
      default:
        return 'unknown';
    }
  })();

  return prefix ? `${base}-${prefix}-${index}` : `${base}-${index}`;
}

function getMentionKey(mention: Mention, index: number): string {
  return getMentionIdentifier(mention, index, '');
}

function getTooltipId(mention: Mention, index: number): string {
  return getMentionIdentifier(mention, index, 'tooltip');
}

export default CommentContentRenderer;
