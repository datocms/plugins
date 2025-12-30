// Bundle ~920KB (258KB gzipped): TipTap ~400KB, DatoCMS UI ~200KB, React ~150KB.
// Acceptable tradeoff for rich functionality; loads once per session.
import {
  connect,
  type OnBootCtx,
  type RenderConfigScreenCtx,
  type RenderItemFormSidebarCtx,
  type RenderPageCtx,
  type ContentAreaSidebarItemsCtx,
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

TimeAgo.addDefaultLocale(en);

async function ensureCommentsModelExists(ctx: OnBootCtx) {
  if (!ctx.currentUserAccessToken) return;

  const client = buildClient({ apiToken: ctx.currentUserAccessToken });

  const existingModels = await client.itemTypes.list();
  const commentsModel = existingModels.find(
    (model) => model.api_key === COMMENTS_MODEL_API_KEY
  );

  if (commentsModel) return;

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

    return [
      {
        label: 'Comments',
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

