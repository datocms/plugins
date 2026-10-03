import type { RenderConfigScreenCtx } from 'datocms-plugin-sdk';
import { Canvas } from 'datocms-react-ui';
import { Button } from '../ui/Button';

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
            title: 'Delete unused assets',
            width: 'm',
          });
        }}
        fullWidth
        buttonType="primary"
      >
        Scan for unused assets
      </Button>
    </Canvas>
  );
}
