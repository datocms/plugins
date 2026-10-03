import type { RenderModalCtx } from 'datocms-plugin-sdk';
import { Canvas, Spinner } from 'datocms-react-ui';
import { useEffect, useMemo, useRef, useState } from 'react';
import { Button } from '../ui/Button';
import { createAssetClient } from '../utils/assetClient';
import {
  type DeletionProgress,
  type DeletionResult,
  type DiscoveryProgress,
  deleteUnusedAssets,
  discoverUnusedAssets,
  type UnusedAsset,
} from '../utils/unusedAssets';
import { useFrameHeight } from '../utils/useFrameHeight';
import s from './styles.module.css';

type PropTypes = {
  ctx: RenderModalCtx;
};

type Phase = 'discovering' | 'ready' | 'deleting' | 'finished' | 'error';

const ASSETS_PER_PAGE = 100;

const formatCount = (value: number) => value.toLocaleString('en-US');

const pluralizeAssets = (count: number) =>
  `${formatCount(count)} ${count === 1 ? 'asset' : 'assets'}`;

const BYTE_UNITS = ['B', 'KB', 'MB', 'GB', 'TB'];

// The dashboard's byte format: base 1024, two decimals without ".00", no space.
function formatBytes(bytes: number) {
  let value = Math.max(0, bytes);
  let unit = 0;
  while (value >= 1024 && unit < BYTE_UNITS.length - 1) {
    value /= 1024;
    unit++;
  }
  const amount = unit === 0 ? String(value) : value.toFixed(2);
  return `${amount.replace(/\.00$/, '')}${BYTE_UNITS[unit]}`;
}

const totalSize = (assets: UnusedAsset[]) =>
  assets.reduce((sum, asset) => sum + asset.size, 0);

function SearchField({
  value,
  onChange,
}: {
  value: string;
  onChange: (value: string) => void;
}) {
  return (
    <div className={s.search}>
      <svg className={s.searchIcon} viewBox="0 0 512 512" aria-hidden="true">
        <path d="M416 208c0 45.9-14.9 88.3-40 122.7l126.6 126.7c12.5 12.5 12.5 32.8 0 45.3s-32.8 12.5-45.3 0L330.7 376c-34.4 25.2-76.8 40-122.7 40C93.1 416 0 322.9 0 208S93.1 0 208 0s208 93.1 208 208zM208 352a144 144 0 1 0 0-288 144 144 0 1 0 0 288z" />
      </svg>
      <input
        type="text"
        className={s.searchInput}
        placeholder="Search by filename…"
        aria-label="Search assets"
        value={value}
        onChange={(event) => onChange(event.target.value)}
      />
      {value && (
        <button
          type="button"
          className={s.searchClear}
          aria-label="Clear search"
          onClick={() => onChange('')}
        >
          <svg viewBox="0 0 384 512" aria-hidden="true">
            <path d="M342.6 150.6c12.5-12.5 12.5-32.8 0-45.3s-32.8-12.5-45.3 0L192 210.7 86.6 105.4c-12.5-12.5-32.8-12.5-45.3 0s-12.5 32.8 0 45.3L146.7 256 41.4 361.4c-12.5 12.5-12.5 32.8 0 45.3s32.8 12.5 45.3 0L192 301.3l105.4 105.3c12.5 12.5 32.8 12.5 45.3 0s12.5-32.8 0-45.3L237.3 256l105.3-105.4z" />
          </svg>
        </button>
      )}
    </div>
  );
}

function SelectAllCheckbox({
  selectedCount,
  total,
  onChange,
}: {
  selectedCount: number;
  total: number;
  onChange: (selected: boolean) => void;
}) {
  const ref = useRef<HTMLInputElement>(null);
  const partial = selectedCount > 0 && selectedCount < total;

  useEffect(() => {
    if (ref.current) {
      ref.current.indeterminate = partial;
    }
  }, [partial]);

  return (
    <input
      ref={ref}
      type="checkbox"
      className={s.checkbox}
      disabled={total === 0}
      checked={total > 0 && selectedCount === total}
      onChange={(event) => onChange(event.target.checked)}
    />
  );
}

const PAGE_WINDOW = 5;

function pageWindow(currentPage: number, pageCount: number) {
  const size = Math.min(PAGE_WINDOW, pageCount);
  const first = Math.min(
    Math.max(0, currentPage - Math.floor(size / 2)),
    pageCount - size,
  );
  return Array.from({ length: size }, (_, index) => first + index);
}

function ListPagination({
  start,
  end,
  total,
  filtered,
  currentPage,
  pageCount,
  onPageChange,
}: {
  start: number;
  end: number;
  total: number;
  filtered: boolean;
  currentPage: number;
  pageCount: number;
  onPageChange: (page: number) => void;
}) {
  return (
    <div className={s.listFooter}>
      <span className={s.meta}>
        Showing {formatCount(start + 1)}–{formatCount(end)} of{' '}
        {filtered
          ? `${formatCount(total)} matching ${total === 1 ? 'asset' : 'assets'}`
          : pluralizeAssets(total)}
      </span>
      <nav className={s.pagination} aria-label="Pagination">
        <button
          type="button"
          className={s.paginationNav}
          disabled={currentPage === 0}
          onClick={() => onPageChange(currentPage - 1)}
        >
          <span aria-hidden="true">« </span>Previous
        </button>
        <div className={s.paginationPages}>
          {pageWindow(currentPage, pageCount).map((pageIndex) =>
            pageIndex === currentPage ? (
              <span
                key={pageIndex}
                className={`${s.paginationPage} ${s.paginationPageCurrent}`}
                aria-current="page"
              >
                {formatCount(pageIndex + 1)}
              </span>
            ) : (
              <button
                key={pageIndex}
                type="button"
                className={s.paginationPage}
                aria-label={`Page ${pageIndex + 1}`}
                onClick={() => onPageChange(pageIndex)}
              >
                {formatCount(pageIndex + 1)}
              </button>
            ),
          )}
        </div>
        <button
          type="button"
          className={s.paginationNav}
          disabled={currentPage === pageCount - 1}
          onClick={() => onPageChange(currentPage + 1)}
        >
          Next<span aria-hidden="true"> »</span>
        </button>
      </nav>
    </div>
  );
}

function AssetConfirmation({
  assets,
  onDelete,
}: {
  assets: UnusedAsset[];
  onDelete: (selected: UnusedAsset[]) => void;
}) {
  const [page, setPage] = useState(0);
  const [query, setQuery] = useState('');
  // Every asset starts selected, so track the ones the user leaves out.
  const [excluded, setExcluded] = useState<ReadonlySet<string>>(new Set());
  const listRef = useRef<HTMLUListElement>(null);

  const search = query.trim().toLowerCase();
  const visible = useMemo(
    () =>
      search
        ? assets.filter((asset) =>
            asset.filename.toLowerCase().includes(search),
          )
        : assets,
    [assets, search],
  );
  const selected = useMemo(
    () =>
      excluded.size === 0
        ? assets
        : assets.filter((asset) => !excluded.has(asset.id)),
    [assets, excluded],
  );
  const selectedBytes = useMemo(() => totalSize(selected), [selected]);
  const visibleSelectedCount = useMemo(
    () => visible.filter((asset) => !excluded.has(asset.id)).length,
    [visible, excluded],
  );

  const pageCount = Math.max(1, Math.ceil(visible.length / ASSETS_PER_PAGE));
  const currentPage = Math.min(page, pageCount - 1);
  const start = currentPage * ASSETS_PER_PAGE;
  const end = Math.min(start + ASSETS_PER_PAGE, visible.length);

  const goToPage = (nextPage: number) => {
    setPage(nextPage);
    if (listRef.current) {
      listRef.current.scrollTop = 0;
    }
  };

  const changeQuery = (nextQuery: string) => {
    setQuery(nextQuery);
    goToPage(0);
  };

  const toggle = (id: string, isSelected: boolean) => {
    setExcluded((current) => {
      const next = new Set(current);
      if (isSelected) {
        next.delete(id);
      } else {
        next.add(id);
      }
      return next;
    });
  };

  // With a search active, "Select all" only affects the matching assets.
  const toggleAll = (isSelected: boolean) => {
    if (!search) {
      setExcluded(
        isSelected ? new Set() : new Set(assets.map((asset) => asset.id)),
      );
      return;
    }
    setExcluded((current) => {
      const next = new Set(current);
      for (const asset of visible) {
        if (isSelected) {
          next.delete(asset.id);
        } else {
          next.add(asset.id);
        }
      }
      return next;
    });
  };

  return (
    <div className={s.stack}>
      <p className={s.lead}>
        Found <strong>{pluralizeAssets(assets.length)}</strong> not in use. The
        selected ones will be permanently deleted. This action cannot be undone.
      </p>
      <div className={s.list}>
        <SearchField value={query} onChange={changeQuery} />
        <div className={s.listHeader}>
          <label className={s.selectAll}>
            <SelectAllCheckbox
              selectedCount={visibleSelectedCount}
              total={visible.length}
              onChange={toggleAll}
            />
            {search ? 'Select all matches' : 'Select all'}
          </label>
          <span className={s.meta}>
            {formatCount(selected.length)} of {formatCount(assets.length)}{' '}
            selected · {formatBytes(selectedBytes)}
          </span>
        </div>
        {visible.length === 0 ? (
          <p className={s.noResults}>No assets match your search</p>
        ) : (
          <ul className={s.listBody} ref={listRef}>
            {visible.slice(start, end).map((asset) => (
              <li key={asset.id} className={s.listRow}>
                <label className={s.selectCell}>
                  <input
                    type="checkbox"
                    className={s.checkbox}
                    aria-label={`Select ${asset.filename}`}
                    checked={!excluded.has(asset.id)}
                    onChange={(event) => toggle(asset.id, event.target.checked)}
                  />
                </label>
                <a
                  className={s.listLink}
                  href={asset.url}
                  target="_blank"
                  rel="noopener noreferrer"
                >
                  {asset.filename}
                </a>
                <span className={s.listSize}>{formatBytes(asset.size)}</span>
              </li>
            ))}
          </ul>
        )}
        {pageCount > 1 && (
          <ListPagination
            start={start}
            end={end}
            total={visible.length}
            filtered={Boolean(search)}
            currentPage={currentPage}
            pageCount={pageCount}
            onPageChange={goToPage}
          />
        )}
      </div>
      <Button
        buttonType="negative"
        buttonSize="xl"
        fullWidth
        disabled={selected.length === 0}
        onClick={() => onDelete(selected)}
      >
        {selected.length === 0
          ? 'Select assets to delete'
          : `Delete ${pluralizeAssets(selected.length)}`}
      </Button>
    </div>
  );
}

type CountRow = [label: string, value: number];

function progressRows(progress: DeletionProgress): CountRow[] {
  return [
    ['Deleted', progress.deleted],
    ['Kept because they are in use', progress.skipped],
    ['Already removed', progress.missing],
    ['Failed', progress.failed],
  ];
}

function DeletionCounts({ rows }: { rows: CountRow[] }) {
  return (
    <dl className={s.counts}>
      {rows.map(([label, value]) => (
        <div key={label} className={s.countRow}>
          <dt>{label}</dt>
          <dd>{formatCount(value)}</dd>
        </div>
      ))}
    </dl>
  );
}

function isComplete(result: DeletionResult) {
  return (
    !result.cancelled &&
    !result.error &&
    result.failed === 0 &&
    result.uncertain === 0 &&
    result.processed === result.total
  );
}

function CircleCheckIcon({ className }: { className: string }) {
  return (
    <svg className={className} viewBox="0 0 512 512" aria-hidden="true">
      <path d="M256 48a208 208 0 1 1 0 416 208 208 0 1 1 0-416zm0 464A256 256 0 1 0 256 0a256 256 0 1 0 0 512zm113-303c9.4-9.4 9.4-24.6 0-33.9s-24.6-9.4-33.9 0l-111 111-47-47c-9.4-9.4-24.6-9.4-33.9 0s-9.4 24.6 0 33.9l64 64c9.4 9.4 24.6 9.4 33.9 0l128-128z" />
    </svg>
  );
}

function CircleExclamationIcon({ className }: { className: string }) {
  return (
    <svg className={className} viewBox="0 0 512 512" aria-hidden="true">
      <path d="M256 48a208 208 0 1 1 0 416 208 208 0 1 1 0-416zm0 464A256 256 0 1 0 256 0a256 256 0 1 0 0 512zm0-384c-13.3 0-24 10.7-24 24v112c0 13.3 10.7 24 24 24s24-10.7 24-24V152c0-13.3-10.7-24-24-24zm32 224a32 32 0 1 0-64 0 32 32 0 1 0 64 0z" />
    </svg>
  );
}

function summaryCopy(result: DeletionResult, complete: boolean) {
  if (complete) {
    return {
      title: 'Assets successfully deleted!',
      description:
        result.deleted === 1
          ? 'The asset has been permanently removed from your project.'
          : 'The assets have been permanently removed from your project.',
    };
  }
  if (result.cancelled) {
    return {
      title: 'Deletion stopped',
      description:
        'Assets deleted before you stopped stay deleted. The rest were left untouched.',
    };
  }
  return {
    title: "Deletion didn't complete",
    description:
      "Some assets couldn't be deleted. Check the details below before starting another deletion.",
  };
}

function DeletionSummary({ result }: { result: DeletionResult }) {
  const complete = isComplete(result);
  const { title, description } = summaryCopy(result, complete);
  const notProcessed = Math.max(
    0,
    result.total - result.processed - result.uncertain,
  );
  const details = (
    [
      ['Kept because they are in use', result.skipped],
      ['Already removed', result.missing],
      ['Failed', result.failed],
      ['Not processed', notProcessed],
    ] satisfies CountRow[]
  ).filter(([, value]) => value > 0);

  return (
    <>
      <div className={s.summaryHeader}>
        {complete ? (
          <CircleCheckIcon className={s.summaryIconSuccess} />
        ) : (
          <CircleExclamationIcon className={s.summaryIcon} />
        )}
        <h2 className={s.title}>{title}</h2>
        <p className={s.summaryDescription}>{description}</p>
      </div>
      <dl className={s.stats}>
        <div className={s.stat}>
          <dt>{result.deleted === 1 ? 'Asset deleted' : 'Assets deleted'}</dt>
          <dd>{formatCount(result.deleted)}</dd>
        </div>
        <div className={s.stat}>
          <dt>
            {result.freedBytesEstimated
              ? 'Storage freed (estimated)'
              : 'Storage freed'}
          </dt>
          <dd>{formatBytes(result.freedBytes)}</dd>
        </div>
      </dl>
      {result.uncertain > 0 && (
        <p role="alert" className={`${s.callout} ${s.calloutWarning}`}>
          Could not confirm deletion of {pluralizeAssets(result.uncertain)}.
          Check your asset library before starting another deletion.
        </p>
      )}
      {result.error && (
        <p role="alert" className={`${s.callout} ${s.calloutDanger}`}>
          {result.error}
        </p>
      )}
      {details.length > 0 && <DeletionCounts rows={details} />}
    </>
  );
}

function DiscoveryStatus({ progress }: { progress: DiscoveryProgress }) {
  return (
    <div className={s.status} role="status" aria-live="polite">
      <Spinner size={32} />
      <p className={s.statusTitle}>Looking for unused assets…</p>
      {progress.total > ASSETS_PER_PAGE && (
        <p className={s.meta}>
          {(progress.attempt ?? 1) > 1 && (
            <>
              Asset library changed; checking again (attempt {progress.attempt}{' '}
              of 3)…{' '}
            </>
          )}
          Checking {formatCount(progress.scanned)} of{' '}
          {formatCount(progress.total)} assets… {formatCount(progress.found)}{' '}
          unused assets found.
        </p>
      )}
    </div>
  );
}

function DeletionStatus({
  progress,
  stopRequested,
  onStop,
}: {
  progress: DeletionProgress;
  stopRequested: boolean;
  onStop: () => void;
}) {
  const started = progress.processed > 0;
  const percent =
    progress.total > 0
      ? Math.floor((progress.processed / progress.total) * 100)
      : 0;

  return (
    <div className={s.stack}>
      <div className={s.progressBlock} role="status" aria-live="polite">
        <div className={s.progressHeader}>
          <span className={s.statusTitle}>
            {stopRequested
              ? 'Stopping after the current batch finishes…'
              : `Deleting ${pluralizeAssets(progress.total)}…`}
          </span>
          <Spinner size={20} />
          <span className={s.progressPercent}>{percent}%</span>
        </div>
        <div
          className={s.progress}
          role="progressbar"
          aria-label="Deletion progress"
          aria-valuemin={0}
          aria-valuemax={progress.total}
          aria-valuenow={progress.processed}
        >
          <div
            className={
              started
                ? s.progressFill
                : `${s.progressFill} ${s.progressFillPending}`
            }
            style={started ? { width: `${percent}%` } : undefined}
          />
        </div>
        <p className={s.meta}>
          {formatCount(progress.processed)} of {pluralizeAssets(progress.total)}{' '}
          processed · {formatBytes(progress.freedBytes)} freed so far
        </p>
      </div>
      <DeletionCounts rows={progressRows(progress)} />
      <p className={s.meta}>
        Keep this window open until the deletion finishes. Closing it stops the
        deletion after the current batch.
      </p>
      {progress.total > ASSETS_PER_PAGE && (
        <Button
          buttonSize="l"
          fullWidth
          disabled={stopRequested}
          onClick={onStop}
        >
          {stopRequested ? 'Stopping…' : 'Stop'}
        </Button>
      )}
    </div>
  );
}

export default function CustomModal({ ctx }: PropTypes) {
  const [unusedAssets, setUnusedAssets] = useState<UnusedAsset[]>([]);
  const [phase, setPhase] = useState<Phase>('discovering');
  const [discoveryProgress, setDiscoveryProgress] = useState<DiscoveryProgress>(
    { scanned: 0, found: 0, total: 0 },
  );
  const [deletionProgress, setDeletionProgress] =
    useState<DeletionProgress | null>(null);
  const [deletionResult, setDeletionResult] = useState<DeletionResult | null>(
    null,
  );
  const [errorMessage, setErrorMessage] = useState('');
  const [stopRequested, setStopRequested] = useState(false);
  const mountedRef = useRef(false);
  const deletionControllerRef = useRef<AbortController | null>(null);
  const deletionInProgressRef = useRef(false);
  const frameRef = useFrameHeight(ctx);

  const client = useMemo(() => {
    if (!ctx.currentUserAccessToken) {
      return null;
    }

    return createAssetClient({
      apiToken: ctx.currentUserAccessToken,
      environment: ctx.environment,
      baseUrl: ctx.cmaBaseUrl,
    });
  }, [ctx.currentUserAccessToken, ctx.environment, ctx.cmaBaseUrl]);
  const selectionClientRef = useRef<typeof client>(null);

  useEffect(() => {
    const controller = new AbortController();
    let active = true;
    mountedRef.current = true;
    selectionClientRef.current = null;
    setUnusedAssets([]);
    setDiscoveryProgress({ scanned: 0, found: 0, total: 0 });
    setDeletionProgress(null);
    setDeletionResult(null);
    setErrorMessage('');
    setStopRequested(false);
    setPhase('discovering');

    if (!client) {
      setErrorMessage(
        'This plugin needs access to your API token to find and delete unused assets.',
      );
      setPhase('error');
    } else {
      discoverUnusedAssets(client, {
        signal: controller.signal,
        onProgress: (progress) => {
          if (active && !controller.signal.aborted) {
            setDiscoveryProgress(progress);
          }
        },
      })
        .then((assets) => {
          if (active && !controller.signal.aborted) {
            selectionClientRef.current = client;
            setUnusedAssets(assets);
            setPhase('ready');
          }
        })
        .catch((error: unknown) => {
          if (active && !controller.signal.aborted) {
            setErrorMessage(
              error instanceof Error
                ? error.message
                : "Couldn't find unused assets. Please close this window and try again.",
            );
            setPhase('error');
          }
        });
    }

    return () => {
      active = false;
      mountedRef.current = false;
      controller.abort();
      deletionControllerRef.current?.abort();
      deletionControllerRef.current = null;
      deletionInProgressRef.current = false;
    };
  }, [client]);

  const close = () => {
    void ctx.resolve('').catch(() => {});
  };

  const startDeletion = async (selected: UnusedAsset[]) => {
    if (
      !client ||
      selected.length === 0 ||
      selectionClientRef.current !== client ||
      phase !== 'ready' ||
      deletionInProgressRef.current
    ) {
      return;
    }

    const controller = new AbortController();
    deletionControllerRef.current = controller;
    deletionInProgressRef.current = true;
    const isCurrentRun = () =>
      mountedRef.current && deletionControllerRef.current === controller;
    setDeletionProgress({
      total: selected.length,
      processed: 0,
      deleted: 0,
      skipped: 0,
      missing: 0,
      failed: 0,
      freedBytes: 0,
    });
    setStopRequested(false);
    setPhase('deleting');

    try {
      const result = await deleteUnusedAssets(client, selected, {
        signal: controller.signal,
        onProgress: (progress) => {
          if (isCurrentRun()) {
            setDeletionProgress(progress);
          }
        },
      });

      if (!isCurrentRun()) {
        return;
      }

      setDeletionResult(result);
      setPhase('finished');
    } catch {
      if (isCurrentRun()) {
        setErrorMessage(
          "Couldn't complete deletion. Counts show the last confirmed progress. Check your asset library before starting another deletion.",
        );
        setPhase('error');
      }
    } finally {
      if (isCurrentRun()) {
        deletionInProgressRef.current = false;
      }
    }
  };

  const stopDeletion = () => {
    deletionControllerRef.current?.abort();
    setStopRequested(true);
  };

  return (
    <Canvas ctx={ctx} noAutoResizer>
      <div ref={frameRef}>
        {phase === 'discovering' && (
          <DiscoveryStatus progress={discoveryProgress} />
        )}
        {phase === 'ready' &&
          (unusedAssets.length ? (
            <AssetConfirmation
              assets={unusedAssets}
              onDelete={(selected) => void startDeletion(selected)}
            />
          ) : (
            <div className={s.empty}>
              <h2 className={s.emptyTitle}>
                There are no unused assets in your library
              </h2>
              <p className={s.meta}>
                Every asset is in use, so there's nothing to delete.
              </p>
            </div>
          ))}
        {phase === 'deleting' && deletionProgress && (
          <DeletionStatus
            progress={deletionProgress}
            stopRequested={stopRequested}
            onStop={stopDeletion}
          />
        )}
        {(phase === 'error' || phase === 'finished') && (
          <div className={s.stack}>
            {phase === 'error' && (
              <>
                <p role="alert" className={`${s.callout} ${s.calloutDanger}`}>
                  {errorMessage}
                </p>
                {deletionProgress && (
                  <DeletionCounts rows={progressRows(deletionProgress)} />
                )}
              </>
            )}
            {phase === 'finished' && deletionResult && (
              <DeletionSummary result={deletionResult} />
            )}
            <Button
              buttonType={
                deletionResult && isComplete(deletionResult)
                  ? 'primary'
                  : 'muted'
              }
              buttonSize="l"
              fullWidth
              onClick={close}
            >
              Close
            </Button>
          </div>
        )}
      </div>
    </Canvas>
  );
}
