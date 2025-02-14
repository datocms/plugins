import { connect } from 'datocms-plugin-sdk';
import 'datocms-react-ui/styles.css';
import '@xyflow/react/dist/style.css';
import './index.css';
import { render } from '@/utils/render';
import ExportPage from './entrypoints/ExportPage';
import { ImportPage } from './entrypoints/ImportPage';

connect({
  schemaItemTypeDropdownActions() {
    return [
      {
        id: 'import-export',
        label: 'Export as JSON...',
        icon: 'file-export',
      },
    ];
  },
  async executeSchemaItemTypeDropdownAction(_id, itemType, ctx) {
    ctx.navigateTo(
      `${ctx.isEnvironmentPrimary ? '' : `/environments/${ctx.environment}`}/configuration/p/${ctx.plugin.id}/pages/import-export?itemTypeId=${itemType.id}`,
    );
  },
  settingsAreaSidebarItemGroups() {
    return [
      {
        label: 'Schema',
        items: [
          {
            label: 'Import/Export',
            icon: 'file-import',
            pointsTo: { pageId: 'import-export' },
          },
        ],
      },
    ];
  },
  renderPage(_id, ctx) {
    const params = new URLSearchParams(ctx.location.search);
    const itemTypeId = params.get('itemTypeId');

    if (!itemTypeId) {
      return render(<ImportPage ctx={ctx} />);
    }

    return render(<ExportPage ctx={ctx} initialItemTypeId={itemTypeId} />);
  },
});
