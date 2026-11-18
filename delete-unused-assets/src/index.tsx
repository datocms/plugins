import { connect } from 'datocms-plugin-sdk';
import 'datocms-react-ui/styles.css';
import ConfigScreen from './entrypoints/ConfigScreen';
import UnusedAssetsPage from './entrypoints/UnusedAssetsPage';
import { UNUSED_ASSETS_PAGE_ID } from './utils/paths';
import { render } from './utils/render';

connect({
  renderConfigScreen(ctx) {
    return render(<ConfigScreen ctx={ctx} />);
  },
  settingsAreaSidebarItemGroups(ctx) {
    // The page deletes assets in bulk: only the users who can change the
    // schema see it
    if (!ctx.currentRole.attributes.can_edit_schema) {
      return [];
    }

    return [
      {
        label: 'Asset cleanup',
        items: [
          {
            label: 'Unused assets',
            icon: 'image-off',
            pointsTo: { pageId: UNUSED_ASSETS_PAGE_ID },
          },
        ],
      },
    ];
  },
  renderPage(pageId, ctx) {
    if (pageId === UNUSED_ASSETS_PAGE_ID) {
      return render(<UnusedAssetsPage ctx={ctx} />);
    }
  },
});
