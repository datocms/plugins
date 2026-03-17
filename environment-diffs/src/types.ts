export type DiffStatus =
  | 'leftOnly'
  | 'rightOnly'
  | 'changed'
  | 'unchanged';

export type FilterValue = 'all' | DiffStatus;

export type EnvironmentPair = {
  leftEnv: string;
  rightEnv: string;
};

export type ProgressState = {
  current: number;
  total: number;
  label: string;
};

export type SummaryCounts = {
  total: number;
  changed: number;
  leftOnly: number;
  rightOnly: number;
  unchanged: number;
};

export type DifferenceEntry = {
  path: string;
  kind: 'changed' | 'added' | 'removed';
  leftValue: unknown;
  rightValue: unknown;
};

export type PageQueryState = {
  leftEnv?: string;
  rightEnv?: string;
  filter: FilterValue;
  entityType?: string;
  entityId?: string;
};

export type CompareTaskSignal = {
  cancelled: boolean;
};

export type CompareTaskContext = {
  signal: CompareTaskSignal;
  reportProgress: (current: number, total: number, label: string) => void;
};

export type DetailPanelValue = {
  title: string;
  subtitle?: string;
  status: DiffStatus;
  leftValue?: unknown;
  rightValue?: unknown;
  changes: DifferenceEntry[];
};

export type TableColumn<Row> = {
  key: string;
  title: string;
  className?: string;
  render: (row: Row) => import('react').ReactNode;
};

export type SummaryRow = {
  id: string;
  label: string;
  description?: string;
  counts: SummaryCounts;
};

export type SchemaEntityType = 'model' | 'block' | 'fieldset' | 'field';

export type SchemaSnapshot = {
  entities: NormalizedSchemaEntity[];
};

export type NormalizedSchemaEntity = {
  rowId: string;
  id: string;
  entityType: SchemaEntityType;
  label: string;
  apiKey?: string;
  parentId?: string;
  parentLabel?: string;
  payload: Record<string, unknown>;
};

export type SchemaDiffRow = {
  id: string;
  entityType: SchemaEntityType;
  label: string;
  secondaryLabel?: string;
  parentLabel?: string;
  status: DiffStatus;
  changedCount: number;
};

export type SchemaDiffDetail = DetailPanelValue & {
  entityType: SchemaEntityType;
};

export type SchemaDiffResult = {
  summary: Record<SchemaEntityType, SummaryCounts>;
  rows: SchemaDiffRow[];
  details: Record<string, SchemaDiffDetail>;
};

export type ContentModelDefinition = {
  id: string;
  name: string;
  apiKey: string;
  titleFieldApiKey: string | null;
  fields: Array<{
    id: string;
    apiKey: string;
    label: string;
    fieldType: string;
  }>;
};

export type NormalizedContentRecord = {
  rowId: string;
  id: string;
  modelId: string;
  modelName: string;
  modelApiKey: string;
  label: string;
  publicationStatus: string;
  systemValues: Record<string, unknown>;
  fieldValues: Record<string, unknown>;
};

export type ContentSnapshot = {
  models: ContentModelDefinition[];
  records: NormalizedContentRecord[];
};

export type ContentModelSummary = SummaryRow & {
  apiKey: string;
};

export type ContentDiffRow = {
  id: string;
  entityType: string;
  label: string;
  secondaryLabel: string;
  status: DiffStatus;
  changedCount: number;
  modelId: string;
  modelName: string;
  publicationState: string;
};

export type ContentDiffDetail = DetailPanelValue & {
  modelId: string;
  modelName: string;
};

export type ContentDiffResult = {
  summaryRows: ContentModelSummary[];
  rows: ContentDiffRow[];
  details: Record<string, ContentDiffDetail>;
};

export type NormalizedFolder = {
  rowId: string;
  id: string;
  label: string;
  parentId: string | null;
  position: number;
  path: string;
  payload: Record<string, unknown>;
};

export type NormalizedUpload = {
  rowId: string;
  id: string;
  label: string;
  folderId: string | null;
  folderPath: string | null;
  payload: Record<string, unknown>;
};

export type MediaSnapshot = {
  folders: NormalizedFolder[];
  uploads: NormalizedUpload[];
};

export type MediaEntityType = 'folder' | 'upload';

export type MediaDiffRow = {
  id: string;
  entityType: MediaEntityType;
  label: string;
  secondaryLabel?: string;
  status: DiffStatus;
  changedCount: number;
};

export type MediaDiffDetail = DetailPanelValue & {
  entityType: MediaEntityType;
};

export type MediaDiffResult = {
  summary: Record<MediaEntityType, SummaryCounts>;
  rows: MediaDiffRow[];
  details: Record<string, MediaDiffDetail>;
};
