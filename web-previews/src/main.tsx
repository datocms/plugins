import {
  type RenderItemFormSidebarCtx,
  type RenderItemFormSidebarPanelCtx,
  connect,
} from 'datocms-plugin-sdk';
import ConfigScreen from './entrypoints/ConfigScreen';
import SidebarFrame from './entrypoints/SidebarFrame';
import SidebarPanel from './entrypoints/SidebarPanel';
import { render } from './utils/render';
import 'datocms-react-ui/styles.css';
import { type Parameters, normalizeParameters } from './types';
import { readSidebarWidth } from './utils/persistedWidth';

connect({
  renderConfigScreen(ctx) {
    return render(<ConfigScreen ctx={ctx} />);
  },
  itemFormSidebarPanels(_itemType, ctx) {
    const { startOpen } = normalizeParameters(
      ctx.plugin.attributes.parameters as Parameters,
    );

    return [
      {
        id: 'webPreviews',
        label: 'Web previews',
        startOpen,
        placement: ['before', 'links'],
      },
    ];
  },
  renderItemFormSidebarPanel(
    _sidebarPanelId,
    ctx: RenderItemFormSidebarPanelCtx,
  ) {
    render(<SidebarPanel ctx={ctx} />);
  },
  itemFormSidebars(_itemType, ctx) {
    const { defaultSidebarWidth } = normalizeParameters(
      ctx.plugin.attributes.parameters as Parameters,
    );

    return [
      {
        id: 'webPreviews',
        label: 'Side-by-side web previews',
        preferredWidth:
          readSidebarWidth(ctx.site) || Number.parseInt(defaultSidebarWidth),
      },
    ];
  },
  renderItemFormSidebar(_sidebarId, ctx: RenderItemFormSidebarCtx) {
    render(<SidebarFrame ctx={ctx} />);
  },
});
