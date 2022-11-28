import { RenderAssetSourceCtx } from 'datocms-plugin-sdk';
import { useCtx } from 'datocms-react-ui';
import { ImagesResponse } from 'openai';
import s from './styles.module.css';

type Image = ImagesResponse['data'][0];

const Cell = ({ image, onClick }: { image: Image; onClick: () => void }) => {
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
