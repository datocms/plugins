import { RenderModalCtx } from 'datocms-plugin-sdk';
import { Button, Canvas } from 'datocms-react-ui';
import styles from './styles.module.css';

type PropTypes = {
  ctx: RenderModalCtx;
};

export default function DeletionModal({ ctx }: PropTypes) {
  const handleClose = (returnValue: boolean) => {
    ctx.resolve(returnValue);
  };

  return (
    <Canvas ctx={ctx}>
      <div className={styles.buttonContainer}>
        <Button fullWidth onClick={handleClose.bind(null, false)}>Keep</Button>
        <Button fullWidth buttonType="negative" onClick={handleClose.bind(null, true)}>
          Delete
        </Button>
      </div>
    </Canvas>
  );
}
