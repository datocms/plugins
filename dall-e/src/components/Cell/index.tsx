import { type RenderAssetSourceCtx } from 'datocms-plugin-sdk';
import { useCtx } from 'datocms-react-ui';
import { Image } from '../../components/ai-elements/image';
import type { GeneratedAssetImage } from '../../utils/openaiImages';
import s from './styles.module.css';

const Cell = ({
  image,
  selected,
  onToggleSelected,
}: {
  image: GeneratedAssetImage;
  selected: boolean;
  onToggleSelected: () => void;
}) => {
  const ctx = useCtx<RenderAssetSourceCtx>();

  return (
    <button
      aria-pressed={selected}
      className={selected ? `${s.cell} ${s.cellSelected}` : s.cell}
      onClick={onToggleSelected}
      type="button"
    >
      <span
        aria-hidden="true"
        className={selected ? `${s.selectionMark} ${s.selectionMarkSelected}` : s.selectionMark}
      >
        <span className={s.selectionIcon} />
      </span>
      <Image
        alt="Generated preview"
        base64={image.base64}
        className={s.image}
        mediaType={image.mediaType}
        onLoad={() => {
          ctx.updateHeight();
        }}
      />
    </button>
  );
};

export default Cell;
