import { type ContentAreaSidebarItem, connect } from 'datocms-plugin-sdk';
import 'datocms-react-ui/styles.css';
import './kit-fixes.css';
import { WORKFLOW_STAGE_MODAL_ID } from './constants';
import ConfigScreen from './entrypoints/ConfigScreen';
import StagePage from './entrypoints/StagePage';
import WorkflowStageModal from './entrypoints/WorkflowStageModal';
import {
  DEFAULT_ICON,
  parseStagePageId,
  readMenuItems,
  sidebarLabels,
} from './lib/parameters';
import { render } from './utils/render';

connect({
  renderConfigScreen(ctx) {
    render(<ConfigScreen ctx={ctx} />);
  },

  contentAreaSidebarItems(ctx) {
    const items = readMenuItems(ctx.plugin.attributes.parameters);
    const labels = sidebarLabels(items);
    return items.map(
      (item, index): ContentAreaSidebarItem => ({
        label: labels[index],
        // Any Font Awesome 6 name; the host renders unknown ones as a cross.
        icon: (item.icon ?? DEFAULT_ICON) as ContentAreaSidebarItem['icon'],
        placement: ['after', 'menuItems'],
        pointsTo: { pageId: item.id },
      }),
    );
  },

  renderPage(pageId, ctx) {
    const target = parseStagePageId(pageId);
    if (!target) return;

    const menuItem =
      readMenuItems(ctx.plugin.attributes.parameters).find(
        (item) =>
          item.workflowId === target.workflowId &&
          item.stageId === target.stageId,
      ) ?? null;
    render(<StagePage ctx={ctx} menuItem={menuItem} />);
  },

  renderModal(modalId, ctx) {
    if (modalId === WORKFLOW_STAGE_MODAL_ID) {
      render(<WorkflowStageModal ctx={ctx} />);
    }
  },
});
