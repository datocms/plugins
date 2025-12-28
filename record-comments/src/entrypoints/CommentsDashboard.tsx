import { useMemo, useCallback, useState } from 'react';
import type { RenderPageCtx } from 'datocms-plugin-sdk';
import { buildClient } from '@datocms/cma-client-browser';
import { Canvas } from 'datocms-react-ui';

// Components
import GlobalCommentsChannel from '@components/GlobalCommentsChannel';
import MyMentionsSidebar from '@components/MyMentionsSidebar';
import RecentCommentsList from '@components/RecentCommentsList';
import SearchFilterSidebar from '@components/SearchFilterSidebar';

// Contexts
import { ProjectDataProvider } from './contexts/ProjectDataContext';
import { MentionPermissionsProvider } from './contexts/MentionPermissionsContext';

// Hooks
import { useProjectData } from '@hooks/useProjectData';
import { useMentionPermissions } from '@hooks/useMentionPermissions';
import {
  useAllCommentsData,
  extractUserMentions,
  extractRecentComments,
} from '@hooks/useAllCommentsData';
import { useCommentsData } from '@hooks/useCommentsData';
import { useCommentFilters } from '@hooks/useCommentFilters';

// Utilities
import { getCurrentUserInfo } from '@utils/userTransformers';
import { parsePluginParams, hasCdaToken } from '@utils/pluginParams';

// Types
import type { StyleWithCustomProps } from '@ctypes/styles';

// Styles
import styles from '@styles/dashboard.module.css';

type CommentsDashboardProps = {
  ctx: RenderPageCtx;
};

/**
 * Main Comments Dashboard page component.
 * Layout: Comments Channel | Filter Column | My Mentions + Recent Comments
 */
const CommentsDashboard = ({ ctx }: CommentsDashboardProps) => {
  // Get plugin parameters
  const pluginParams = parsePluginParams(ctx.plugin.attributes.parameters);
  const cdaToken = pluginParams.cdaToken;
  const realTimeEnabled = hasCdaToken(pluginParams);

  // Get current user info
  const { email: userEmail, name: userName } = getCurrentUserInfo(ctx.currentUser);

  // Create CMA client
  const client = useMemo(() => {
    if (!ctx.currentUserAccessToken) return null;
    return buildClient({ apiToken: ctx.currentUserAccessToken });
  }, [ctx.currentUserAccessToken]);

  // Load project data (users, models) - no fields needed in dashboard
  // Pass client for avatar URL caching from user overrides
  const { projectUsers, projectModels, userOverrides, typedUsers } = useProjectData(ctx, { client });

  // Get mention permissions
  const { canMentionAssets, canMentionModels, readableModels } = useMentionPermissions(
    ctx,
    projectModels
  );

  // Get main locale for title extraction
  const mainLocale = ctx.site.attributes.locales[0];

  // State to track if sync is allowed (updated by GlobalCommentsChannel's operationQueue)
  const [isSyncAllowed, setIsSyncAllowed] = useState(true);

  // Global comments data and subscription (lifted from GlobalCommentsChannel)
  const {
    comments,
    setComments,
    isLoading,
    error,
    status,
    fullResult: { commentsModelId, commentRecordId, setCommentRecordId },
  } = useCommentsData({
    context: 'global',
    ctx,
    realTimeEnabled,
    cdaToken,
    client,
    isSyncAllowed,
  });

  // Comment filters
  const {
    filters,
    setFilters,
    filterOptions,
    filteredComments,
    isFiltering,
    hasUnappliedChanges,
    applyFilters,
    clearFilters,
  } = useCommentFilters(comments);

  // Load all comments for sidebar sections
  const { allComments, isLoading: isSidebarLoading } = useAllCommentsData({
    client,
    mainLocale,
  });

  // Compute user mentions
  const userMentions = useMemo(
    () => extractUserMentions(allComments, userEmail),
    [allComments, userEmail]
  );

  // Compute recent comments (limit to 20)
  const recentComments = useMemo(
    () => extractRecentComments(allComments, 20),
    [allComments]
  );

  // Handle navigation to a record from sidebar sections
  const handleNavigateToRecord = useCallback(
    (modelId: string, recordId: string) => {
      const path = `/editor/item_types/${modelId}/items/${recordId}/edit`;
      ctx.navigateTo(path);
    },
    [ctx]
  );

  // Handle scrolling to a global comment (when clicking in sidebar)
  const handleScrollToGlobalComment = useCallback((dateISO: string) => {
    // Find the comment element in the channel and scroll to it
    const commentElement = document.querySelector(`[data-comment-id="${dateISO}"]`);
    if (commentElement) {
      commentElement.scrollIntoView({ behavior: 'smooth', block: 'center' });
      // Add a brief highlight effect
      commentElement.classList.add('highlight');
      setTimeout(() => commentElement.classList.remove('highlight'), 2000);
    }
  }, []);

  const hasComments = comments.length > 0;
  const accentColor = ctx.theme.accentColor;

  // Filter panel collapsed state
  const [isFilterCollapsed, setIsFilterCollapsed] = useState(true);

  // Count active filters for badge
  const activeFilterCount = [
    filters.searchQuery.trim(),
    filters.authorEmail,
    filters.dateRange.start,
    filters.dateRange.end,
    filters.mentionedRecordId,
    filters.mentionedAssetId,
    filters.mentionedModelId,
    filters.mentionedUserEmail,
  ].filter(Boolean).length;

  const showFilterColumn = hasComments && !isFilterCollapsed;

  return (
    <Canvas ctx={ctx}>
      <div className={styles.dashboardContainer}>
        {/* Main Channel */}
        <div className={styles.mainChannel}>
          {/*
            ============================================================================
            MODEL FIELDS INTENTIONALLY EMPTY FOR GLOBAL COMMENTS CHANNEL
            ============================================================================

            The `modelFields={[]}` is intentional, NOT a bug or oversight. Here's why:

            1. GLOBAL COMMENTS ARE MODEL-AGNOSTIC:
               - Global/project-wide comments don't belong to any specific record
               - Field mentions (#field_name) only make sense in record-specific context
               - The global channel is for project discussions, not field-specific feedback

            2. FIELD MENTION DISABLED IN GLOBAL CONTEXT:
               - MentionPermissionsProvider sets canMentionFields={false} below
               - The # trigger is disabled in TipTapComposer for global comments
               - Even if modelFields were provided, users couldn't use them

            3. PERFORMANCE CONSIDERATION:
               - Loading all fields for all models would be expensive (~O(models × fields))
               - This data would never be used since field mentions are disabled
               - Sidebar (CommentsBar) loads fields because it HAS a specific record context

            4. DISPLAY OF EXISTING FIELD MENTIONS:
               - If a comment was created in sidebar with a field mention, then viewed here,
                 the mention would display as "#api_key" without click navigation
               - This is acceptable since users can navigate to the specific record to
                 interact with field mentions in their proper context

            DO NOT change this to load modelFields. The empty array is the correct design
            for the global comments context.
            ============================================================================
          */}
          <ProjectDataProvider
            projectUsers={projectUsers}
            projectModels={projectModels}
            modelFields={[]}
            currentUserEmail={userEmail}
            userOverrides={userOverrides}
            typedUsers={typedUsers}
          >
            <MentionPermissionsProvider
              canMentionFields={false}
              canMentionAssets={canMentionAssets}
              canMentionModels={canMentionModels}
            >
              <GlobalCommentsChannel
                ctx={ctx}
                client={client}
                userName={userName}
                readableModels={readableModels}
                accentColor={accentColor}
                comments={comments}
                filteredComments={filteredComments}
                setComments={setComments}
                commentsModelId={commentsModelId}
                commentRecordId={commentRecordId}
                setCommentRecordId={setCommentRecordId}
                isLoading={isLoading}
                error={error}
                status={status}
                isFiltering={isFiltering}
                onSyncAllowedChange={setIsSyncAllowed}
              />
            </MentionPermissionsProvider>
          </ProjectDataProvider>
        </div>

      {/* Sidebar */}
      <div className={styles.sidebar}>
        {/* Filter Column - overlays to the left of sidebar */}
        {showFilterColumn && (
          <div className={styles.filterColumn}>
            <SearchFilterSidebar
              filters={filters}
              filterOptions={filterOptions}
              onFiltersChange={setFilters}
              onClearAll={clearFilters}
              onApply={applyFilters}
              isFiltering={isFiltering}
              hasUnappliedChanges={hasUnappliedChanges}
              accentColor={accentColor}
            />
          </div>
        )}
        {/* Filter toggle button - floating on the divider */}
        {hasComments && (
          <button
            type="button"
            className={`${styles.filterToggleFab}${isFiltering ? ` ${styles.filterToggleFabActive}` : ''}${!isFilterCollapsed ? ` ${styles.filterToggleFabExpanded}` : ''}`}
            onClick={() => setIsFilterCollapsed(!isFilterCollapsed)}
            style={{ '--accent-color': accentColor } as StyleWithCustomProps}
            title={isFilterCollapsed ? 'Show filters' : 'Hide filters'}
          >
            <svg className={styles.filterToggleFabIcon} viewBox="0 0 16 16" fill="currentColor">
              <title>Filters</title>
              <path d="M1.5 1.5A.5.5 0 0 1 2 1h12a.5.5 0 0 1 .5.5v2a.5.5 0 0 1-.128.334L10 8.692V13.5a.5.5 0 0 1-.342.474l-3 1A.5.5 0 0 1 6 14.5V8.692L1.628 3.834A.5.5 0 0 1 1.5 3.5v-2z"/>
            </svg>
            {activeFilterCount > 0 && (
              <span
                className={styles.filterToggleFabBadge}
                style={{ backgroundColor: accentColor }}
              >
                {activeFilterCount}
              </span>
            )}
          </button>
        )}

        <div className={styles.sidebarInner}>
          <MyMentionsSidebar
            mentions={userMentions}
            isLoading={isSidebarLoading}
            onNavigateToRecord={handleNavigateToRecord}
            onScrollToGlobalComment={handleScrollToGlobalComment}
          />
          <RecentCommentsList
            comments={recentComments}
            isLoading={isSidebarLoading}
            onNavigateToRecord={handleNavigateToRecord}
            onScrollToGlobalComment={handleScrollToGlobalComment}
          />
        </div>
      </div>
      </div>
    </Canvas>
  );
};

export default CommentsDashboard;
