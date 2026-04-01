import { connect, type RenderModalCtx } from 'datocms-plugin-sdk';
import 'datocms-react-ui/styles.css';
import { buildClient } from '@datocms/cma-client-browser';
import DeletionModal from './entrypoints/DeletionModal';
import findUploadIds from './utils/findUploadIds';
import { render } from './utils/render';

connect({
  renderModal(modalId: string, ctx: RenderModalCtx) {
    switch (modalId) {
      case 'deletionModal':
        return render(<DeletionModal ctx={ctx} />);
    }
  },
  async onBeforeItemsDestroy(items, ctx) {
    const wantToDelete = await ctx.openModal({
      id: 'deletionModal',
      title: 'Delete assets only used in these records?',
      width: 's',
      closeDisabled: true,
    });

    if (!wantToDelete) {
      return true;
    }

    const apiToken = ctx.currentUserAccessToken;
    if (!apiToken) {
      return true;
    }

    const client = buildClient({ apiToken });

    const itemsWithUploads = await Promise.all(
      items.map(async (deletedItem) => {
        const item = await client.items.find(deletedItem.id, { nested: true });
        const uploadIds = findUploadIds(item as Record<string, unknown>);
        return uploadIds;
      }),
    );

    const allUploadIds = itemsWithUploads
      .filter((ids): ids is string[] => ids !== null)
      .flat();

    if (allUploadIds.length === 0) {
      return true;
    }

    setTimeout(() => {
      client.uploads
        .bulkDestroy({
          uploads: allUploadIds.map((id) => ({
            type: 'upload',
            id: id,
          })),
        })
        .then(() => {
          ctx.notice(`${allUploadIds.length} assets successfully deleted!`);
        });
    }, 5000);

    return true;
  },
});
