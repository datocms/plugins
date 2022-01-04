import { useEffect, useState } from 'react';
import { Basic as Photo } from 'unsplash-js/dist/methods/photos/types';
import { BlurhashCanvas } from 'react-blurhash';
import s from './styles.module.css';

const Cell = ({ photo, onClick }: { photo: Photo; onClick: () => void }) => {
  const [loaded, setLoaded] = useState(false);

  useEffect(() => {
    const img = new Image();
    img.onload = () => setLoaded(true);
    img.src = photo.urls.small;
  }, [photo.urls.small]);

  return (
    <div className={s.cell} onClick={onClick}>
      <div
        className={s.cellBlurhash}
        style={{ paddingTop: `${(photo.height / photo.width) * 100}%` }}
      >
        {photo.blur_hash && (
          <BlurhashCanvas hash={photo.blur_hash} width={32} height={32} />
        )}
      </div>
      <img
        className={s.image}
        src={photo.urls.small}
        alt={photo.alt_description || `Image ${photo.id}`}
        style={{ opacity: loaded ? 1 : 0 }}
      />
      <div className={s.hover}>
        <a
          className={s.author}
          href={`https://unsplash.com/@${photo.user.username}?utm_source=datocms&utm_medium=referral`}
          target="_blank"
          rel="noreferrer"
          onClick={(e) => {
            e.stopPropagation();
          }}
        >
          <div className={s.authorAvatar}>
            <img src={photo.user.profile_image.small} alt={photo.user.name} />
          </div>
          <div className={s.authorName}>{photo.user.name}</div>
        </a>
      </div>
    </div>
  );
};

export default Cell;
