import {
  connect,
  type ContentAreaSidebarItemsCtx,
  type ContentAreaSidebarItem,
  type RenderPageCtx,
} from 'datocms-plugin-sdk';
import 'datocms-react-ui/styles.css';
import ConfigScreen from './entrypoints/ConfigScreen';
import StagePage from './entrypoints/StagePage';
import type { PluginParameters, StageMenuItem } from './types';
import { render } from './utils/render';

type ParametersWithFallback = Partial<PluginParameters> | Record<string, unknown> | undefined;

function readMenuItems(params: ParametersWithFallback): StageMenuItem[] {
  const typed = (params ?? {}) as Partial<PluginParameters>;
  return typed.menuItems ?? [];
}

connect({
  renderConfigScreen(ctx) {
    return render(<ConfigScreen ctx={ctx} />);
  },

  contentAreaSidebarItems(ctx: ContentAreaSidebarItemsCtx) {
    const menuItems = readMenuItems(ctx.plugin.attributes.parameters);
    const defaultIcon: ContentAreaSidebarItem['icon'] = 'tasks';

    return menuItems.map((item) => ({
      label: item.label ?? `${item.stageName} (${item.workflowName})`,
      icon: (item.icon ?? defaultIcon) as ContentAreaSidebarItem['icon'],
      placement: ['after', 'menuItems'] as const,
      pointsTo: { pageId: item.id },
    }));
  },

  renderPage(pageId: string, ctx: RenderPageCtx) {
    if (!pageId.startsWith('wf:')) {
      return null;
    }

    const menuItems = readMenuItems(ctx.plugin.attributes.parameters);
    const menuItem = menuItems.find((item) => item.id === pageId) ?? null;

    return render(<StagePage ctx={ctx} menuItem={menuItem} />);
  },
});
