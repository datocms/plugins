import 'datocms-react-ui/styles.css';
import { type ContentAreaSidebarItem, connect } from 'datocms-plugin-sdk';
import { WORKFLOW_STAGE_MODAL_ID } from './constants';
import ConfigScreen from './entrypoints/ConfigScreen';
import StagePage from './entrypoints/StagePage';
import WorkflowStageModal from './entrypoints/WorkflowStageModal';
import { iconByName } from './lib/icons';
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
        // The settings keep Font Awesome names: the host draws the Lucide
        // glyph that means the same thing, or the default for an unknown name.
        icon: iconByName(item.icon ?? DEFAULT_ICON)?.id ?? 'list-checks',
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
