import { RenderConfigScreenCtx } from 'datocms-plugin-sdk';
import { Button, Canvas } from 'datocms-react-ui';

type Props = {
  ctx: RenderConfigScreenCtx;
};

export default function ConfigScreen({ ctx }: Props) {
  return (
    <Canvas ctx={ctx}>
      <Button
        onClick={() => {
          ctx.openModal({
            id: 'deleteAssetsConfirmation',
            title: 'Deletion confirmation',
            width: 'm',
          });
        }}
        fullWidth
        buttonType="primary"
      >
        Delete all unused assets
      </Button>
    </Canvas>
  );
}
