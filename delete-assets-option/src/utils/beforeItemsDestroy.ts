import type { OnBeforeItemsDestroyCtx } from 'datocms-plugin-sdk';
import {
  type CleanupClient,
  collectAssets,
  deleteCollectedAssets,
  waitForRecordDeletion,
} from './assetCleanup';
import { createCleanupProgress } from './cleanupProgress';
import { createClient } from './createClient';

type DeletionContext = Pick<
  OnBeforeItemsDestroyCtx,
  | 'openModal'
  | 'alert'
  | 'notice'
  | 'customToast'
  | 'currentUserAccessToken'
  | 'environment'
  | 'cmaBaseUrl'
>;

export async function beforeItemsDestroy(
  items: readonly { id: string }[],
  ctx: DeletionContext,
  clientFactory: (ctx: DeletionContext) => CleanupClient = createClient,
) {
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

  const recordIds = [...new Set(items.map((item) => item.id))];
  const progress = createCleanupProgress(ctx, recordIds.length);
  const options = { signal: progress.signal, onProgress: progress.report };
  let client: CleanupClient;
  let uploadIds: string[];
  try {
    client = clientFactory(ctx);
    uploadIds = await collectAssets(client, recordIds, options);
  } catch {
    progress.finish();
    await progress.handoff();
    if (!progress.signal.aborted) {
      await ctx.alert(
        'Could not collect all assets safely. Records will be deleted; assets will be kept.',
      );
    }
    return true;
  }
  if (uploadIds.length === 0 || progress.signal.aborted) {
    progress.finish();
    await progress.handoff();
    return true;
  }
  // Close the collection modal before the host's own reference confirmation.
  // Subsequent progress uses notifications so it cannot cover that dialog.
  await progress.handoff();

  // There is no after-destroy SDK hook. Release the before hook so the host
  // can delete the records, then observe disappearance instead of assuming a
  // fixed delay. The boot iframe owns this continuous, caught background task.
  const cleanup = async () => {
    try {
      await waitForRecordDeletion(client, recordIds, options);
      const result = await deleteCollectedAssets(client, uploadIds, options);
      const summary = `${result.deleted} assets successfully deleted; ${result.kept} kept; ${result.unavailable} already unavailable; ${result.unconfirmed} unconfirmed.`;
      if (result.cancelled || result.unconfirmed > 0) {
        await ctx.alert(
          `${summary} Asset cleanup ${result.cancelled ? 'was cancelled' : 'could not confirm every result'}.`,
        );
      } else {
        await ctx.notice(summary);
      }
    } catch {
      if (!progress.signal.aborted) {
        await ctx.alert(
          'Could not verify record deletion. Asset cleanup stopped safely; assets were kept.',
        );
      }
    } finally {
      progress.finish();
    }
  };
  // Errors in host notification methods must not become unhandled rejections.
  void cleanup().catch(() => progress.finish());
  return true;
}
