import type { RawApiTypes } from '@datocms/cma-client-browser';

export type RawItem = RawApiTypes.Item;
export type RawItemType = RawApiTypes.ItemType;

export type PublicationStatus = 'draft' | 'updated' | 'published';
export type SortableColumnId =
  | '_preview'
  | '_model'
  | '_status'
  | '_updated_at'
  | '_created_at'
  | 'id';
export type SortDirection = 'ASC' | 'DESC';
export type OrderBy = `${SortableColumnId}_${SortDirection}`;

export type QueryState = {
  page: number;
  perPage: number;
  query: string;
  model: string | null;
  status: PublicationStatus | null;
  orderBy: OrderBy | null;
};

export type ColumnId =
  | '_preview'
  | '_model'
  | '_status'
  | '_updated_at'
  | '_created_at'
  | 'id';

export type ColumnSetting = {
  id: ColumnId;
  width: number;
};

export type ModelSummary = {
  id: string;
  name: string;
  apiKey: string;
  draftModeActive: boolean;
  workflowId: string | null;
};

export type WorkflowStageOption = {
  id: string;
  name: string;
};
