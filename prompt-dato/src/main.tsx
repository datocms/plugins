import {
  connect,
  type RenderConfigScreenCtx,
  type RenderItemFormSidebarCtx,
} from 'datocms-plugin-sdk';
import 'datocms-react-ui/styles.css';
import ConfigScreen from './entrypoints/ConfigScreen';
import PromptSidebar from './entrypoints/PromptSidebar';
import { dlog } from './lib/debugLog';
import { handleOAuthCallbackIfPresent } from './lib/oauth';
import { render } from './utils/render';

const SIDEBAR_ID = 'promptDato';

// If this page load is the OAuth popup callback, post the code to the opener
// and close the popup — never boot the plugin SDK in that case.
if (handleOAuthCallbackIfPresent()) {
  // Intentionally empty — the popup will close itself.
  dlog('Boot', 'oauth_callback_short_circuit', {
    hasOpener: Boolean(window.opener),
  });
} else {
  dlog('Boot', 'plugin_connecting', { url: window.location.href });
  connect({
    itemFormSidebars() {
      return [
        {
          id: SIDEBAR_ID,
          label: 'Prompt Dato',
        },
      ];
    },
    renderItemFormSidebar(sidebarId: string, ctx: RenderItemFormSidebarCtx) {
      if (sidebarId === SIDEBAR_ID) {
        render(<PromptSidebar ctx={ctx} />);
      }
    },
    renderConfigScreen(ctx: RenderConfigScreenCtx) {
      render(<ConfigScreen ctx={ctx} />);
    },
  });
}
