import { connect } from 'datocms-plugin-sdk';
import 'datocms-react-ui/styles.css';
import '@xyflow/react/dist/style.css';
import './index.css';
import { render } from '@/utils/render';
import ExportModal from './entrypoints/ExportModal';

connect({
  schemaItemTypeDropdownActions() {
    return [
      {
        id: 'export',
        label: 'Export as JSON...',
        icon: 'file-export',
      },
    ];
  },
  async executeSchemaItemTypeDropdownAction(_id, itemType, ctx) {
    const result = await ctx.openModal({
      title: 'Export to JSON',
      id: 'export',
      width: 2000,
      parameters: { itemType },
    });
  },
  renderModal(_modalId, ctx) {
    return render(<ExportModal ctx={ctx} />);
  },
  settingsAreaSidebarItemGroups() {
    return [
      {
        label: 'Import',
        items: [
          {
            label: 'Import from JSON',
            icon: 'file-import',
            pointsTo: { pageId: 'import' },
          },
        ],
      },
    ];
  },
  renderPage(_id, ctx) {
    return render(<ImportPage ctx={ctx} />);
  },
});
