import MediaCard from 'datocms-react-ui/MediaCard';
import { useEffect, useState } from 'react';
import { BlurhashCanvas } from 'react-blurhash';
import type { Basic as Photo } from 'unsplash-js/dist/methods/photos/types';
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
      caption={
        <a
          href={`https://unsplash.com/@${photo.user.username}?utm_source=datocms&utm_medium=referral`}
          target="_blank"
          rel="noreferrer"
          onClick={(event) => event.stopPropagation()}
        >
          {photo.user.name}
        </a>
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
          alt={photo.alt_description || `Image ${photo.id}`}
          style={{ opacity: loaded ? 1 : 0 }}
        />
      </div>
    </MediaCard>
  );
};

export default Cell;
