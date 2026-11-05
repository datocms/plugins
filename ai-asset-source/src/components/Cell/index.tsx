import MediaCard from 'datocms-react-ui/MediaCard';
import type { NormalizedGeneratedImage } from '../../utils/imageService/types';

type Props = {
  image: NormalizedGeneratedImage;
  /** The description that made the image: the name of the card */
  caption: string;
  selected: boolean;
  /** An image of the grid is selected: every checkbox shows, not only on hover */
  anySelected: boolean;
  sent: boolean;
  onPreviewFailed: () => void;
  onToggleSelected: () => void;
};

// Every card has the same square box, and the image keeps its own ratio in it
const mediaBox = { display: 'block', width: '100%', aspectRatio: '1 / 1' };

export default function Cell({
  image,
  caption,
  selected,
  anySelected,
  sent,
  onPreviewFailed,
  onToggleSelected,
}: Props) {
  // The caption is cut to one line: the image shows the whole description
  // on hover
  const preview = (
    <img
      src={image.previewSrc}
      alt={caption}
      title={caption}
      loading="lazy"
      decoding="async"
      style={{ ...mediaBox, objectFit: 'contain' }}
      onError={onPreviewFailed}
    />
  );

  if (sent) {
    return (
      <MediaCard
        caption={{ text: 'Added to the Media Area', muted: true }}
        disabled
      >
        {preview}
      </MediaCard>
    );
  }

  // A generated image has no title of its own: its caption is muted
  return (
    <MediaCard
      caption={{ text: caption, muted: true }}
      selection={{
        selected,
        onSelect: onToggleSelected,
        checkbox: anySelected ? 'always' : 'hover',
      }}
    >
      {preview}
    </MediaCard>
  );
}
