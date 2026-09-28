import { connect } from 'datocms-plugin-sdk';
import 'datocms-react-ui/styles.css';
import './kit-fixes.css';
import './styles/recipes.css';
import './styles/app.css';
import { PAGE_ID, PANEL_ID, SCOPE_MODAL_ID } from './constants';
import ConfigScreen from './entrypoints/ConfigScreen';
import ProjectPage from './entrypoints/ProjectPage';
import RecordPanel from './entrypoints/RecordPanel';
import ScopeModal from './entrypoints/ScopeModal';
import { contextKey } from './utils/contextKey';
import { render } from './utils/render';

connect({
  contentAreaSidebarItems(ctx) {
    // Without the API permission the page can't scan: it stays out of the navigation.
    if (!ctx.plugin.attributes.permissions.includes('currentUserAccessToken'))
      return [];
    return [
      {
        label: 'Link checker',
        icon: 'link',
        pointsTo: { pageId: PAGE_ID },
        placement: ['after', 'menuItems'],
      },
    ];
  },
  renderPage(pageId, ctx) {
    switch (pageId) {
      case PAGE_ID:
        render(<ProjectPage key={contextKey(ctx)} ctx={ctx} />);
        break;
    }
  },
  itemFormSidebarPanels(itemType) {
    if (itemType.attributes.modular_block) return [];
    return [
      {
        id: PANEL_ID,
        label: 'Broken links',
        startOpen: false,
        placement: ['after', 'links'],
        // The idle panel: just the "Check links" button
        initialHeight: 41,
      },
    ];
  },
  renderItemFormSidebarPanel(panelId, ctx) {
    switch (panelId) {
      case PANEL_ID:
        render(
          <RecordPanel
            key={`${contextKey(ctx)}:${ctx.item?.id ?? 'new'}:${ctx.itemType.id}`}
            ctx={ctx}
          />,
        );
        break;
    }
  },
  renderModal(modalId, ctx) {
    switch (modalId) {
      case SCOPE_MODAL_ID:
        render(<ScopeModal ctx={ctx} />);
        break;
    }
  },
  renderConfigScreen(ctx) {
    render(<ConfigScreen ctx={ctx} />);
  },
});
