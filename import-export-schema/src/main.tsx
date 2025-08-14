import { connect } from 'datocms-plugin-sdk';
import 'datocms-react-ui/styles.css';
import '@xyflow/react/dist/style.css';
import './index.css';
import { Spinner } from 'datocms-react-ui';
import { lazy, Suspense } from 'react';
import { render } from '@/utils/render';

// Lazy-load entrypoints to reduce initial bundle size
const LazyConfig = lazy(() =>
  import('./entrypoints/Config').then((m) => ({ default: m.Config })),
);
const LazyExportHome = lazy(() => import('./entrypoints/ExportHome'));
const LazyExportPage = lazy(() => import('./entrypoints/ExportPage'));
const LazyImportPage = lazy(() =>
  import('./entrypoints/ImportPage').then((m) => ({ default: m.ImportPage })),
);

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
      `${ctx.isEnvironmentPrimary ? '' : `/environments/${ctx.environment}`}/configuration/p/${ctx.plugin.id}/pages/export?itemTypeId=${itemType.id}`,
    );
  },
  settingsAreaSidebarItemGroups() {
    return [
      {
        label: 'Schema',
        items: [
          {
            label: 'Import',
            icon: 'file-import',
            pointsTo: { pageId: 'import' },
          },
          {
            label: 'Export',
            icon: 'file-export',
            pointsTo: { pageId: 'export' },
          },
        ],
      },
    ];
  },
  renderPage(pageId, ctx) {
    const params = new URLSearchParams(ctx.location.search);
    const itemTypeId = params.get('itemTypeId');

    if (pageId === 'import') {
      return render(
        <Suspense fallback={<Spinner size={60} placement="centered" />}>
          <LazyImportPage ctx={ctx} initialMode="import" hideModeToggle />
        </Suspense>,
      );
    }

    if (pageId === 'export') {
      if (itemTypeId) {
        return render(
          <Suspense fallback={<Spinner size={60} placement="centered" />}>
            <LazyExportPage ctx={ctx} initialItemTypeId={itemTypeId} />
          </Suspense>,
        );
      }
      // Export landing with selection flow
      return render(
        <Suspense fallback={<Spinner size={60} placement="centered" />}>
          <LazyExportHome ctx={ctx} />
        </Suspense>,
      );
    }

    // Fallback for legacy pageId
    return render(
      <Suspense fallback={<Spinner size={60} placement="centered" />}>
        <LazyImportPage ctx={ctx} initialMode="import" hideModeToggle />
      </Suspense>,
    );
  },
  renderConfigScreen(ctx) {
    return render(
      <Suspense fallback={<Spinner size={60} placement="centered" />}>
        <LazyConfig ctx={ctx} />
      </Suspense>,
    );
  },
});
