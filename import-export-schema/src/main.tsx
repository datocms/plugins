// The kit stylesheet loads first, then the library CSS of the graph; the CSS
// modules of the plugin come after both and win at the same specificity.
import 'datocms-react-ui/styles.css';
import '@xyflow/react/dist/style.css';
import { connect } from 'datocms-plugin-sdk';
import Canvas, { type BaseCtx } from 'datocms-react-ui/Canvas';
import Spinner from 'datocms-react-ui/Spinner';
import { lazy, type ReactNode, Suspense } from 'react';
import { TEXTS } from '@/texts';
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

/**
 * The root of every frame: the Canvas of the hook, then the lazy chunk. A
 * page fills its frame, so its spinner is centered in it. A frame that sizes
 * itself to its content (the config screen) gets a spinner area instead,
 * which keeps a height while the chunk loads.
 */
function renderFrame(
  ctx: BaseCtx,
  content: ReactNode,
  { selfSizing = false }: { selfSizing?: boolean } = {},
) {
  render(
    <Canvas ctx={ctx} texts={TEXTS}>
      <Suspense
        fallback={selfSizing ? <Spinner.Area size="small" /> : <Spinner />}
      >
        {content}
      </Suspense>
    </Canvas>,
  );
}

connect({
  schemaItemTypeDropdownActions() {
    return [
      {
        id: 'import-export',
        label: 'Export as JSON…',
        icon: 'file-export',
      },
    ];
  },
  async executeSchemaItemTypeDropdownAction(_id, itemType, ctx) {
    const environmentPrefix = ctx.isEnvironmentPrimary
      ? ''
      : `/environments/${ctx.environment}`;
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
      return renderFrame(ctx, <LazyImportPage ctx={ctx} />);
    }

    if (pageId === 'export') {
      if (itemTypeId) {
        // Export triggered from a specific item type skips the start step and hydrates the export page.
        return renderFrame(
          ctx,
          <LazyExportPage ctx={ctx} initialItemTypeId={itemTypeId} />,
        );
      }
      // Bare export navigation shows the start step so the user can choose what to export.
      return renderFrame(ctx, <LazyExportHome ctx={ctx} />);
    }

    // Unknown page IDs fall back to the import screen to preserve legacy deep links.
    return renderFrame(ctx, <LazyImportPage ctx={ctx} />);
  },
  renderConfigScreen(ctx) {
    return renderFrame(ctx, <LazyConfig ctx={ctx} />, { selfSizing: true });
  },
});
