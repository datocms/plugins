import {
  connect,
  type MainNavigationTabsCtx,
  type RenderPageCtx,
} from 'datocms-plugin-sdk';
import 'datocms-react-ui/styles.css';
import './kit-fixes.css';
import './ui/recipes.css';
import ConfigScreen from './entrypoints/ConfigScreen';
import FindReplacePage from './entrypoints/FindReplacePage';
import { readPluginParameters } from './utils/parameters';
import { isRoleAllowed } from './utils/permissions';
import { render } from './utils/render';

const PAGE_ID = 'find-and-replace';

function canShowNavigation(
  ctx: Pick<MainNavigationTabsCtx | RenderPageCtx, 'plugin' | 'currentRole'>,
): boolean {
  const params = readPluginParameters(ctx.plugin.attributes.parameters);
  return isRoleAllowed(params, ctx.currentRole.id);
}

connect({
  renderConfigScreen(ctx) {
    return render(<ConfigScreen ctx={ctx} />);
  },
  mainNavigationTabs(ctx) {
    if (!canShowNavigation(ctx)) {
      return [];
    }

    return [
      {
        label: 'Find and Replace',
        icon: 'file-magnifying-glass',
        placement: ['after', 'content'],
        pointsTo: { pageId: PAGE_ID },
      },
    ];
  },
  renderPage(pageId, ctx) {
    if (pageId !== PAGE_ID) {
      return;
    }

    return render(<FindReplacePage ctx={ctx} />);
  },
});
