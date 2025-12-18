import { RenderConfigScreenCtx } from "datocms-plugin-sdk";
import { Button, Canvas } from "datocms-react-ui";

type Props = {
  ctx: RenderConfigScreenCtx;
};

export default function PreInstallConfig({ ctx }: Props) {
  const handleRetryInstallation = async () => {
    ctx.updatePluginParameters({ installationState: null });
    await ctx.openModal({
      id: "installationModal",
      title: "Automatic Backups setup",
      width: "m",
      closeDisabled: true,
    });
  };

  return (
    <Canvas ctx={ctx}>
      <h2>The plugin installation could not be completed.</h2>
      <Button onClick={handleRetryInstallation} fullWidth buttonType="primary">
        Retry installation
      </Button>
    </Canvas>
  );
}
