import type { CommentSegment, Mention, UserMention } from '@ctypes/mentions';
import { areSegmentsEqual } from '@utils/comparisonHelpers';
import type { NavigableUserType } from '@utils/navigationHelpers';
import { memo, useCallback, useMemo } from 'react';
import {
  type NavigationCallbacks,
  useNavigationContext,
} from '@/entrypoints/contexts/NavigationCallbacksContext';
import { useProjectDataContext } from '@/entrypoints/contexts/ProjectDataContext';
import { MentionDisplay } from './shared/MentionDisplay';

type CommentContentRendererProps = {
  segments: CommentSegment[];
};

function arePropsEqual(
  prev: CommentContentRendererProps,
  next: CommentContentRendererProps,
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
    [typedUsers],
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
          return () =>
            nav.handleScrollToField?.(
              fieldPath,
              mention.localized,
              mention.locale,
            );
        }
        case 'asset':
          return () => nav.handleOpenAsset(mention.id);
        case 'record':
          return () => nav.handleOpenRecord(mention.id, mention.modelId);
        case 'model':
          return () =>
            nav.handleNavigateToModel(mention.id, mention.isBlockModel);
        default:
          return undefined;
      }
    },
    [nav, userMentionTypes],
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
        // A field that needs no scroll to a locale only opens a CMS path:
        // it is a link, thus a middle click opens it in a new tab
        const to = getMentionLinkPath(mention, nav);
        const clickHandler = to
          ? undefined
          : createMentionClickHandler(mention);

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
            to={to}
            onClick={clickHandler}
            isClickable={isClickable}
            isProjectOwner={isProjectOwner}
            projectUsers={projectUsers}
          />
        );
      })}
    </>
  );
}, arePropsEqual);

/**
 * The CMS path that a mention opens as a link. Only a field that is not
 * localized: a localized field also scrolls the form to its locale, and the
 * other mentions open pickers or new tabs, thus they stay actions.
 */
function getMentionLinkPath(
  mention: Mention,
  nav: NavigationCallbacks,
): string | undefined {
  if (mention.type !== 'field' || mention.localized) return undefined;
  if (!nav.handleScrollToField) return undefined;
  return nav.getFieldLinkPath?.(mention.fieldPath ?? mention.apiKey);
}

// The key of a mention: what it points to, and its place in the text
function getMentionKey(mention: Mention, index: number): string {
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

  return `${base}-${index}`;
}

export default CommentContentRenderer;
