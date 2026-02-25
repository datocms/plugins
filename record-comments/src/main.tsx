// Bundle ~920KB (258KB gzipped): TipTap ~400KB, DatoCMS UI ~200KB, React ~150KB.
// Acceptable tradeoff for rich functionality; loads once per session.
import {
  connect,
  type OnBootCtx,
  type RenderConfigScreenCtx,
  type RenderItemFormSidebarCtx,
  type RenderPageCtx,
  type ContentAreaSidebarItemsCtx,
  // Postponed: Field dropdown feature
  // type FieldDropdownActionsCtx,
  // type ExecuteFieldDropdownActionCtx,
} from 'datocms-plugin-sdk';
import { buildClient } from '@datocms/cma-client-browser';
import { render } from '@/utils/render';
import 'datocms-react-ui/styles.css';
import '@/entrypoints/styles/tokens.css';
import CommentsBar from '@/entrypoints/CommentsBar';
import ConfigScreen from '@/entrypoints/ConfigScreen';
import CommentsDashboard from '@/entrypoints/CommentsDashboard';
import {
  SidebarNavigationProvider,
  PageNavigationProvider,
} from '@/entrypoints/contexts/NavigationCallbacksContext';
import TimeAgo from 'javascript-time-ago';
import en from 'javascript-time-ago/locale/en.json';
import { COMMENTS_MODEL_API_KEY, COMMENT_FIELDS, PLUGIN_IDS } from '@/constants';
import { logError } from '@/utils/errorLogger';
import { parsePluginParams } from '@utils/pluginParams';
import { parseMentionStateContent } from '@utils/mentionState';
import { getCurrentUserInfo } from '@utils/userTransformers';

TimeAgo.addDefaultLocale(en);

const MAX_MENTION_BADGE_COUNT = 99;

function getCachedUnreadMentionCount(projectId: string, userId: string): number {
  if (typeof localStorage === 'undefined') return 0;
  try {
    const raw = localStorage.getItem(`mentionsCache:${projectId}:${userId}`);
    if (!raw) return 0;
    const content = parseMentionStateContent(raw);
    return content.unread.length;
  } catch {
    return 0;
  }
}

function formatCommentsLabel(baseLabel: string, unreadCount: number): string {
  if (unreadCount <= 0) return baseLabel;
  const displayCount = unreadCount > MAX_MENTION_BADGE_COUNT
    ? `${MAX_MENTION_BADGE_COUNT}+`
    : String(unreadCount);
  return `${baseLabel} (${displayCount})`;
}

async function ensureCommentsModelExists(ctx: OnBootCtx): Promise<string | null> {
  if (!ctx.currentUserAccessToken) return null;

  const client = buildClient({ apiToken: ctx.currentUserAccessToken });

  const existingModels = await client.itemTypes.list();
  const commentsModel = existingModels.find(
    (model) => model.api_key === COMMENTS_MODEL_API_KEY
  );

  if (commentsModel) {
    return commentsModel.id;
  }

  // Model doesn't exist - create it with all fields
  const newModel = await client.itemTypes.create({
    name: 'Project Comment',
    api_key: COMMENTS_MODEL_API_KEY,
    draft_mode_active: false,
  });

  await client.fields.create(newModel.id, {
    label: 'Model ID',
    api_key: COMMENT_FIELDS.MODEL_ID,
    field_type: 'string',
    validators: { required: {} },
  });

  await client.fields.create(newModel.id, {
    label: 'Record ID',
    api_key: COMMENT_FIELDS.RECORD_ID,
    field_type: 'string',
    validators: { required: {}, unique: {} },
  });

  await client.fields.create(newModel.id, {
    label: 'Content',
    api_key: COMMENT_FIELDS.CONTENT,
    field_type: 'json',
    validators: { required: {} },
  });

  return newModel.id;
}

connect({
  async onBoot(ctx: OnBootCtx) {
    try {
      await ensureCommentsModelExists(ctx);
    } catch (error) {
      // Don't throw - plugin can still view existing comments
      logError('Failed to ensure comments model exists during plugin boot', error, {
        hasAccessToken: !!ctx.currentUserAccessToken,
      });
      ctx.notice(
        'Comments plugin initialization warning: Unable to verify comment storage. ' +
        'If this is your first time using the plugin, please check your permissions.'
      );
    }
  },
  renderConfigScreen(ctx: RenderConfigScreenCtx) {
    render(<ConfigScreen ctx={ctx} />);
  },
  itemFormSidebars() {
    return [
      {
        id: PLUGIN_IDS.SIDEBAR,
        label: 'Comments',
      },
    ];
  },
  renderItemFormSidebar(sidebarId, ctx: RenderItemFormSidebarCtx) {
    if (sidebarId === PLUGIN_IDS.SIDEBAR) {
      render(
        <SidebarNavigationProvider ctx={ctx}>
          <CommentsBar ctx={ctx} />
        </SidebarNavigationProvider>
      );
    }
  },
  contentAreaSidebarItems(ctx: ContentAreaSidebarItemsCtx) {
    const pluginParams = parsePluginParams(ctx.plugin.attributes.parameters);

    if (!pluginParams.dashboardEnabled) {
      return [];
    }

    const { id: currentUserId } = getCurrentUserInfo(ctx.currentUser);
    const unreadCount = getCachedUnreadMentionCount(ctx.site.id, currentUserId);
    const label = formatCommentsLabel('Comments', unreadCount);

    return [
      {
        label,
        icon: PLUGIN_IDS.ICON,
        placement: ['before', 'menuItems'],
        pointsTo: { pageId: PLUGIN_IDS.PAGE },
      },
    ];
  },
  renderPage(pageId: string, ctx: RenderPageCtx) {
    if (pageId === PLUGIN_IDS.PAGE) {
      render(
        <PageNavigationProvider ctx={ctx}>
          <CommentsDashboard ctx={ctx} />
        </PageNavigationProvider>
      );
    }
  },
});
