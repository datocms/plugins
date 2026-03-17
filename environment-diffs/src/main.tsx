import { connect } from 'datocms-plugin-sdk';
import 'datocms-react-ui/styles.css';
import './index.css';
import { Spinner } from 'datocms-react-ui';
import { lazy, Suspense } from 'react';
import { render } from './utils/render';

const LazySchemaDiffsPage = lazy(() => import('./pages/SchemaDiffsPage'));
const LazyContentDiffsPage = lazy(() => import('./pages/ContentDiffsPage'));
const LazyMediaDiffsPage = lazy(() => import('./pages/MediaDiffsPage'));

function LoadingPage() {
  return (
    <div className="loading-state loading-state--page">
      <Spinner size={60} />
      <p>Loading…</p>
    </div>
  );
}

connect({
  settingsAreaSidebarItemGroups() {
    return [
      {
        label: 'Environment diffs',
        items: [
          {
            label: 'Schema diffs',
            icon: 'code',
            pointsTo: { pageId: 'schema-diffs' },
          },
          {
            label: 'Content diffs',
            icon: 'table',
            pointsTo: { pageId: 'content-diffs' },
          },
          {
            label: 'Media area diffs',
            icon: 'images',
            pointsTo: { pageId: 'media-diffs' },
          },
        ],
      },
    ];
  },
  renderPage(pageId, ctx) {
    switch (pageId) {
      case 'schema-diffs':
        return render(
          <Suspense fallback={<LoadingPage />}>
            <LazySchemaDiffsPage ctx={ctx} />
          </Suspense>,
        );
      case 'content-diffs':
        return render(
          <Suspense fallback={<LoadingPage />}>
            <LazyContentDiffsPage ctx={ctx} />
          </Suspense>,
        );
      case 'media-diffs':
        return render(
          <Suspense fallback={<LoadingPage />}>
            <LazyMediaDiffsPage ctx={ctx} />
          </Suspense>,
        );
      default:
        return render(
          <Suspense fallback={<LoadingPage />}>
            <LazySchemaDiffsPage ctx={ctx} />
          </Suspense>,
        );
    }
  },
});
