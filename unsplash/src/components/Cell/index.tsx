import Button from 'datocms-react-ui/Button';
import MediaCard from 'datocms-react-ui/MediaCard';
import { useEffect, useState } from 'react';
import { BlurhashCanvas } from 'react-blurhash';
import type { Basic as Photo } from 'unsplash-js/dist/methods/photos/types';
import { OpenInNewTabIcon } from '../../icons';
import s from './styles.module.css';

const Cell = ({ photo, onClick }: { photo: Photo; onClick: () => void }) => {
  const [loaded, setLoaded] = useState(false);

  useEffect(() => {
    const img = new Image();
    img.onload = () => setLoaded(true);
    img.src = photo.urls.small;
  }, [photo.urls.small]);

  return (
    <MediaCard
      onClick={onClick}
      caption={{ text: `Photo by ${photo.user.name}` }}
      captionAction={
        <Button
          tone="ghost"
          size="micro"
          iconOnly
          icon={OpenInNewTabIcon}
          label="View profile on Unsplash"
          onClick={(event) => {
            // A click on the caption uploads the photo
            event.stopPropagation();
            window.open(
              `https://unsplash.com/@${photo.user.username}?utm_source=datocms&utm_medium=referral`,
              '_blank',
              'noreferrer',
            );
          }}
        />
      }
    >
      <div
        className={s.media}
        style={{ aspectRatio: `${photo.width} / ${photo.height}` }}
      >
        {photo.blur_hash && (
          <BlurhashCanvas hash={photo.blur_hash} width={32} height={32} />
        )}
        <img
          src={photo.urls.small}
          alt={photo.alt_description ?? ''}
          style={{ opacity: loaded ? 1 : 0 }}
        />
      </div>
    </MediaCard>
  );
};

export default Cell;
