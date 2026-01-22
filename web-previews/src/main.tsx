import { connect } from 'datocms-plugin-sdk';
import ConfigScreen from './entrypoints/ConfigScreen';
import SidebarFrame from './entrypoints/SidebarFrame';
import SidebarPanel from './entrypoints/SidebarPanel';
import { render } from './utils/render';
import 'datocms-react-ui/styles.css';
import { library } from '@fortawesome/fontawesome-svg-core';
import { fas } from '@fortawesome/free-solid-svg-icons';
import { IconPickerModal } from './entrypoints/ConfigScreen/IconPickerInput/IconPickerModal';
import Inspector from './entrypoints/Inspector';
import InspectorLoading from './entrypoints/InspectorLoading';
import WrongEnvironmentPanel from './entrypoints/WrongEnvironmentPanel';
import {
  type Parameters,
  getVisualEditingFrontends,
  normalizeParameters,
} from './types';
import { readSidebarWidth } from './utils/persistedWidth';

library.add(fas);

connect({
  mainNavigationTabs(ctx) {
    const params = normalizeParameters(
      ctx.plugin.attributes.parameters as Parameters,
    );

    const visualEditingFrontends = getVisualEditingFrontends(params);

    return visualEditingFrontends.length > 0
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
    const { previewLinksSidebarPanel } = normalizeParameters(
      ctx.plugin.attributes.parameters as Parameters,
    );

    // Only register the sidebar panel if it's enabled
    if (!previewLinksSidebarPanel) {
      return [];
    }

    return [
      {
        id: 'webPreviews',
        label: 'Related website pages',
        startOpen: previewLinksSidebarPanel.startOpen,
        placement: ['before', 'links'],
      },
    ];
  },
  renderItemFormSidebarPanel(_sidebarPanelId, ctx) {
    render(<SidebarPanel ctx={ctx} />);
  },
  itemFormSidebars(_itemType, ctx) {
    const { previewLinksSidebar } = normalizeParameters(
      ctx.plugin.attributes.parameters as Parameters,
    );

    // Only register the sidebar if it's enabled
    if (!previewLinksSidebar) {
      return [];
    }

    return [
      {
        id: 'webPreviews',
        label: 'Website preview',
        preferredWidth:
          readSidebarWidth(ctx.site) || previewLinksSidebar.defaultWidth,
      },
    ];
  },
  renderItemFormSidebar(_sidebarId, ctx) {
    render(<SidebarFrame ctx={ctx} />);
  },
  renderInspector(_inspectorId, ctx) {
    render(<Inspector ctx={ctx} />);
  },
  renderInspectorPanel(panelId, ctx) {
    switch (panelId) {
      case 'CONTENT_COMING_FROM_WRONG_ENVIRONMENT':
        return render(<WrongEnvironmentPanel ctx={ctx} />);
      default:
        return render(<InspectorLoading ctx={ctx} />);
    }
  },
  renderModal(modalId, ctx) {
    switch (modalId) {
      case 'iconPicker':
        return render(<IconPickerModal ctx={ctx} />);
    }
  },
});
