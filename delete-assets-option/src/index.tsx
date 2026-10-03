import { connect, type RenderModalCtx } from 'datocms-plugin-sdk';
import 'datocms-react-ui/styles.css';
import CleanupProgressModal from './entrypoints/CleanupProgressModal';
import DeletionModal from './entrypoints/DeletionModal';
import { beforeItemsDestroy } from './utils/beforeItemsDestroy';
import { render } from './utils/render';

connect({
  renderModal(modalId: string, ctx: RenderModalCtx) {
    switch (modalId) {
      case 'deletionModal':
        return render(<DeletionModal ctx={ctx} />);
      case 'cleanupProgress':
        return render(<CleanupProgressModal ctx={ctx} />);
    }
  },
  onBeforeItemsDestroy: beforeItemsDestroy,
});
