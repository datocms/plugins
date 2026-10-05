import type { ModelSummary, RawItem } from '../types';
import { isPotentiallyEligible } from './permissions';
import type {
  ItemPermissionRule,
  MoveSelectionContext,
  PermissionContext,
  MoveSelectionInput,
  SelectionAction,
  SelectionEvaluation,
  SelectionInput,
} from './types';

function uniqueItems(items: readonly RawItem[]): RawItem[] {
  const seen = new Set<string>();

  return items.filter((item) => {
    if (seen.has(item.id)) {
      return false;
    }

    seen.add(item.id);
    return true;
  });
}

function modelForItem(
  item: RawItem,
  modelsById: ReadonlyMap<string, ModelSummary>,
): ModelSummary | undefined {
  return modelsById.get(item.relationships.item_type.data.id);
}

function modelAllowsAction(
  model: ModelSummary,
  action: SelectionAction,
): boolean {
  if (action === 'delete') {
    return true;
  }

  return model.draftModeActive;
}

function disabledReason(
  action: SelectionAction | 'move_to_stage',
  selectedCount: number,
  eligibleCount: number,
): string | null {
  if (selectedCount === 0) {
    return 'Select at least one record.';
  }

  if (eligibleCount > 0) {
    return null;
  }

  switch (action) {
    case 'delete':
      return 'Your role cannot delete any of the selected records.';
    case 'publish':
      return 'None of the selected records can be published.';
    case 'unpublish':
      return 'None of the selected records can be unpublished.';
    case 'move_to_stage':
      return 'None of the selected records can be moved to this stage.';
  }
}

function buildEvaluation(
  selected: readonly RawItem[],
  eligible: readonly RawItem[],
  action: SelectionAction | 'move_to_stage',
): SelectionEvaluation {
  const submittedItems = [...eligible];

  return {
    selectedCount: selected.length,
    eligibleCount: eligible.length,
    excludedCount: selected.length - eligible.length,
    submittedCount: submittedItems.length,
    overflowCount: 0,
    items: submittedItems,
    itemIds: submittedItems.map((item) => item.id),
    disabledReason: disabledReason(action, selected.length, eligible.length),
  };
}

export function evaluateSelection(
  input: SelectionInput & { action: SelectionAction },
): SelectionEvaluation {
  const selected = uniqueItems(input.items);
  const permissionAction = input.action === 'delete' ? 'delete' : 'publish';
  const eligible = selected.filter((item) => {
    const model = modelForItem(item, input.modelsById);

    return Boolean(
      model &&
        modelAllowsAction(model, input.action) &&
        isPotentiallyEligible({
          item,
          model,
          permissions: input.permissions,
          action: permissionAction,
        }),
    );
  });

  return buildEvaluation(selected, eligible, input.action);
}

function moveDisabled(disabledReason: string): MoveSelectionContext {
  return { enabled: false, workflowId: null, disabledReason };
}

export function getMoveSelectionContext(
  input: Pick<SelectionInput, 'items' | 'modelsById'>,
): MoveSelectionContext {
  const selected = uniqueItems(input.items);

  if (selected.length === 0) {
    return moveDisabled('Select at least one record.');
  }

  const workflowIds = new Set(
    selected.map((item) => modelForItem(item, input.modelsById)?.workflowId),
  );

  if (workflowIds.has(undefined) || workflowIds.has(null)) {
    return moveDisabled('Some of the selected records do not use a workflow.');
  }

  if (workflowIds.size !== 1) {
    return moveDisabled(
      'Records must use the same workflow to move them between stages.',
    );
  }

  const [workflowId] = workflowIds as Set<string>;
  return { enabled: true, workflowId, disabledReason: null };
}

function canMoveTo(
  item: RawItem,
  input: SelectionInput,
  destinationStageId: string,
): boolean {
  const model = modelForItem(item, input.modelsById);
  return Boolean(
    model &&
      item.meta.stage !== destinationStageId &&
      isPotentiallyEligible({
        item,
        model,
        permissions: input.permissions,
        action: 'move_to_stage',
        destinationStageId,
      }),
  );
}

export function evaluateMoveSelection(
  input: MoveSelectionInput,
): SelectionEvaluation {
  const selected = uniqueItems(input.items);
  const moveContext = getMoveSelectionContext(input);

  if (!moveContext.enabled) {
    return {
      ...buildEvaluation(selected, [], 'move_to_stage'),
      disabledReason: moveContext.disabledReason,
    };
  }

  const eligible = selected.filter((item) =>
    canMoveTo(item, input, input.destinationStageId),
  );

  return buildEvaluation(selected, eligible, 'move_to_stage');
}

export function availableMoveDestinationIds(
  input: SelectionInput & { destinationStageIds: readonly string[] },
): string[] {
  if (!getMoveSelectionContext(input).enabled) {
    return [];
  }

  return input.destinationStageIds.filter((destinationStageId) =>
    input.items.some((item) => canMoveTo(item, input, destinationStageId)),
  );
}

/** Stands in for "a stage not named by any rule" when the stages are unknown. */
export const ANY_OTHER_STAGE = '\u0000any-other-stage';

/**
 * Destinations to test when the workflow's stages couldn't be read: every
 * stage the role's move rules name, plus any other stage. Moving is only
 * offered if at least one of them passes the permission checks.
 */
export function potentialMoveDestinationIds(
  permissions: PermissionContext,
): string[] {
  const rules = permissions.role.meta.final_permissions
    .positive_item_type_permissions as unknown as ItemPermissionRule[];
  const named = rules.flatMap((rule) =>
    rule.environment === permissions.environment &&
    (rule.action === 'all' || rule.action === 'move_to_stage') &&
    rule.to_stage
      ? [rule.to_stage]
      : [],
  );
  return [...new Set([...named, ANY_OTHER_STAGE])];
}
