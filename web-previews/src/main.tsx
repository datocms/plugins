// The kit stylesheet loads first, thus the CSS modules of the plugin come
// after it and win at the same specificity
import 'datocms-react-ui/styles.css';
import { connect } from 'datocms-plugin-sdk';
import Canvas from 'datocms-react-ui/Canvas';
import ConfigScreen from './entrypoints/ConfigScreen';
import { IconPickerModal } from './entrypoints/ConfigScreen/IconPickerInput/IconPickerModal';
import Inspector from './entrypoints/Inspector';
import InspectorLoading from './entrypoints/InspectorLoading';
import SidebarFrame from './entrypoints/SidebarFrame';
import SidebarPanel from './entrypoints/SidebarPanel';
import WrongEnvironmentPanel from './entrypoints/WrongEnvironmentPanel';
import { TEXTS } from './texts';
import {
  getVisualEditingFrontends,
  normalizeParameters,
  type Parameters,
} from './types';
import { readSidebarWidth } from './utils/persistedWidth';
import { render } from './utils/render';

connect({
  mainNavigationTabs(ctx) {
    const params = normalizeParameters(
      ctx.plugin.attributes.parameters as Parameters,
    );

    if (!params.showVisualTab) {
      return [];
    }

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
    render(
      <Canvas ctx={ctx} texts={TEXTS}>
        <ConfigScreen ctx={ctx} />
      </Canvas>,
    );
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
    render(
      <Canvas ctx={ctx} texts={TEXTS}>
        <SidebarPanel ctx={ctx} />
      </Canvas>,
    );
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
  // The preview sidebar, the Visual tab and the panels of the inspector get
  // the size of their frame from the host: no auto-resizer
  renderItemFormSidebar(_sidebarId, ctx) {
    render(
      <Canvas ctx={ctx} texts={TEXTS} noAutoResizer>
        <SidebarFrame ctx={ctx} />
      </Canvas>,
    );
  },
  renderInspector(_inspectorId, ctx) {
    render(
      <Canvas ctx={ctx} texts={TEXTS} noAutoResizer>
        <Inspector ctx={ctx} />
      </Canvas>,
    );
  },
  renderInspectorPanel(panelId, ctx) {
    switch (panelId) {
      case 'CONTENT_COMING_FROM_WRONG_ENVIRONMENT':
        return render(
          <Canvas ctx={ctx} texts={TEXTS} noAutoResizer>
            <WrongEnvironmentPanel ctx={ctx} />
          </Canvas>,
        );
      default:
        return render(
          <Canvas ctx={ctx} texts={TEXTS} noAutoResizer>
            <InspectorLoading />
          </Canvas>,
        );
    }
  },
  renderModal(modalId, ctx) {
    switch (modalId) {
      case 'iconPicker':
        return render(
          <Canvas ctx={ctx} texts={TEXTS}>
            <IconPickerModal ctx={ctx} />
          </Canvas>,
        );
    }
  },
});
