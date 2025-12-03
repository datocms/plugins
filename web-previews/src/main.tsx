import { connect } from 'datocms-plugin-sdk';
import ConfigScreen from './entrypoints/ConfigScreen';
import SidebarFrame from './entrypoints/SidebarFrame';
import SidebarPanel from './entrypoints/SidebarPanel';
import { render } from './utils/render';
import 'datocms-react-ui/styles.css';
import { library } from '@fortawesome/fontawesome-svg-core';
import { fas } from '@fortawesome/free-solid-svg-icons';
import Inspector from './entrypoints/Inspector';
import { type Parameters, normalizeParameters } from './types';
import { readSidebarWidth } from './utils/persistedWidth';

library.add(fas);

connect({
  mainNavigationTabs(ctx) {
    const { visualEditing } = normalizeParameters(
      ctx.plugin.attributes.parameters as Parameters,
    );

    return visualEditing?.enableDraftModeUrl
      ? [
          {
            label: 'Visual',
            icon: 'eye',
            pointsTo: {
              inspectorId: 'visual',
            },
            placement: ['before', 'content'],
          },
        ]
      : [];
  },
  renderConfigScreen(ctx) {
    render(<ConfigScreen ctx={ctx} />);
  },
  itemFormSidebarPanels(_itemType, ctx) {
    const { startOpen } = normalizeParameters(
      ctx.plugin.attributes.parameters as Parameters,
    );

    return [
      {
        id: 'webPreviews',
        label: 'Related website pages',
        startOpen,
        placement: ['before', 'links'],
      },
    ];
  },
  renderItemFormSidebarPanel(_sidebarPanelId, ctx) {
    render(<SidebarPanel ctx={ctx} />);
  },
  itemFormSidebars(_itemType, ctx) {
    const { defaultSidebarWidth } = normalizeParameters(
      ctx.plugin.attributes.parameters as Parameters,
    );

    return [
      {
        id: 'webPreviews',
        label: 'Website preview',
        preferredWidth: readSidebarWidth(ctx.site) || defaultSidebarWidth,
      },
    ];
  },
  renderItemFormSidebar(_sidebarId, ctx) {
    render(<SidebarFrame ctx={ctx} />);
  },
  renderInspector(_inspectorId, ctx) {
    render(<Inspector ctx={ctx} />);
  },
});
