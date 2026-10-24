import BlankSlate from 'datocms-react-ui/BlankSlate';
import MediaCard from 'datocms-react-ui/MediaCard';
import { useState } from 'react';
import { CircleExclamationIcon } from '../../icons';
import type { NormalizedGenerationImage } from '../../utils/imageService/types';

type Props = {
  image: NormalizedGenerationImage;
  selected: boolean;
  sent: boolean;
  hasSelection: boolean;
  onPreviewFailed: () => void;
  onToggleSelected: () => void;
};

export default function Cell({
  image,
  selected,
  sent,
  hasSelection,
  onPreviewFailed,
  onToggleSelected,
}: Props) {
  const [previewFailed, setPreviewFailed] = useState(false);

  if (image.kind === 'error' || previewFailed) {
    return (
      <MediaCard caption={`Image ${image.position}`}>
        <BlankSlate
          placement="inline"
          small
          error
          icon={<CircleExclamationIcon />}
          title={
            image.kind === 'error' ? 'Image unavailable' : 'Preview unavailable'
          }
          description={
            image.kind === 'error'
              ? image.errorMessage
              : 'The preview could not be displayed for this generated image.'
          }
        />
      </MediaCard>
    );
  }

  const preview = (
    <img
      src={image.previewSrc}
      alt="Generated preview"
      loading="lazy"
      decoding="async"
      style={{ display: 'block', width: '100%', height: 'auto' }}
      onError={() => {
        setPreviewFailed(true);
        onPreviewFailed();
      }}
    />
  );

  if (sent) {
    return (
      <MediaCard caption="Sent to the Media Area" captionDisabled>
        {preview}
      </MediaCard>
    );
  }

  return (
    <MediaCard
      caption={`Image ${image.position}`}
      selection={{
        selected,
        onSelect: onToggleSelected,
        checkbox: hasSelection ? 'always' : 'hover',
      }}
    >
      {preview}
    </MediaCard>
  );
}
