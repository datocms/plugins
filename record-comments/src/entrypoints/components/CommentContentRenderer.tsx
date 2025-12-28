import { memo, useCallback } from 'react';
import type { CommentSegment, Mention } from '@ctypes/mentions';
import { areSegmentsEqual } from '@utils/comparisonHelpers';
import { useNavigationContext } from '@/entrypoints/contexts/NavigationCallbacksContext';
import { useProjectDataContext } from '@/entrypoints/contexts/ProjectDataContext';
import { MentionDisplay } from './shared/MentionDisplay';

type CommentContentRendererProps = {
  segments: CommentSegment[];
};

/**
 * Custom comparator for CommentContentRenderer.
 * Uses efficient segment comparison instead of JSON serialization.
 */
function arePropsEqual(
  prev: CommentContentRendererProps,
  next: CommentContentRendererProps
): boolean {
  // Compare segments using efficient helper
  return areSegmentsEqual(prev.segments, next.segments);
}

/**
 * Component to render comment content from structured segments
 */
const CommentContentRenderer = memo(function CommentContentRenderer({
  segments,
}: CommentContentRendererProps) {
  // Get navigation callbacks from context
  const nav = useNavigationContext();

  // Get project users (with overrides applied) from context for user mention name resolution
  const { projectUsers } = useProjectDataContext();

  /**
   * CLICK HANDLER FACTORY - Performance Analysis:
   * ----------------------------------------------
   * This factory creates a new handler function for each mention on every render.
   * The useCallback around the factory only prevents recreating the factory itself,
   * not the handlers it produces.
   *
   * WHY THIS IS ACCEPTABLE:
   * 1. Component is memoized with arePropsEqual - only re-renders when segments change
   * 2. When segments DO change, we need new handlers for new/changed mentions anyway
   * 3. Handler creation is cheap (just closure allocation, no complex computation)
   * 4. MentionDisplay is also memoized, so unchanged mentions skip re-render
   *
   * ALTERNATIVES CONSIDERED:
   * - useMemo per mention: Would require stable mention identity, adds complexity
   * - Handler map: Would need cache invalidation logic, overkill for this use case
   * - Event delegation: Would complicate navigation logic and accessibility
   *
   * The `nav` dependency changes when NavigationContext updates, but this context
   * is stable (uses refs internally) so changes are rare. The useCallback still
   * provides value by preventing unnecessary factory recreation on unrelated renders.
   *
   * DO NOT refactor to complex memoization without profiling evidence of a problem.
   */
  const createMentionClickHandler = useCallback(
    (mention: Mention) => {
      switch (mention.type) {
        case 'user':
          return () => nav.handleNavigateToUsers();
        case 'field': {
          // When handleScrollToField is not available (e.g., global comments page),
          // field mentions are not clickable
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
    [nav]
  );

  /**
   * KEY PATTERN JUSTIFICATION:
   * Using index in keys is generally discouraged, but is acceptable here because:
   * 1. The segments array has a stable, fixed order for a given comment
   * 2. Segments are never reordered, added, or removed during the component's lifecycle
   * 3. When the comment content changes, the entire segments array is replaced
   * 4. The segments are derived from immutable comment data, not user-editable state
   *
   * The content slice is added to make keys more specific, but the index alone
   * would be sufficient given the above constraints.
   */
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

        // Field mentions are not clickable when handleScrollToField is unavailable
        const isClickable = mention.type === 'field' ? !!nav.handleScrollToField : true;

        return (
          <MentionDisplay
            key={mentionKey}
            mention={mention}
            onClick={clickHandler}
            isClickable={isClickable}
            tooltipId={tooltipId}
            projectUsers={projectUsers}
          />
        );
      })}
    </>
  );
}, arePropsEqual);

/**
 * Generate a unique key for a mention based on its type and identifying properties
 */
function getMentionKey(mention: Mention, index: number): string {
  switch (mention.type) {
    case 'user':
      return `user-${mention.id}-${index}`;
    case 'field': {
      const fieldPath = mention.fieldPath ?? mention.apiKey;
      return `field-${fieldPath}-${mention.locale ?? ''}-${index}`;
    }
    case 'asset':
      return `asset-${mention.id}-${index}`;
    case 'record':
      return `record-${mention.id}-${index}`;
    case 'model':
      return `model-${mention.id}-${index}`;
    default:
      return `unknown-${index}`;
  }
}

/**
 * Generate a unique tooltip ID for a mention
 */
function getTooltipId(mention: Mention, index: number): string {
  switch (mention.type) {
    case 'user':
      return `user-tooltip-${mention.id}-${index}`;
    case 'field': {
      const fieldPath = mention.fieldPath ?? mention.apiKey;
      return `field-tooltip-${fieldPath}-${mention.locale ?? ''}-${index}`;
    }
    case 'asset':
      return `asset-tooltip-${mention.id}-${index}`;
    case 'record':
      return `record-tooltip-${mention.id}-${index}`;
    case 'model':
      return `model-tooltip-${mention.id}-${index}`;
    default:
      return `tooltip-${index}`;
  }
}

export default CommentContentRenderer;
