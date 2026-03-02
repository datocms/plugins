import { connect, type RenderItemFormSidebarPanelCtx } from 'datocms-plugin-sdk';
import 'datocms-react-ui/styles.css';
import SidebarPanel from './entrypoints/SidebarPanel';
import { render } from './utils/render';

connect({
  itemFormSidebarPanels(_itemType, ctx) {
    const params = ctx.plugin.attributes.parameters as Record<string, unknown>;
    if (!params.itemTypeApiKey || !params.fieldApiKey) {
      return [];
    }

    return [
      {
        id: 'inverseRelationships',
        label: 'Inverse relationships',
        startOpen: true,
      },
    ];
  },

  renderItemFormSidebarPanel(sidebarPanelId: string, ctx: RenderItemFormSidebarPanelCtx) {
    if (sidebarPanelId === 'inverseRelationships') {
      render(<SidebarPanel ctx={ctx} />);
    }
  },
});
