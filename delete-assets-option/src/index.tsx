import { buildClient } from '@datocms/cma-client-browser';
import { connect, type RenderModalCtx } from 'datocms-plugin-sdk';
import 'datocms-react-ui/styles.css';
import DeletionModal from './entrypoints/DeletionModal';
import {
  collectAssets,
  deleteAssets,
  waitForRecordDeletion,
} from './utils/assetCleanup';
import { render } from './utils/render';

connect({
  renderModal(modalId: string, ctx: RenderModalCtx) {
    switch (modalId) {
      case 'deletionModal':
        return render(<DeletionModal ctx={ctx} />);
    }
  },
  async onBeforeItemsDestroy(items, ctx) {
    if (items.length === 0) return true;

    const wantToDelete = await ctx.openModal({
      id: 'deletionModal',
      title: 'Delete assets only used in these records?',
      width: 's',
      closeDisabled: true,
    });
    if (wantToDelete !== true) return true;

    if (!ctx.currentUserAccessToken) {
      await ctx.alert(
        'Asset cleanup requires API access. Records will be deleted; assets will be kept.',
      );
      return true;
    }

    const client = buildClient({
      apiToken: ctx.currentUserAccessToken,
      environment: ctx.environment,
      baseUrl: ctx.cmaBaseUrl,
    });
    const recordIds = [...new Set(items.map((item) => item.id))];

    let uploadIds: string[];
    try {
      uploadIds = await collectAssets(client, recordIds);
    } catch {
      await ctx.alert(
        'Could not collect the assets of these records. Records will be deleted; assets will be kept.',
      );
      return true;
    }
    if (uploadIds.length === 0) return true;

    // There is no after-destroy hook: let the dashboard delete the records,
    // and only delete the assets once the records are gone.
    const cleanUp = async () => {
      try {
        await waitForRecordDeletion(client, recordIds);
      } catch {
        await ctx.alert(
          'Could not confirm that the records were deleted, so their assets were kept.',
        );
        return;
      }
      try {
        const { deleted, kept } = await deleteAssets(client, uploadIds);
        await ctx.notice(
          `${deleted} assets successfully deleted; ${kept} kept because they are still in use.`,
        );
      } catch {
        await ctx.alert('Could not delete all the assets of these records.');
      }
    };
    void cleanUp().catch(() => {});

    return true;
  },
});
