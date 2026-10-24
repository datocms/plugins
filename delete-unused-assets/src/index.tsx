import { connect, type RenderModalCtx } from 'datocms-plugin-sdk';
import 'datocms-react-ui/styles.css';
import ConfigScreen from './entrypoints/ConfigScreen';
import CustomModal from './entrypoints/CustomModal';
import { render } from './utils/render';

connect({
  renderConfigScreen(ctx) {
    return render(<ConfigScreen ctx={ctx} />);
  },
  renderModal(modalId: string, ctx: RenderModalCtx) {
    switch (modalId) {
      case 'deleteAssetsConfirmation':
        return render(<CustomModal ctx={ctx} />);
    }
  },
});
