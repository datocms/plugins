import { RenderConfigScreenCtx } from "datocms-plugin-sdk";
import { Button, Canvas, FieldGroup } from "datocms-react-ui";

type Props = {
  ctx: RenderConfigScreenCtx;
};

export default function ConfigScreen({ ctx }: Props) {
  const openNetlifyPage = () => {
    window.open(`https://app.netlify.com/`);
  };

  const openBackupsPage = async () => {
    await ctx.navigateTo("/admin/environments");
  };

  return (
    <Canvas ctx={ctx}>
      <h4>Weekly and daily backups have been successfully setup!</h4>
      <FieldGroup>
        <Button onClick={openNetlifyPage}>Manage my functions</Button>
        <Button onClick={openBackupsPage}>Manage my backups</Button>
      </FieldGroup>
    </Canvas>
  );
}
