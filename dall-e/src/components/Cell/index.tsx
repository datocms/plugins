import { RenderAssetSourceCtx } from 'datocms-plugin-sdk';
import { useCtx } from 'datocms-react-ui';
import s from './styles.module.css';

export type GeneratedImage = {
  b64_json?: string;
  url?: string;
  revised_prompt?: string;
};

const Cell = ({
  image,
  onClick,
}: {
  image: GeneratedImage;
  onClick: () => void;
}) => {
  const ctx = useCtx<RenderAssetSourceCtx>();
  return (
    <div className={s.cell} onClick={onClick}>
      <img
        className={s.image}
        src={`data:image/png;base64,${image.b64_json}`}
        alt=""
        onLoad={() => {
          ctx.updateHeight();
        }}
      />
    </div>
  );
};

export default Cell;
