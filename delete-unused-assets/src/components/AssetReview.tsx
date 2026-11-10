import Callout from 'datocms-react-ui/Callout';
import ListArea from 'datocms-react-ui/ListArea';
import MultipleSelectionActionBar from 'datocms-react-ui/MultipleSelectionActionBar';
import Pane from 'datocms-react-ui/Pane';
import {
  Table,
  type TableColumn,
  useInMemoryTableLayout,
} from 'datocms-react-ui/Table';
import Toolbar, { useFilterToolbar } from 'datocms-react-ui/Toolbar';
import {
  type MouseEvent,
  memo,
  useCallback,
  useMemo,
  useRef,
  useState,
} from 'react';
import s from '../entrypoints/styles.module.css';
import { formatBytes, useFormatters } from '../utils/format';
import type { UnusedAsset } from '../utils/unusedAssets';

export const ASSETS_PER_PAGE = 100;

// The link opens the file: it doesn't toggle the row.
const stopPropagation = (event: MouseEvent) => event.stopPropagation();

const COLUMNS: TableColumn<UnusedAsset>[] = [
  {
    name: 'filename',
    label: 'Filename',
    // A long name ends with an ellipsis: the title shows it in full.
    renderCell: (asset) => (
      <a
        title={asset.filename}
        href={asset.url}
        target="_blank"
        rel="noopener noreferrer"
        onClick={stopPropagation}
      >
        {asset.filename}
      </a>
    ),
  },
  {
    name: 'size',
    label: 'Size',
    renderCell: (asset) => formatBytes(asset.size),
  },
];

// The shares of the table of assets in the Table docs: the size column fits
// a size in full ("1023.99KB") in the narrow settings column, and the
// filename takes the rest.
const DEFAULT_LAYOUT = {
  columns: [
    { name: 'filename', width: 0.7 },
    { name: 'size', width: 0.3 },
  ],
};

const totalSize = (assets: UnusedAsset[]) =>
  assets.reduce((sum, asset) => sum + asset.size, 0);

// Resets the scroll of the pane content that holds the element.
function scrollToTop(
  element: HTMLElement | null,
  boundary: HTMLElement | null,
) {
  for (
    let node = element?.parentElement;
    node && node !== boundary;
    node = node.parentElement
  ) {
    if (node.scrollTop > 0) {
      node.scrollTop = 0;
    }
  }
}

// A row renders again only when its own selection changes.
const AssetRow = memo(function AssetRow({
  asset,
  selected,
  onToggle,
}: {
  asset: UnusedAsset;
  selected: boolean;
  onToggle: (id: string) => void;
}) {
  const selection = useMemo(
    () => ({ selected, onSelect: () => onToggle(asset.id) }),
    [selected, onToggle, asset.id],
  );
  return <Table.Row row={asset} selection={selection} />;
});

type Props = {
  assets: UnusedAsset[];
  onDelete: (selected: UnusedAsset[]) => Promise<void>;
};

export default function AssetReview({ assets, onDelete }: Props) {
  const format = useFormatters();
  const [page, setPage] = useState(0);
  const [query, setQuery] = useState('');
  // Every asset starts selected, so track the ones the user leaves out.
  const [excluded, setExcluded] = useState<ReadonlySet<string>>(
    () => new Set(),
  );
  const [layout, setLayout] = useInMemoryTableLayout(DEFAULT_LAYOUT);
  const reviewRef = useRef<HTMLDivElement>(null);
  const bodyRef = useRef<HTMLDivElement>(null);

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
  // The bar keeps its old props while it slides out: Delete reads the
  // current selection, so it never deletes assets that were just deselected.
  const selectedRef = useRef(selected);
  selectedRef.current = selected;
  const visibleSelectedCount = useMemo(
    () => visible.filter((asset) => !excluded.has(asset.id)).length,
    [visible, excluded],
  );

  const pageCount = Math.max(1, Math.ceil(visible.length / ASSETS_PER_PAGE));
  const currentPage = Math.min(page, pageCount - 1);
  const start = currentPage * ASSETS_PER_PAGE;
  const rows = visible.slice(start, start + ASSETS_PER_PAGE);

  const goToPage = (nextPage: number) => {
    setPage(nextPage);
    scrollToTop(bodyRef.current, reviewRef.current);
  };

  const changeQuery = (nextQuery: string) => {
    setQuery(nextQuery);
    goToPage(0);
  };

  const filter = useFilterToolbar({
    isFiltering: query !== '',
    onClear: () => changeQuery(''),
  });

  const toggle = useCallback((id: string) => {
    setExcluded((current) => {
      const next = new Set(current);
      if (next.has(id)) {
        next.delete(id);
      } else {
        next.add(id);
      }
      return next;
    });
  }, []);

  // With a search active, "select all" only affects the matching assets.
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
    <div ref={reviewRef} className={s.review}>
      <div className={s.reviewPane}>
        <Pane
          ariaLabel="Unused assets"
          header={
            <>
              <Toolbar>
                <Toolbar.Title>Unused assets</Toolbar.Title>
                <Toolbar.Subtitle>
                  {search
                    ? `${format.count(visible.length)} of ${format.assets(assets.length)}`
                    : format.assets(assets.length)}
                </Toolbar.Subtitle>
                <Toolbar.Space />
                <Toolbar.Group>
                  <Toolbar.FilterToggle
                    pressed={filter.open}
                    onClick={filter.onToggle}
                    onOpen={filter.onOpen}
                  />
                </Toolbar.Group>
              </Toolbar>
              {filter.open && (
                <Toolbar fields onClose={filter.onClose}>
                  <Toolbar.FilterInput
                    value={query}
                    onChange={changeQuery}
                    autoFocus={filter.autoFocus}
                    onClose={filter.onClose}
                  />
                </Toolbar>
              )}
            </>
          }
          footer={
            pageCount > 1 && (
              <Toolbar>
                <Toolbar.Pagination
                  currentPage={currentPage}
                  perPage={ASSETS_PER_PAGE}
                  totalEntries={visible.length}
                  onChange={goToPage}
                />
              </Toolbar>
            )
          }
          slideUpToolbar={
            <MultipleSelectionActionBar
              open={selected.length > 0}
              status={{
                id: 'deleteUnusedAssets.selection',
                values: {
                  selected: selected.length,
                  total: assets.length,
                  size: formatBytes(selectedBytes),
                },
              }}
              onDeselectAll={() =>
                setExcluded(new Set(assets.map((asset) => asset.id)))
              }
              actions={[
                {
                  id: 'delete',
                  label: 'Delete',
                  tone: 'primary',
                  onClick: () => {
                    const current = selectedRef.current;
                    return current.length > 0
                      ? onDelete(current)
                      : Promise.resolve();
                  },
                },
              ]}
            />
          }
        >
          {/* The area holds the notice and the table, or the blank slate alone:
            the blank slate centers itself in the whole pane content. */}
          <ListArea>
            {visible.length === 0 ? (
              <Pane.FilterBlankSlate />
            ) : (
              <>
                <Callout tone="warning" title="Deletion is permanent">
                  These assets aren't used by any record in this environment,
                  but your website may still link to some of them directly.
                  Untick anything you want to keep.
                </Callout>
                <Table
                  columns={COLUMNS}
                  layout={layout}
                  onLayoutChange={setLayout}
                  checkboxes={{ alwaysVisible: true }}
                >
                  <Table.Header
                    selectAll={{
                      selected: visibleSelectedCount === visible.length,
                      onChange: toggleAll,
                    }}
                  />
                  <Table.Body ref={bodyRef}>
                    {rows.map((asset) => (
                      <AssetRow
                        key={asset.id}
                        asset={asset}
                        selected={!excluded.has(asset.id)}
                        onToggle={toggle}
                      />
                    ))}
                  </Table.Body>
                </Table>
                {/* The selection bar floats over the bottom of the list: this
                  room lets the last rows scroll above it. */}
                {selected.length > 0 && (
                  <div className={s.selectionBarRoom} aria-hidden="true" />
                )}
              </>
            )}
          </ListArea>
        </Pane>
      </div>
    </div>
  );
}
