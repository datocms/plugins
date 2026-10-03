import type { RenderAssetSourceCtx } from 'datocms-plugin-sdk';
import { useCtx } from 'datocms-react-ui';
import { useState } from 'react';
import type { NormalizedGenerationImage } from '../../utils/imageService/types';
import s from './styles.module.css';

type Props = {
  image: NormalizedGenerationImage;
  selected: boolean;
  sent: boolean;
  onPreviewFailed: () => void;
  onToggleSelected: () => void;
};

export default function Cell({
  image,
  selected,
  sent,
  onPreviewFailed,
  onToggleSelected,
}: Props) {
  const ctx = useCtx<RenderAssetSourceCtx>();
  const [previewFailed, setPreviewFailed] = useState(false);

  const isSelectable = image.kind === 'success' && !previewFailed && !sent;
  const hasInlineError = image.kind === 'error' || previewFailed;
  const cellClassName = [
    s.cell,
    selected && isSelectable ? s.cellSelected : '',
    hasInlineError ? s.cellError : '',
  ]
    .filter(Boolean)
    .join(' ');
  const selectionMarkClassName = selected
    ? `${s.selectionMark} ${s.selectionMarkSelected}`
    : s.selectionMark;
  const inlineErrorTitle =
    image.kind === 'error'
      ? `Image ${image.position} unavailable`
      : 'Preview unavailable';
  const inlineErrorMessage =
    image.kind === 'error'
      ? image.errorMessage
      : 'The preview could not be displayed for this generated image.';

  if (hasInlineError) {
    return (
      <div
        aria-label={`${inlineErrorTitle}. ${inlineErrorMessage}`}
        className={cellClassName}
        role="img"
      >
        <div className={s.errorState}>
          <div className={s.errorPosition}>Image {image.position}</div>
          <div className={s.errorTitle}>{inlineErrorTitle}</div>
          <div className={s.errorMessage}>{inlineErrorMessage}</div>
        </div>
      </div>
    );
  }

  return (
    <button
      aria-pressed={selected}
      title={sent ? 'Sent to the Media Area' : undefined}
      className={cellClassName}
      disabled={!isSelectable}
      onClick={onToggleSelected}
      type="button"
    >
      <span aria-hidden="true" className={selectionMarkClassName}>
        <span className={s.selectionIcon} />
      </span>
      <img
        alt="Generated preview"
        className={s.image}
        loading="lazy"
        decoding="async"
        src={image.previewSrc}
        onError={() => {
          setPreviewFailed(true);
          onPreviewFailed();
          ctx.updateHeight();
        }}
        onLoad={() => {
          ctx.updateHeight();
        }}
      />
    </button>
  );
}
