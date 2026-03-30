import type { RenderConfigScreenCtx } from 'datocms-plugin-sdk';
import { Canvas, Button } from 'datocms-react-ui';

type Props = {
  ctx: RenderConfigScreenCtx;
};

export default function ConfigScreen({ ctx }: Props) {
  return (
    <Canvas ctx={ctx}>
      <Button
        buttonType="muted"
        buttonSize="l"
        fullWidth
        onClick={() => ctx.navigateTo(`/configuration/p/${ctx.plugin.id}/pages/optimize-assets`)}
      >
        Go to asset optimization
      </Button>
    </Canvas>
  );
}
