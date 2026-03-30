import { RenderModalCtx, connect } from 'datocms-plugin-sdk';
import { render } from './utils/render';
import ConfigScreen from './entrypoints/ConfigScreen';
import 'datocms-react-ui/styles.css';
import CustomModal from './entrypoints/CustomModal';

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
