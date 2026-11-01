import { buildClient } from '@datocms/cma-client-browser';
import { connect } from 'datocms-plugin-sdk';
import {
  collectAssets,
  deleteAssets,
  waitForRecordDeletion,
} from './utils/assetCleanup';

const assets = (count: number) =>
  `${count} ${count === 1 ? 'asset' : 'assets'}`;

connect({
  async onBeforeItemsDestroy(items, ctx) {
    if (items.length === 0) return true;

    const wantToDelete = await ctx.openConfirm({
      title: 'Delete assets only used in these records?',
      content:
        'The assets are deleted once the records are gone. Assets still used elsewhere are kept.',
      choices: [{ label: 'Delete', value: true, intent: 'negative' }],
      cancel: { label: 'Keep', value: false },
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
          kept > 0
            ? `Deleted ${assets(deleted)}. Kept ${assets(kept)} still in use elsewhere.`
            : `Deleted ${assets(deleted)}.`,
        );
      } catch {
        await ctx.alert('Could not delete all the assets of these records.');
      }
    };
    void cleanUp().catch(() => {});

    return true;
  },
});
