import type { RenderConfigScreenCtx } from 'datocms-plugin-sdk';
import { Button, Canvas } from 'datocms-react-ui';

type Props = {
  ctx: RenderConfigScreenCtx;
};

export default function ConfigScreen({ ctx }: Props) {
  const environmentPrefix = ctx.isEnvironmentPrimary
    ? ''
    : `/environments/${ctx.environment}`;

  return (
    <Canvas ctx={ctx}>
      <Button
        buttonType="muted"
        buttonSize="l"
        fullWidth
        onClick={() =>
          ctx.navigateTo(
            `${environmentPrefix}/configuration/p/${ctx.plugin.id}/pages/optimize-assets`,
          )
        }
      >
        Go to asset optimization
      </Button>
    </Canvas>
  );
}
