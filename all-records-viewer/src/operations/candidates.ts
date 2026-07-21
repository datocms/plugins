import { MAX_BULK_ITEMS } from '../constants';
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
  action: SelectionAction | 'move_to_stage',
): SelectionEvaluation {
  const overflowCount = Math.max(eligible.length - MAX_BULK_ITEMS, 0);
  const submittedItems = overflowCount > 0 ? [] : [...eligible];
  const maxItemsReason =
    overflowCount > 0
      ? `Bulk actions support at most ${MAX_BULK_ITEMS} records.`
      : null;

  return {
    selectedCount: selected.length,
    eligibleCount: eligible.length,
    excludedCount: selected.length - eligible.length,
    submittedCount: submittedItems.length,
    overflowCount,
    items: submittedItems,
    itemIds: submittedItems.map((item) => item.id),
    disabledReason:
      maxItemsReason ??
      disabledReason(action, selected.length, eligible.length),
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
      ...buildEvaluation(selected, [], 'move_to_stage'),
      disabledReason: moveContext.disabledReason,
    };
  }

  const eligible = selected.filter(
    (item) =>
      item.meta.stage !== input.destinationStageId &&
      isPotentiallyEligible({
        item,
        model: moveContext.model,
        permissions: input.permissions,
        action: 'move_to_stage',
        destinationStageId: input.destinationStageId,
      }),
  );

  return buildEvaluation(selected, eligible, 'move_to_stage');
}

export function availableMoveDestinationIds(
  input: SelectionInput & { destinationStageIds: readonly string[] },
): string[] {
  const moveContext = getMoveSelectionContext(input);

  if (!moveContext.enabled) {
    return [];
  }

  return input.destinationStageIds.filter(
    (destinationStageId) =>
      evaluateMoveSelection({ ...input, destinationStageId }).eligibleCount > 0,
  );
}
