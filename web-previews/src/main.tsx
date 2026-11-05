// The kit stylesheet loads first, thus the CSS modules of the plugin come
// after it and win at the same specificity
import 'datocms-react-ui/styles.css';
import { connect } from 'datocms-plugin-sdk';
import Canvas from 'datocms-react-ui/Canvas';
import ConfigScreen from './entrypoints/ConfigScreen';
import FormPreviewLinks from './entrypoints/FormPreviewLinks';
import Inspector from './entrypoints/Inspector';
import InspectorLoading from './entrypoints/InspectorLoading';
import NotConnectedPanel from './entrypoints/NotConnectedPanel';
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
            label: 'Visual Editing',
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
        label: 'Preview links',
        startOpen: previewLinksSidebarPanel.startOpen,
        placement: ['after', 'info'],
      },
    ];
  },
  renderItemFormSidebarPanel(_sidebarPanelId, ctx) {
    render(
      <Canvas ctx={ctx} texts={TEXTS}>
        {/* The first save of a record starts the panel again: no frontend
            answered for the unsaved record, so the links of the saved
            record load with their spinner */}
        <SidebarPanel key={ctx.item ? 'saved' : 'new'} ctx={ctx} />
      </Canvas>,
    );
  },
  itemFormOutlets(itemType, ctx) {
    if (itemType.attributes.modular_block) {
      return [];
    }

    const { frontends, previewLinksFormOutlet } = normalizeParameters(
      ctx.plugin.attributes.parameters as Parameters,
    );

    if (
      !previewLinksFormOutlet ||
      !frontends.some((f) => !f.disabled && f.previewLinks)
    ) {
      return [];
    }

    return [{ id: 'webPreviewsLinks', initialHeight: 0 }];
  },
  renderItemFormOutlet(_itemFormOutletId, ctx) {
    render(
      <Canvas ctx={ctx} texts={TEXTS}>
        <FormPreviewLinks ctx={ctx} />
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
        {/* As the panel, it starts again on the first save of the record */}
        <SidebarFrame key={ctx.item ? 'saved' : 'new'} ctx={ctx} />
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
      case 'WEBSITE_NOT_CONNECTED':
        return render(
          <Canvas ctx={ctx} texts={TEXTS} noAutoResizer>
            <NotConnectedPanel />
          </Canvas>,
        );
      default:
        return render(
          <Canvas ctx={ctx} texts={TEXTS} noAutoResizer>
            <InspectorLoading ctx={ctx} />
          </Canvas>,
        );
    }
  },
});
