import type { ApiTypes } from '@datocms/cma-client-browser';

export const TEXT_LIKE_FIELD_TYPES = ['string', 'text', 'slug'] as const;

export type TextLikeFieldType = (typeof TEXT_LIKE_FIELD_TYPES)[number];

export type PluginParameters = {
  allowedRoleIds: string[];
  allowedModelIds: string[];
};

export type FieldConditionOperator =
  | 'eq'
  | 'neq'
  | 'matches'
  | 'exists'
  | 'not_exists';

export type PublicationStatusFilter = 'draft' | 'updated' | 'published' | 'all';

export type OperationType =
  | 'findReplace'
  | 'prepend'
  | 'append'
  | 'setFixedValue'
  | 'clearValue'
  | 'copyField';

export type ModelSummary = {
  id: string;
  name: string;
  apiKey: string;
  workflowId: string | null;
};

export type RoleSummary = {
  id: string;
  name: string;
};

export type FieldSummary = ApiTypes.Field & {
  itemTypeId: string;
  name: string;
};

export type FieldCondition = {
  fieldId: string;
  apiKey: string;
  operator: FieldConditionOperator;
  value?: string;
};

export type GlobalFieldConditionOperator = 'contains' | 'regex';

export type GlobalFieldCondition = {
  operator: GlobalFieldConditionOperator;
  value: string;
};

export type ModelSearchPlan = {
  modelId: string;
  locales: string[];
  publicationStatuses: PublicationStatusFilter[];
  fieldConditions: FieldCondition[];
  globalConditions: GlobalFieldCondition[];
  textFieldApiKeys: string[];
};

export type ModelRule = {
  modelId: string;
  targetFieldId: string;
};

export type CopyRule = {
  modelId: string;
  sourceFieldId: string;
  targetFieldId: string;
};

export type OperationPlan =
  | {
      type: 'findReplace';
      perModel: ModelRule[];
      find: string;
      replace: string;
    }
  | {
      type: 'prepend';
      perModel: ModelRule[];
      value: string;
    }
  | {
      type: 'append';
      perModel: ModelRule[];
      value: string;
    }
  | {
      type: 'setFixedValue';
      perModel: ModelRule[];
      value: string;
      onlyIfEmpty: boolean;
    }
  | {
      type: 'clearValue';
      perModel: ModelRule[];
    }
  | {
      type: 'copyField';
      perModel: CopyRule[];
      onlyIfEmpty: boolean;
    };

export type CandidateStatus = 'draft' | 'updated' | 'published';

export type CandidateRecord = {
  id: string;
  modelId: string;
  modelName: string;
  title: string;
  status: CandidateStatus;
  currentVersion: string | null;
  updatedAt: string | null;
  selected: boolean;
  snapshot: Record<string, unknown>;
};

export type PreviewOutcome = 'change' | 'no_change' | 'skip' | 'invalid';

export type PreviewRow = {
  recordId: string;
  modelId: string;
  modelName: string;
  recordTitle: string;
  targetFieldApiKey: string;
  sourceFieldApiKey?: string;
  locale: string | null;
  beforeValue: string | null;
  afterValue: string | null;
  outcome: PreviewOutcome;
  reason?: string;
};

export type ExecutionStatus = 'success' | 'skipped' | 'failed';

export type ExecutionRow = {
  recordId: string;
  modelId: string;
  modelName: string;
  recordTitle: string;
  status: ExecutionStatus;
  message?: string;
};

export type SearchCounts = {
  total: number;
  byModel: Array<{
    modelId: string;
    modelName: string;
    count: number;
  }>;
};

export type PreparedChange = {
  preview: PreviewRow;
  recordStatus: CandidateStatus;
  currentVersion: string | null;
  targetFieldApiKey: string;
  payload: Record<string, unknown>;
};

export type PermissionView = {
  canAccessPage: boolean;
  canEditSchema: boolean;
  allowedModelIds: Set<string>;
};

export type SearchState = {
  counts: SearchCounts | null;
  candidates: CandidateRecord[];
  frozenAt: string | null;
};

export type ExecutionProgress = {
  total: number;
  completed: number;
  success: number;
  failed: number;
  skipped: number;
  currentLabel: string;
};

export type SearchProgress = {
  plansTotal: number;
  plansCompleted: number;
  currentPlanLabel: string;
  recordsFrozen: number;
  recordsScanned: number;
};
