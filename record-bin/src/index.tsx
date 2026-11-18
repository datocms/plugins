import { connect, type RenderModalCtx } from 'datocms-plugin-sdk';
import 'datocms-react-ui/styles.css';
import ConfigScreen from './entrypoints/ConfigScreen';
import ErrorModal from './entrypoints/ErrorModal';
import { createDebugLogger, isDebugEnabled } from './utils/debugLogger';
import { getRuntimeMode } from './utils/getRuntimeMode';
import { captureDeletedItemsWithoutLambda } from './utils/lambdaLessCapture';
import { render } from './utils/render';
import {
  ERROR_MODAL_ID,
  RESTORE_ACTION_ID,
  restoreRecordFromBin,
} from './utils/restoreRecordFromBin';

/** The model of the bin: its records archive the deleted records. */
const RECORD_BIN_MODEL_API_KEY = 'record_bin';

connect({
  async onBeforeItemsDestroy(items, ctx) {
    const debugLogger = createDebugLogger(
      isDebugEnabled(ctx.plugin.attributes.parameters),
      'index.onBeforeItemsDestroy',
    );
    const runtimeMode = getRuntimeMode(ctx.plugin.attributes.parameters);

    // The host currently sends one bulk request, whose CMA limit is 200 IDs.
    // Performing deletion here would bypass other plugins' concurrent vetoes.
    if (items.length > 200) {
      await ctx
        .alert(
          "Record Bin cancelled this deletion because a selection above 200 records can't be archived safely. Delete at most 200 records at a time.",
        )
        .catch((error) =>
          debugLogger.warn('Could not display deletion limit notice', error),
        );
      return false;
    }

    if (runtimeMode === 'lambda') {
      debugLogger.log(
        'Skipping Lambda-less delete capture because lambda mode is active',
      );
      return true;
    }

    try {
      const captureResult = await captureDeletedItemsWithoutLambda(items, ctx);
      debugLogger.log('Lambda-less delete capture completed', captureResult);
      return captureResult.allowDeletion;
    } catch (error) {
      debugLogger.error(
        'Unexpected error in delete capture. Deletion blocked to preserve the records.',
        error,
      );
      return false;
    }
  },
  renderConfigScreen(ctx) {
    const debugLogger = createDebugLogger(
      isDebugEnabled(ctx.plugin.attributes.parameters),
      'index.renderConfigScreen',
    );
    debugLogger.log('Rendering config screen');
    return render(<ConfigScreen ctx={ctx} />);
  },
  itemFormDropdownActions(itemType, ctx) {
    const debugLogger = createDebugLogger(
      isDebugEnabled(ctx.plugin.attributes.parameters),
      'index.itemFormDropdownActions',
    );
    if (itemType.attributes.api_key !== RECORD_BIN_MODEL_API_KEY) return [];
    debugLogger.log('Offering the restore action on a record of the bin');
    return [
      {
        id: RESTORE_ACTION_ID,
        label: 'Restore record',
        icon: 'archive-arrow-up',
      },
    ];
  },
  async executeItemFormDropdownAction(actionId, ctx) {
    if (actionId === RESTORE_ACTION_ID) await restoreRecordFromBin(ctx);
  },
  renderModal(modalId: string, ctx: RenderModalCtx) {
    const debugLogger = createDebugLogger(
      isDebugEnabled(ctx.plugin.attributes.parameters),
      'index.renderModal',
    );
    debugLogger.log('Rendering modal', { modalId });

    switch (modalId) {
      case ERROR_MODAL_ID:
        return render(<ErrorModal ctx={ctx} />);
      default:
        debugLogger.warn('Received unknown modal id', { modalId });
        return undefined;
    }
  },
});
