import Button from 'datocms-react-ui/Button';
import { Page } from 'datocms-react-ui/Page';
import {
  Table,
  type TableColumn,
  type TableLayout,
  useInMemoryTableLayout,
} from 'datocms-react-ui/Table';
import Toolbar from 'datocms-react-ui/Toolbar';
import { useEffect, useMemo, useState } from 'react';
import { ArrowUpRightFromSquareIcon, ImageIcon } from '../../icons';
import { formatFileSize } from '../../utils/formatters';
import type {
  AssetOptimizerResult,
  OptimizedAsset,
  ProcessedAsset,
} from '../../utils/optimizationUtils';
import { ASSET_PAGE_SIZE, getAssetPage } from './presentation';

export type AssetCategory = 'optimized' | 'skipped' | 'failed';

type ResultAsset = OptimizedAsset | ProcessedAsset;

// The width of the controls of a row: two micro icon buttons
const ROW_CONTROLS_WIDTH = 64;

const extensionOf = (asset: ResultAsset) =>
  (asset.path.split('.').pop() ?? '').toUpperCase();

const sizesOf = (asset: ResultAsset) =>
  'originalSize' in asset
    ? { originalSize: asset.originalSize, optimizedSize: asset.optimizedSize }
    : { originalSize: undefined, optimizedSize: undefined };

const computeSavingsPercentage = (asset: ResultAsset): string => {
  const { originalSize, optimizedSize } = sizesOf(asset);
  if (!originalSize || !optimizedSize) return '—';
  return `${Math.round(((originalSize - optimizedSize) / originalSize) * 100)}%`;
};

const fileColumn: TableColumn<ResultAsset> = {
  name: 'file',
  label: 'File',
  minWidth: 240,
  renderCell: (asset) => asset.path,
};

const typeColumn: TableColumn<ResultAsset> = {
  name: 'type',
  label: 'Type',
  priority: 1,
  renderCell: extensionOf,
};

function columnsOf(
  category: AssetCategory,
  isPreview: boolean,
): TableColumn<ResultAsset>[] {
  if (category === 'skipped') return [fileColumn, typeColumn];
  if (category === 'failed')
    return [
      fileColumn,
      typeColumn,
      {
        name: 'error',
        label: 'Error',
        priority: 2,
        truncate: false,
        renderCell: (asset) => ('error' in asset ? asset.error : undefined),
      },
    ];
  return [
    fileColumn,
    typeColumn,
    {
      name: 'originalSize',
      label: 'Original size',
      renderCell: (asset) => {
        const { originalSize } = sizesOf(asset);
        return originalSize === undefined ? '—' : formatFileSize(originalSize);
      },
    },
    {
      name: 'optimizedSize',
      label: isPreview ? 'Expected size' : 'New size',
      renderCell: (asset) => {
        const { optimizedSize } = sizesOf(asset);
        return optimizedSize === undefined
          ? '—'
          : formatFileSize(optimizedSize);
      },
    },
    {
      name: 'saved',
      label: 'Saved',
      priority: 2,
      renderCell: computeSavingsPercentage,
    },
  ];
}

const DEFAULT_LAYOUTS: Record<AssetCategory, TableLayout> = {
  optimized: {
    columns: [
      { name: 'file', width: 4 },
      { name: 'type', width: 1 },
      { name: 'originalSize', width: 1.5 },
      { name: 'optimizedSize', width: 1.5 },
      { name: 'saved', width: 1 },
    ],
  },
  skipped: {
    columns: [
      { name: 'file', width: 4 },
      { name: 'type', width: 1 },
    ],
  },
  failed: {
    columns: [
      { name: 'file', width: 3 },
      { name: 'type', width: 1 },
      { name: 'error', width: 4 },
    ],
  },
};

type CategoryGroupProps = {
  category: AssetCategory;
  title: string;
  assets: readonly ResultAsset[];
  isPreview: boolean;
  open: boolean;
  onToggle: () => void;
  environmentPrefix: string;
};

/** The images of one category of the results, in a table that opens */
function CategoryGroup({
  category,
  title,
  assets,
  isPreview,
  open,
  onToggle,
  environmentPrefix,
}: CategoryGroupProps) {
  const [layout, setLayout] = useInMemoryTableLayout(DEFAULT_LAYOUTS[category]);
  const columns = useMemo(
    () => columnsOf(category, isPreview),
    [category, isPreview],
  );
  const [page, setPage] = useState(0);
  // biome-ignore lint/correctness/useExhaustiveDependencies: Reset pagination whenever the result set changes.
  useEffect(() => {
    setPage(0);
  }, [assets, category]);

  const assetPage = getAssetPage(assets, page);

  return (
    <Page.Group
      title={title}
      flush
      collapse={{ open, onToggle }}
      footer={
        assets.length > ASSET_PAGE_SIZE ? (
          <Toolbar>
            <Toolbar.Pagination
              ariaLabel={title}
              totalEntries={assets.length}
              perPage={ASSET_PAGE_SIZE}
              currentPage={assetPage.page}
              onChange={setPage}
            />
          </Toolbar>
        ) : undefined
      }
    >
      <Table
        columns={columns}
        layout={layout}
        onLayoutChange={setLayout}
        trailingWidth={ROW_CONTROLS_WIDTH}
      >
        <Table.Header />
        <Table.Body>
          {assetPage.assets.map((asset) => (
            <Table.Row
              key={asset.id}
              row={asset}
              trailing={
                <>
                  <Button
                    tone="ghost"
                    size="micro"
                    iconOnly
                    icon={ArrowUpRightFromSquareIcon}
                    label="Open image"
                    href={asset.url}
                    newTab
                  />
                  <Button
                    tone="ghost"
                    size="micro"
                    iconOnly
                    icon={ImageIcon}
                    label="Open in media area"
                    to={`${environmentPrefix}/media/assets/${asset.id}`}
                    newTab
                  />
                </>
              }
            />
          ))}
        </Table.Body>
      </Table>
    </Page.Group>
  );
}

interface AssetListProps {
  result: AssetOptimizerResult;
  isPreview: boolean;
  openCategories: readonly AssetCategory[];
  onToggleCategory: (category: AssetCategory) => void;
  environmentPrefix: string;
}

/**
 * The lists of the optimized, skipped and failed images of a run. A category
 * with no image has no list.
 */
const AssetList = ({
  result,
  isPreview,
  openCategories,
  onToggleCategory,
  environmentPrefix,
}: AssetListProps) => {
  const categories: {
    category: AssetCategory;
    title: string;
    assets: readonly ResultAsset[];
  }[] = [
    {
      category: 'optimized',
      title: isPreview ? 'Images to optimize' : 'Optimized images',
      assets: result.optimizedAssets,
    },
    {
      category: 'skipped',
      title: 'Skipped images',
      assets: result.skippedAssets,
    },
    { category: 'failed', title: 'Failed images', assets: result.failedAssets },
  ];

  return (
    <>
      {categories
        .filter(({ assets }) => assets.length > 0)
        .map(({ category, title, assets }) => (
          <CategoryGroup
            key={category}
            category={category}
            title={title}
            assets={assets}
            isPreview={isPreview}
            open={openCategories.includes(category)}
            onToggle={() => onToggleCategory(category)}
            environmentPrefix={environmentPrefix}
          />
        ))}
    </>
  );
};

export default AssetList;
