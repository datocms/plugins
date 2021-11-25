import { RenderFieldExtensionCtx } from 'datocms-plugin-sdk';
import { Canvas } from 'datocms-react-ui';
import generateDummyText from '../../utils/generateDummyText';
import s from './styles.module.css';

type Props = {
  ctx: RenderFieldExtensionCtx;
};

export default function FieldExtension({ ctx }: Props) {
  const handleClick = () => {
    ctx.setFieldValue(ctx.fieldPath, generateDummyText(ctx.field));
  };

  return (
    <Canvas ctx={ctx}>
      <button type="button" onClick={handleClick} className={s.link}>
        Fill in with dummy data
      </button>
    </Canvas>
  );
}
