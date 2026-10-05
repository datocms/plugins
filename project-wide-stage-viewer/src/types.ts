import type { RawApiTypes } from '@datocms/cma-client-browser';

/**
 * One workflow stage pinned to the content sidebar. The names are snapshots
 * taken when the settings were saved: the sidebar entry needs them
 * synchronously, and the stage page refreshes them from the API.
 */
export type StageMenuItem = {
  /** The page ID, `wf.{workflowId}.st.{stageId}` (see `buildPageId`). */
  id: string;
  workflowId: string;
  workflowName: string;
  stageId: string;
  stageName: string;
  /** Sidebar label. Falls back to the stage name. */
  label?: string;
  /** Font Awesome 6 icon name. Falls back to `DEFAULT_ICON`. */
  icon?: string;
};

export type PluginParameters = {
  menuItems: StageMenuItem[];
};

export type WorkflowStage = {
  id: string;
  name: string;
};

export type Workflow = {
  id: string;
  name: string;
  stages: WorkflowStage[];
};

export type PublicationStatus = 'draft' | 'updated' | 'published';

export type ColumnId =
  | '_preview'
  | '_model'
  | '_status'
  | '_updated_at'
  | '_created_at'
  | 'id';

export type SortableColumnId = ColumnId;
export type SortDirection = 'ASC' | 'DESC';
export type OrderBy = `${SortableColumnId}_${SortDirection}`;

export type ColumnSetting = {
  id: ColumnId;
  width: number;
};

export type RawItem = RawApiTypes.Item;
export type RawItemType = RawApiTypes.ItemType;

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
