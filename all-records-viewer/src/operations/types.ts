import type { Client, RawApiTypes } from '@datocms/cma-client-browser';
import type { Role } from 'datocms-plugin-sdk';
import type { ModelSummary, RawItem } from '../types';

export type PermissionAction = 'delete' | 'publish' | 'move_to_stage';
export type SelectionAction = 'delete' | 'publish' | 'unpublish';
export type BulkOperation = SelectionAction | 'move_to_stage';

export type Identity = {
  id: string;
  type: string;
};

export type PermissionContext = {
  role: Role;
  environment: string;
  currentUser: Identity;
  /**
   * Optional role IDs for record creators, keyed with `identityKey()`.
   * A present `null` value means that the creator has no role; a missing key
   * means that the creator's role is unknown and is treated as potentially
   * eligible, leaving the CMA as the final authority.
   */
  creatorRoleByIdentity?: ReadonlyMap<string, string | null>;
};

export type SelectionInput = {
  items: readonly RawItem[];
  modelsById: ReadonlyMap<string, ModelSummary>;
  permissions: PermissionContext;
};

export type SelectionEvaluation = {
  selectedCount: number;
  eligibleCount: number;
  excludedCount: number;
  submittedCount: number;
  overflowCount: number;
  items: RawItem[];
  itemIds: string[];
  disabledReason: string | null;
};

export type MoveSelectionContext =
  | {
      enabled: true;
      model: ModelSummary;
      modelId: string;
      workflowId: string;
      disabledReason: null;
    }
  | {
      enabled: false;
      model: null;
      modelId: null;
      workflowId: null;
      disabledReason: string;
    };

export type MoveSelectionInput = SelectionInput & {
  destinationStageId: string;
};

export type BulkOperationRequest =
  | {
      operation: SelectionAction;
      itemIds: readonly string[];
    }
  | {
      operation: 'move_to_stage';
      itemIds: readonly string[];
      stage: string;
    };

export type BulkOperationResult = {
  operation: BulkOperation;
  requested: number;
  successful: number;
  failed: number;
};

export type BulkItemsResource = Pick<
  Client['items'],
  | 'rawBulkPublish'
  | 'rawBulkUnpublish'
  | 'rawBulkDestroy'
  | 'rawBulkMoveToStage'
>;

export type BulkClient = {
  items: BulkItemsResource;
};

export type BulkJobResult =
  | RawApiTypes.ItemBulkPublishJobSchema
  | RawApiTypes.ItemBulkUnpublishJobSchema
  | RawApiTypes.ItemBulkDestroyJobSchema
  | RawApiTypes.ItemBulkMoveToStageJobSchema;

export type ItemPermissionRule = {
  action:
    | 'all'
    | 'read'
    | 'update'
    | 'create'
    | 'duplicate'
    | 'delete'
    | 'publish'
    | 'edit_creator'
    | 'take_over'
    | 'move_to_stage';
  environment: string;
  item_type?: string | null;
  workflow?: string | null;
  on_stage?: string | null;
  to_stage?: string | null;
  on_creator?: 'anyone' | 'self' | 'role' | null;
};
