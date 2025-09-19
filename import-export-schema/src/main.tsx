import { connect } from 'datocms-plugin-sdk';
import 'datocms-react-ui/styles.css';
import '@xyflow/react/dist/style.css';
import './index.css';
import { Spinner } from 'datocms-react-ui';
import { lazy, Suspense } from 'react';
import { render } from '@/utils/render';

// Lazy-load entrypoints so the iframe boots with only the shared shell.
// Each page chunk loads on demand, keeping initial bundles lighter and first render quicker.
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
    const environmentPrefix = ctx.isEnvironmentPrimary ? '' : `/environments/${ctx.environment}`;
    const exportPagePath = `/configuration/p/${ctx.plugin.id}/pages/export`;
    const navigateUrl = `${environmentPrefix}${exportPagePath}?itemTypeId=${itemType.id}`;

    ctx.navigateTo(navigateUrl);
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
    // All page renders may include an itemTypeId query param when navigating from a schema dropdown.
    const params = new URLSearchParams(ctx.location.search);
    const itemTypeId = params.get('itemTypeId');

    if (pageId === 'import') {
      // Direct navigation to the import page always boots the import screen in import-only mode.
      return render(
        <Suspense fallback={<Spinner size={60} placement="centered" />}>
          <LazyImportPage ctx={ctx} initialMode="import" />
        </Suspense>,
      );
    }

    if (pageId === 'export') {
      if (itemTypeId) {
        // Export triggered from a specific item type skips the landing step and hydrates the export page.
        return render(
          <Suspense fallback={<Spinner size={60} placement="centered" />}>
            <LazyExportPage ctx={ctx} initialItemTypeId={itemTypeId} />
          </Suspense>,
        );
      }
      // Bare export navigation shows the landing page so the user can choose what to export.
      return render(
        <Suspense fallback={<Spinner size={60} placement="centered" />}>
          <LazyExportHome ctx={ctx} />
        </Suspense>,
      );
    }

    // Unknown page IDs fall back to the import screen to preserve legacy deep links.
    return render(
      <Suspense fallback={<Spinner size={60} placement="centered" />}>
        <LazyImportPage ctx={ctx} initialMode="import" />
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
