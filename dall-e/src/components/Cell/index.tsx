import { RenderAssetSourceCtx } from 'datocms-plugin-sdk';
import { useCtx } from 'datocms-react-ui';
import type { GeneratedImage } from '../../utils/openaiImages';
import s from './styles.module.css';

const Cell = ({
  image,
  selected,
  onToggleSelected,
}: {
  image: GeneratedImage;
  selected: boolean;
  onToggleSelected: () => void;
}) => {
  const ctx = useCtx<RenderAssetSourceCtx>();

  return (
    <button
      className={selected ? `${s.cell} ${s.cellSelected}` : s.cell}
      onClick={onToggleSelected}
      type="button"
      aria-pressed={selected}
    >
      <span
        className={selected ? `${s.selectionMark} ${s.selectionMarkSelected}` : s.selectionMark}
        aria-hidden="true"
      >
        <span className={s.selectionIcon} />
      </span>
      <img
        className={s.image}
        src={image.previewSrc}
        alt="Generated preview"
        onLoad={() => {
          ctx.updateHeight();
        }}
      />
    </button>
  );
};

export default Cell;
