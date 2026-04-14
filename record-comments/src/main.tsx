// Bundle ~920KB (258KB gzipped): TipTap ~400KB, DatoCMS UI ~200KB, React ~150KB.
// Acceptable tradeoff for rich functionality; loads once per session.
import {
  connect,
  type OnBootCtx,
  type RenderConfigScreenCtx,
  type RenderItemFormSidebarCtx,
} from 'datocms-plugin-sdk';
import { render } from '@/utils/render';
import 'datocms-react-ui/styles.css';
import '@/entrypoints/styles/tokens.css';
import {
  parsePluginParams,
  setCommentsModelIdForEnvironment,
} from '@utils/pluginParams';
import TimeAgo from 'javascript-time-ago';
import en from 'javascript-time-ago/locale/en.json';
import { PLUGIN_IDS } from '@/constants';
import CommentsBar from '@/entrypoints/CommentsBar';
import ConfigScreen from '@/entrypoints/ConfigScreen';
import { SidebarNavigationProvider } from '@/entrypoints/contexts/NavigationCallbacksContext';
import { ensureCommentsModelExists } from '@/utils/commentsStorage';
import { logError, setDebugLoggingEnabled } from '@/utils/errorLogger';

TimeAgo.addDefaultLocale(en);

connect({
  async onBoot(ctx: OnBootCtx) {
    const pluginParams = parsePluginParams(ctx.plugin.attributes.parameters);
    setDebugLoggingEnabled(pluginParams.debugLoggingEnabled);

    try {
      const commentsModelId = await ensureCommentsModelExists(ctx);

      if (
        commentsModelId &&
        pluginParams.commentsModelIdsByEnvironment[ctx.environment] !==
          commentsModelId
      ) {
        try {
          await ctx.updatePluginParameters(
            setCommentsModelIdForEnvironment(
              pluginParams,
              ctx.environment,
              commentsModelId,
            ),
          );
        } catch (updateError) {
          logError(
            'Failed to persist comments model ID during plugin boot',
            updateError,
            { environment: ctx.environment },
          );
        }
      }
    } catch (error) {
      // Don't throw - plugin can still view existing comments
      logError(
        'Failed to ensure comments model exists during plugin boot',
        error,
        {
          hasAccessToken: !!ctx.currentUserAccessToken,
        },
      );
      await ctx.alert(
        'Comments plugin initialization warning: Unable to verify comment storage. ' +
          'If this is your first time using the plugin, please check your permissions.',
      );
    }
  },
  renderConfigScreen(ctx: RenderConfigScreenCtx) {
    setDebugLoggingEnabled(
      parsePluginParams(ctx.plugin.attributes.parameters).debugLoggingEnabled,
    );
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
    setDebugLoggingEnabled(
      parsePluginParams(ctx.plugin.attributes.parameters).debugLoggingEnabled,
    );

    if (sidebarId === PLUGIN_IDS.SIDEBAR) {
      render(
        <SidebarNavigationProvider ctx={ctx}>
          <CommentsBar ctx={ctx} />
        </SidebarNavigationProvider>,
      );
    }
  },
});
