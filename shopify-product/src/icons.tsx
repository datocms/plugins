import {
  ArrowDown,
  ArrowRightLeft,
  ArrowUp,
  Barcode,
  CircleExclamationPoint,
  EllipsisVertical,
  ExternalLink,
  Eye,
  EyeOff,
  Globe,
  Layers,
  LayoutGrid,
  List,
  Plus,
  RefreshCw,
  Search,
  Star,
  Tag,
  Trash,
  X,
} from 'lucide-react';
import type { ShopifyKind } from './types';

// The icons of the plugin, from Lucide. They are drawn at 1em, the size of the
// text around them (see the LucideProvider in utils/render.tsx).

export const ArrowDownIcon = ArrowDown;
export const ArrowRightArrowLeftIcon = ArrowRightLeft;
export const ArrowUpIcon = ArrowUp;
export const ArrowUpRightFromSquareIcon = ExternalLink;
export const ArrowsRotateIcon = RefreshCw;
export const BarcodeIcon = Barcode;
export const CircleExclamationIcon = CircleExclamationPoint;
export const EllipsisVerticalIcon = EllipsisVertical;
export const EyeIcon = Eye;
export const EyeSlashIcon = EyeOff;
export const GlobeIcon = Globe;
export const GridIcon = LayoutGrid;
export const LayerGroupIcon = Layers;
export const ListIcon = List;
export const MagnifyingGlassIcon = Search;
export const PlusIcon = Plus;
export const StarIcon = Star;
export const TagIcon = Tag;
export const TrashIcon = Trash;
export const XmarkIcon = X;

/**
 * The icon of an item without a picture: the tag for products and variants,
 * the layers for collections.
 */
export function KindIcon({ kind }: { kind: ShopifyKind }) {
  return kind === 'collection' ? <Layers /> : <Tag />;
}
