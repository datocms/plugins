import { connect, RenderModalCtx } from 'datocms-plugin-sdk';
import 'datocms-react-ui/styles.css';
import { render } from './utils/render';
import { buildClient } from '@datocms/cma-client-browser';
import findUploadIds from './utils/findUploadIds';
import DeletionModal from './entrypoints/DeletionModal';

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

    for (const deletedItem of items) {
      const client = buildClient({ apiToken: ctx.currentUserAccessToken! });
      const item = await client.items.find(deletedItem.id, { nested: true });

      const uploadIds = findUploadIds(item);

      if (!uploadIds) {
        return true;
      }

      setTimeout(() => {
        client.uploads
          .bulkDestroy({
            uploads: uploadIds.map((id) => ({
              type: 'upload',
              id: id,
            })),
          })
          .then((job) => {
            ctx.notice(`${uploadIds.length} assets successfully deleted!`);
          });
      }, 5000);
    }
    return true;
  },
});
