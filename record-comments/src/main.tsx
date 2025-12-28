/**
 * DatoCMS Record Comments Plugin
 *
 * BUNDLE SIZE NOTE: The production build generates a ~920KB main chunk (258KB gzipped).
 * This exceeds the recommended 500KB limit but is acceptable for this plugin because:
 *
 * 1. **TipTap Editor (~400KB)**: The rich text editor with mention support is essential
 *    functionality and cannot be easily replaced with a smaller alternative.
 *
 * 2. **DatoCMS React UI (~200KB)**: Required for consistent styling with the DatoCMS dashboard.
 *
 * 3. **React + ReactDOM (~150KB)**: Framework overhead, cannot be reduced.
 *
 * Potential optimizations if bundle size becomes problematic:
 * - Dynamic import the CommentsDashboard (only loads when user visits dashboard page)
 * - Lazy load TipTap only when user focuses on composer (would add UX latency)
 * - Tree-shake unused TipTap extensions (limited benefit, we use most)
 *
 * Current approach: Accept the bundle size as the cost of rich functionality.
 * The plugin loads once per session and subsequent navigations are cached.
 */
import {
  connect,
  type OnBootCtx,
  type RenderConfigScreenCtx,
  type RenderItemFormSidebarCtx,
  type RenderPageCtx,
  type ContentAreaSidebarItemsCtx,
  type SettingsAreaSidebarItemGroupsCtx,
} from 'datocms-plugin-sdk';
import { buildClient } from '@datocms/cma-client-browser';
import { render } from '@/utils/render';
import 'datocms-react-ui/styles.css';
import '@/entrypoints/styles/tokens.css';
import CommentsBar from '@/entrypoints/CommentsBar';
import ConfigScreen from '@/entrypoints/ConfigScreen';
import CommentsDashboard from '@/entrypoints/CommentsDashboard';
import UserProfileSettings from '@/entrypoints/UserProfileSettings';
import {
  SidebarNavigationProvider,
  PageNavigationProvider,
} from '@/entrypoints/contexts/NavigationCallbacksContext';
import TimeAgo from 'javascript-time-ago';
import en from 'javascript-time-ago/locale/en.json';
import { COMMENTS_MODEL_API_KEY, COMMENT_FIELDS, PLUGIN_IDS } from '@/constants';
import { logError } from '@/utils/errorLogger';

TimeAgo.addDefaultLocale(en);

async function ensureCommentsModelExists(ctx: OnBootCtx) {
  if (!ctx.currentUserAccessToken) {
    return; // Cannot create model without access token
  }

  const client = buildClient({
    apiToken: ctx.currentUserAccessToken,
  });

  // Check if the model already exists
  const existingModels = await client.itemTypes.list();
  const commentsModel = existingModels.find(
    (model) => model.api_key === COMMENTS_MODEL_API_KEY
  );

  if (commentsModel) {
    return; // Model already exists
  }

  // Create the project_comment model
  const newModel = await client.itemTypes.create({
    name: 'Project Comment',
    api_key: COMMENTS_MODEL_API_KEY,
    draft_mode_active: false,
  });

  // Create the model_id field (string, required)
  await client.fields.create(newModel.id, {
    label: 'Model ID',
    api_key: COMMENT_FIELDS.MODEL_ID,
    field_type: 'string',
    validators: {
      required: {},
    },
  });

  // Create the record_id field (string, required, unique)
  await client.fields.create(newModel.id, {
    label: 'Record ID',
    api_key: COMMENT_FIELDS.RECORD_ID,
    field_type: 'string',
    validators: {
      required: {},
      unique: {},
    },
  });

  // Create the content field (JSON, required)
  await client.fields.create(newModel.id, {
    label: 'Content',
    api_key: COMMENT_FIELDS.CONTENT,
    field_type: 'json',
    validators: {
      required: {},
    },
  });
}

connect({
  async onBoot(ctx: OnBootCtx) {
    try {
      await ensureCommentsModelExists(ctx);
    } catch (error) {
      // Log the error but don't throw - the plugin can still function for viewing
      // existing comments, just won't be able to create new ones if the model doesn't exist.
      // Common causes: insufficient permissions, network error, rate limiting.
      logError('Failed to ensure comments model exists during plugin boot', error, {
        hasAccessToken: !!ctx.currentUserAccessToken,
      });

      // Show a notice to the user so they know something went wrong
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
  contentAreaSidebarItems(_ctx: ContentAreaSidebarItemsCtx) {
    return [
      {
        label: 'Comments',
        icon: PLUGIN_IDS.ICON,
        placement: ['before', 'menuItems'],
        pointsTo: { pageId: PLUGIN_IDS.PAGE },
      },
    ];
  },
  settingsAreaSidebarItemGroups(_ctx: SettingsAreaSidebarItemGroupsCtx) {
    return [
      {
        label: 'Comments Plugin',
        items: [
          {
            label: 'User Profiles',
            icon: PLUGIN_IDS.SETTINGS_ICON,
            pointsTo: { pageId: PLUGIN_IDS.SETTINGS_PAGE },
          },
        ],
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

    if (pageId === PLUGIN_IDS.SETTINGS_PAGE) {
      render(<UserProfileSettings ctx={ctx} />);
    }
  },
});

