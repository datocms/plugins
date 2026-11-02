import type { ModelSummary, RawItem } from '../types';
import { isPotentiallyEligible } from './permissions';
import type {
  MoveSelectionContext,
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
  deniedCount: number,
  action: SelectionAction | 'move_to_stage',
): SelectionEvaluation {
  const submittedItems = [...eligible];

  return {
    selectedCount: selected.length,
    eligibleCount: eligible.length,
    excludedCount: selected.length - eligible.length,
    deniedCount,
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
  const eligible: RawItem[] = [];
  let deniedCount = 0;

  for (const item of selected) {
    const model = modelForItem(item, input.modelsById);
    if (!model || !modelAllowsAction(model, input.action)) continue;
    if (
      isPotentiallyEligible({
        item,
        model,
        permissions: input.permissions,
        action: permissionAction,
      })
    ) {
      eligible.push(item);
    } else {
      deniedCount += 1;
    }
  }

  return buildEvaluation(selected, eligible, deniedCount, input.action);
}

export function getMoveSelectionContext(
  input: Pick<SelectionInput, 'items' | 'modelsById'>,
): MoveSelectionContext {
  const selected = uniqueItems(input.items);

  if (selected.length === 0) {
    return {
      enabled: false,
      model: null,
      modelId: null,
      workflowId: null,
      disabledReason: 'Select at least one record.',
    };
  }

  const modelIds = new Set(
    selected.map((item) => item.relationships.item_type.data.id),
  );

  if (modelIds.size !== 1) {
    return {
      enabled: false,
      model: null,
      modelId: null,
      workflowId: null,
      disabledReason:
        'Records must belong to the same model to move them between stages.',
    };
  }

  const modelId = modelIds.values().next().value;
  const model = modelId ? input.modelsById.get(modelId) : undefined;

  if (!model?.workflowId) {
    return {
      enabled: false,
      model: null,
      modelId: null,
      workflowId: null,
      disabledReason: 'The selected model does not use a workflow.',
    };
  }

  return {
    enabled: true,
    model,
    modelId: model.id,
    workflowId: model.workflowId,
    disabledReason: null,
  };
}

export function evaluateMoveSelection(
  input: MoveSelectionInput,
): SelectionEvaluation {
  const selected = uniqueItems(input.items);
  const moveContext = getMoveSelectionContext(input);

  if (!moveContext.enabled) {
    return {
      ...buildEvaluation(selected, [], 0, 'move_to_stage'),
      disabledReason: moveContext.disabledReason,
    };
  }

  const eligible: RawItem[] = [];
  let deniedCount = 0;

  for (const item of selected) {
    // A record already in the stage needs no move
    if (item.meta.stage === input.destinationStageId) continue;
    if (
      isPotentiallyEligible({
        item,
        model: moveContext.model,
        permissions: input.permissions,
        action: 'move_to_stage',
        destinationStageId: input.destinationStageId,
      })
    ) {
      eligible.push(item);
    } else {
      deniedCount += 1;
    }
  }

  return buildEvaluation(selected, eligible, deniedCount, 'move_to_stage');
}

export function availableMoveDestinationIds(
  input: SelectionInput & { destinationStageIds: readonly string[] },
): string[] {
  const moveContext = getMoveSelectionContext(input);

  if (!moveContext.enabled) {
    return [];
  }

  return input.destinationStageIds.filter((destinationStageId) =>
    input.items.some(
      (item) =>
        item.meta.stage !== destinationStageId &&
        isPotentiallyEligible({
          item,
          model: moveContext.model,
          permissions: input.permissions,
          action: 'move_to_stage',
          destinationStageId,
        }),
    ),
  );
}
