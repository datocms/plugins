import {
  connect,
  type ItemFormOutletsCtx,
  type ItemType,
  type RenderItemFormOutletCtx,
  type RenderModalCtx,
} from 'datocms-plugin-sdk';
import ConfigScreen from './entrypoints/ConfigScreen';
import { render } from './utils/render';
import 'datocms-react-ui/styles.css';
import BinOutlet from './entrypoints/BinOutlet';
import ErrorModal from './entrypoints/ErrorModal';
import { createDebugLogger, isDebugEnabled } from './utils/debugLogger';
import { getRuntimeMode } from './utils/getRuntimeMode';
import { captureDeletedItemsWithoutLambda } from './utils/lambdaLessCapture';

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
        .notice(
          'Record Bin stopped this deletion: the dashboard must support bounded bulk operations before a selection above 200 records can be deleted safely. The original records have been kept.',
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
  itemFormOutlets(model: ItemType, _ctx: ItemFormOutletsCtx) {
    const debugLogger = createDebugLogger(
      isDebugEnabled(_ctx.plugin.attributes.parameters),
      'index.itemFormOutlets',
    );
    if (model.attributes.api_key === 'record_bin') {
      debugLogger.log('Registering item form outlet for record_bin model');
      return [
        {
          id: 'recordBin',
          initialHeight: 0,
        },
      ];
    }

    debugLogger.log('Skipping item form outlet for model', {
      modelApiKey: model.attributes.api_key,
    });
    return [];
  },
  renderItemFormOutlet(outletId, ctx: RenderItemFormOutletCtx) {
    const debugLogger = createDebugLogger(
      isDebugEnabled(ctx.plugin.attributes.parameters),
      'index.renderItemFormOutlet',
    );
    if (outletId === 'recordBin') {
      debugLogger.log('Rendering record bin outlet');
      render(<BinOutlet ctx={ctx} />);
      return;
    }

    debugLogger.log('Skipping outlet rendering', {
      outletId,
    });
  },
  renderModal(modalId: string, ctx: RenderModalCtx) {
    const debugLogger = createDebugLogger(
      isDebugEnabled(ctx.plugin.attributes.parameters),
      'index.renderModal',
    );
    debugLogger.log('Rendering modal', { modalId });

    switch (modalId) {
      case 'errorModal':
        return render(<ErrorModal ctx={ctx} />);
      default:
        debugLogger.warn('Received unknown modal id', { modalId });
        return undefined;
    }
  },
});
