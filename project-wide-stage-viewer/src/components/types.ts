import type { ReactNode } from 'react';
import type {
  ColumnId,
  ColumnSetting,
  OrderBy,
  PublicationStatus,
} from '../types';

export type TableColumn = {
  id: ColumnId;
  label: string;
  sortable: boolean;
};

export type TableRecord = {
  id: string;
  title: ReactNode;
  imageUrl?: string | null;
  imageAlt?: string;
  model: ReactNode;
  status: PublicationStatus | 'new';
  statusLabel?: ReactNode;
  updatedAt: ReactNode;
  createdAt: ReactNode;
  publishedValid?: boolean | null;
  currentValid?: boolean | null;
  draftModeActive?: boolean | null;
};

export type TableSortHandler = (orderBy: OrderBy | null) => void;

export type ColumnSettingsHandler = (columns: readonly ColumnSetting[]) => void;

export type SelectionActionId = 'delete' | 'publish' | 'unpublish' | 'move';

export type SelectionAction = {
  label?: ReactNode;
  disabled?: boolean;
  disabledReason?: string;
  onClick: () => void | Promise<void>;
};
