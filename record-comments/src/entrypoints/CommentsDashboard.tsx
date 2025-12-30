import { useMemo, useCallback, useState } from 'react';
import type { RenderPageCtx } from 'datocms-plugin-sdk';
import { buildClient } from '@datocms/cma-client-browser';
import { Canvas } from 'datocms-react-ui';

import GlobalCommentsChannel from '@components/GlobalCommentsChannel';
import MyMentionsSidebar from '@components/MyMentionsSidebar';
import RecentCommentsList from '@components/RecentCommentsList';
import SearchFilterSidebar from '@components/SearchFilterSidebar';

import { ProjectDataProvider } from './contexts/ProjectDataContext';
import { MentionPermissionsProvider } from './contexts/MentionPermissionsContext';

import { useProjectData } from '@hooks/useProjectData';
import { useMentionPermissions } from '@hooks/useMentionPermissions';
import {
  useAllCommentsData,
  extractUserMentions,
  extractRecentComments,
} from '@hooks/useAllCommentsData';
import { useCommentsData } from '@hooks/useCommentsData';
import { useCommentFilters } from '@hooks/useCommentFilters';

import { getCurrentUserInfo } from '@utils/userTransformers';
import { parsePluginParams, hasCdaToken } from '@utils/pluginParams';

import type { StyleWithCustomProps } from '@ctypes/styles';

import styles from '@styles/dashboard.module.css';

type CommentsDashboardProps = {
  ctx: RenderPageCtx;
};

// Layout: Comments Channel | Filter Column | My Mentions + Recent Comments
const CommentsDashboard = ({ ctx }: CommentsDashboardProps) => {
  const pluginParams = parsePluginParams(ctx.plugin.attributes.parameters);
  const cdaToken = pluginParams.cdaToken;
  const realTimeEnabled = hasCdaToken(pluginParams);

  const { email: userEmail, name: userName } = getCurrentUserInfo(ctx.currentUser);

  const client = useMemo(() => {
    if (!ctx.currentUserAccessToken) return null;
    return buildClient({ apiToken: ctx.currentUserAccessToken });
  }, [ctx.currentUserAccessToken]);

  const { projectUsers, projectModels, typedUsers } = useProjectData(ctx);
  const { canMentionAssets, canMentionModels, readableModels } = useMentionPermissions(ctx, projectModels);
  const mainLocale = ctx.site.attributes.locales[0];

  const [isSyncAllowed, setIsSyncAllowed] = useState(true);

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

  const { allComments, isLoading: isSidebarLoading } = useAllCommentsData({
    client,
    mainLocale,
  });

  const userMentions = useMemo(() => extractUserMentions(allComments, userEmail), [allComments, userEmail]);
  const recentComments = useMemo(() => extractRecentComments(allComments, 20), [allComments]);

  const handleNavigateToRecord = useCallback(
    (modelId: string, recordId: string) => {
      const path = `/editor/item_types/${modelId}/items/${recordId}/edit`;
      ctx.navigateTo(path);
    },
    [ctx]
  );

  const handleScrollToGlobalComment = useCallback((dateISO: string) => {
    const commentElement = document.querySelector(`[data-comment-id="${dateISO}"]`);
    if (commentElement) {
      commentElement.scrollIntoView({ behavior: 'smooth', block: 'center' });
      commentElement.classList.add('highlight');
      setTimeout(() => commentElement.classList.remove('highlight'), 2000);
    }
  }, []);

  const hasComments = comments.length > 0;
  const accentColor = ctx.theme.accentColor;

  const [isFilterCollapsed, setIsFilterCollapsed] = useState(true);

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
        <div className={styles.mainChannel}>
          {/* modelFields={[]} - global comments don't support field mentions */}
          <ProjectDataProvider
            projectUsers={projectUsers}
            projectModels={projectModels}
            modelFields={[]}
            currentUserEmail={userEmail}
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

      <div className={styles.sidebar}>
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
