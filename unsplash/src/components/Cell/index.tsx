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
    <div className={s.cell}>
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
        onClick={onClick}
        style={{ opacity: loaded ? 1 : 0 }}
      />
      <div className={s.hover}>
        <div className={s.author}>
          <div className={s.authorAvatar}>
            <img src={photo.user.profile_image.small} alt={photo.user.name} />
          </div>
          <div className={s.authorName}>{photo.user.name}</div>
        </div>
      </div>
    </div>
  );
};

export default Cell;
