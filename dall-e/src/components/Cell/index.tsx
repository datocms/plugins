import { type RenderAssetSourceCtx } from 'datocms-plugin-sdk';
import { useCtx } from 'datocms-react-ui';
import type { NormalizedGeneratedImage } from '../../utils/imageService';
import s from './styles.module.css';

const Cell = ({
  image,
  selected,
  onToggleSelected,
}: {
  image: NormalizedGeneratedImage;
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
      <img
        alt="Generated preview"
        className={s.image}
        src={image.previewSrc}
        onLoad={() => {
          ctx.updateHeight();
        }}
      />
    </button>
  );
};

export default Cell;
