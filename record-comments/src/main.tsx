// Bundle ~1.2MB (~370KB gzipped), mostly TipTap, the DatoCMS UI kit and React.
// Acceptable tradeoff for rich functionality; loads once per session.

// The kit stylesheet loads first, thus the CSS modules of the plugin come
// after it and win at the same specificity
import 'datocms-react-ui/styles.css';
import {
  parsePluginParams,
  setCommentsModelIdForEnvironment,
} from '@utils/pluginParams';
import {
  connect,
  type OnBootCtx,
  type RenderConfigScreenCtx,
  type RenderItemFormSidebarCtx,
} from 'datocms-plugin-sdk';
import Canvas from 'datocms-react-ui/Canvas';
import { PLUGIN_IDS } from '@/constants';
import CommentsBar from '@/entrypoints/CommentsBar';
import ConfigScreen from '@/entrypoints/ConfigScreen';
import { SidebarNavigationProvider } from '@/entrypoints/contexts/NavigationCallbacksContext';
import { TEXTS } from '@/texts';
import { ensureCommentsModelExists } from '@/utils/commentsStorage';
import { logError, setDebugLoggingEnabled } from '@/utils/errorLogger';
import { render } from '@/utils/render';

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
        "Record comments couldn't check where comments are stored. " +
          'If you just installed the plugin, make sure your role can change the schema, then reload.',
      );
    }
  },
  renderConfigScreen(ctx: RenderConfigScreenCtx) {
    setDebugLoggingEnabled(
      parsePluginParams(ctx.plugin.attributes.parameters).debugLoggingEnabled,
    );
    render(
      <Canvas ctx={ctx} texts={TEXTS}>
        <ConfigScreen ctx={ctx} />
      </Canvas>,
    );
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
        <Canvas ctx={ctx} texts={TEXTS}>
          <SidebarNavigationProvider ctx={ctx}>
            <CommentsBar ctx={ctx} />
          </SidebarNavigationProvider>
        </Canvas>,
      );
    }
  },
});
