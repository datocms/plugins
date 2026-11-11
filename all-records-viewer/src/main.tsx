import 'datocms-react-ui/styles.css';
import { connect } from 'datocms-plugin-sdk';
import { PAGE_ID, WORKFLOW_STAGE_MODAL_ID } from './constants';
import AllRecordsPage from './entrypoints/AllRecordsPage';
import WorkflowStageModal from './entrypoints/WorkflowStageModal';
import { render } from './utils/render';

connect({
  contentAreaSidebarItems() {
    return [
      {
        label: 'All records',
        icon: 'table-2',
        placement: ['before', 'menuItems'],
        pointsTo: { pageId: PAGE_ID },
      },
    ];
  },

  renderPage(pageId, ctx) {
    switch (pageId) {
      case PAGE_ID:
        render(<AllRecordsPage ctx={ctx} />);
        break;
    }
  },

  renderModal(modalId, ctx) {
    switch (modalId) {
      case WORKFLOW_STAGE_MODAL_ID:
        render(<WorkflowStageModal ctx={ctx} />);
        break;
    }
  },
});
