import { connect, RenderModalCtx } from 'datocms-plugin-sdk';
import { render } from './utils/render';
import ConfigScreen from './entrypoints/ConfigScreen';
import 'datocms-react-ui/styles.css';
import PreInstallConfig from './entrypoints/PreInstallConfig';
import InstallationModal from './entrypoints/InstallationModal';

connect({
  async onBoot(ctx) {
    if (
      !ctx.plugin.attributes.parameters.installationState &&
      !ctx.plugin.attributes.parameters.hasBeenPrompted
    ) {
      ctx.updatePluginParameters({ hasBeenPrompted: true });
      await ctx.openModal({
        id: 'installationModal',
        title: 'Automatic Backups setup',
        width: 'm',
        parameters: { foo: 'bar' },
        closeDisabled: true,
      });
      return;
    }
  },
  renderConfigScreen(ctx) {
    if (ctx.plugin.attributes.parameters.installationState === 'installed') {
      return render(<ConfigScreen ctx={ctx} />);
    } else {
      return render(<PreInstallConfig ctx={ctx} />);
    }
  },
  renderModal(modalId: string, ctx: RenderModalCtx) {
    switch (modalId) {
      case 'installationModal':
        return render(<InstallationModal ctx={ctx} />);
    }
  },
});
