import type { SchemaTypes } from '@datocms/cma-client-browser';
import {
  connect,
  type ExecuteItemsDropdownActionCtx,
  type ItemDropdownActionsCtx,
  type RenderModalCtx,
} from 'datocms-plugin-sdk';
import 'datocms-react-ui/styles.css';
import {
  type BulkResult,
  bulkChangeCreator,
} from './actions/bulkChangeCreator';
import ConfigScreen from './entrypoints/ConfigScreen';
import SelectCreatorModal from './entrypoints/SelectCreatorModal';
import {
  isBulkResult,
  isCreatorSelection,
  LARGE_SELECTION_THRESHOLD,
  resolveExecutionError,
} from './utils/bulkCreatorWorkflow';
import { render } from './utils/render';

const ACTION_ID = 'bulkChangeCreator';
const MODAL_ID = 'select-creator';
let executionRunning = false;

function recordLabel(count: number) {
  return `${count} record${count === 1 ? '' : 's'}`;
}

function summarizeFailures(failures: BulkResult['failureSamples']) {
  return failures
    .slice(0, 3)
    .map(({ id, error }) => {
      return `${id}: ${error}`;
    })
    .join('\n');
}

function reportResult(result: BulkResult, ctx: ExecuteItemsDropdownActionCtx) {
  if (result.succeeded > 0) {
    ctx.notice(`Creator changed on ${recordLabel(result.succeeded)}.`);
  }

  const messages: string[] = [];
  if (result.failed > 0) {
    messages.push(`Failed to update ${recordLabel(result.failed)}.`);
  }
  if (result.unprocessed > 0) {
    messages.push(
      `${result.unprocessed} record${result.unprocessed === 1 ? ' was' : 's were'} not processed.`,
    );
  }
  if (result.stopped && result.stopReason) {
    messages.push(result.stopReason);
  }

  if (messages.length > 0) {
    const details = summarizeFailures(result.failureSamples);
    ctx.alert(`${messages.join('\n')}${details ? `\n\n${details}` : ''}`);
  }
}

function reportModalCompletion(
  modalResult: unknown,
  itemCount: number,
  ctx: ExecuteItemsDropdownActionCtx,
) {
  if (
    modalResult !== null &&
    typeof modalResult === 'object' &&
    'bulkResult' in modalResult &&
    isBulkResult(modalResult.bulkResult) &&
    modalResult.bulkResult.total <= itemCount
  ) {
    reportResult(modalResult.bulkResult, ctx);
  } else if (
    modalResult !== null &&
    typeof modalResult === 'object' &&
    'executionError' in modalResult &&
    typeof modalResult.executionError === 'string'
  ) {
    ctx.alert(modalResult.executionError);
  } else {
    ctx.alert(
      'The creator change returned an invalid result. Check the selected records before running the action again.',
    );
  }
}

export function executeItemsDropdownAction(
  actionId: string,
  items: ReadonlyArray<{ id: string }>,
  ctx: ExecuteItemsDropdownActionCtx,
): Promise<void> {
  if (actionId !== ACTION_ID) {
    return Promise.resolve();
  }

  if (executionRunning) {
    ctx.notice('A creator change is already in progress.');
    return Promise.resolve();
  }

  if (!ctx.currentUserAccessToken) {
    ctx.alert(
      "This action requires the 'currentUserAccessToken' permission to be granted to the plugin.",
    );
    return Promise.resolve();
  }

  // Release our reference to the SDK's full records before the long async job.
  return executeCreatorChange(
    items.map((item) => item.id),
    ctx.currentUserAccessToken,
    ctx,
  );
}

async function executeCreatorChange(
  itemIds: string[],
  apiToken: string,
  ctx: ExecuteItemsDropdownActionCtx,
) {
  executionRunning = true;
  try {
    const isLargeSelection = itemIds.length >= LARGE_SELECTION_THRESHOLD;
    const modalResult: unknown = await ctx.openModal({
      id: MODAL_ID,
      title: 'Change creators',
      width: 'm',
      ...(isLargeSelection ? { closeDisabled: true } : {}),
      parameters: {
        itemCount: itemIds.length,
        ...(isLargeSelection ? { itemIds } : {}),
      },
    });

    if (modalResult === null || modalResult === undefined) {
      return;
    }

    if (isLargeSelection) {
      reportModalCompletion(modalResult, itemIds.length, ctx);
      return;
    }

    if (!isCreatorSelection(modalResult)) {
      ctx.alert('The selected creator is invalid. No records were updated.');
      return;
    }

    const result = await bulkChangeCreator({
      apiToken,
      environment: ctx.environment,
      baseUrl: ctx.cmaBaseUrl,
      itemIds,
      userId: modalResult.userId,
      userType: modalResult.userType,
    });
    reportResult(result, ctx);
  } catch (error) {
    ctx.alert(resolveExecutionError(error));
  } finally {
    executionRunning = false;
  }
}

connect({
  renderConfigScreen(ctx) {
    return render(<ConfigScreen ctx={ctx} />);
  },
  itemsDropdownActions(
    _itemType: SchemaTypes.ItemType,
    _ctx: ItemDropdownActionsCtx,
  ) {
    return [
      {
        id: ACTION_ID,
        label: 'Change creators…',
        icon: 'user-pen',
      },
    ];
  },
  executeItemsDropdownAction,
  renderModal(modalId: string, modalCtx: RenderModalCtx) {
    if (modalId !== MODAL_ID) {
      return;
    }

    return render(<SelectCreatorModal ctx={modalCtx} />);
  },
});
