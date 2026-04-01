import type { SchemaTypes } from '@datocms/cma-client-browser';
import {
  connect,
  type ExecuteItemsDropdownActionCtx,
  type ItemDropdownActionsCtx,
  type RenderModalCtx,
} from 'datocms-plugin-sdk';
import 'datocms-react-ui/styles.css';
import { bulkChangeCreator } from './actions/bulkChangeCreator';
import ConfigScreen from './entrypoints/ConfigScreen';
import SelectCreatorModal from './entrypoints/SelectCreatorModal';
import { render } from './utils/render';

const ACTION_ID = 'bulkChangeCreator';
const MODAL_ID = 'select-creator';
type CreatorType = 'user' | 'sso_user' | 'account' | 'organization';

type ModalResult = { userId: string; userType: CreatorType } | null;

function summarizeFailures(failures: Array<{ id: string; error: unknown }>) {
  const preview = failures
    .slice(0, 3)
    .map(({ id, error }) => {
      const message =
        error instanceof Error
          ? error.message
          : typeof error === 'string'
            ? error
            : JSON.stringify(error);
      return `${id}: ${message}`;
    })
    .join('\n');
  return preview;
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
  async executeItemsDropdownAction(
    actionId: string,
    items,
    ctx: ExecuteItemsDropdownActionCtx,
  ) {
    if (actionId !== ACTION_ID) {
      return;
    }

    if (!ctx.currentUserAccessToken) {
      ctx.alert(
        "This action requires the 'currentUserAccessToken' permission to be granted to the plugin.",
      );
      return;
    }

    const modalResult = (await ctx.openModal({
      id: MODAL_ID,
      title: 'Change creators',
      width: 'm',
      parameters: {
        itemCount: items.length,
      },
    })) as ModalResult;

    if (!modalResult?.userId) {
      return;
    }

    const { ok, fail } = await bulkChangeCreator({
      apiToken: ctx.currentUserAccessToken,
      environment: ctx.environment,
      itemIds: items.map((item) => item.id),
      userId: modalResult.userId,
      userType: modalResult.userType,
    });

    if (ok.length) {
      ctx.notice(
        `Creator changed on ${ok.length} record${ok.length === 1 ? '' : 's'}.`,
      );
    }

    if (fail.length) {
      const message = `Failed to update ${fail.length} record${fail.length === 1 ? '' : 's'}.`;
      const details = summarizeFailures(fail);
      ctx.alert(details ? `${message}\n\n${details}` : message);
    }
  },
  renderModal(modalId: string, modalCtx: RenderModalCtx) {
    if (modalId !== MODAL_ID) {
      return;
    }

    return render(<SelectCreatorModal ctx={modalCtx} />);
  },
});
