import { connect } from 'datocms-plugin-sdk';
import 'datocms-react-ui/styles.css';
import { AssetDeletionSidebar } from './components/AssetDeletionSidebar.tsx';
import { render } from './utils/render';

connect({
  uploadSidebarPanels() {
    return [
      {
        id: 'deleteFromOtherEnvs',
        label: 'Delete from other environments',
      },
    ];
  },

  renderUploadSidebarPanel(_id, ctx) {
    render(<AssetDeletionSidebar ctx={ctx} />);
  },
});
