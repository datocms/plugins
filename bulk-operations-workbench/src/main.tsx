import {
  connect,
  type MainNavigationTabsCtx,
  type RenderPageCtx,
} from 'datocms-plugin-sdk';
import 'datocms-react-ui/styles.css';
import ConfigScreen from './entrypoints/ConfigScreen';
import WorkbenchPage from './entrypoints/WorkbenchPage';
import { readPluginParameters } from './utils/parameters';
import { render } from './utils/render';

const PAGE_ID = 'bulk-operations-workbench';

function canShowNavigation(
  ctx: Pick<MainNavigationTabsCtx | RenderPageCtx, 'plugin' | 'currentRole'>,
): boolean {
  const params = readPluginParameters(ctx.plugin.attributes.parameters);
  return (
    params.allowedRoleIds.length === 0 || params.allowedRoleIds.includes(ctx.currentRole.id)
  );
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
        label: 'Bulk Operations',
        icon: 'pen-ruler',
        placement: ['after', 'content'],
        pointsTo: { pageId: PAGE_ID },
      },
    ];
  },
  renderPage(pageId, ctx) {
    if (pageId !== PAGE_ID) {
      return;
    }

    return render(<WorkbenchPage ctx={ctx} />);
  },
});
